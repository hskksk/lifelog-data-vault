#!/usr/bin/env tsx
/**
 * Print hosted bi_reader warehouse settings for Lightdash project setup.
 * --print-yaml  includes a dbt profiles.yml fragment with the live password.
 */
import dotenv from "dotenv";
import {
  biReaderConnectionFromPostgresPooler,
  lightdashBiReaderProfilesYaml,
  lightdashWarehouseSettings,
} from "./lib/bi-connection.ts";
import { detectProjectRef } from "./lib/supabase-detect.ts";
import { resolveDbPushUrl } from "./lib/supabase-pooler-url.ts";
import { readVaultSecret } from "./lib/vault-read.ts";

dotenv.config({ path: ".env" });

async function main() {
  if (!process.env.SUPABASE_DB_PASSWORD) {
    throw new Error(
      "SUPABASE_DB_PASSWORD is required (postgres role, to read Vault bi_reader_password via the pooler).",
    );
  }
  const projectRef = detectProjectRef();
  const postgresPoolerUrl = await resolveDbPushUrl(projectRef, process.env.SUPABASE_DB_PASSWORD);
  const password = readVaultSecret(postgresPoolerUrl, "bi_reader_password");
  const conn = biReaderConnectionFromPostgresPooler(projectRef, postgresPoolerUrl, password);

  if (process.argv.includes("--print-yaml")) {
    process.stdout.write(lightdashBiReaderProfilesYaml(conn));
    return;
  }

  const payload = lightdashWarehouseSettings(conn, { includePassword: process.argv.includes("--include-password") });
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});