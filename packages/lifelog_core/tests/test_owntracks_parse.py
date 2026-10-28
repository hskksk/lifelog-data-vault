from lifelog_core.owntracks_parse import location_event_id, parse_location_payload
from lifelog_core.person_map import resolve_person_id


def test_location_event_id_stable() -> None:
    a = location_event_id("owntracks/me/iphone", 1700000000, 35.0, 139.0, "u")
    b = location_event_id("owntracks/me/iphone", 1700000000, 35.0, 139.0, "u")
    assert a == b


def test_parse_location_h3() -> None:
    payload = {
        "_type": "location",
        "topic": "owntracks/me/iphone",
        "tid": "ip",
        "tst": 1700000000,
        "lat": 35.6812,
        "lon": 139.7671,
        "t": "u",
        "acc": 10,
    }
    row = parse_location_payload(payload, person_id="me")
    assert row.h3_index_r9
    assert len(row.h3_index_r9) > 0
    assert row.person_id == "me"


def test_person_map_default() -> None:
    assert resolve_person_id("owntracks/unknown/phone", "/nonexistent/path.yml") == "me"
