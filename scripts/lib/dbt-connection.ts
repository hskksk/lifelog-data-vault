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
  let port = parsed.port ? Number.parseInt(parsed.port, 10) : 5432;
  if (port === 6543) {
    port = 5432;
  }
  if (!parsed.hostname || !parsed.username) {
    throw new Error("Invalid Postgres URL: missing host or user");
  }
  // URL.username / .password are already percent-decoded; decodeURIComponent breaks on literal '%'.
  return {
    host: parsed.hostname,
    port,
    user: parsed.username,
    password: parsed.password,
    dbname,
    sslmode,
  };
}

/** Build dbt_runner fields without round-tripping the Vault password through a URL string. */
export function dbtRunnerConnectionFromPostgresPooler(
  projectRef: string,
  postgresPoolerUrl: string,
  dbtRunnerPassword: string,
): DbtPostgresConnection {
  const base = parsePostgresUrl(postgresPoolerUrl);
  return {
    ...base,
    user: `dbt_runner.${projectRef}`,
    password: dbtRunnerPassword,
  };
}
