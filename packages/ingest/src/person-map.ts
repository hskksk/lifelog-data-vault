import { readFileSync } from "node:fs";
import YAML from "yaml";

type PersonMapFile = {
  default_person_id?: string;
  users?: Record<string, string>;
};

export function resolvePersonId(topic: string, mapPath: string): string {
  let data: PersonMapFile = {};
  try {
    const raw = readFileSync(mapPath, "utf8");
    data = (YAML.parse(raw) as PersonMapFile) ?? {};
  } catch {
    /* use defaults */
  }

  const defaultId = data.default_person_id ?? "me";
  const users = data.users ?? {};
  const parts = topic.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length >= 2 && parts[0] === "owntracks") {
    const userSlug = parts[1];
    if (userSlug && users[userSlug]) return users[userSlug];
  }
  return defaultId;
}
