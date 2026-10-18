{{ config(
    materialized='incremental',
    unique_key='location_h3_hk',
    schema='raw_vault',
    tags=['owntracks'],
) }}

select distinct
  {{ hash_key(['h3_index_r9']) }} as location_h3_hk,
  h3_index_r9 as location_h3_bk,
  current_timestamp as load_dts,
  'owntracks'::text as record_source
from {{ ref('stg_owntracks__location') }}
{% if is_incremental() %}
where {{ hash_key(['h3_index_r9']) }} not in (select location_h3_hk from {{ this }})
{% endif %}
