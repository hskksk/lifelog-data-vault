#!/usr/bin/env tsx
/**
 * Remote Supabase deploy: link → Edge secrets → db push (migrations only, no seed) → functions.
 * GitHub Actions: .github/workflows/deploy.yml
 *
 * GitHub Actions is IPv4-only. `db push` uses the session pooler (--db-url) with sslmode=require,
 * resolved from SUPABASE_DB_PUSH_URL, `supabase/.temp/pooler-url` after link, or Management API.
 */
import dotenv from "dotenv";
import { execFileSync, execSync } from "node:child_process";
import { detectProjectRef } from "./lib/supabase-detect.ts";
import { resolveDbPushUrl } from "./lib/supabase-pooler-url.ts";

dotenv.config({ path: ".env" });

function run(cmd: string) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", env: process.env });
}

/** Pass argv without shell so `--db-url` stays a parseable postgresql:// URL (do not encode the whole string). */
function runSupabase(args: string[]) {
  console.log(`\n$ supabase ${args.map((a) => (a.includes("://") ? "postgresql://…" : a)).join(" ")}`);
  execFileSync("supabase", args, { stdio: "inherit", env: process.env });
}

async function main() {
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) {
    console.error("SUPABASE_DB_PASSWORD is required for remote db push (hosted Postgres password).");
    process.exit(1);
  }

  const projectRef = detectProjectRef();

  run(`supabase link --project-ref ${projectRef} --yes`);

  run("supabase secrets set --env-file .env");

  const pushUrl = await resolveDbPushUrl(projectRef, password);
  console.log("\n[db push] Using session pooler (IPv4) with sslmode=require");
  runSupabase(["db", "push", "--db-url", pushUrl, "--yes"]);

  run(
    "supabase functions deploy owntracks-ingest owntracks-materialize --no-verify-jwt --yes",
  );

  const functionsBase = `https://${projectRef}.supabase.co/functions/v1`;
  console.log("\nDeploy complete.");
  console.log(`Ingest URL:      ${functionsBase}/owntracks-ingest`);
  console.log(`Materialize URL: ${functionsBase}/owntracks-materialize (Cron / service role)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
