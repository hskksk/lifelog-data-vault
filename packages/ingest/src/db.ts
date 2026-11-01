import pg from "pg";

import type { OwnTracksLocation } from "./owntracks/parse.js";
import { payloadHashdiff } from "./owntracks/parse.js";

const { Pool } = pg;

export function createPool(databaseUrl: string): pg.Pool {
  return new Pool({ connectionString: databaseUrl });
}

export async function registerBatch(
  pool: pg.Pool,
  opts: {
    batchId: string;
    recordSource: string;
    bronzePrefix: string;
    status?: string;
  },
): Promise<void> {
  const { batchId, recordSource, bronzePrefix, status = "received" } = opts;
  await pool.query(
    `
    insert into ops.ingest_batch (batch_id, record_source, bronze_prefix, status)
    values ($1::uuid, $2, $3, $4)
    on conflict (batch_id) do update set
      bronze_prefix = excluded.bronze_prefix,
      status = excluded.status
    `,
    [batchId, recordSource, bronzePrefix, status],
  );
}

export async function insertOwntracksInbox(
  pool: pg.Pool,
  opts: {
    batchId: string;
    bronzeKey: string;
    receivedAt: string;
    row: OwnTracksLocation;
  },
): Promise<boolean> {
  const { batchId, bronzeKey, receivedAt, row } = opts;
  const result = await pool.query(
    `
    insert into staging.owntracks_location_inbox (
      batch_id, bronze_key, received_at, location_event_id, topic, person_id,
      tid, tst, lat, lon, h3_index_r9, trigger_code, accuracy_m, altitude_m,
      velocity_kmh, battery_pct, in_regions, motion_activities, payload, hashdiff
    ) values (
      $1::uuid, $2, $3::timestamptz, $4, $5, $6,
      $7, $8, $9, $10, $11, $12, $13, $14,
      $15, $16, $17::jsonb, $18::jsonb, $19::jsonb, $20
    )
    on conflict (location_event_id, batch_id) do nothing
    returning id
    `,
    [
      batchId,
      bronzeKey,
      receivedAt,
      row.locationEventId,
      row.topic,
      row.personId,
      row.tid,
      row.tst,
      row.lat,
      row.lon,
      row.h3IndexR9,
      row.triggerCode,
      row.accuracyM,
      row.altitudeM,
      row.velocityKmh,
      row.batteryPct,
      row.inRegions ? JSON.stringify(row.inRegions) : null,
      row.motionActivities ? JSON.stringify(row.motionActivities) : null,
      JSON.stringify(row.payload),
      payloadHashdiff(row.payload),
    ],
  );
  return (result.rowCount ?? 0) > 0;
}

export type BatchRow = { batchId: string; bronzePrefix: string };

export async function listBatchesToMaterialize(
  pool: pg.Pool,
  recordSource: string,
): Promise<BatchRow[]> {
  const result = await pool.query<{ batch_id: string; bronze_prefix: string }>(
    `
    select batch_id::text, bronze_prefix
    from ops.ingest_batch
    where record_source = $1 and status = 'received'
    order by started_at
    `,
    [recordSource],
  );
  return result.rows.map((r) => ({
    batchId: r.batch_id,
    bronzePrefix: r.bronze_prefix,
  }));
}

export async function markBatchStaged(pool: pg.Pool, batchId: string): Promise<void> {
  await pool.query(
    `
    update ops.ingest_batch
    set status = 'staged', finished_at = now()
    where batch_id = $1::uuid
    `,
    [batchId],
  );
}
