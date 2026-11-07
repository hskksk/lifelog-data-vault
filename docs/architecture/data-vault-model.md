# Data Vault model (initial)

## Hubs

- `hub_person`
- `hub_device`
- `hub_observation_definition` — short codes (`steps`, `heart_rate`, `weight`, …) for generic observations. Apple Health uses the HK type string as the business key; see [macos-local-ingest.md](./macos-local-ingest.md)
- `hub_location_h3`, `hub_location_event` — see [owntracks.md](./owntracks.md)
- `hub_power_event`, `hub_application`, `hub_usage_interval`, `hub_health_record`, `hub_workout` — see [macos-local-ingest.md](./macos-local-ingest.md)

## Links

- `link_person_device`
- `link_person_observation` (optional)

## Satellites (examples)

- `sat_device_details`
- `sat_observation_value`
- `sat_observation_quality`
- `sat_macos_power_event`, `sat_macos_screentime_interval`, `sat_apple_health_record`, `sat_apple_health_workout`, `sat_apple_health_activity_summary` — see [macos-local-ingest.md](./macos-local-ingest.md)

## Business vault

- `bv_observation_daily`
- `bv_sleep_session`

## Marts

- `mart_health_daily`
- `mart_pc_activity_daily`

Required metadata on satellites: `load_dts`, `record_source`, `batch_id`, hash keys via dbt macros.
