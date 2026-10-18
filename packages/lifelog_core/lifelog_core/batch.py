from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime


@dataclass
class BatchMeta:
    batch_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    record_source: str = ""
    ingested_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())
    file_count: int = 0

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=2, sort_keys=True)
