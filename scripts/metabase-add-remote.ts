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
import { upsertRemoteDatabase } from "./lib/metabase-remote.ts";
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
  return raw.replace(/\/$/, "");
}

async function authHeaders(baseUrl: string): Promise<Record<string, string>> {
  const apiKey = process.env.METABASE_API_KEY?.trim();
  if (apiKey) {
    return { "x-api-key": apiKey, "content-type": "application/json" };
  }
  const email = process.env.METABASE_EMAIL?.trim();
  const password = process.env.METABASE_PASSWORD ?? "";
  if (!email || !password) {
    throw new Error(
      "Set METABASE_API_KEY, or METABASE_EMAIL and METABASE_PASSWORD. Pass --print to emit the connection JSON instead.",
    );
  }
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: email, password }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new Error(
      `Metabase is not reachable at ${baseUrl}. Start it with make metabase-up and finish the admin setup. ${err instanceof Error ? err.message : err}`,
    );
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Metabase login failed (${res.status}): ${text.split(password).join("***").slice(0, 500)}`);
  }
  const body = (await res.json()) as { id?: string };
  if (!body.id) {
    throw new Error("Metabase login did not return a session id.");
  }
  return { "X-Metabase-Session": body.id, "content-type": "application/json" };
}

async function main() {
  const conn = await resolveConnection();
  if (process.argv.includes("--print")) {
    process.stdout.write(JSON.stringify(conn));
    return;
  }
  const baseUrl = metabaseBaseUrl();
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
