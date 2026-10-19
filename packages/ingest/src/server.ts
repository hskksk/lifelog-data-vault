import { randomUUID } from "node:crypto";

import { Hono } from "hono";
import { serve } from "@hono/node-server";

import { newBatchMeta } from "./batch.js";
import { putBronzeJsonLocal } from "./bronze/local.js";
import { putBronzeJsonR2 } from "./bronze/r2.js";
import { getSettings } from "./config.js";
import { createPool, registerBatch } from "./db.js";

export function createApp(): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.post("/ingest/owntracks", async (c) => {
    const settings = getSettings();
    if (settings.ingestBearerToken) {
      const auth = c.req.header("Authorization");
      if (auth !== `Bearer ${settings.ingestBearerToken}`) {
        return c.json({ detail: "Unauthorized" }, 401);
      }
    }

    const payload = await c.req.json();
    const batch = newBatchMeta();
    const requestId = randomUUID();
    const recordSource = "owntracks";

    let prefix: string;
    if (settings.r2) {
      prefix = await putBronzeJsonR2(settings.r2, {
        recordSource,
        batch,
        payload,
        requestId,
      });
    } else {
      prefix = putBronzeJsonLocal(settings.bronzeLocalDir, {
        recordSource,
        batch,
        payload,
        requestId,
      });
    }

    const pool = createPool(settings.databaseUrl);
    try {
      await registerBatch(pool, {
        batchId: batch.batchId,
        recordSource,
        bronzePrefix: prefix,
        status: "received",
      });
    } finally {
      await pool.end();
    }

    return c.json({
      status: "accepted",
      batch_id: batch.batchId,
      bronze_prefix: prefix,
    });
  });

  return app;
}

export function serveOwntracks(host: string, port: number): void {
  const app = createApp();
  serve({ fetch: app.fetch, hostname: host, port });
  console.error(`lifelog-ingest listening on http://${host}:${port}`);
}
