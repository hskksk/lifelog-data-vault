{{ config(tags=['owntracks']) }}

select
  location_event_id,
  topic,
  person_id,
  tid,
  tst,
  lat,
  lon,
  h3_index_r9,
  trigger_code,
  accuracy_m,
  altitude_m,
  velocity_kmh,
  battery_pct,
  in_regions,
  motion_activities,
  hashdiff,
  batch_id,
  record_source,
  received_at as load_dts
from {{ source('staging', 'owntracks_location_inbox') }}
where vault_loaded_at is null
