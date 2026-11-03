#!/usr/bin/env tsx
/**
 * Build SUPABASE_DB_URL for dbt CI: session pooler (link/API, same as deploy) +
 * dbt_runner password from Vault secret dbt_runner_password.
 *
 * Prints the URL on stdout (one line). Requires postgres pooler access (SUPABASE_DB_PASSWORD).
 */
import dotenv from "dotenv";
import { detectProjectRef } from "./lib/supabase-detect.ts";
import { dbtRunnerConnectionFromPostgresPooler } from "./lib/dbt-connection.ts";
import { buildDbtRunnerPoolerUrl, resolveDbPushUrl } from "./lib/supabase-pooler-url.ts";
import { readVaultSecret } from "./lib/vault-read.ts";

dotenv.config({ path: ".env" });

async function main() {
  if (!process.env.SUPABASE_DB_PASSWORD) {
    console.error("SUPABASE_DB_PASSWORD is required (postgres role, for Vault read via pooler).");
    process.exit(1);
  }

  const projectRef = detectProjectRef();
  const postgresPoolerUrl = await resolveDbPushUrl(projectRef, process.env.SUPABASE_DB_PASSWORD);
  const dbtPassword = readVaultSecret(postgresPoolerUrl, "dbt_runner_password");
  const dbtUrl = buildDbtRunnerPoolerUrl(projectRef, postgresPoolerUrl, dbtPassword);
  dbtRunnerConnectionFromPostgresPooler(projectRef, postgresPoolerUrl, dbtPassword); // validate fields
  process.stdout.write(dbtUrl);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
