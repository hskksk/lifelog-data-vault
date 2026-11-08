import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type CollectorConfig = {
  ingestUrl: string;
  bearerToken: string;
  stateDir: string;
};

export function defaultStateDir(): string {
  return join(homedir(), "Library", "Application Support", "lifelog");
}

export const CONFIG_URL_PLACEHOLDER = "https://<project-ref>.supabase.co/functions/v1/macos-ingest";

export function configTemplate(ingestUrl = CONFIG_URL_PLACEHOLDER): string {
  return `${JSON.stringify({ ingest_url: ingestUrl }, null, 2)}\n`;
}

export function writeConfigTemplate(
  stateDir: string,
  ingestUrl?: string,
): { path: string; created: boolean } {
  mkdirSync(stateDir, { recursive: true });
  chmodSync(stateDir, 0o700);
  const path = join(stateDir, "config.json");
  if (existsSync(path)) return { path, created: false };
  writeFileSync(path, configTemplate(ingestUrl), { encoding: "utf8", mode: 0o600 });
  return { path, created: true };
}

export function loadCollectorConfig(env: NodeJS.ProcessEnv = process.env): CollectorConfig {
  const stateDir = env.LIFELOG_STATE_DIR || defaultStateDir();
  const fromFile = readIngestUrl(join(stateDir, "config.json"));
  const ingestUrl = env.MACOS_INGEST_URL || fromFile;
  if (!ingestUrl) {
    throw new Error(
      "Set MACOS_INGEST_URL, or write ingest_url with: tsx src/cli.ts init-config",
    );
  }
  const bearerToken = env.MACOS_INGEST_BEARER_TOKEN || readKeychainToken();
  if (!bearerToken) {
    throw new Error("Set MACOS_INGEST_BEARER_TOKEN or store it in the keychain service lifelog-macos-ingest");
  }
  return { ingestUrl, bearerToken, stateDir };
}

function readIngestUrl(path: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { ingest_url?: string };
    return parsed.ingest_url;
  } catch {
    return undefined;
  }
}

function readKeychainToken(): string | undefined {
  if (process.platform !== "darwin") return undefined;
  try {
    return execFileSync(
      "security",
      ["find-generic-password", "-s", "lifelog-macos-ingest", "-w"],
      { encoding: "utf8" },
    ).trim();
  } catch {
    return undefined;
  }
}
