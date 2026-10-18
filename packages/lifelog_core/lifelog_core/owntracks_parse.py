from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import h3


@dataclass(frozen=True)
class OwnTracksLocation:
    location_event_id: str
    topic: str
    person_id: str
    tid: str | None
    tst: datetime
    lat: float
    lon: float
    h3_index_r9: str
    trigger_code: str | None
    accuracy_m: float | None
    altitude_m: float | None
    velocity_kmh: float | None
    battery_pct: int | None
    in_regions: list[str] | None
    motion_activities: list[str] | None
    payload: dict[str, Any]

    @property
    def record_source(self) -> str:
        return "owntracks"


def location_event_id(topic: str, tst: int, lat: float, lon: float, trigger: str | None) -> str:
    raw = f"{topic}|{tst}|{lat}|{lon}|{trigger or ''}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest()


def parse_location_payload(payload: dict[str, Any], person_id: str) -> OwnTracksLocation:
    if payload.get("_type") != "location":
        msg = f"Expected _type=location, got {payload.get('_type')!r}"
        raise ValueError(msg)
    topic = str(payload.get("topic") or "owntracks/unknown/phone")
    lat = float(payload["lat"])
    lon = float(payload["lon"])
    tst_raw = int(payload["tst"])
    tst = datetime.fromtimestamp(tst_raw, tz=UTC)
    trigger = payload.get("t")
    trigger_code = str(trigger) if trigger is not None else None
    h3_index = h3.latlng_to_cell(lat, lon, 9)

    in_regions = payload.get("inregions")
    if in_regions is not None and not isinstance(in_regions, list):
        in_regions = None
    motion = payload.get("motionactivities")
    if motion is not None and not isinstance(motion, list):
        motion = None

    acc = payload.get("acc")
    alt = payload.get("alt")
    vel = payload.get("vel")
    batt = payload.get("batt")

    return OwnTracksLocation(
        location_event_id=location_event_id(topic, tst_raw, lat, lon, trigger_code),
        topic=topic,
        person_id=person_id,
        tid=str(payload["tid"]) if payload.get("tid") is not None else None,
        tst=tst,
        lat=lat,
        lon=lon,
        h3_index_r9=h3_index,
        trigger_code=trigger_code,
        accuracy_m=float(acc) if acc is not None else None,
        altitude_m=float(alt) if alt is not None else None,
        velocity_kmh=float(vel) if vel is not None else None,
        battery_pct=int(batt) if batt is not None else None,
        in_regions=in_regions,
        motion_activities=motion,
        payload=payload,
    )


def payload_hashdiff(payload: dict[str, Any]) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.md5(canonical.encode("utf-8")).hexdigest()
