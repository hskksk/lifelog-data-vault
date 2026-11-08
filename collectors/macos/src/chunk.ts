import { MACOS_MAX_BODY_BYTES, MACOS_MAX_EVENTS } from "@lifelog/ingest-core";

export function chunkEvents<T>(
  events: T[],
  wrap: (chunk: T[]) => unknown,
  maxCount = MACOS_MAX_EVENTS,
  maxBytes = MACOS_MAX_BODY_BYTES,
): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  for (const event of events) {
    const next = [...current, event];
    const tooMany = next.length > maxCount;
    const tooBig = Buffer.byteLength(JSON.stringify(wrap(next))) > maxBytes;
    if (current.length > 0 && (tooMany || tooBig)) {
      chunks.push(current);
      current = [event];
      continue;
    }
    current = next;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
