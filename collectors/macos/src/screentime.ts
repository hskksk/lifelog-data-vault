import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";

import {
  canonicalOffsetTimestamp,
  type CollectorIdentity,
  type MacosScreenTimeEnvelope,
  normalizeScreenTimeEvent,
  SCREEN_TIME_STREAM,
  type ScreenTimeEventInput,
} from "@lifelog/ingest-core";

import { chunkEvents } from "./chunk.js";
import { windowStart } from "./state.js";

const SCREEN_OVERLAP_MS = 24 * 60 * 60 * 1000;
const COCOA_EPOCH = 978307200;
const REQUIRED_COLUMNS = ["ZSTREAMNAME", "ZVALUESTRING", "ZSTARTDATE", "ZENDDATE", "ZSOURCE"];

export type ScreenTimeExtract =
  | { ok: true; events: ScreenTimeEventInput[]; streamCounts: Record<string, number> }
  | { ok: false; reason: "full_disk_access" | "schema" | "sqlite"; detail: string };

export function screenTimeQuery(cocoaLowerBound: number | null, deviceColumn: string | null): string {
  if (deviceColumn !== null && deviceColumn !== "ZDEVICEID") {
    throw new Error("unsupported screen time device column");
  }
  if (cocoaLowerBound !== null && !Number.isInteger(cocoaLowerBound)) {
    throw new Error("invalid screen time bound");
  }
  const deviceExpr = deviceColumn ? `coalesce(s.${deviceColumn}, '')` : "''";
  const lower = cocoaLowerBound === null ? "" : `and o.ZSTARTDATE >= ${cocoaLowerBound}`;
  return `
    select
      o.ZSTREAMNAME as stream,
      o.ZVALUESTRING as bundle_id,
      strftime('%Y-%m-%dT%H:%M:%SZ', o.ZSTARTDATE + ${COCOA_EPOCH}, 'unixepoch') as started_at,
      strftime('%Y-%m-%dT%H:%M:%SZ', o.ZENDDATE + ${COCOA_EPOCH}, 'unixepoch') as ended_at,
      (o.ZENDDATE - o.ZSTARTDATE) as duration_seconds,
      ${deviceExpr} as source_device_ref
    from ZOBJECT o
    left join ZSOURCE s on o.ZSOURCE = s.Z_PK
    where o.ZSTREAMNAME = '${SCREEN_TIME_STREAM}'
      ${lower}
  `;
}

export function mapScreenTimeRows(rows: Record<string, unknown>[]): ScreenTimeEventInput[] {
  const events: ScreenTimeEventInput[] = [];
  for (const row of rows) {
    const event = normalizeScreenTimeEvent(row);
    if (event) events.push(event);
  }
  return events;
}

function sqliteJson(dbPath: string, sql: string): unknown {
  const text = execFileSync("sqlite3", ["-json", dbPath, sql], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!text.trim()) return [];
  return JSON.parse(text) as unknown;
}

function columnNames(dbPath: string, table: string): string[] {
  const rows = sqliteJson(dbPath, `select name from pragma_table_info('${table}')`) as { name?: string }[];
  return rows.map((row) => row.name ?? "").filter((name) => name.length > 0);
}

function presetCopyFailure(): ScreenTimeExtract | null {
  const status = process.env.LIFELOG_KNOWLEDGE_COPY_STATUS;
  if (status !== "full_disk_access" && status !== "sqlite") return null;
  const detail = process.env.LIFELOG_KNOWLEDGE_COPY_DETAIL;
  if (status === "full_disk_access") {
    return { ok: false, reason: "full_disk_access", detail: detail || "knowledgeC.db is not readable" };
  }
  return { ok: false, reason: "sqlite", detail: detail || "could not copy knowledgeC.db" };
}

// The launchd binary copies knowledgeC.db before node starts. Only a directory
// it created (lifelog-knowledge-*) is accepted, so a stray env value cannot
// point this process at another folder and then delete it.
function trustedSnapshot(): { dir: string; file: string } | null {
  const dir = process.env.LIFELOG_KNOWLEDGE_SNAPSHOT_DIR;
  const file = process.env.LIFELOG_KNOWLEDGE_SNAPSHOT;
  if (!dir || !file) return null;
  if (!basename(dir).startsWith("lifelog-knowledge-")) return null;
  const prefix = dir.endsWith(sep) ? dir : dir + sep;
  if (!file.startsWith(prefix)) return null;
  return { dir, file };
}

export function extractScreenTime(knowledgeDb: string, coveredUntil: string | undefined, now = new Date()): ScreenTimeExtract {
  const preset = presetCopyFailure();
  if (preset) return preset;

  const trusted = trustedSnapshot();
  const destDir = trusted?.dir ?? mkdtempSync(join(tmpdir(), "lifelog-knowledge-"));
  const copyPath = trusted?.file ?? join(destDir, "knowledgeC.db");
  try {
    if (!trusted) {
      try {
        copyFileSync(knowledgeDb, copyPath);
        for (const suffix of ["-wal", "-shm"]) {
          try {
            copyFileSync(`${knowledgeDb}${suffix}`, `${copyPath}${suffix}`);
          } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== "ENOENT") throw error;
          }
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        const message = error instanceof Error ? error.message : String(error);
        if (code === "EPERM" || message.includes("Operation not permitted")) {
          return { ok: false, reason: "full_disk_access", detail: "knowledgeC.db is not readable" };
        }
        return { ok: false, reason: "sqlite", detail: "could not copy knowledgeC.db" };
      }
    }

    let columns: string[];
    try {
      columns = columnNames(copyPath, "ZOBJECT");
    } catch {
      return { ok: false, reason: "schema", detail: "could not read ZOBJECT columns" };
    }
    const missing = REQUIRED_COLUMNS.filter((column) => !columns.includes(column));
    if (missing.length > 0) {
      return { ok: false, reason: "schema", detail: `missing columns: ${missing.join(", ")}` };
    }
    let deviceColumn: string | null = null;
    try {
      const sourceColumns = columnNames(copyPath, "ZSOURCE");
      if (sourceColumns.includes("ZDEVICEID")) deviceColumn = "ZDEVICEID";
    } catch {
      deviceColumn = null;
    }

    const start = windowStart(coveredUntil, SCREEN_OVERLAP_MS);
    const cocoa = start === null ? null : Math.floor(Date.parse(start) / 1000) - COCOA_EPOCH;
    let rows: Record<string, unknown>[];
    let counts: { stream?: string; n?: number }[];
    try {
      rows = sqliteJson(copyPath, screenTimeQuery(cocoa, deviceColumn)) as Record<string, unknown>[];
      counts = sqliteJson(
        copyPath,
        "select ZSTREAMNAME as stream, count(*) as n from ZOBJECT group by ZSTREAMNAME",
      ) as { stream?: string; n?: number }[];
    } catch {
      return { ok: false, reason: "sqlite", detail: "screen time query failed" };
    }
    const streamCounts: Record<string, number> = {};
    for (const row of counts) {
      if (typeof row.stream === "string") streamCounts[row.stream] = Number(row.n ?? 0);
    }
    const events = mapScreenTimeRows(rows).filter((event) => Date.parse(event.started_at) <= now.getTime());
    return { ok: true, events, streamCounts };
  } finally {
    rmSync(destDir, { recursive: true, force: true });
  }
}

export function screenTimeEnvelopes(
  identity: CollectorIdentity,
  events: ScreenTimeEventInput[],
  streamCounts: Record<string, number>,
  exportedAt: string,
): MacosScreenTimeEnvelope[] {
  const canonical = canonicalOffsetTimestamp(exportedAt) ?? exportedAt;
  const chunks = chunkEvents(events, (chunk) => ({
    schema_version: 1,
    record_source: "macos_screentime",
    entity: "usage_interval",
    exported_at: canonical,
    collector: identity,
    extract: { stream_counts: streamCounts },
    events: chunk,
  }));
  return chunks.map((chunk) => ({
    schema_version: 1 as const,
    record_source: "macos_screentime" as const,
    entity: "usage_interval" as const,
    exported_at: canonical,
    collector: identity,
    extract: { stream_counts: streamCounts },
    events: chunk,
  }));
}

export function defaultKnowledgeDb(): string {
  return join(
    process.env.HOME ?? "",
    "Library",
    "Application Support",
    "Knowledge",
    "knowledgeC.db",
  );
}
