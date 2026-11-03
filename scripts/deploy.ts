#!/usr/bin/env tsx
/**
 * Remote Supabase deploy (pattern: hskksk/podcaster scripts/deploy.ts).
 *
 * Remote: link → secrets → db push → functions deploy.
 * Lifelog differs only on db push: GitHub Actions is IPv4-only, so migrations use
 * session pooler (--db-url) via scripts/lib/supabase-pooler-url.ts. Podcaster uses
 * plain `supabase db push` after link (same runner may need the same fix later).
 */
import dotenv from "dotenv";
import { execFileSync, execSync } from "node:child_process";
import { detectProjectRef } from "./lib/supabase-detect.ts";
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

async function main() {
  if (!process.env.SUPABASE_DB_PASSWORD) {
    console.error("SUPABASE_DB_PASSWORD is required (hosted Postgres password).");
    process.exit(1);
  }

  const projectRef = detectProjectRef();
  const password = process.env.SUPABASE_DB_PASSWORD;

  // 1. Link project (idempotent). Password via env — same as podcaster CI + Supabase docs.
  run(`supabase link --project-ref ${projectRef} --yes`);

  // 2. Push Edge secrets
  run("supabase secrets set --env-file .env");

  // 3. Apply migrations (no seed on push). Pooler URL for IPv4-only CI — see supabase-pooler-url.ts.
  const pushUrl = await resolveDbPushUrl(projectRef, password);
  runSupabase(["db", "push", "--db-url", pushUrl, "--yes"]);

  // 4. Deploy Edge Functions
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
  console.log(`Materialize URL: ${functionsBase}/owntracks-materialize (Cron / service role)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
