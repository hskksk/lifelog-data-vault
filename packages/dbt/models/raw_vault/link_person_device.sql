{{ config(
    materialized='incremental',
    unique_key='link_hk',
    schema='raw_vault',
    tags=['owntracks'],
) }}

select distinct
  {{ hash_key(['person_id', 'topic']) }} as link_hk,
  {{ hash_key(['person_id']) }} as person_hk,
  {{ hash_key(['topic']) }} as device_hk,
  current_timestamp as load_dts,
  'owntracks'::text as record_source
from {{ ref('stg_owntracks__location') }}
{% if is_incremental() %}
where {{ hash_key(['person_id', 'topic']) }} not in (select link_hk from {{ this }})
{% endif %}
