{{ config(
    materialized='incremental',
    unique_key='link_hk',
    schema='raw_vault',
    tags=['owntracks'],
) }}

select distinct
  {{ hash_key(['location_event_id', 'h3_index_r9']) }} as link_hk,
  {{ hash_key(['location_event_id']) }} as location_event_hk,
  {{ hash_key(['h3_index_r9']) }} as location_h3_hk,
  current_timestamp as load_dts,
  'owntracks'::text as record_source
from {{ ref('stg_owntracks__location') }}
{% if is_incremental() %}
where {{ hash_key(['location_event_id', 'h3_index_r9']) }} not in (select link_hk from {{ this }})
{% endif %}
