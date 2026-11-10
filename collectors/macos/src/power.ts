import { execFileSync } from "node:child_process";

import {
  canonicalOffsetTimestamp,
  type CollectorIdentity,
  type MacosPowerEnvelope,
  type PowerEventInput,
  parsePmsetLog,
} from "@lifelog/ingest-core";

import { chunkEvents } from "./chunk.js";
import { windowStart } from "./state.js";

const POWER_OVERLAP_MS = 120 * 60 * 1000;

export function parseIoregPlatformUuid(text: string): string | null {
  const match = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(text);
  return match?.[1] ?? null;
}

export function readMachineIdentity(now = new Date()): Omit<CollectorIdentity, "person_id"> {
  const ioreg = execFileSync("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], { encoding: "utf8" });
  const hardware = parseIoregPlatformUuid(ioreg);
  if (!hardware) throw new Error("IOPlatformUUID was not found");
  const computerName = execFileSync("scutil", ["--get", "ComputerName"], { encoding: "utf8" }).trim();
  if (!computerName) throw new Error("ComputerName is empty");
  const model = execFileSync("sysctl", ["-n", "hw.model"], { encoding: "utf8" }).trim();
  const osVersion = execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim();
  return {
    hardware_uuid: hardware,
    os_user_id: process.getuid?.() ?? 0,
    computer_name: computerName,
    model,
    os_version: osVersion,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

export function readPmsetLog(): string {
  return execFileSync("pmset", ["-g", "log"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

export function powerEventsInWindow(
  logText: string,
  coveredUntil: string | undefined,
  now = new Date(),
): PowerEventInput[] {
  const start = windowStart(coveredUntil, POWER_OVERLAP_MS);
  const startMs = start ? Date.parse(start) : null;
  return parsePmsetLog(logText).filter((event) => {
    if (startMs === null) return true;
    return Date.parse(event.occurred_at) >= startMs;
  }).filter((event) => Date.parse(event.occurred_at) <= now.getTime() + 5 * 60 * 1000);
}

export function powerEnvelopes(
  identity: CollectorIdentity,
  events: PowerEventInput[],
  exportedAt: string,
): MacosPowerEnvelope[] {
  const chunks = chunkEvents(events, (chunk) => ({
    schema_version: 1,
    record_source: "macos_power",
    entity: "power_event",
    exported_at: exportedAt,
    collector: identity,
    events: chunk,
  }));
  return chunks.map((chunk) => ({
    schema_version: 1 as const,
    record_source: "macos_power" as const,
    entity: "power_event" as const,
    exported_at: canonicalOffsetTimestamp(exportedAt) ?? exportedAt,
    collector: identity,
    events: chunk,
  }));
}
