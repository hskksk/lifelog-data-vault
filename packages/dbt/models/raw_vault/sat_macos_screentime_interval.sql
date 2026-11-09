{{ config(
    materialized='incremental',
    unique_key='sat_pk',
    schema='raw_vault',
    tags=['macos', 'macos_screentime'],
    on_schema_change='append_new_columns',
    post_hook=[
      "{{ backfill_screentime_interval_keys() }}",
      "{{ grant_mart_to_bi_reader() }}",
    ],
) }}

select
  {{ hash_key(['usage_interval_id']) }} as usage_interval_hk,
  {{ hash_key(['usage_interval_id']) }} || '-' || hashdiff as sat_pk,
  hashdiff,
  started_at,
  stream,
  ended_at,
  duration_seconds,
  source_device_ref,
  batch_id,
  load_dts,
  record_source
from {{ ref('stg_macos_screentime__interval') }}
{% if is_incremental() %}
where ({{ hash_key(['usage_interval_id']) }} || '-' || hashdiff) not in (select sat_pk from {{ this }})
{% endif %}
