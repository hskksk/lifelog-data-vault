/** Parsed Postgres pooler connection for dbt 1.12+ profiles (no `url:` field). */

export type DbtPostgresConnection = {
  host: string;
  port: number;
  user: string;
  password: string;
  dbname: string;
  sslmode: string;
};

export function parsePostgresUrl(connectionUrl: string): DbtPostgresConnection {
  const parsed = new URL(connectionUrl);
  const dbname = parsed.pathname.replace(/^\//, "") || "postgres";
  const sslmode = parsed.searchParams.get("sslmode") ?? "require";
  const port = parsed.port ? Number.parseInt(parsed.port, 10) : 5432;
  if (!parsed.hostname || !parsed.username) {
    throw new Error("Invalid Postgres URL: missing host or user");
  }
  return {
    host: parsed.hostname,
    port,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    dbname,
    sslmode,
  };
}
