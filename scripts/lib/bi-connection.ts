/** Metabase warehouse connection for hosted Supabase (session pooler, bi_reader). */

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

/** Body for POST/PUT /api/database. Schema sync is limited to mart. */
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
      "schema-filters-patterns": "mart",
      "tunnel-enabled": false,
    },
  };
}
