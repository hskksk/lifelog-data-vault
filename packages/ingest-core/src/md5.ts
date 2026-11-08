import { createHash } from "node:crypto";

/** Same join as dbt `hash_key` / `hash_diff`: md5 of fields separated by `||`. */
export function md5Key(parts: readonly string[]): string {
  return createHash("md5").update(parts.join("||"), "utf8").digest("hex");
}
