{{ config(
    materialized='incremental',
    unique_key='sat_pk',
    schema='raw_vault',
    tags=['owntracks'],
    post_hook="{{ mark_owntracks_inbox_loaded() }}",
) }}

select
  {{ hash_key(['location_event_id']) }} as location_event_hk,
  {{ hash_key(['location_event_id']) }} || '-' || hashdiff as sat_pk,
  hashdiff,
  lat,
  lon,
  h3_index_r9,
  tst,
  trigger_code,
  accuracy_m,
  altitude_m,
  velocity_kmh,
  battery_pct,
  in_regions,
  motion_activities,
  tid,
  batch_id,
  load_dts,
  record_source
from {{ ref('stg_owntracks__location') }}
{% if is_incremental() %}
where ({{ hash_key(['location_event_id']) }} || '-' || hashdiff) not in (select sat_pk from {{ this }})
{% endif %}
