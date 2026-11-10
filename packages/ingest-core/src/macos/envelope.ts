import { normalizePersonId } from "../person-id.ts";
import {
  isPowerKind,
  MACOS_MAX_EVENTS,
  MACOS_SCHEMA_VERSION,
  SCREEN_TIME_STREAM,
} from "./constants.ts";
import {
  normalizeScreenTimeEvent,
  osAccountBk,
  type PowerEventInput,
  type ScreenTimeEventInput,
} from "./model.ts";
import { canonicalOffsetTimestamp } from "./time.ts";

export type CollectorIdentity = {
  hardware_uuid: string;
  os_user_id: number;
  computer_name: string;
  model: string;
  os_version: string;
  timezone: string;
  person_id: string;
};

export type MacosPowerEnvelope = {
  schema_version: 1;
  record_source: "macos_power";
  entity: "power_event";
  exported_at: string;
  collector: CollectorIdentity;
  events: PowerEventInput[];
};

export type MacosScreenTimeEnvelope = {
  schema_version: 1;
  record_source: "macos_screentime";
  entity: "usage_interval";
  exported_at: string;
  collector: CollectorIdentity;
  extract?: { stream_counts?: Record<string, number> };
  events: ScreenTimeEventInput[];
};

export type MacosEnvelope = MacosPowerEnvelope | MacosScreenTimeEnvelope;

export type EnvelopeInvalid = { ok: false; detail: string };
export type EnvelopeValid = { ok: true; envelope: MacosEnvelope };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCollector(value: unknown): CollectorIdentity | string {
  if (!isRecord(value)) return "collector is required";
  const hardware = value.hardware_uuid;
  const uid = value.os_user_id;
  const name = value.computer_name;
  if (typeof hardware !== "string" || hardware.trim().length === 0) {
    return "collector.hardware_uuid is required";
  }
  if (typeof uid !== "number" || !Number.isInteger(uid) || uid < 0) {
    return "collector.os_user_id must be a non-negative integer";
  }
  if (typeof name !== "string" || name.trim().length === 0) {
    return "collector.computer_name is required";
  }
  const personId = normalizePersonId(value.person_id);
  if (!personId) return "collector.person_id is required";
  return {
    hardware_uuid: hardware.trim(),
    os_user_id: uid,
    computer_name: name,
    model: typeof value.model === "string" ? value.model : "",
    os_version: typeof value.os_version === "string" ? value.os_version : "",
    timezone: typeof value.timezone === "string" ? value.timezone : "",
    person_id: personId,
  };
}

function readPowerEvents(value: unknown): PowerEventInput[] | string {
  if (!Array.isArray(value)) return "events must be an array";
  if (value.length === 0) return "events must not be empty";
  if (value.length > MACOS_MAX_EVENTS) return `events exceed ${MACOS_MAX_EVENTS}`;
  const events: PowerEventInput[] = [];
  for (const item of value) {
    if (!isRecord(item)) return "power event must be an object";
    if (typeof item.occurred_at !== "string" || !canonicalOffsetTimestamp(item.occurred_at)) {
      return "power event occurred_at must be an offset timestamp";
    }
    if (typeof item.kind !== "string" || !isPowerKind(item.kind)) {
      return "power event kind is not allowed";
    }
    if (typeof item.message !== "string" || typeof item.raw_line !== "string" || item.raw_line.length === 0) {
      return "power event message and raw_line are required";
    }
    const occurredAt = canonicalOffsetTimestamp(item.occurred_at);
    if (!occurredAt) return "power event occurred_at must be an offset timestamp";
    events.push({
      occurred_at: occurredAt,
      kind: item.kind,
      message: item.message,
      raw_line: item.raw_line,
    });
  }
  return events;
}

function readScreenEvents(value: unknown): ScreenTimeEventInput[] | string {
  if (!Array.isArray(value)) return "events must be an array";
  if (value.length === 0) return "events must not be empty";
  if (value.length > MACOS_MAX_EVENTS) return `events exceed ${MACOS_MAX_EVENTS}`;
  const events: ScreenTimeEventInput[] = [];
  for (const item of value) {
    if (!isRecord(item)) return "screen time event must be an object";
    if (item.stream !== SCREEN_TIME_STREAM) return "screen time stream is not allowed";
    const event = normalizeScreenTimeEvent(item);
    if (!event) return "screen time event is invalid";
    events.push(event);
  }
  return events;
}

export function validateMacosEnvelope(payload: unknown): EnvelopeValid | EnvelopeInvalid {
  if (!isRecord(payload)) return { ok: false, detail: "JSON object required" };
  if (payload.schema_version !== MACOS_SCHEMA_VERSION) {
    return { ok: false, detail: "unsupported schema_version" };
  }
  const exported = payload.exported_at;
  if (typeof exported !== "string" || !canonicalOffsetTimestamp(exported)) {
    return { ok: false, detail: "exported_at must be an offset timestamp" };
  }
  const collector = readCollector(payload.collector);
  if (typeof collector === "string") return { ok: false, detail: collector };

  if (payload.record_source === "macos_power" && payload.entity === "power_event") {
    const events = readPowerEvents(payload.events);
    if (typeof events === "string") return { ok: false, detail: events };
    return {
      ok: true,
      envelope: {
        schema_version: 1,
        record_source: "macos_power",
        entity: "power_event",
        exported_at: canonicalOffsetTimestamp(exported) ?? exported,
        collector,
        events,
      },
    };
  }

  if (payload.record_source === "macos_screentime" && payload.entity === "usage_interval") {
    const events = readScreenEvents(payload.events);
    if (typeof events === "string") return { ok: false, detail: events };
    return {
      ok: true,
      envelope: {
        schema_version: 1,
        record_source: "macos_screentime",
        entity: "usage_interval",
        exported_at: canonicalOffsetTimestamp(exported) ?? exported,
        collector,
        events,
      },
    };
  }

  return { ok: false, detail: "record_source and entity are not an allowed pair" };
}

export function collectorOsAccountBk(collector: CollectorIdentity): string {
  return osAccountBk(collector.hardware_uuid, collector.os_user_id);
}
