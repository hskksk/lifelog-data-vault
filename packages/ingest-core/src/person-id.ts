const PERSON_ID_MAX = 64;

/** A person key the sender chose. No spaces or slashes, so it can match an OwnTracks user. */
export function normalizePersonId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (id.length === 0 || id.length > PERSON_ID_MAX) return null;
  if (/[\s/]/.test(id)) return null;
  return id;
}

/** `owntracks/<user>/<device>` → `<user>`. */
export function personIdFromOwntracksTopic(topic: string): string | null {
  const parts = topic.trim().replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length < 2 || parts[0] !== "owntracks") return null;
  return normalizePersonId(parts[1] ?? "");
}
