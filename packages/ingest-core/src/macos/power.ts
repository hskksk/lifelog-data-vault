import { md5Key } from "../md5.ts";
import { osAccountBk, parsePmsetLog, type PowerEventInput } from "./model.ts";

export { osAccountBk, parsePmsetLog, type PowerEventInput };

export function powerEventId(machineBk: string, event: PowerEventInput): string {
  return md5Key([machineBk, event.occurred_at, event.raw_line]);
}

export function powerEventHashdiff(event: PowerEventInput): string {
  return md5Key([event.occurred_at, event.kind, event.message, event.raw_line]);
}

export function machineDetailsHashdiff(
  computerName: string,
  model: string,
  osVersion: string,
): string {
  return md5Key([computerName, model, osVersion]);
}
