import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { chunkEvents } from "../src/chunk";
import { writeConfigTemplate } from "../src/config";
import { parseIoregPlatformUuid, powerEnvelopes, powerEventsInWindow } from "../src/power";
import { screenTimeQuery } from "../src/screentime";
import { readState, windowStart, writeState } from "../src/state";

describe("mac collector helpers", () => {
  it("reads the platform UUID from ioreg text", () => {
    const text = `"IOPlatformUUID" = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"`;
    expect(parseIoregPlatformUuid(text)).toBe("AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE");
  });

  it("keeps only power events inside the overlap window", () => {
    const log = [
      "2026-11-08 01:00:00 +0000 Sleep                 old",
      "2026-11-08 06:30:00 +0000 Wake                  recent",
    ].join("\n");
    const events = powerEventsInWindow(log, "2026-11-08T07:00:00.000Z", new Date("2026-11-08T08:00:00Z"));
    expect(events.map((event) => event.kind)).toEqual(["Wake"]);
  });

  it("does not post an empty power chunk", () => {
    expect(
      powerEnvelopes(
        {
          hardware_uuid: "MACHINE",
          os_user_id: 501,
          computer_name: "Studio",
          model: "Mac14,13",
          os_version: "15.1",
          timezone: "Asia/Tokyo",
        },
        [],
        "2026-11-08T08:00:00.000Z",
      ),
    ).toEqual([]);
  });

  it("splits screen time queries without inventing a device column", () => {
    expect(screenTimeQuery(100, null)).not.toContain("ZDEVICEID");
    expect(screenTimeQuery(100, "ZDEVICEID")).toContain("s.ZDEVICEID");
    expect(screenTimeQuery(null, null)).not.toContain("ZSTARTDATE >=");
  });

  it("chunks by count", () => {
    const chunks = chunkEvents([1, 2, 3], (chunk) => ({ events: chunk }), 2, 1_500_000);
    expect(chunks).toEqual([[1, 2], [3]]);
  });

  it("writes a config template once and does not replace it", () => {
    const dir = mkdtempSync(join(tmpdir(), "lifelog-config-"));
    const first = writeConfigTemplate(dir);
    expect(first.created).toBe(true);
    const body = JSON.parse(readFileSync(first.path, "utf8")) as { ingest_url: string };
    expect(body.ingest_url).toContain("macos-ingest");
    writeFileSync(first.path, '{"ingest_url":"keep-me"}\n');
    const second = writeConfigTemplate(dir, "https://example.test/macos-ingest");
    expect(second.created).toBe(false);
    expect(readFileSync(first.path, "utf8")).toContain("keep-me");
  });

  it("remembers the covered-until watermark", () => {
    const dir = mkdtempSync(join(tmpdir(), "lifelog-state-"));
    expect(readState(dir)).toEqual({});
    writeState(dir, { power_covered_until: "2026-11-08T08:00:00.000Z" });
    expect(readState(dir).power_covered_until).toBe("2026-11-08T08:00:00.000Z");
    expect(windowStart("2026-11-08T08:00:00.000Z", 120 * 60 * 1000)).toBe("2026-11-08T06:00:00.000Z");
  });
});
