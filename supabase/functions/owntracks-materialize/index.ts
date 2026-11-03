import { bronzeStorageObjectPath } from "@lifelog/bronze";
import { type PersonMapFile, resolvePersonId } from "@lifelog/person-map";
import {
  type OwnTracksPayload,
  parseLocationPayload,
  payloadHashdiff,
} from "@lifelog/parse";
import { createClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import YAML from "yaml";

const BRONZE_BUCKET = "bronze";
const RECORD_SOURCE = "owntracks";
const FUNCTION_NAME = "owntracks-materialize";

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function createServiceClient() {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function authorizeInternalRequest(authHeader: string | undefined): boolean {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const materializeToken = Deno.env.get("MATERIALIZE_BEARER_TOKEN");
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice("Bearer ".length);
  if (serviceKey && token === serviceKey) return true;
  if (materializeToken && token === materializeToken) return true;
  return false;
}

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
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage.from(BRONZE_BUCKET).download("config/person_map.yml");
  if (!error && data) {
    const text = await data.text();
    return (YAML.parse(text) as PersonMapFile) ?? {};
  }
  return { default_person_id: "me" };
}

const app = new Hono().basePath(`/${FUNCTION_NAME}`);

app.get("/health", (c) => c.json({ status: "ok" }));

app.post("/", async (c) => {
  if (!authorizeInternalRequest(c.req.header("Authorization"))) {
    return c.json({ detail: "Unauthorized" }, 401);
  }

  const maxBatches = intEnv("MATERIALIZE_MAX_BATCHES", 20);
  const maxFilesPerBatch = intEnv("MATERIALIZE_MAX_FILES_PER_BATCH", 50);
  const supabase = createServiceClient();
  const personMap = await loadPersonMap();

  const { data: batches, error: listError } = await supabase.rpc("list_ingest_batches_to_materialize", {
    p_record_source: RECORD_SOURCE,
    p_limit: maxBatches,
  });
  if (listError) {
    console.error("list_ingest_batches_to_materialize", listError);
    return c.json({ detail: "Database error" }, 500);
  }

  let rowsInserted = 0;
  let batchesProcessed = 0;

  for (const batch of batches ?? []) {
    const batchId = batch.batch_id as string;
    const bronzePrefix = batch.bronze_prefix as string;
    const dataFolder = bronzeStorageObjectPath(`${bronzePrefix}/data`);

    const { data: listed, error: listStorageError } = await supabase.storage
      .from(BRONZE_BUCKET)
      .list(dataFolder, { limit: maxFilesPerBatch, sortBy: { column: "name", order: "asc" } });
    if (listStorageError) {
      console.error("storage list failed", { dataFolder, listStorageError });
      continue;
    }

    const jsonFiles = (listed ?? []).filter((f) => f.name.endsWith(".json")).slice(0, maxFilesPerBatch);

    for (const file of jsonFiles) {
      const objectPath = `${dataFolder}/${file.name}`;
      const bronzeKey = `bronze/${objectPath}`;
      const { data: blob, error: downloadError } = await supabase.storage
        .from(BRONZE_BUCKET)
        .download(objectPath);
      if (downloadError || !blob) {
        console.error("storage download failed", { objectPath, downloadError });
        continue;
      }
      let payload: OwnTracksPayload;
      try {
        payload = JSON.parse(await blob.text()) as OwnTracksPayload;
      } catch {
        continue;
      }
      if (payload._type !== "location") continue;

      const topic = String(payload.topic ?? "owntracks/unknown/phone");
      const personId = resolvePersonId(topic, personMap);
      const row = parseLocationPayload(payload, personId);
      const receivedAt = receivedAtFromFileName(file.name);

      const { data: inserted, error: insertError } = await supabase.rpc("insert_owntracks_inbox", {
        p_batch_id: batchId,
        p_bronze_key: bronzeKey,
        p_received_at: receivedAt,
        p_lat: row.lat,
        p_lon: row.lon,
        p_h3_index_r9: row.h3IndexR9,
        p_trigger_code: row.triggerCode,
        p_accuracy_m: row.accuracyM,
        p_altitude_m: row.altitudeM,
        p_velocity_kmh: row.velocityKmh,
        p_battery_pct: row.batteryPct,
        p_in_regions: row.inRegions,
        p_motion_activities: row.motionActivities,
        p_payload: row.payload,
        p_hashdiff: payloadHashdiff(row.payload),
        p_location_event_id: row.locationEventId,
        p_topic: row.topic,
        p_person_id: row.personId,
        p_tid: row.tid,
        p_tst: row.tst.toISOString(),
      });
      if (insertError) {
        console.error("insert_owntracks_inbox", insertError);
        continue;
      }
      if (inserted === true) rowsInserted += 1;
    }

    const { error: markError } = await supabase.rpc("mark_ingest_batch_staged", {
      p_batch_id: batchId,
    });
    if (markError) {
      console.error("mark_ingest_batch_staged", markError);
      continue;
    }
    batchesProcessed += 1;
  }

  return c.json({
    batches_processed: batchesProcessed,
    rows_inserted: rowsInserted,
  });
});

Deno.serve(app.fetch);
