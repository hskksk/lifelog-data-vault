#!/usr/bin/env tsx
/**
 * Remote Supabase deploy: link → Edge secrets → db push (migrations only, no seed) → functions.
 * GitHub Actions: .github/workflows/deploy.yml
 */
import dotenv from "dotenv";
import { execSync } from "node:child_process";
import { detectProjectRef } from "./lib/supabase-detect.ts";

dotenv.config({ path: ".env" });

function run(cmd: string) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", env: process.env });
}

const projectRef = detectProjectRef();
const passwordFlag = process.env.SUPABASE_DB_PASSWORD
  ? ` --password ${process.env.SUPABASE_DB_PASSWORD}`
  : "";

run(`supabase link --project-ref ${projectRef}${passwordFlag}`);

// Edge runtime secrets (INGEST_BEARER_TOKEN, optional PERSON_MAP_YAML / MATERIALIZE_*).
// Do not put pooler URLs or local DATABASE_URL in .env for this step.
run("supabase secrets set --env-file .env");

// Migrations only; supabase/seed.sql is not applied on db push.
run("supabase db push");

run(
  "supabase functions deploy owntracks-ingest owntracks-materialize --no-verify-jwt",
);

const functionsBase = `https://${projectRef}.supabase.co/functions/v1`;
console.log("\nDeploy complete.");
console.log(`Ingest URL:      ${functionsBase}/owntracks-ingest`);
console.log(`Materialize URL: ${functionsBase}/owntracks-materialize (Cron / service role)`);
