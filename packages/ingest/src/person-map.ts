import { readFileSync } from "node:fs";

import { type PersonMapFile, resolvePersonId as resolveFromMap } from "@lifelog/ingest-core";
import YAML from "yaml";

export function resolvePersonId(topic: string, mapPath: string): string {
  let data: PersonMapFile = {};
  try {
    const raw = readFileSync(mapPath, "utf8");
    data = (YAML.parse(raw) as PersonMapFile) ?? {};
  } catch {
    /* use defaults */
  }
  return resolveFromMap(topic, data);
}
