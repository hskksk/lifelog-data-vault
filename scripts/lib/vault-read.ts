import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

type QueryJsonRow = Record<string, unknown>;

const TRANSIENT_POOLER_PATTERNS = [
  "econnrefused",
  "SQLSTATE 08006",
  "connection reset",
  "timeout",
  "too many connections",
  "Failed to connect to database",
];

function isTransientPoolerError(err: unknown): boolean {
  const stderr =
    err && typeof err === "object" && "stderr" in err
      ? String((err as { stderr?: Buffer | string }).stderr ?? "")
      : "";
  const message = err instanceof Error ? err.message : String(err);
  const text = `${stderr}\n${message}`.toLowerCase();
  return TRANSIENT_POOLER_PATTERNS.some((p) => text.includes(p.toLowerCase()));
}

function runQueryOnce(dbUrl: string, sql: string): string {
  return execFileSync("supabase", ["db", "query", "--db-url", dbUrl, "--yes", "-o", "json"], {
    input: sql,
    encoding: "utf8",
    env: process.env,
  }).trim();
}

/** Run one SQL statement via linked/pooler URL; expects a single scalar cell. */
export async function queryScalar(dbUrl: string, sql: string): Promise<string | null> {
  const maxAttempts = 4;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const raw = runQueryOnce(dbUrl, sql);
      if (!raw) return null;

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error("supabase db query did not return JSON; cannot read Vault secret.");
      }

      const rows = normalizeRows(parsed);
      if (rows.length === 0) return null;

      const first = rows[0]!;
      const keys = Object.keys(first);
      if (keys.length === 0) return null;
      const value = first[keys[0]!];
      if (value === null || value === undefined) return null;
      return String(value);
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts || !isTransientPoolerError(err)) {
        throw err;
      }
      const delayMs = attempt * 3000;
      console.warn(
        `Vault pooler query failed (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms…`,
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

function normalizeRows(parsed: unknown): QueryJsonRow[] {
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return [];
    if (Array.isArray(parsed[0])) return [];
    return parsed as QueryJsonRow[];
  }
  if (parsed && typeof parsed === "object" && "rows" in parsed) {
    const rows = (parsed as { rows: unknown }).rows;
    return Array.isArray(rows) ? (rows as QueryJsonRow[]) : [];
  }
  return [];
}

export async function readVaultSecret(dbUrl: string, name: string): Promise<string> {
  const sql =
    "select decrypted_secret from vault.decrypted_secrets where name = '" +
    name.replace(/'/g, "''") +
    "' limit 1;";
  const value = await queryScalar(dbUrl, sql);
  if (!value?.trim()) {
    throw new Error(`Vault secret "${name}" is missing or empty.`);
  }
  return value.trim();
}
