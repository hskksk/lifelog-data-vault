import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { type BatchMeta, batchMetaJson } from "../batch.js";
import { bronzePrefix } from "./paths.js";

export function putBronzeJsonLocal(
  root: string,
  opts: {
    recordSource: string;
    batch: BatchMeta;
    payload: unknown;
    requestId: string;
  },
): string {
  const { recordSource, batch, payload, requestId } = opts;
  const prefix = bronzePrefix(recordSource, batch.batchId);
  const receivedAt = new Date().toISOString();
  const base = join(root, prefix);
  const dataDir = join(base, "data");
  mkdirSync(dataDir, { recursive: true });
  const dataPath = join(dataDir, `${receivedAt}_${requestId}.json`);
  writeFileSync(dataPath, JSON.stringify(payload), "utf8");

  batch.recordSource = recordSource;
  batch.fileCount = 1;
  const metaDir = join(base, "_meta");
  mkdirSync(metaDir, { recursive: true });
  writeFileSync(join(metaDir, "batch.json"), batchMetaJson(batch), "utf8");
  return prefix;
}
