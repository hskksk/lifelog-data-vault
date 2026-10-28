from __future__ import annotations

import json
import uuid
from collections.abc import Iterator
from contextlib import contextmanager

import psycopg

from lifelog_core.owntracks_parse import OwnTracksLocation, payload_hashdiff


@contextmanager
def connect(database_url: str) -> Iterator[psycopg.Connection]:
    with psycopg.connect(database_url) as conn:
        yield conn


def register_batch(
    conn: psycopg.Connection,
    *,
    batch_id: uuid.UUID,
    record_source: str,
    bronze_prefix: str,
    status: str = "received",
) -> None:
    conn.execute(
        """
        insert into ops.ingest_batch (batch_id, record_source, bronze_prefix, status)
        values (%s, %s, %s, %s)
        on conflict (batch_id) do update set
          bronze_prefix = excluded.bronze_prefix,
          status = excluded.status
        """,
        (batch_id, record_source, bronze_prefix, status),
    )
    conn.commit()


def insert_owntracks_inbox(
    conn: psycopg.Connection,
    *,
    batch_id: uuid.UUID,
    bronze_key: str,
    received_at: str,
    row: OwnTracksLocation,
) -> bool:
    """Returns False if duplicate (location_event_id, batch_id)."""
    cur = conn.execute(
        """
        insert into staging.owntracks_location_inbox (
          batch_id, bronze_key, received_at, location_event_id, topic, person_id,
          tid, tst, lat, lon, h3_index_r9, trigger_code, accuracy_m, altitude_m,
          velocity_kmh, battery_pct, in_regions, motion_activities, payload, hashdiff
        ) values (
          %s, %s, %s::timestamptz, %s, %s, %s,
          %s, %s, %s, %s, %s, %s, %s, %s,
          %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s
        )
        on conflict (location_event_id, batch_id) do nothing
        returning id
        """,
        (
            batch_id,
            bronze_key,
            received_at,
            row.location_event_id,
            row.topic,
            row.person_id,
            row.tid,
            row.tst,
            row.lat,
            row.lon,
            row.h3_index_r9,
            row.trigger_code,
            row.accuracy_m,
            row.altitude_m,
            row.velocity_kmh,
            row.battery_pct,
            json.dumps(row.in_regions) if row.in_regions is not None else None,
            json.dumps(row.motion_activities) if row.motion_activities is not None else None,
            json.dumps(row.payload),
            payload_hashdiff(row.payload),
        ),
    )
    conn.commit()
    return cur.fetchone() is not None


def list_batches_to_materialize(conn: psycopg.Connection, record_source: str) -> list[tuple]:
    rows = conn.execute(
        """
        select batch_id, bronze_prefix
        from ops.ingest_batch
        where record_source = %s and status = 'received'
        order by started_at
        """,
        (record_source,),
    ).fetchall()
    return list(rows)


def mark_batch_staged(conn: psycopg.Connection, batch_id: uuid.UUID) -> None:
    conn.execute(
        """
        update ops.ingest_batch
        set status = 'staged', finished_at = now()
        where batch_id = %s
        """,
        (batch_id,),
    )
    conn.commit()
