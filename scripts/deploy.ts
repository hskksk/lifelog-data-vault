#!/usr/bin/env tsx
/**
 * Remote Supabase deploy: link → Edge secrets → db push (migrations only, no seed) → functions.
 * GitHub Actions: .github/workflows/deploy.yml
 *
 * GitHub Actions is IPv4-only; use `db push --linked` with SUPABASE_DB_PASSWORD (pooler via link),
 * or set SUPABASE_DB_PUSH_URL to the session pooler connection string (postgres user).
 */
import dotenv from "dotenv";
import { execSync } from "node:child_process";
import { detectProjectRef } from "./lib/supabase-detect.ts";

dotenv.config({ path: ".env" });

function run(cmd: string) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", env: process.env });
}

if (!process.env.SUPABASE_DB_PASSWORD) {
  console.error("SUPABASE_DB_PASSWORD is required for remote db push (hosted Postgres password).");
  process.exit(1);
}

const projectRef = detectProjectRef();

// Password via env (not argv) — special characters safe; enables IPv4 pooler path after link.
run(`supabase link --project-ref ${projectRef} --yes`);

// Edge runtime secrets (INGEST_BEARER_TOKEN, optional PERSON_MAP_YAML / MATERIALIZE_*).
// Do not put pooler URLs or local DATABASE_URL in .env for this step.
run("supabase secrets set --env-file .env");

// Migrations only; supabase/seed.sql is not applied on db push.
const pushUrl = process.env.SUPABASE_DB_PUSH_URL?.trim();
if (pushUrl) {
  const encoded = encodeURIComponent(pushUrl);
  run(`supabase db push --db-url ${encoded} --yes`);
} else {
  // --linked: remote via pooler config from link (avoid db.*.supabase.co IPv6 on GitHub Actions).
  run("supabase db push --linked --yes");
}

run(
  "supabase functions deploy owntracks-ingest owntracks-materialize --no-verify-jwt --yes",
);

const functionsBase = `https://${projectRef}.supabase.co/functions/v1`;
console.log("\nDeploy complete.");
console.log(`Ingest URL:      ${functionsBase}/owntracks-ingest`);
console.log(`Materialize URL: ${functionsBase}/owntracks-materialize (Cron / service role)`);
