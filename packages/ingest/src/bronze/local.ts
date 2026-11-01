import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { type BatchMeta, planBronzeJsonWrite } from "@lifelog/ingest-core";

export function putBronzeJsonLocal(
  root: string,
  opts: {
    recordSource: string;
    batch: BatchMeta;
    payload: unknown;
    requestId: string;
  },
): string {
  const plan = planBronzeJsonWrite(opts);
  for (const obj of plan.objects) {
    const fullPath = join(root, obj.storageKey);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, obj.body, "utf8");
  }
  return plan.bronzePrefix;
}
