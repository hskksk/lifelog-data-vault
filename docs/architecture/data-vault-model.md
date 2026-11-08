# Data Vault model (initial)

## Hubs

- `hub_person` — the human. Shared across sources
- `hub_device` — OwnTracks topic only (`owntracks/me/iphone`). Not a hardware id
- `hub_machine` — Mac hardware UUID. Power events. See [macos-local-ingest.md](./macos-local-ingest.md)
- `hub_os_account` — `<hardware_uuid>:<uid>`. Screen Time. See [macos-local-ingest.md](./macos-local-ingest.md)
- `hub_observation_definition` — short codes (`steps`, `heart_rate`, `weight`, …) for generic observations. Apple Health, when added, keeps its own key and does not reuse `hub_device`
- `hub_location_h3`, `hub_location_event` — see [owntracks.md](./owntracks.md)
- `hub_power_event`, `hub_application`, `hub_usage_interval` — see [macos-local-ingest.md](./macos-local-ingest.md)

## Links

- `link_person_device` — person × OwnTracks topic
- `link_person_machine`, `link_person_os_account`, `link_machine_os_account` — see [macos-local-ingest.md](./macos-local-ingest.md)
- `link_person_observation` (optional)

## Satellites (examples)

- `sat_device_details` — OwnTracks topic 用。Mac のコンピュータ名は入れない
- `sat_machine_details` — `computer_name`, model, os version. See [macos-local-ingest.md](./macos-local-ingest.md)
- `sat_observation_value`
- `sat_observation_quality`
- `sat_macos_power_event`, `sat_macos_screentime_interval`, `sat_apple_health_record`, `sat_apple_health_workout`, `sat_apple_health_activity_summary` — see [macos-local-ingest.md](./macos-local-ingest.md)

## Business vault

ある時刻の場所と行動（位置の補間、電源区間、アプリ区間）の定義は、[person-activity.md](./person-activity.md) にある。

- `bv_location_fix`, `bv_location_segment` — 実測点と、隣り合う二点の組（位置区間）。`position_model = linear` になるのは、線形補間してよい位置区間だけ
- `bv_power_interval` — Sleep / Wake などのイベントから、マシンの状態区間を作る
- `bv_app_usage_interval` — スクリーンタイム区間。終了時刻が伸びた更新を反映した、最新の行だけを持つ
- `bv_observation_daily`, `bv_sleep_session` — ヘルスケアを取り込むときに作る

## Marts

- `mart_location_trail` — 実測の fix だけ。補間点は入れない
- `mart_person_activity_minute` — person × 分。推定位置、電源、アプリ。定義は [person-activity.md](./person-activity.md)
- `mart_health_daily`, `mart_pc_activity_daily` — 日次。分マートの再集計では作らない

Required metadata on satellites: `load_dts`, `record_source`, `batch_id`, hash keys via dbt macros.
