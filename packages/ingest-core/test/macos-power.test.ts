import { describe, expect, it } from "vitest";

import { parsePmsetLog, powerEventId } from "../src/macos/power";

const LOG = `
Time stamp                Domain                  Message
2026-11-08 07:00:00 +0900 Assertions            Summary- [System: No Assertions]
2026-11-08 07:01:02 +0900 Sleep                 Entering Sleep state due to 'Clamshell Sleep':
2026-11-08 07:15:03 +0900 Wake                  Wake from Deep Idle [CDNVA] : due to EC.LidOpen
2026-11-08 07:15:04 +0900 DarkWake              DarkWake from Deep Idle
2026-11-08 06:00:00 +0900 Start                 powerd process is started
2026-11-08 08:00:00 +0900 Shutdown              Shutdown cause 5
`.trim();

describe("parsePmsetLog", () => {
  it("keeps allowlisted power events and drops assertions", () => {
    const events = parsePmsetLog(LOG);
    expect(events.map((event) => event.kind)).toEqual([
      "Sleep",
      "Wake",
      "DarkWake",
      "Start",
      "Shutdown",
    ]);
    expect(events[0]?.occurred_at).toBe("2026-11-08T07:01:02+09:00");
    expect(events[0]?.message).toContain("Clamshell Sleep");
    expect(events[1]?.raw_line).toContain("EC.LidOpen");
  });

  it("uses the raw line so two events in the same second stay distinct", () => {
    const machine = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE";
    const events = parsePmsetLog(
      [
        "2026-11-08 07:15:03 +0900 Wake                  Wake from Deep Idle",
        "2026-11-08 07:15:03 +0900 DarkWake              DarkWake from Deep Idle",
      ].join("\n"),
    );
    expect(powerEventId(machine, events[0]!).length).toBe(32);
    expect(powerEventId(machine, events[0]!)).not.toBe(powerEventId(machine, events[1]!));
    expect(powerEventId(machine, events[0]!)).toBe(powerEventId(machine, events[0]!));
  });
});
