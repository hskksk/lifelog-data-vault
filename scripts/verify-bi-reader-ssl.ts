#!/usr/bin/env tsx
/**
 * Sanity-check Supabase CA file format and optional pooler TLS (no password printed).
 *
 * Usage (from repo root, .env with SUPABASE_DB_PASSWORD + project ref):
 *   SUPABASE_DB_SSLROOTCERT=~/.postgresql/supabase-prod-ca.crt pnpm verify-bi-reader-ssl
 *
 * Or pass the CA path as argv[2].
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import { biReaderConnectionFromPostgresPooler } from "./lib/bi-connection.ts";
import { detectProjectRef } from "./lib/supabase-detect.ts";
import { resolveDbPushUrl } from "./lib/supabase-pooler-url.ts";
import { readVaultSecret } from "./lib/vault-read.ts";

dotenv.config({ path: ".env" });

function caPath(): string {
  return process.argv[2]?.trim() || process.env.SUPABASE_DB_SSLROOTCERT?.trim() || "";
}

function inspectCa(path: string): void {
  const head = readFileSync(path, { encoding: "utf8", flag: "r" }).slice(0, 80);
  const looksPem = head.includes("BEGIN CERTIFICATE");
  console.log(`CA path: ${path}`);
  console.log(`First bytes: ${JSON.stringify(head.split("\n")[0])}`);
  if (!looksPem) {
    console.error(
      "File does not look like PEM. Supabase Dashboard download is usually PEM in a .crt/.cer name.\n" +
        "Convert DER with: openssl x509 -inform DER -in input.crt -out ~/.postgresql/supabase.pem",
    );
    process.exit(1);
  }
  const openssl = spawnSync("openssl", ["x509", "-in", path, "-noout", "-subject", "-issuer"], {
    encoding: "utf8",
  });
  if (openssl.status !== 0) {
    console.error(openssl.stderr || "openssl x509 failed");
    process.exit(1);
  }
  console.log(openssl.stdout.trim());
}

async function probeTls(host: string, port: number, ca: string): Promise<void> {
  const sClient = spawnSync(
    "openssl",
    ["s_client", "-connect", `${host}:${port}`, "-servername", host, "-CAfile", ca],
    { encoding: "utf8", input: "" },
  );
  const out = `${sClient.stdout}\n${sClient.stderr}`;
  if (/Verify return code: 0 \(ok\)/.test(out)) {
    console.log("openssl s_client: certificate verify OK");
    return;
  }
  const code = out.match(/Verify return code: (\d+ \([^)]+\))/);
  console.error(code ? `openssl s_client: ${code[1]}` : "openssl s_client: verify failed");
  console.error("If verify fails here, fix the CA file before lightdash deploy.");
  process.exit(1);
}

async function main() {
  const ca = caPath();
  if (!ca) {
    throw new Error("Set SUPABASE_DB_SSLROOTCERT or pass the CA path as argv[2].");
  }
  inspectCa(ca);

  if (!process.env.SUPABASE_DB_PASSWORD) {
    console.log("Skip pooler probe (SUPABASE_DB_PASSWORD unset). CA format looks OK.");
    return;
  }
  const projectRef = detectProjectRef();
  const poolerUrl = await resolveDbPushUrl(projectRef, process.env.SUPABASE_DB_PASSWORD);
  const password = readVaultSecret(poolerUrl, "bi_reader_password");
  const conn = biReaderConnectionFromPostgresPooler(projectRef, poolerUrl, password);
  await probeTls(conn.host, conn.port, ca);
  console.log(`Pooler host: ${conn.host}:${conn.port} user ${conn.user}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});