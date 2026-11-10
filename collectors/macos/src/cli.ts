import type { CollectorIdentity } from "@lifelog/ingest-core";

import { defaultStateDir, loadCollectorConfig, writeConfigTemplate } from "./config.js";
import { powerEnvelopes, powerEventsInWindow, readMachineIdentity, readPmsetLog } from "./power.js";
import { postEnvelope } from "./post.js";
import { readState, writeState } from "./state.js";
import { defaultKnowledgeDb, extractScreenTime, screenTimeEnvelopes } from "./screentime.js";

type SourceName = "power" | "screentime";

async function sendPower(identity: CollectorIdentity, stateDir: string, url: string, token: string): Promise<void> {
  const state = readState(stateDir);
  const now = new Date();
  const exportedAt = now.toISOString();
  const events = powerEventsInWindow(readPmsetLog(), state.power_covered_until, now);
  for (const envelope of powerEnvelopes(identity, events, exportedAt)) {
    await postEnvelope(url, token, envelope);
  }
  writeState(stateDir, { ...readState(stateDir), power_covered_until: exportedAt });
}

async function sendScreenTime(
  identity: CollectorIdentity,
  stateDir: string,
  url: string,
  token: string,
): Promise<void> {
  const state = readState(stateDir);
  const now = new Date();
  const exportedAt = now.toISOString();
  const extracted = extractScreenTime(
    process.env.KNOWLEDGE_C_DB || defaultKnowledgeDb(),
    state.screentime_covered_until,
    now,
  );
  if (!extracted.ok) {
    throw new Error(`screentime ${extracted.reason}: ${extracted.detail}`);
  }
  for (const envelope of screenTimeEnvelopes(identity, extracted.events, extracted.streamCounts, exportedAt)) {
    await postEnvelope(url, token, envelope);
  }
  writeState(stateDir, { ...readState(stateDir), screentime_covered_until: exportedAt });
}

async function runSource(source: SourceName): Promise<number> {
  const config = loadCollectorConfig();
  const identity = { ...readMachineIdentity(), person_id: config.personId };
  try {
    if (source === "power") {
      await sendPower(identity, config.stateDir, config.ingestUrl, config.bearerToken);
    } else {
      await sendScreenTime(identity, config.stateDir, config.ingestUrl, config.bearerToken);
    }
    return 0;
  } catch (error) {
    console.error(source, error instanceof Error ? error.message : "failed");
    return 1;
  }
}

const command = process.argv[2] ?? "run";
if (command === "init-config") {
  const stateDir = process.env.LIFELOG_STATE_DIR || defaultStateDir();
  const ingestUrl = process.argv[3];
  const written = writeConfigTemplate(stateDir, ingestUrl);
  console.log(written.created ? `wrote ${written.path}` : `left existing ${written.path}`);
  process.exit(0);
}
if (!["run", "power", "screentime"].includes(command)) {
  console.error("usage: lifelog-macos-collect init-config [ingest-url] | run | power | screentime");
  process.exit(2);
}

const sources: SourceName[] = command === "run" ? ["power", "screentime"] : [command as SourceName];
let failed = 0;
for (const source of sources) {
  failed += await runSource(source);
}
process.exit(failed > 0 ? 1 : 0);
