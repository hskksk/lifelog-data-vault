{{ config(
    materialized='incremental',
    unique_key='usage_interval_hk',
    schema='raw_vault',
    tags=['macos', 'macos_screentime'],
) }}

select
  {{ hash_key(['usage_interval_id']) }} as usage_interval_hk,
  usage_interval_id as usage_interval_bk,
  current_timestamp as load_dts,
  min(record_source) as record_source
from {{ ref('stg_macos_screentime__interval') }}
group by usage_interval_id
{% if is_incremental() %}
having {{ hash_key(['usage_interval_id']) }} not in (select usage_interval_hk from {{ this }})
{% endif %}
