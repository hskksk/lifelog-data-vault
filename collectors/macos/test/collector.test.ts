import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { chunkEvents } from "../src/chunk";
import { loadCollectorConfig, writeConfigTemplate } from "../src/config";
import { parseIoregPlatformUuid, powerEnvelopes, powerEventsInWindow } from "../src/power";
import { extractScreenTime, screenTimeQuery } from "../src/screentime";
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
          person_id: "hskksk",
        },
        [],
        "2026-11-08T08:00:00.000Z",
      ),
    ).toEqual([]);
  });

  it("reports the launchd copier status without opening knowledgeC.db", () => {
    const previousStatus = process.env.LIFELOG_KNOWLEDGE_COPY_STATUS;
    const previousDetail = process.env.LIFELOG_KNOWLEDGE_COPY_DETAIL;
    process.env.LIFELOG_KNOWLEDGE_COPY_STATUS = "full_disk_access";
    process.env.LIFELOG_KNOWLEDGE_COPY_DETAIL = "knowledgeC.db is not readable";
    try {
      expect(extractScreenTime("/does-not-exist/knowledgeC.db", undefined)).toEqual({
        ok: false,
        reason: "full_disk_access",
        detail: "knowledgeC.db is not readable",
      });
    } finally {
      if (previousStatus === undefined) delete process.env.LIFELOG_KNOWLEDGE_COPY_STATUS;
      else process.env.LIFELOG_KNOWLEDGE_COPY_STATUS = previousStatus;
      if (previousDetail === undefined) delete process.env.LIFELOG_KNOWLEDGE_COPY_DETAIL;
      else process.env.LIFELOG_KNOWLEDGE_COPY_DETAIL = previousDetail;
    }
  });

  it("reads the launchd snapshot and does not open the original database", () => {
    const dir = mkdtempSync(join(tmpdir(), "lifelog-knowledge-"));
    const db = join(dir, "knowledgeC.db");
    execFileSync("sqlite3", [
      db,
      `create table ZOBJECT (
        ZSTREAMNAME text, ZVALUESTRING text, ZSTARTDATE real, ZENDDATE real, ZSOURCE integer
      );
      create table ZSOURCE (Z_PK integer primary key, ZDEVICEID text);
      insert into ZSOURCE (Z_PK, ZDEVICEID) values (1, 'mac');
      insert into ZOBJECT (ZSTREAMNAME, ZVALUESTRING, ZSTARTDATE, ZENDDATE, ZSOURCE)
      values ('/app/usage', 'com.example.App', 700000000, 700000060, 1);`,
    ]);
    const previousFile = process.env.LIFELOG_KNOWLEDGE_SNAPSHOT;
    const previousDir = process.env.LIFELOG_KNOWLEDGE_SNAPSHOT_DIR;
    process.env.LIFELOG_KNOWLEDGE_SNAPSHOT = db;
    process.env.LIFELOG_KNOWLEDGE_SNAPSHOT_DIR = dir;
    try {
      const extracted = extractScreenTime("/does-not-exist/knowledgeC.db", undefined, new Date("2026-11-08T00:00:00Z"));
      expect(extracted.ok).toBe(true);
      if (!extracted.ok) return;
      expect(extracted.events.map((event) => event.bundle_id)).toEqual(["com.example.App"]);
      expect(existsSync(dir)).toBe(false);
    } finally {
      if (previousFile === undefined) delete process.env.LIFELOG_KNOWLEDGE_SNAPSHOT;
      else process.env.LIFELOG_KNOWLEDGE_SNAPSHOT = previousFile;
      if (previousDir === undefined) delete process.env.LIFELOG_KNOWLEDGE_SNAPSHOT_DIR;
      else process.env.LIFELOG_KNOWLEDGE_SNAPSHOT_DIR = previousDir;
    }
  });

  it("ignores a snapshot directory it did not create", () => {
    const dir = mkdtempSync(join(tmpdir(), "keep-me-"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "sentinel"), "stay");
    const previousFile = process.env.LIFELOG_KNOWLEDGE_SNAPSHOT;
    const previousDir = process.env.LIFELOG_KNOWLEDGE_SNAPSHOT_DIR;
    process.env.LIFELOG_KNOWLEDGE_SNAPSHOT = join(dir, "knowledgeC.db");
    process.env.LIFELOG_KNOWLEDGE_SNAPSHOT_DIR = dir;
    try {
      const extracted = extractScreenTime("/does-not-exist/knowledgeC.db", undefined);
      expect(extracted.ok).toBe(false);
      expect(existsSync(join(dir, "sentinel"))).toBe(true);
    } finally {
      if (previousFile === undefined) delete process.env.LIFELOG_KNOWLEDGE_SNAPSHOT;
      else process.env.LIFELOG_KNOWLEDGE_SNAPSHOT = previousFile;
      if (previousDir === undefined) delete process.env.LIFELOG_KNOWLEDGE_SNAPSHOT_DIR;
      else process.env.LIFELOG_KNOWLEDGE_SNAPSHOT_DIR = previousDir;
    }
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

  it("requires a person_id before sending", () => {
    expect(() =>
      loadCollectorConfig({
        MACOS_INGEST_URL: "https://example.test/macos-ingest",
        MACOS_INGEST_BEARER_TOKEN: "secret",
      }),
    ).toThrow(/person_id/);
    expect(
      loadCollectorConfig({
        MACOS_INGEST_URL: "https://example.test/macos-ingest",
        MACOS_INGEST_BEARER_TOKEN: "secret",
        MACOS_PERSON_ID: " hskksk ",
      }).personId,
    ).toBe("hskksk");
  });

  it("remembers the covered-until watermark", () => {
    const dir = mkdtempSync(join(tmpdir(), "lifelog-state-"));
    expect(readState(dir)).toEqual({});
    writeState(dir, { power_covered_until: "2026-11-08T08:00:00.000Z" });
    expect(readState(dir).power_covered_until).toBe("2026-11-08T08:00:00.000Z");
    expect(windowStart("2026-11-08T08:00:00.000Z", 120 * 60 * 1000)).toBe("2026-11-08T06:00:00.000Z");
  });
});
