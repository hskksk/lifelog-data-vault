{{ config(
    materialized='incremental',
    unique_key='sat_pk',
    schema='raw_vault',
    tags=['macos', 'macos_power'],
) }}

select
  {{ hash_key(['power_event_id']) }} as power_event_hk,
  {{ hash_key(['power_event_id']) }} || '-' || hashdiff as sat_pk,
  hashdiff,
  occurred_at,
  kind,
  message,
  raw_line,
  batch_id,
  load_dts,
  record_source
from {{ ref('stg_macos_power__event') }}
{% if is_incremental() %}
where ({{ hash_key(['power_event_id']) }} || '-' || hashdiff) not in (select sat_pk from {{ this }})
{% endif %}
