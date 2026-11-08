import { describe, expect, it } from "vitest";

import { normalizeScreenTimeEvent, screenTimeHashdiff, usageIntervalId } from "../src/macos/screentime";

describe("screen time identity", () => {
  it("keeps the interval id stable when the end time changes", () => {
    const open = normalizeScreenTimeEvent({
      stream: "/app/usage",
      bundle_id: "com.apple.Safari",
      started_at: "2026-11-08T01:00:00Z",
      ended_at: "2026-11-08T01:05:00Z",
      duration_seconds: 300,
      source_device_ref: "",
    });
    const closed = normalizeScreenTimeEvent({
      stream: "/app/usage",
      bundle_id: "com.apple.Safari",
      started_at: "2026-11-08 01:00:00Z",
      ended_at: "2026-11-08T01:20:00+00:00",
      duration_seconds: 1200,
      source_device_ref: "",
    });
    expect(open).not.toBeNull();
    expect(closed).not.toBeNull();
    const id = usageIntervalId("MACHINE", 501, open!);
    expect(id).toBe(usageIntervalId("MACHINE", 501, closed!));
    expect(screenTimeHashdiff(open!)).not.toBe(screenTimeHashdiff(closed!));
  });

  it("drops non-positive durations and other streams", () => {
    expect(
      normalizeScreenTimeEvent({
        stream: "/app/usage",
        bundle_id: "com.apple.Safari",
        started_at: "2026-11-08T01:00:00Z",
        ended_at: "2026-11-08T01:00:00Z",
        duration_seconds: 0,
        source_device_ref: "",
      }),
    ).toBeNull();
    expect(
      normalizeScreenTimeEvent({
        stream: "/safari/history",
        bundle_id: "https://example.test",
        started_at: "2026-11-08T01:00:00Z",
        ended_at: "2026-11-08T01:05:00Z",
        duration_seconds: 300,
        source_device_ref: "",
      }),
    ).toBeNull();
  });
});
