from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import boto3
from lifelog_core.config import Settings, get_settings
from lifelog_core.db import (
    connect,
    insert_owntracks_inbox,
    list_batches_to_materialize,
    mark_batch_staged,
)
from lifelog_core.owntracks_parse import parse_location_payload
from lifelog_core.person_map import resolve_person_id


def _load_json_object(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _iter_bronze_data_files_local(bronze_prefix: str, root: Path) -> list[Path]:
    base = root / bronze_prefix / "data"
    if not base.is_dir():
        return []
    return sorted(base.glob("*.json"))


def _iter_bronze_data_files_r2(settings: Settings, bronze_prefix: str) -> list[tuple[str, str]]:
    if settings.r2 is None:
        return []
    client = boto3.client(
        "s3",
        endpoint_url=settings.r2.endpoint_url,
        aws_access_key_id=settings.r2.access_key_id,
        aws_secret_access_key=settings.r2.secret_access_key,
        region_name="auto",
    )
    prefix = f"{bronze_prefix}/data/"
    out: list[tuple[str, str]] = []
    token: str | None = None
    while True:
        kwargs: dict[str, Any] = {"Bucket": settings.r2.bucket, "Prefix": prefix}
        if token:
            kwargs["ContinuationToken"] = token
        resp = client.list_objects_v2(**kwargs)
        for obj in resp.get("Contents") or []:
            key = obj["Key"]
            out.append((key, key.split("/")[-1]))
        if not resp.get("IsTruncated"):
            break
        token = resp.get("NextContinuationToken")
    return out


def _fetch_r2_json(settings: Settings, key: str) -> dict[str, Any]:
    assert settings.r2 is not None
    client = boto3.client(
        "s3",
        endpoint_url=settings.r2.endpoint_url,
        aws_access_key_id=settings.r2.access_key_id,
        aws_secret_access_key=settings.r2.secret_access_key,
        region_name="auto",
    )
    body = client.get_object(Bucket=settings.r2.bucket, Key=key)["Body"].read()
    return json.loads(body.decode("utf-8"))


def materialize_owntracks(*, bronze_local_dir: Path | None = None) -> int:
    settings = get_settings()
    map_path = settings.person_map_path
    local_root = bronze_local_dir or Path(os.environ.get("BRONZE_LOCAL_DIR", "var/bronze"))
    loaded = 0

    with connect(settings.database_url) as conn:
        batches = list_batches_to_materialize(conn, "owntracks")
        for batch_id, bronze_prefix in batches:
            if settings.r2 is not None:
                for key, _name in _iter_bronze_data_files_r2(settings, bronze_prefix):
                    payload = _fetch_r2_json(settings, key)
                    if payload.get("_type") != "location":
                        continue
                    topic = str(payload.get("topic") or "owntracks/unknown/phone")
                    person_id = resolve_person_id(topic, map_path)
                    row = parse_location_payload(payload, person_id)
                    received_at = key.split("/")[-1].split("_")[0]
                    if insert_owntracks_inbox(
                        conn,
                        batch_id=batch_id,
                        bronze_key=key,
                        received_at=received_at,
                        row=row,
                    ):
                        loaded += 1
            else:
                for path in _iter_bronze_data_files_local(bronze_prefix, local_root):
                    payload = _load_json_object(path)
                    if payload.get("_type") != "location":
                        continue
                    topic = str(payload.get("topic") or "owntracks/unknown/phone")
                    person_id = resolve_person_id(topic, map_path)
                    row = parse_location_payload(payload, person_id)
                    received_at = path.name.split("_")[0]
                    if insert_owntracks_inbox(
                        conn,
                        batch_id=batch_id,
                        bronze_key=str(path),
                        received_at=received_at,
                        row=row,
                    ):
                        loaded += 1
            mark_batch_staged(conn, batch_id)

    return loaded
