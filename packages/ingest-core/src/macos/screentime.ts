import { md5Key } from "../md5.ts";
import { normalizeScreenTimeEvent, type ScreenTimeEventInput } from "./model.ts";

export { normalizeScreenTimeEvent, type ScreenTimeEventInput };

export function usageIntervalId(
  machineBk: string,
  uid: number,
  event: Pick<ScreenTimeEventInput, "stream" | "bundle_id" | "started_at" | "source_device_ref">,
): string {
  return md5Key([
    machineBk,
    String(uid),
    event.stream,
    event.bundle_id,
    event.started_at,
    event.source_device_ref,
  ]);
}

export function screenTimeHashdiff(
  event: Pick<ScreenTimeEventInput, "ended_at" | "duration_seconds" | "source_device_ref">,
): string {
  return md5Key([
    event.ended_at ?? "",
    String(event.duration_seconds),
    event.source_device_ref,
  ]);
}
