import { isPowerKind, type PowerKind, SCREEN_TIME_STREAM } from "./constants.ts";
import { canonicalOffsetTimestamp, pmsetStampToCanonical } from "./time.ts";

export type PowerEventInput = {
  occurred_at: string;
  kind: PowerKind;
  message: string;
  raw_line: string;
};

export type ScreenTimeEventInput = {
  stream: string;
  bundle_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;
  source_device_ref: string;
};

const PMSET_LINE =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2}) ([+-]\d{4}) (\S+)\s*(.*)$/;

export function parsePmsetLog(text: string): PowerEventInput[] {
  const events: PowerEventInput[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.trim().length === 0) continue;
    const match = PMSET_LINE.exec(rawLine);
    if (!match) continue;
    const date = match[1];
    const time = match[2];
    const offset = match[3];
    const kind = match[4];
    const message = match[5] ?? "";
    if (!date || !time || !offset || !kind || !isPowerKind(kind)) continue;
    const occurredAt = pmsetStampToCanonical(date, time, offset);
    if (!occurredAt) continue;
    events.push({
      occurred_at: occurredAt,
      kind,
      message: message.trim(),
      raw_line: rawLine,
    });
  }
  return events;
}

export function osAccountBk(machineBk: string, uid: number): string {
  return `${machineBk}:${uid}`;
}

export function normalizeScreenTimeEvent(input: Record<string, unknown>): ScreenTimeEventInput | null {
  if (input.stream !== SCREEN_TIME_STREAM) return null;
  if (typeof input.bundle_id !== "string" || input.bundle_id.length === 0) return null;
  if (typeof input.started_at !== "string") return null;
  const startedAt = canonicalOffsetTimestamp(input.started_at);
  if (!startedAt) return null;
  let endedAt: string | null = null;
  if (input.ended_at !== null && input.ended_at !== undefined && input.ended_at !== "") {
    if (typeof input.ended_at !== "string") return null;
    endedAt = canonicalOffsetTimestamp(input.ended_at);
    if (!endedAt) return null;
  }
  const duration = Number(input.duration_seconds);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const source =
    input.source_device_ref === null || input.source_device_ref === undefined
      ? ""
      : String(input.source_device_ref);
  return {
    stream: SCREEN_TIME_STREAM,
    bundle_id: input.bundle_id,
    started_at: startedAt,
    ended_at: endedAt,
    duration_seconds: duration,
    source_device_ref: source,
  };
}
