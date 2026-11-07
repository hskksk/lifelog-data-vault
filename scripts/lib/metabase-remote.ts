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

const JSON_HEADERS = { "content-type": "application/json" };

/** Metabase 0.64 reads `{:details {:engine ... :details ...}}` on this route. */
export function validateDatabaseBody(payload: { engine: string; details: Record<string, unknown> }) {
  return { details: { engine: payload.engine, details: payload.details } };
}

async function currentUserOk(
  root: string,
  headers: AuthHeaders,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  const res = await fetchImpl(`${root}/api/user/current`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return false;
  const body = (await res.json()) as { is_superuser?: boolean };
  if (body.is_superuser === false) {
    throw new Error(
      "This Metabase login is not an admin. Database registration needs the admin user, or an API key in the Administrators group.",
    );
  }
  return true;
}

export async function resolveMetabaseAuth(
  baseUrl: string,
  env: { apiKey?: string; email?: string; password?: string },
  opts?: { fetchImpl?: typeof fetch; log?: (line: string) => void },
): Promise<AuthHeaders> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const log = opts?.log ?? ((line: string) => process.stderr.write(line + "\n"));
  const root = baseUrl.replace(/\/$/, "");
  const apiKey = env.apiKey?.trim();
  const email = env.email?.trim();
  const password = env.password ?? "";

  if (apiKey) {
    const headers = { "x-api-key": apiKey, ...JSON_HEADERS };
    if (await currentUserOk(root, headers, fetchImpl)) return headers;
    if (email && password) {
      log("METABASE_API_KEY was rejected. Signing in with METABASE_EMAIL.");
    } else {
      const shape = apiKey.startsWith("mb_")
        ? "The key was not accepted."
        : "The value does not start with mb_.";
      throw new Error(
        `Metabase rejected METABASE_API_KEY (401 Unauthenticated). ${shape} ` +
          "Create one in Admin → Settings → Authentication → API keys, in the Administrators group. " +
          "Or leave METABASE_API_KEY empty and set METABASE_EMAIL and METABASE_PASSWORD to the admin user from http://127.0.0.1:3000.",
      );
    }
  }

  if (!email || !password) {
    throw new Error(
      "Set METABASE_API_KEY, or METABASE_EMAIL and METABASE_PASSWORD. Pass --print to emit the connection JSON instead.",
    );
  }

  let res: Response;
  try {
    res = await fetchImpl(`${root}/api/session`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ username: email, password }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new Error(
      `Metabase is not reachable at ${root}. Start it with make metabase-up and finish the admin setup. ${describeFetchError(err)}`,
    );
  }
  if (!res.ok) {
    const text = redactSecret(await res.text(), password).slice(0, 500);
    throw new Error(`Metabase login failed (${res.status}): ${text}`);
  }
  const body = (await res.json()) as { id?: string };
  if (!body.id) {
    throw new Error("Metabase login did not return a session id.");
  }
  const headers = { "X-Metabase-Session": body.id, ...JSON_HEADERS };
  if (!(await currentUserOk(root, headers, fetchImpl))) {
    throw new Error(
      "Metabase accepted the password and then rejected the session. Finish the admin setup at http://127.0.0.1:3000 and sign in again.",
    );
  }
  return headers;
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
    body: JSON.stringify(validateDatabaseBody(payload)),
    signal: AbortSignal.timeout(60_000),
  });
  if (validate.status === 401 || validate.status === 403) {
    throw new Error(
      `Metabase rejected the API login (${validate.status}). ` +
        "Finish the admin user at http://127.0.0.1:3000, then set METABASE_API_KEY (starts with mb_, Administrators group) or METABASE_EMAIL and METABASE_PASSWORD. " +
        (await errorText(validate, conn.password)),
    );
  }
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
