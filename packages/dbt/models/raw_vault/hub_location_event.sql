{{ config(
    materialized='incremental',
    unique_key='location_event_hk',
    schema='raw_vault',
    tags=['owntracks'],
) }}

select distinct
  {{ hash_key(['location_event_id']) }} as location_event_hk,
  location_event_id as location_event_bk,
  current_timestamp as load_dts,
  'owntracks'::text as record_source
from {{ ref('stg_owntracks__location') }}
{% if is_incremental() %}
where {{ hash_key(['location_event_id']) }} not in (select location_event_hk from {{ this }})
{% endif %}
