import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type CollectorState = {
  power_covered_until?: string;
  screentime_covered_until?: string;
};

export function readState(stateDir: string): CollectorState {
  try {
    return JSON.parse(readFileSync(join(stateDir, "state.json"), "utf8")) as CollectorState;
  } catch {
    return {};
  }
}

export function writeState(stateDir: string, state: CollectorState): void {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "state.json"), JSON.stringify(state, null, 2));
}

export function windowStart(coveredUntil: string | undefined, overlapMs: number): string | null {
  if (!coveredUntil) return null;
  const parsed = Date.parse(coveredUntil);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed - overlapMs).toISOString();
}
