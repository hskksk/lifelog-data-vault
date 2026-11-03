#!/usr/bin/env tsx
/**
 * Resolve dbt_runner session pooler connection (same as resolve-dbt-db-url.ts).
 * Default: JSON on stdout for CI. --format=github writes multiline-safe GITHUB_OUTPUT keys.
 */
import dotenv from "dotenv";
import {
  dbtRunnerConnectionFromPostgresPooler,
  type DbtPostgresConnection,
} from "./lib/dbt-connection.ts";
import { detectProjectRef } from "./lib/supabase-detect.ts";
import { resolveDbPushUrl } from "./lib/supabase-pooler-url.ts";
import { readVaultSecret } from "./lib/vault-read.ts";

dotenv.config({ path: ".env" });

async function resolveConnection(): Promise<DbtPostgresConnection> {
  if (!process.env.SUPABASE_DB_PASSWORD) {
    throw new Error("SUPABASE_DB_PASSWORD is required (postgres role, for Vault read via pooler).");
  }
  const projectRef = detectProjectRef();
  const postgresPoolerUrl = await resolveDbPushUrl(projectRef, process.env.SUPABASE_DB_PASSWORD);
  const dbtPassword = readVaultSecret(postgresPoolerUrl, "dbt_runner_password");
  return dbtRunnerConnectionFromPostgresPooler(projectRef, postgresPoolerUrl, dbtPassword);
}

function writeGithubOutput(conn: DbtPostgresConnection) {
  const lines = [
    `host=${conn.host}`,
    `port=${conn.port}`,
    `user=${conn.user}`,
    `dbname=${conn.dbname}`,
    `sslmode=${conn.sslmode}`,
    `password<<EOF`,
    conn.password,
    `EOF`,
  ];
  process.stdout.write(lines.join("\n") + "\n");
}

async function main() {
  const format = process.argv.includes("--format=github") ? "github" : "json";
  const conn = await resolveConnection();
  if (format === "github") {
    writeGithubOutput(conn);
    return;
  }
  process.stdout.write(JSON.stringify(conn));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
