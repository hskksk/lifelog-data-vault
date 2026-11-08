export type PersonMapFile = {
  default_person_id?: string;
  users?: Record<string, string>;
  machines?: Record<string, string>;
  os_accounts?: Record<string, string>;
};

export function resolvePersonId(topic: string, map: PersonMapFile): string {
  const defaultId = map.default_person_id ?? "me";
  const users = map.users ?? {};
  const parts = topic.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length >= 2 && parts[0] === "owntracks") {
    const userSlug = parts[1];
    if (userSlug && users[userSlug]) return users[userSlug];
  }
  return defaultId;
}

function mappedOrDefault(key: string, table: Record<string, string> | undefined, fallback: string): string {
  const mapped = table?.[key];
  return mapped && mapped.length > 0 ? mapped : fallback;
}

export function resolveMachinePersonId(machineBk: string, map: PersonMapFile): string {
  return mappedOrDefault(machineBk, map.machines, map.default_person_id ?? "me");
}

export function resolveOsAccountPersonId(osAccountBk: string, map: PersonMapFile): string {
  return mappedOrDefault(osAccountBk, map.os_accounts, map.default_person_id ?? "me");
}
