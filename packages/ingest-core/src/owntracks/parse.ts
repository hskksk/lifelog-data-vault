import { createHash } from "node:crypto";
import { latLngToCell } from "h3-js";

export type OwnTracksPayload = Record<string, unknown>;

export type OwnTracksLocation = {
  locationEventId: string;
  topic: string;
  personId: string;
  tid: string | null;
  tst: Date;
  lat: number;
  lon: number;
  h3IndexR9: string;
  triggerCode: string | null;
  accuracyM: number | null;
  altitudeM: number | null;
  velocityKmh: number | null;
  batteryPct: number | null;
  inRegions: string[] | null;
  motionActivities: string[] | null;
  payload: OwnTracksPayload;
};

export function locationEventId(
  topic: string,
  tst: number,
  lat: number,
  lon: number,
  trigger: string | null,
): string {
  const raw = `${topic}|${tst}|${lat}|${lon}|${trigger ?? ""}`;
  return createHash("md5").update(raw, "utf8").digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function payloadHashdiff(payload: OwnTracksPayload): string {
  const canonical = stableStringify(payload);
  return createHash("md5").update(canonical, "utf8").digest("hex");
}

function asStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((x) => typeof x === "string") ? (value as string[]) : null;
}

export function parseLocationPayload(
  payload: OwnTracksPayload,
  personId: string,
): OwnTracksLocation {
  if (payload._type !== "location") {
    throw new Error(`Expected _type=location, got ${String(payload._type)}`);
  }
  const topic = String(payload.topic ?? "owntracks/unknown/phone");
  const lat = Number(payload.lat);
  const lon = Number(payload.lon);
  const tstRaw = Number(payload.tst);
  const tst = new Date(tstRaw * 1000);
  const triggerCode =
    payload.t === undefined || payload.t === null ? null : String(payload.t);
  const h3IndexR9 = latLngToCell(lat, lon, 9);

  return {
    locationEventId: locationEventId(topic, tstRaw, lat, lon, triggerCode),
    topic,
    personId,
    tid: payload.tid === undefined || payload.tid === null ? null : String(payload.tid),
    tst,
    lat,
    lon,
    h3IndexR9,
    triggerCode,
    accuracyM: payload.acc === undefined ? null : Number(payload.acc),
    altitudeM: payload.alt === undefined ? null : Number(payload.alt),
    velocityKmh: payload.vel === undefined ? null : Number(payload.vel),
    batteryPct: payload.batt === undefined ? null : Number(payload.batt),
    inRegions: asStringList(payload.inregions),
    motionActivities: asStringList(payload.motionactivities),
    payload,
  };
}
