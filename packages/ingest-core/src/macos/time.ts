/**
 * Canonical offset timestamp used inside business keys.
 * `2026-11-08T07:01:02+09:00` — no milliseconds, offset with a colon, `Z` becomes `+00:00`.
 */
export function canonicalOffsetTimestamp(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.exec(
    value.trim(),
  );
  if (!match) return null;
  const date = match[1];
  const time = match[2];
  if (!date || !time) return null;
  let offset = match[3] ?? "";
  if (offset === "Z") offset = "+00:00";
  else if (/^[+-]\d{4}$/.test(offset)) offset = `${offset.slice(0, 3)}:${offset.slice(3)}`;
  const iso = `${date}T${time}${offset}`;
  if (Number.isNaN(Date.parse(iso))) return null;
  return iso;
}

/** `pmset` offset `+0900` → `+09:00`. */
export function pmsetStampToCanonical(date: string, time: string, offset: string): string | null {
  return canonicalOffsetTimestamp(`${date}T${time}${offset}`);
}
