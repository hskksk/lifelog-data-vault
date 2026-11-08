import { describe, expect, it } from "vitest";

import { batchMetaJson, newBatchMeta } from "../src/batch";
import { validateMacosEnvelope } from "../src/macos/envelope";
import { resolveMachinePersonId, resolveOsAccountPersonId } from "../src/person-map";

const collector = {
  hardware_uuid: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
  os_user_id: 501,
  computer_name: "Studio",
  model: "Mac14,13",
  os_version: "15.1",
  timezone: "Asia/Tokyo",
};

describe("validateMacosEnvelope", () => {
  it("accepts a power batch and canonicalizes the timestamp", () => {
    const result = validateMacosEnvelope({
      schema_version: 1,
      record_source: "macos_power",
      entity: "power_event",
      exported_at: "2026-11-08T00:15:00Z",
      collector,
      events: [
        {
          occurred_at: "2026-11-08T07:01:02+09:00",
          kind: "Sleep",
          message: "Entering Sleep",
          raw_line: "2026-11-08 07:01:02 +0900 Sleep Entering Sleep",
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.envelope.exported_at).toBe("2026-11-08T00:15:00+00:00");
  });

  it("rejects an empty batch, a health entity, and a missing computer name", () => {
    expect(
      validateMacosEnvelope({
        schema_version: 1,
        record_source: "macos_power",
        entity: "power_event",
        exported_at: "2026-11-08T00:15:00Z",
        collector,
        events: [],
      }).ok,
    ).toBe(false);
    expect(
      validateMacosEnvelope({
        schema_version: 1,
        record_source: "apple_health",
        entity: "record",
        exported_at: "2026-11-08T00:15:00Z",
        collector,
        events: [{}],
      }).ok,
    ).toBe(false);
    const missingName = validateMacosEnvelope({
      schema_version: 1,
      record_source: "macos_screentime",
      entity: "usage_interval",
      exported_at: "2026-11-08T00:15:00Z",
      collector: { ...collector, computer_name: "  " },
      events: [],
    });
    expect(missingName.ok).toBe(false);
  });
});

describe("person map for machines", () => {
  it("uses the machine map, then the default person", () => {
    const map = {
      default_person_id: "me",
      machines: { "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE": "me" },
      os_accounts: { "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE:501": "me" },
    };
    expect(resolveMachinePersonId("AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE", map)).toBe("me");
    expect(resolveMachinePersonId("other", map)).toBe("me");
    expect(resolveOsAccountPersonId("AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE:501", map)).toBe("me");
  });
});

describe("batch meta", () => {
  it("writes schema_version and entity when the mac collector set them", () => {
    const batch = newBatchMeta("00000000-0000-4000-8000-000000000001");
    batch.recordSource = "macos_power";
    batch.schemaVersion = 1;
    batch.entity = "power_event";
    const meta = JSON.parse(batchMetaJson(batch)) as { schema_version: number; entity: string };
    expect(meta.schema_version).toBe(1);
    expect(meta.entity).toBe("power_event");
  });
});
