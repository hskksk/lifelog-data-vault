#!/usr/bin/env tsx
/**
 * Remote Supabase deploy (pattern: hskksk/podcaster scripts/deploy.ts).
 *
 * Remote: link → secrets → db push → vault upsert → functions deploy.
 * Lifelog differs only on db push: GitHub Actions is IPv4-only, so migrations use
 * session pooler (--db-url) via scripts/lib/supabase-pooler-url.ts. Podcaster uses
 * plain `supabase db push` after link (same runner may need the same fix later).
 */
import dotenv from "dotenv";
import { execFileSync, execSync } from "node:child_process";
import { detectProjectRef, detectSecretKey } from "./lib/supabase-detect.ts";
import { resolveDbPushUrl } from "./lib/supabase-pooler-url.ts";

dotenv.config({ path: ".env" });
console.log("Using env file: .env");

function run(cmd: string, opts?: { env?: Record<string, string> }) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", env: { ...process.env, ...opts?.env } });
}

function runSupabase(args: string[]) {
  const redacted = args.map((a) => (a.includes("://") ? "postgresql://…" : a));
  console.log(`\n$ supabase ${redacted.join(" ")}`);
  execFileSync("supabase", args, { stdio: "inherit", env: process.env });
}

function escapeSqlLiteral(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

function runSql(label: string, sql: string, dbUrl: string) {
  console.log(`\n[sql] ${label}`);
  execFileSync("supabase", ["db", "query", "--db-url", dbUrl, "--yes"], {
    input: sql,
    stdio: ["pipe", "inherit", "inherit"],
    env: process.env,
  });
}

function upsertVaultSecret(dbUrl: string, name: string, value: string, description: string) {
  runSql(
    `vault: upsert ${name}`,
    `
do $$
declare
  v_id uuid;
  v_value text := ${escapeSqlLiteral(value)};
begin
  select id into v_id from vault.secrets where name = ${escapeSqlLiteral(name)} limit 1;
  if v_id is null then
    perform vault.create_secret(v_value, ${escapeSqlLiteral(name)}, ${escapeSqlLiteral(description)});
  else
    perform vault.update_secret(v_id, v_value, ${escapeSqlLiteral(name)}, ${escapeSqlLiteral(description)});
  end if;
end;
$$;
`,
    dbUrl,
  );
}

async function main() {
  if (!process.env.SUPABASE_DB_PASSWORD) {
    console.error("SUPABASE_DB_PASSWORD is required (hosted Postgres password).");
    process.exit(1);
  }

  const projectRef = detectProjectRef();
  const secretKey = detectSecretKey(projectRef);
  const password = process.env.SUPABASE_DB_PASSWORD;

  // 1. Link project (idempotent). Password via env — same as podcaster CI + Supabase docs.
  run(`supabase link --project-ref ${projectRef} --yes`);

  // 2. Push Edge secrets (Supabase CLI v3 requires --yes in CI)
  runSupabase(["secrets", "set", "--env-file", ".env", "--yes"]);

  // 3. Apply migrations (no seed on push). Pooler URL for IPv4-only CI — see supabase-pooler-url.ts.
  const pushUrl = await resolveDbPushUrl(projectRef, password);
  runSupabase(["db", "push", "--db-url", pushUrl, "--yes"]);

  // 4. Vault secrets for pg_cron → materialize Edge (hosted cannot ALTER DATABASE SET app.*)
  upsertVaultSecret(
    pushUrl,
    "supabase_project_id",
    projectRef,
    "Supabase project ref for building Edge Functions base URL",
  );
  upsertVaultSecret(
    pushUrl,
    "supabase_secret_key",
    secretKey,
    "Secret API key (sb_secret_...) for owntracks-materialize apikey header",
  );

  // 5. Deploy Edge Functions
  runSupabase([
    "functions",
    "deploy",
    "owntracks-ingest",
    "owntracks-materialize",
    "--no-verify-jwt",
    "--yes",
  ]);

  const functionsBase = `https://${projectRef}.supabase.co/functions/v1`;
  console.log("\nDeploy complete.");
  console.log(`Ingest URL:      ${functionsBase}/owntracks-ingest`);
  console.log(`Materialize URL: ${functionsBase}/owntracks-materialize (Cron uses Vault + apikey)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
