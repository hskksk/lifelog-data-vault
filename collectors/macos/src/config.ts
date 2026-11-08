import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

export function loadCollectorConfig(env: NodeJS.ProcessEnv = process.env): CollectorConfig {
  const stateDir = env.LIFELOG_STATE_DIR || defaultStateDir();
  const fromFile = readIngestUrl(join(stateDir, "config.json"));
  const ingestUrl = env.MACOS_INGEST_URL || fromFile;
  if (!ingestUrl) {
    throw new Error("Set MACOS_INGEST_URL or ingest_url in ~/Library/Application Support/lifelog/config.json");
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
