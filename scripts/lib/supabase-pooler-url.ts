/** Session pooler URL for `supabase db push` from IPv4-only CI (GitHub Actions). */

type PoolerConfig = {
  database_type?: string;
  pool_mode?: string;
  db_user: string;
  db_host: string;
  db_port: number;
  db_name: string;
};

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

/** Fetch Supavisor session pooler host via Management API (IPv4). */
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
        "Grant the access token Database Config (Read) / pooler read, or set SUPABASE_DB_PUSH_URL. " +
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

export async function resolveDbPushUrl(projectRef: string, password: string): Promise<string> {
  const fromEnv = process.env.SUPABASE_DB_PUSH_URL?.trim();
  if (fromEnv) {
    return ensureSslMode(fromEnv);
  }
  return fetchSessionPoolerPushUrl(projectRef, password);
}
