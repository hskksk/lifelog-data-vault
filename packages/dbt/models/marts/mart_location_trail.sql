{{ config(
    materialized='view',
    schema='mart',
    tags=['owntracks'],
) }}

-- One row per location_event_hk: latest satellite version (same rule as bv_location_fix).
select distinct on (location_event_hk)
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
order by location_event_hk, load_dts desc
