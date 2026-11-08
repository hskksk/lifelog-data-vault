import { bronzeStorageObjectPath } from "@lifelog/bronze";
import { collectorOsAccountBk, type MacosEnvelope, validateMacosEnvelope } from "@lifelog/macos-envelope";
import { machineDetailsHashdiff, powerEventHashdiff, powerEventId } from "@lifelog/macos-power";
import { screenTimeHashdiff, usageIntervalId } from "@lifelog/macos-screentime";
import {
  type PersonMapFile,
  resolveMachinePersonId,
  resolveOsAccountPersonId,
} from "@lifelog/person-map";
import { authorizeMaterializeRequest, createAdminClient } from "@lifelog/supabase-admin";
import { Hono } from "hono";
import YAML from "yaml";

const BRONZE_BUCKET = "bronze";
const FUNCTION_NAME = "macos-materialize";
const RECORD_SOURCES = ["macos_power", "macos_screentime"] as const;

function intEnv(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function receivedAtFromFileName(fileName: string): string {
  const base = fileName.replace(/\.json$/, "");
  const idx = base.lastIndexOf("_");
  return idx > 0 ? base.slice(0, idx) : base;
}

async function loadPersonMap(): Promise<PersonMapFile> {
  const yamlEnv = Deno.env.get("PERSON_MAP_YAML");
  if (yamlEnv) {
    return (YAML.parse(yamlEnv) as PersonMapFile) ?? {};
  }
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage.from(BRONZE_BUCKET).download("config/person_map.yml");
  if (!error && data) {
    const text = await data.text();
    return (YAML.parse(text) as PersonMapFile) ?? {};
  }
  return { default_person_id: "me" };
}

async function finishBatch(
  batchId: string,
  status: "staged" | "rejected" | "error",
  errorMessage: string | null,
): Promise<boolean> {
  const supabase = createAdminClient();
  const { error } = await supabase.rpc("mark_ingest_batch_finished", {
    p_batch_id: batchId,
    p_status: status,
    p_error_message: errorMessage,
  });
  if (error) {
    console.error("mark_ingest_batch_finished", error.message);
    return false;
  }
  return true;
}

async function insertEnvelope(
  batchId: string,
  bronzeKey: string,
  receivedAt: string,
  envelope: MacosEnvelope,
  personMap: PersonMapFile,
): Promise<{ inserted: number } | { error: string }> {
  const supabase = createAdminClient();
  const collector = envelope.collector;
  const machineHash = machineDetailsHashdiff(collector.computer_name, collector.model, collector.os_version);
  let inserted = 0;

  if (envelope.record_source === "macos_power") {
    const personId = resolveMachinePersonId(collector.hardware_uuid, personMap);
    for (const event of envelope.events) {
      const { data, error } = await supabase.rpc("insert_macos_power_inbox", {
        p_batch_id: batchId,
        p_bronze_key: bronzeKey,
        p_received_at: receivedAt,
        p_power_event_id: powerEventId(collector.hardware_uuid, event),
        p_machine_bk: collector.hardware_uuid,
        p_person_id: personId,
        p_computer_name: collector.computer_name,
        p_model: collector.model,
        p_os_version: collector.os_version,
        p_machine_hashdiff: machineHash,
        p_occurred_at: event.occurred_at,
        p_kind: event.kind,
        p_message: event.message,
        p_raw_line: event.raw_line,
        p_payload: { collector, event },
        p_hashdiff: powerEventHashdiff(event),
      });
      if (error) return { error: error.message };
      if (data === true) inserted += 1;
    }
    return { inserted };
  }

  const osBk = collectorOsAccountBk(collector);
  const personId = resolveOsAccountPersonId(osBk, personMap);
  const machinePersonId = resolveMachinePersonId(collector.hardware_uuid, personMap);
  for (const event of envelope.events) {
    const { data, error } = await supabase.rpc("insert_macos_screentime_inbox", {
      p_batch_id: batchId,
      p_bronze_key: bronzeKey,
      p_received_at: receivedAt,
      p_usage_interval_id: usageIntervalId(collector.hardware_uuid, collector.os_user_id, event),
      p_os_account_bk: osBk,
      p_hardware_uuid: collector.hardware_uuid,
      p_uid: collector.os_user_id,
      p_person_id: personId,
      p_machine_person_id: machinePersonId,
      p_computer_name: collector.computer_name,
      p_model: collector.model,
      p_os_version: collector.os_version,
      p_machine_hashdiff: machineHash,
      p_stream: event.stream,
      p_bundle_id: event.bundle_id,
      p_started_at: event.started_at,
      p_ended_at: event.ended_at,
      p_duration_seconds: event.duration_seconds,
      p_source_device_ref: event.source_device_ref,
      p_payload: { collector, event },
      p_hashdiff: screenTimeHashdiff(event),
    });
    if (error) return { error: error.message };
    if (data === true) inserted += 1;
  }
  return { inserted };
}

const app = new Hono().basePath(`/${FUNCTION_NAME}`);

app.get("/health", (c) => c.json({ status: "ok" }));

app.post("/", async (c) => {
  if (
    !authorizeMaterializeRequest({
      apikey: c.req.header("apikey"),
      authorization: c.req.header("Authorization"),
    })
  ) {
    return c.json({ detail: "Unauthorized" }, 401);
  }

  const maxBatches = intEnv("MATERIALIZE_MAX_BATCHES", 20);
  const supabase = createAdminClient();
  const personMap = await loadPersonMap();
  let rowsInserted = 0;
  let batchesStaged = 0;
  let batchesRejected = 0;
  let batchesErrored = 0;

  for (const recordSource of RECORD_SOURCES) {
    const { data: batches, error: listError } = await supabase.rpc(
      "list_ingest_batches_to_materialize",
      { p_record_source: recordSource, p_limit: maxBatches },
    );
    if (listError) {
      console.error("list_ingest_batches_to_materialize", listError.message);
      return c.json({ detail: "Database error" }, 500);
    }

    for (const batch of batches ?? []) {
      const batchId = batch.batch_id as string;
      const bronzePrefix = batch.bronze_prefix as string;
      const dataFolder = bronzeStorageObjectPath(`${bronzePrefix}/data`);
      const { data: listed, error: listStorageError } = await supabase.storage
        .from(BRONZE_BUCKET)
        .list(dataFolder, { limit: 5, sortBy: { column: "name", order: "asc" } });
      if (listStorageError) {
        console.error("storage list failed", listStorageError.message);
        if (await finishBatch(batchId, "error", "storage list failed")) batchesErrored += 1;
        continue;
      }
      const jsonFile = (listed ?? []).find((file) => file.name.endsWith(".json"));
      if (!jsonFile) {
        if (await finishBatch(batchId, "error", "no data file")) batchesErrored += 1;
        continue;
      }
      const objectPath = `${dataFolder}/${jsonFile.name}`;
      const { data: blob, error: downloadError } = await supabase.storage
        .from(BRONZE_BUCKET)
        .download(objectPath);
      if (downloadError || !blob) {
        console.error("storage download failed", downloadError?.message);
        if (await finishBatch(batchId, "error", "storage download failed")) batchesErrored += 1;
        continue;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(await blob.text());
      } catch {
        if (await finishBatch(batchId, "rejected", "invalid json")) batchesRejected += 1;
        continue;
      }
      const validated = validateMacosEnvelope(payload);
      if (!validated.ok || validated.envelope.record_source !== recordSource) {
        const detail = validated.ok ? "record_source mismatch" : validated.detail;
        if (await finishBatch(batchId, "rejected", detail)) batchesRejected += 1;
        continue;
      }
      const inserted = await insertEnvelope(
        batchId,
        `bronze/${objectPath}`,
        receivedAtFromFileName(jsonFile.name),
        validated.envelope,
        personMap,
      );
      if ("error" in inserted) {
        console.error("inbox insert failed", inserted.error);
        if (await finishBatch(batchId, "error", "inbox insert failed")) batchesErrored += 1;
        continue;
      }
      if (await finishBatch(batchId, "staged", null)) {
        rowsInserted += inserted.inserted;
        batchesStaged += 1;
      }
    }
  }

  return c.json({
    batches_staged: batchesStaged,
    batches_rejected: batchesRejected,
    batches_errored: batchesErrored,
    rows_inserted: rowsInserted,
  });
});

Deno.serve(app.fetch);
