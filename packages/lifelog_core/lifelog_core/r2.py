from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import boto3

from lifelog_core.batch import BatchMeta
from lifelog_core.config import R2Config


def s3_client(cfg: R2Config):
    return boto3.client(
        "s3",
        endpoint_url=cfg.endpoint_url,
        aws_access_key_id=cfg.access_key_id,
        aws_secret_access_key=cfg.secret_access_key,
        region_name="auto",
    )


def bronze_prefix(record_source: str, batch_id: str, dt: datetime | None = None) -> str:
    day = (dt or datetime.now(UTC)).strftime("%Y-%m-%d")
    return f"bronze/{record_source}/dt={day}/batch={batch_id}"


def put_bronze_json(
    cfg: R2Config,
    *,
    record_source: str,
    batch: BatchMeta,
    payload: dict[str, Any],
    request_id: str,
) -> str:
    prefix = bronze_prefix(record_source, batch.batch_id)
    received_at = datetime.now(UTC).isoformat()
    data_key = f"{prefix}/data/{received_at}_{request_id}.json"
    meta_key = f"{prefix}/_meta/batch.json"

    client = s3_client(cfg)
    client.put_object(
        Bucket=cfg.bucket,
        Key=data_key,
        Body=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        ContentType="application/json",
    )
    batch.record_source = record_source
    batch.file_count = 1
    client.put_object(
        Bucket=cfg.bucket,
        Key=meta_key,
        Body=batch.to_json().encode("utf-8"),
        ContentType="application/json",
    )
    return prefix
