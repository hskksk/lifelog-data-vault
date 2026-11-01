import { describe, expect, it } from "vitest";

import { newBatchMeta, planBronzeJsonWrite } from "../src/index.js";

describe("planBronzeJsonWrite", () => {
  it("builds data and meta keys under bronze prefix", () => {
    const batch = newBatchMeta("00000000-0000-4000-8000-000000000001");
    const plan = planBronzeJsonWrite({
      recordSource: "owntracks",
      batch,
      payload: { _type: "location", tst: 1 },
      requestId: "req-1",
      receivedAt: "2026-11-01T12:00:00.000Z",
    });
    expect(plan.bronzePrefix).toBe(
      "bronze/owntracks/dt=2026-11-01/batch=00000000-0000-4000-8000-000000000001",
    );
    expect(plan.objects).toHaveLength(2);
    expect(plan.objects[0]?.storageKey).toContain("/data/2026-11-01T12:00:00.000Z_req-1.json");
    expect(plan.objects[1]?.storageKey).toContain("/_meta/batch.json");
  });
});
