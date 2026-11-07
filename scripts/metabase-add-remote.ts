#!/usr/bin/env tsx
/**
 * Register the hosted mart on a running Metabase.
 * Connection is the session pooler as bi_reader.<project-ref> (not port 6543).
 * Password comes from Vault bi_reader_password, read with the postgres pooler URL.
 *
 * --print  JSON connection on stdout (includes the password). Does not call Metabase.
 */
import dotenv from "dotenv";
import {
  REMOTE_MART_DATABASE_NAME,
  biReaderConnectionFromPostgresPooler,
} from "./lib/bi-connection.ts";
import type { DbtPostgresConnection } from "./lib/dbt-connection.ts";
import {
  normalizeMetabaseUrl,
  resolveMetabaseAuth,
  upsertRemoteDatabase,
  waitForMetabase,
} from "./lib/metabase-remote.ts";
import { detectProjectRef } from "./lib/supabase-detect.ts";
import { resolveDbPushUrl } from "./lib/supabase-pooler-url.ts";
import { readVaultSecret } from "./lib/vault-read.ts";

dotenv.config({ path: ".env" });

async function resolveConnection(): Promise<DbtPostgresConnection> {
  if (!process.env.SUPABASE_DB_PASSWORD) {
    throw new Error(
      "SUPABASE_DB_PASSWORD is required (postgres role, to read Vault bi_reader_password via the pooler).",
    );
  }
  const projectRef = detectProjectRef();
  const postgresPoolerUrl = await resolveDbPushUrl(projectRef, process.env.SUPABASE_DB_PASSWORD);
  const password = readVaultSecret(postgresPoolerUrl, "bi_reader_password");
  return biReaderConnectionFromPostgresPooler(projectRef, postgresPoolerUrl, password);
}

function metabaseBaseUrl(): string {
  const raw = process.env.METABASE_URL?.trim()
    || `http://127.0.0.1:${process.env.METABASE_PORT?.trim() || "3000"}`;
  return normalizeMetabaseUrl(raw);
}

function authHeaders(baseUrl: string): Promise<Record<string, string>> {
  return resolveMetabaseAuth(baseUrl, {
    apiKey: process.env.METABASE_API_KEY,
    email: process.env.METABASE_EMAIL,
    password: process.env.METABASE_PASSWORD,
  });
}

async function main() {
  const conn = await resolveConnection();
  if (process.argv.includes("--print")) {
    process.stdout.write(JSON.stringify(conn));
    return;
  }
  const baseUrl = metabaseBaseUrl();
  await waitForMetabase(baseUrl);
  const headers = await authHeaders(baseUrl);
  await upsertRemoteDatabase(baseUrl, headers, conn);
  console.log(
    `Metabase database "${REMOTE_MART_DATABASE_NAME}" uses ${conn.user} at ${conn.host}:${conn.port} (schema mart, SSL require).`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
