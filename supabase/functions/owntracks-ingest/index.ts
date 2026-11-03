import {
  bronzeStorageObjectPath,
  newBatchMeta,
  planBronzeJsonWrite,
} from "@lifelog/ingest-core";
import { createAdminClient } from "@lifelog/supabase-admin";
import { Hono } from "hono";

const BRONZE_BUCKET = "bronze";
const RECORD_SOURCE = "owntracks";

const FUNCTION_NAME = "owntracks-ingest";
const app = new Hono().basePath(`/${FUNCTION_NAME}`);

app.get("/health", (c) => c.json({ status: "ok" }));

app.post("/", async (c) => {
  const ingestToken = Deno.env.get("INGEST_BEARER_TOKEN");
  if (!ingestToken) {
    return c.json({ detail: "Ingest not configured" }, 503);
  }
  const auth = c.req.header("Authorization");
  if (auth !== `Bearer ${ingestToken}`) {
    return c.json({ detail: "Unauthorized" }, 401);
  }

  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ detail: "Invalid JSON" }, 400);
  }

  const batch = newBatchMeta(crypto.randomUUID());
  const plan = planBronzeJsonWrite({
    recordSource: RECORD_SOURCE,
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
      console.error("bronze upload failed", { path, error });
      return c.json({ detail: "Storage error" }, 500);
    }
  }

  const { error: dbError } = await supabase.rpc("register_ingest_batch", {
    p_batch_id: plan.batch.batchId,
    p_record_source: RECORD_SOURCE,
    p_bronze_prefix: plan.bronzePrefix,
    p_status: "received",
  });
  if (dbError) {
    console.error("register_ingest_batch failed", dbError);
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
