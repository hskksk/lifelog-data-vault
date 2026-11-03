export type PersonMapFile = {
  default_person_id?: string;
  users?: Record<string, string>;
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
