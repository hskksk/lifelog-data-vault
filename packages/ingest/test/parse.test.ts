import { describe, expect, it } from "vitest";

import { locationEventId, parseLocationPayload } from "../src/owntracks/parse.js";

describe("parseLocationPayload", () => {
  it("computes stable event id and h3", () => {
    const a = locationEventId("owntracks/me/iphone", 1700000000, 35, 139, "u");
    const b = locationEventId("owntracks/me/iphone", 1700000000, 35, 139, "u");
    expect(a).toBe(b);

    const row = parseLocationPayload(
      {
        _type: "location",
        topic: "owntracks/me/iphone",
        tid: "ip",
        tst: 1700000000,
        lat: 35.6812,
        lon: 139.7671,
        t: "u",
        acc: 10,
      },
      "me",
    );
    expect(row.h3IndexR9.length).toBeGreaterThan(0);
    expect(row.personId).toBe("me");
  });
});
