{{ config(
    materialized='view',
    schema='mart',
    tags=['owntracks'],
) }}

select
  location_event_hk,
  lat,
  lon,
  h3_index_r9,
  tst,
  trigger_code,
  accuracy_m,
  altitude_m,
  velocity_kmh,
  battery_pct,
  tid,
  batch_id,
  load_dts,
  record_source
from {{ ref('sat_owntracks_location') }}
