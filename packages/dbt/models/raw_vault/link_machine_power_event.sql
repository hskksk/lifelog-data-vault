{{ config(
    materialized='incremental',
    unique_key='link_hk',
    schema='raw_vault',
    tags=['macos', 'macos_power'],
) }}

select distinct
  {{ hash_key(['machine_bk', 'power_event_id']) }} as link_hk,
  {{ hash_key(['machine_bk']) }} as machine_hk,
  {{ hash_key(['power_event_id']) }} as power_event_hk,
  current_timestamp as load_dts,
  record_source
from {{ ref('stg_macos_power__event') }}
{% if is_incremental() %}
where {{ hash_key(['machine_bk', 'power_event_id']) }} not in (select link_hk from {{ this }})
{% endif %}
