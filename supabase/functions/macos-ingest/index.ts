import {
  bronzeStorageObjectPath,
  newBatchMeta,
  planBronzeJsonWrite,
} from "@lifelog/ingest-core";
import { MACOS_MAX_BODY_BYTES } from "@lifelog/macos-constants";
import { validateMacosEnvelope } from "@lifelog/macos-envelope";
import { authorizeIngestRequest } from "@lifelog/ingest-auth";
import { createAdminClient } from "@lifelog/supabase-admin";
import { Hono } from "hono";

const BRONZE_BUCKET = "bronze";
const FUNCTION_NAME = "macos-ingest";
const app = new Hono().basePath(`/${FUNCTION_NAME}`);

app.get("/health", (c) => c.json({ status: "ok" }));

app.post("/", async (c) => {
  const ingestToken = Deno.env.get("MACOS_INGEST_BEARER_TOKEN");
  if (!ingestToken) {
    return c.json({ detail: "Ingest not configured" }, 503);
  }
  const auth = c.req.header("Authorization");
  if (!authorizeIngestRequest(auth, ingestToken)) {
    return c.json({ detail: "Unauthorized" }, 401);
  }

  const raw = await c.req.text();
  if (raw.length > MACOS_MAX_BODY_BYTES) {
    return c.json({ detail: "Payload too large" }, 413);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return c.json({ detail: "Invalid JSON" }, 400);
  }

  const validated = validateMacosEnvelope(payload);
  if (!validated.ok) {
    return c.json({ detail: validated.detail }, 400);
  }

  const batch = newBatchMeta(crypto.randomUUID());
  batch.schemaVersion = validated.envelope.schema_version;
  batch.entity = validated.envelope.entity;
  const plan = planBronzeJsonWrite({
    recordSource: validated.envelope.record_source,
    batch,
    payload,
    requestId: crypto.randomUUID(),
  });

  const supabase = createAdminClient();
  for (const obj of plan.objects) {
    const path = bronzeStorageObjectPath(obj.storageKey);
    const { error } = await supabase.storage.from(BRONZE_BUCKET).upload(path, obj.body, {
      contentType: obj.contentType,
      upsert: false,
    });
    if (error) {
      console.error("bronze upload failed", { path, message: error.message });
      return c.json({ detail: "Storage error" }, 500);
    }
  }

  const { error: dbError } = await supabase.rpc("register_ingest_batch", {
    p_batch_id: plan.batch.batchId,
    p_record_source: validated.envelope.record_source,
    p_bronze_prefix: plan.bronzePrefix,
    p_status: "received",
  });
  if (dbError) {
    console.error("register_ingest_batch failed", dbError.message);
    return c.json({ detail: "Database error" }, 500);
  }

  return c.json(
    {
      batch_id: plan.batch.batchId,
      bronze_prefix: plan.bronzePrefix,
    },
    202,
  );
});

Deno.serve(app.fetch);
