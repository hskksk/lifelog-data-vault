/** Session pooler URL for `supabase db push` from IPv4-only CI (GitHub Actions). */

import fs from "node:fs";
import path from "node:path";

type PoolerConfig = {
  database_type?: string;
  pool_mode?: string;
  db_user: string;
  db_host: string;
  db_port: number;
  db_name: string;
};

const LINKED_POOLER_URL_FILE = path.join("supabase", ".temp", "pooler-url");

/** Postgres URLs use `sslmode=require` (not `ssl=true`). Supabase pooler expects TLS. */
export function ensureSslMode(connectionUrl: string): string {
  const parsed = new URL(connectionUrl);
  if (!parsed.searchParams.has("sslmode")) {
    parsed.searchParams.set("sslmode", "require");
  }
  return parsed.toString();
}

function encodePostgresPassword(password: string): string {
  return encodeURIComponent(password);
}

function buildPoolerUrl(cfg: PoolerConfig, password: string): string {
  const user = encodeURIComponent(cfg.db_user);
  const pass = encodePostgresPassword(password);
  const db = cfg.db_name.replace(/^\//, "");
  const base = `postgresql://${user}:${pass}@${cfg.db_host}:${cfg.db_port}/${db}`;
  return ensureSslMode(base);
}

function pickSessionPooler(configs: PoolerConfig[]): PoolerConfig | undefined {
  const primary = configs.filter((c) => c.database_type === "PRIMARY" || !c.database_type);
  const pool = primary.length > 0 ? primary : configs;
  return (
    pool.find((c) => c.pool_mode === "session") ??
    pool.find((c) => c.db_port === 5432) ??
    pool[0]
  );
}

/**
 * After `supabase link`, the CLI writes `supabase/.temp/pooler-url` (same source as link uses).
 * Avoids a separate Management API call and does not need `database_pooling_config_read` on the PAT.
 */
export function readLinkedPoolerPushUrl(projectRef: string, password: string): string | null {
  const file = path.join(process.cwd(), LINKED_POOLER_URL_FILE);
  if (!fs.existsSync(file)) return null;

  const raw = fs.readFileSync(file, "utf8").trim();
  if (!raw.includes("pooler.supabase.com")) return null;

  // CLI stores a template; newer versions may omit :password@ entirely (not only [YOUR-PASSWORD]).
  const forParse = raw.replaceAll("[YOUR-PASSWORD]", "placeholder");
  let parsed: URL;
  try {
    parsed = new URL(forParse);
  } catch {
    return null;
  }

  if (!parsed.username) {
    parsed.username = `postgres.${projectRef}`;
  }
  parsed.password = password;

  // CLI template is often transaction mode (:6543); prefer session (:5432) for migrations.
  if (parsed.port === "6543") {
    parsed.port = "5432";
  }

  return ensureSslMode(parsed.toString());
}

/** Optional fallback when pooler-url file is missing (needs Connection Pooling → Read on the PAT). */
export async function fetchSessionPoolerPushUrl(
  projectRef: string,
  password: string,
): Promise<string> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    throw new Error("SUPABASE_ACCESS_TOKEN is required to resolve the session pooler URL.");
  }

  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/config/database/pooler`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Failed to load pooler config (${res.status}). ` +
        "PAT needs Connection Pooling → Read (database_pooling_config_read), not Database Config alone. " +
        "Or set SUPABASE_DB_PUSH_URL. " +
        body.slice(0, 200),
    );
  }

  const configs = (await res.json()) as PoolerConfig[];
  const cfg = pickSessionPooler(configs);
  if (!cfg?.db_host) {
    throw new Error("No session pooler entry in Management API response.");
  }

  return buildPoolerUrl(cfg, password);
}

function withPasswordFromEnv(connectionUrl: string, password: string): string {
  const parsed = new URL(connectionUrl.replace("[YOUR-PASSWORD]", "placeholder"));
  if (!parsed.password) {
    parsed.password = password;
  }
  return ensureSslMode(parsed.toString());
}

export async function resolveDbPushUrl(projectRef: string, password: string): Promise<string> {
  const fromEnv = process.env.SUPABASE_DB_PUSH_URL?.trim();
  if (fromEnv) {
    return withPasswordFromEnv(fromEnv, password);
  }

  const fromLink = readLinkedPoolerPushUrl(projectRef, password);
  if (fromLink) {
    return fromLink;
  }

  return fetchSessionPoolerPushUrl(projectRef, password);
}

/** Session pooler URL for role dbt_runner (same host/port as postgres pooler). */
export function buildDbtRunnerPoolerUrl(
  projectRef: string,
  postgresPoolerUrl: string,
  dbtRunnerPassword: string,
): string {
  const parsed = new URL(postgresPoolerUrl);
  parsed.username = `dbt_runner.${projectRef}`;
  parsed.password = dbtRunnerPassword;
  if (parsed.port === "6543") {
    parsed.port = "5432";
  }
  return ensureSslMode(parsed.toString());
}
