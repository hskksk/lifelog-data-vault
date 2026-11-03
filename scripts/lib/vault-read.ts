import { execFileSync } from "node:child_process";

type QueryJsonRow = Record<string, unknown>;

/** Run one SQL statement via linked/pooler URL; expects a single scalar cell. */
export function queryScalar(dbUrl: string, sql: string): string | null {
  const raw = execFileSync(
    "supabase",
    ["db", "query", "--db-url", dbUrl, "--yes", "-o", "json"],
    { input: sql, encoding: "utf8", env: process.env },
  ).trim();

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

export function readVaultSecret(dbUrl: string, name: string): string {
  const sql =
    "select decrypted_secret from vault.decrypted_secrets where name = '" +
    name.replace(/'/g, "''") +
    "' limit 1;";
  const value = queryScalar(dbUrl, sql);
  if (!value?.trim()) {
    throw new Error(`Vault secret "${name}" is missing or empty.`);
  }
  return value.trim();
}
