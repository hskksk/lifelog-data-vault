{{ config(
    materialized='incremental',
    unique_key='power_event_hk',
    schema='raw_vault',
    tags=['macos', 'macos_power'],
) }}

select
  {{ hash_key(['power_event_id']) }} as power_event_hk,
  power_event_id as power_event_bk,
  current_timestamp as load_dts,
  min(record_source) as record_source
from {{ ref('stg_macos_power__event') }}
group by power_event_id
{% if is_incremental() %}
having {{ hash_key(['power_event_id']) }} not in (select power_event_hk from {{ this }})
{% endif %}
