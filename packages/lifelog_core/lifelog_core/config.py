from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class R2Config:
    endpoint_url: str
    access_key_id: str
    secret_access_key: str
    bucket: str


@dataclass(frozen=True)
class Settings:
    database_url: str
    r2: R2Config | None
    ingest_bearer_token: str | None
    person_map_path: str


def _require(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        msg = f"Missing required environment variable: {name}"
        raise RuntimeError(msg)
    return value


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    r2: R2Config | None = None
    if os.environ.get("R2_BUCKET"):
        r2 = R2Config(
            endpoint_url=_require("R2_ENDPOINT"),
            access_key_id=_require("R2_ACCESS_KEY_ID"),
            secret_access_key=_require("R2_SECRET_ACCESS_KEY"),
            bucket=_require("R2_BUCKET"),
        )
    return Settings(
        database_url=os.environ.get(
            "DATABASE_URL", "postgresql://lifelog:lifelog@localhost:5432/lifelog"
        ),
        r2=r2,
        ingest_bearer_token=os.environ.get("INGEST_BEARER_TOKEN"),
        person_map_path=os.environ.get("PERSON_MAP_PATH", "config/person_map.yml"),
    )
