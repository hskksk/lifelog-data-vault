/** Add or update the hosted mart database on a Metabase instance. */

import type { DbtPostgresConnection } from "./dbt-connection.ts";
import { metabaseRemoteDatabasePayload } from "./bi-connection.ts";

export type AuthHeaders = Record<string, string>;

type DatabaseRow = { id: number; name: string };

export function redactSecret(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join("***");
}

/** Docker publishes 127.0.0.1 only. macOS resolves localhost to ::1 first. */
export function normalizeMetabaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`METABASE_URL is not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`METABASE_URL must be http or https: ${raw}`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1") {
    url.hostname = "127.0.0.1";
  }
  return url.toString().replace(/\/$/, "");
}

export function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause;
  if (cause instanceof Error) {
    const code = "code" in cause ? String((cause as { code?: unknown }).code ?? "") : "";
    return [err.message, code, cause.message].filter(Boolean).join(" ");
  }
  return err.message;
}

export async function waitForMetabase(
  baseUrl: string,
  opts?: {
    timeoutMs?: number;
    intervalMs?: number;
    fetchImpl?: typeof fetch;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    log?: (line: string) => void;
  },
): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? 360_000;
  const intervalMs = opts?.intervalMs ?? 2_000;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const now = opts?.now ?? Date.now;
  const sleep = opts?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const log = opts?.log ?? ((line: string) => process.stderr.write(line + "\n"));
  const deadline = now() + timeoutMs;
  let last = "no response";
  log(`Waiting for Metabase at ${baseUrl}. The first migration often takes a few minutes.`);
  while (now() < deadline) {
    try {
      const res = await fetchImpl(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(5_000) });
      if (res.ok) return;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = describeFetchError(err);
    }
    if (now() + intervalMs >= deadline) break;
    await sleep(intervalMs);
  }
  throw new Error(
    `Metabase did not become ready at ${baseUrl} (${last}). ` +
      "The first migration often takes a few minutes after make metabase-up. Check make metabase-logs. " +
      "Open http://127.0.0.1:3000. Docker publishes that address.",
  );
}

export function databaseRows(body: unknown): DatabaseRow[] {
  if (Array.isArray(body)) return body as DatabaseRow[];
  if (body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data)) {
    return (body as { data: DatabaseRow[] }).data;
  }
  throw new Error("Unexpected GET /api/database response.");
}

async function errorText(res: Response, secret: string): Promise<string> {
  const text = await res.text();
  return redactSecret(text.slice(0, 500), secret);
}

export async function upsertRemoteDatabase(
  baseUrl: string,
  headers: AuthHeaders,
  conn: DbtPostgresConnection,
  fetchImpl: typeof fetch = fetch,
): Promise<"created" | "updated"> {
  const root = baseUrl.replace(/\/$/, "");
  const payload = metabaseRemoteDatabasePayload(conn);

  const validate = await fetchImpl(`${root}/api/database/validate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ engine: payload.engine, details: payload.details }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!validate.ok) {
    throw new Error(
      `Remote Postgres rejected the bi_reader login (${validate.status}). ` +
        "Deploy the bi_reader migration, set Vault bi_reader_password, and run deploy so the role password syncs. " +
        (await errorText(validate, conn.password)),
    );
  }

  const listed = await fetchImpl(`${root}/api/database`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!listed.ok) {
    throw new Error(`GET /api/database failed (${listed.status}): ${await errorText(listed, conn.password)}`);
  }
  const existing = databaseRows(await listed.json()).find((row) => row.name === payload.name);

  const saved = await fetchImpl(
    existing ? `${root}/api/database/${existing.id}` : `${root}/api/database`,
    {
      method: existing ? "PUT" : "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!saved.ok) {
    throw new Error(
      `${existing ? "PUT" : "POST"} /api/database failed (${saved.status}): ${await errorText(saved, conn.password)}`,
    );
  }

  if (existing) {
    const sync = await fetchImpl(`${root}/api/database/${existing.id}/sync_schema`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    if (!sync.ok) {
      throw new Error(
        `POST /api/database/${existing.id}/sync_schema failed (${sync.status}): ${await errorText(sync, conn.password)}`,
      );
    }
  }

  return existing ? "updated" : "created";
}
