import os
import uuid

import pytest
from fastapi.testclient import TestClient
from lifelog_ingest.sources.owntracks.webhook import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("BRONZE_LOCAL_DIR", str(tmp_path / "bronze"))
    monkeypatch.setenv("DATABASE_URL", os.environ.get("DATABASE_URL", ""))
    if not os.environ.get("DATABASE_URL"):
        pytest.skip("DATABASE_URL not set")
    return TestClient(create_app())


def test_health():
    client = TestClient(create_app())
    assert client.get("/health").json()["status"] == "ok"


def test_ingest_location(client):
    token = os.environ.get("INGEST_BEARER_TOKEN", "")
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    payload = {
        "_type": "location",
        "topic": "owntracks/me/iphone",
        "tid": "ip",
        "tst": 1700000001,
        "lat": 35.0,
        "lon": 139.0,
        "t": "u",
    }
    resp = client.post("/ingest/owntracks", json=payload, headers=headers)
    assert resp.status_code == 200
    assert uuid.UUID(resp.json()["batch_id"])
