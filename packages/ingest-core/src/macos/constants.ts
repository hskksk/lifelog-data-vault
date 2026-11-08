/** Keep in sync with config/sources.yml macos_power.kinds. */
export const POWER_KINDS = [
  "Sleep",
  "Wake",
  "DarkWake",
  "Start",
  "Shutdown",
  "Restart",
] as const;

export type PowerKind = (typeof POWER_KINDS)[number];

export const SCREEN_TIME_STREAM = "/app/usage";

export const MACOS_SCHEMA_VERSION = 1;
export const MACOS_MAX_EVENTS = 1000;
export const MACOS_MAX_BODY_BYTES = 1_500_000;

export function isPowerKind(value: string): value is PowerKind {
  return (POWER_KINDS as readonly string[]).includes(value);
}
