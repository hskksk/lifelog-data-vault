from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from lifelog_core.batch import BatchMeta
from lifelog_core.r2 import bronze_prefix


def put_bronze_json_local(
    root: Path,
    *,
    record_source: str,
    batch: BatchMeta,
    payload: dict[str, Any],
    request_id: str,
) -> str:
    prefix = bronze_prefix(record_source, batch.batch_id)
    received_at = datetime.now(UTC).isoformat()
    base = root / prefix
    data_dir = base / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    data_path = data_dir / f"{received_at}_{request_id}.json"
    data_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    meta_path = base / "_meta" / "batch.json"
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    batch.record_source = record_source
    batch.file_count = 1
    meta_path.write_text(batch.to_json(), encoding="utf-8")
    return prefix
