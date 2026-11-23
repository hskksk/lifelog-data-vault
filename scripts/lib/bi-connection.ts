/** BI warehouse connection for hosted Supabase (session pooler, bi_reader). */

import {
  parsePostgresUrl,
  type DbtPostgresConnection,
} from "./dbt-connection.ts";

export const REMOTE_MART_DATABASE_NAME = "lifelog mart (remote)";

export function biReaderConnectionFromPostgresPooler(
  projectRef: string,
  postgresPoolerUrl: string,
  biReaderPassword: string,
): DbtPostgresConnection {
  const base = parsePostgresUrl(postgresPoolerUrl);
  return {
    ...base,
    user: `bi_reader.${projectRef}`,
    password: biReaderPassword,
    sslmode: "require",
  };
}

/** Schemas BI tools may read. staging and ops stay off this list. */
export const BI_WAREHOUSE_SCHEMAS = ["mart", "business_vault", "raw_vault"] as const;

/** Comma-separated schema filter (Metabase, Lightdash project settings). */
export const BI_SCHEMA_FILTER = BI_WAREHOUSE_SCHEMAS.join(",");

/** @deprecated Use BI_SCHEMA_FILTER */
export const METABASE_SCHEMA_FILTER = BI_SCHEMA_FILTER;

/** Body for POST/PUT /api/database. Schema sync is mart, business_vault, and raw_vault. */
export function metabaseRemoteDatabasePayload(conn: DbtPostgresConnection) {
  return {
    name: REMOTE_MART_DATABASE_NAME,
    engine: "postgres" as const,
    auto_run_queries: true,
    is_full_sync: true,
    details: {
      host: conn.host,
      port: conn.port,
      dbname: conn.dbname,
      user: conn.user,
      password: conn.password,
      ssl: true,
      "ssl-mode": "require",
      "schema-filters-type": "inclusion",
      "schema-filters-patterns": BI_SCHEMA_FILTER,
      "tunnel-enabled": false,
    },
  };
}

const q = (value: string) => JSON.stringify(value);

/** dbt profiles fragment for Lightdash CLI deploy to hosted Supabase (bi_reader_hosted target). */
export function lightdashBiReaderProfilesYaml(conn: DbtPostgresConnection): string {
  return `lifelog_vault:
  target: bi_reader_hosted
  outputs:
    bi_reader_hosted:
      type: postgres
      host: ${q(conn.host)}
      user: ${q(conn.user)}
      password: ${q(conn.password)}
      port: ${conn.port}
      dbname: ${q(conn.dbname)}
      sslmode: require
      sslrootcert: "/absolute/path/to/supabase-prod-ca.crt"
      schema: mart
      threads: 1
`;
}

/** Connection fields for hosted warehouse (password redacted unless included). */
export function lightdashWarehouseSettings(conn: DbtPostgresConnection, opts?: { includePassword?: boolean }) {
  return {
    type: "postgres",
    host: conn.host,
    port: conn.port,
    user: conn.user,
    password: opts?.includePassword ? conn.password : "<from Vault bi_reader_password>",
    dbname: conn.dbname,
    sslmode: "require",
    sslRootCert:
      "Absolute path in profiles.yml (Lightdash CLI). Download: Dashboard → Database → SSL Configuration",
    schemas: [...BI_WAREHOUSE_SCHEMAS],
    searchPath: BI_WAREHOUSE_SCHEMAS.join(", "),
    sessionPoolerNote: "Use session pooler port 5432, not transaction pooler 6543.",
    lightdashCliSslNote:
      "CLI deploy: profiles sslrootcert (dbt) + NODE_EXTRA_CA_CERTS=<same CA path> for Node. UI warehouse: verify-full + CA upload or no-verify.",
  };
}
