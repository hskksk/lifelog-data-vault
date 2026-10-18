# Data Vault model (initial)

## Hubs

- `hub_person`
- `hub_device`
- `hub_observation_definition` (steps, heart_rate, sleep_session, weight, …)

## Links

- `link_person_device`
- `link_person_observation` (optional)

## Satellites (examples)

- `sat_device_details`
- `sat_observation_value`
- `sat_observation_quality`

## Business vault

- `bv_observation_daily`
- `bv_sleep_session`

## Marts

- `mart_health_daily`
- `mart_pc_activity_daily`

Required metadata on satellites: `load_dts`, `record_source`, `batch_id`, hash keys via dbt macros.
