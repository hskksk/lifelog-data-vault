from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from lifelog_core.batch import BatchMeta
from lifelog_core.bronze_local import put_bronze_json_local
from lifelog_core.config import get_settings
from lifelog_core.db import connect, register_batch
from lifelog_core.r2 import put_bronze_json

security = HTTPBearer(auto_error=False)


def verify_token(credentials: HTTPAuthorizationCredentials | None = Depends(security)) -> None:
    settings = get_settings()
    expected = settings.ingest_bearer_token
    if not expected:
        return
    if credentials is None or credentials.credentials != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")


def create_app() -> FastAPI:
    app = FastAPI(title="lifelog-ingest", version="0.1.0")

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/ingest/owntracks", dependencies=[Depends(verify_token)])
    async def ingest_owntracks(request: Request) -> dict[str, str]:
        payload: dict[str, Any] = await request.json()
        batch = BatchMeta()
        request_id = str(uuid.uuid4())
        settings = get_settings()
        record_source = "owntracks"

        if settings.r2 is not None:
            prefix = put_bronze_json(
                settings.r2,
                record_source=record_source,
                batch=batch,
                payload=payload,
                request_id=request_id,
            )
        else:
            local_root = Path(os.environ.get("BRONZE_LOCAL_DIR", "var/bronze"))
            prefix = put_bronze_json_local(
                local_root,
                record_source=record_source,
                batch=batch,
                payload=payload,
                request_id=request_id,
            )

        with connect(settings.database_url) as conn:
            register_batch(
                conn,
                batch_id=uuid.UUID(batch.batch_id),
                record_source=record_source,
                bronze_prefix=prefix,
                status="received",
            )

        return {"status": "accepted", "batch_id": batch.batch_id, "bronze_prefix": prefix}

    return app
