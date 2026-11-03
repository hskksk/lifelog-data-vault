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
/** CI profiles.yml with literal credentials (avoid env_var + log leakage in GHA). */
export function renderDbtCiProfilesYaml(conn: DbtPostgresConnection): string {
  const q = (value: string) => JSON.stringify(value);
  return `lifelog_vault:
  target: ci
  outputs:
    ci:
      type: postgres
      host: ${q(conn.host)}
      user: ${q(conn.user)}
      password: ${q(conn.password)}
      port: ${conn.port}
      dbname: ${q(conn.dbname)}
      sslmode: ${q(conn.sslmode)}
      schema: staging
      threads: 2
`;
}

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
