from __future__ import annotations

from pathlib import Path

import yaml


def resolve_person_id(topic: str, map_path: str | Path) -> str:
    """Map OwnTracks topic (owntracks/user/device) to hub_person business key."""
    path = Path(map_path)
    data: dict = {}
    if path.is_file():
        loaded = yaml.safe_load(path.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            data = loaded
    default = str(data.get("default_person_id") or "me")
    users = data.get("users") or {}
    if not isinstance(users, dict):
        users = {}
    parts = topic.strip("/").split("/")
    if len(parts) >= 2 and parts[0] == "owntracks":
        user_slug = parts[1]
        if user_slug in users:
            return str(users[user_slug])
    return default
