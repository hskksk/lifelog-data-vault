{{ config(
    materialized='incremental',
    unique_key='device_hk',
    schema='raw_vault',
    tags=['owntracks'],
) }}

select distinct
  {{ hash_key(['topic']) }} as device_hk,
  topic as device_bk,
  current_timestamp as load_dts,
  'owntracks'::text as record_source
from {{ ref('stg_owntracks__location') }}
{% if is_incremental() %}
where {{ hash_key(['topic']) }} not in (select device_hk from {{ this }})
{% endif %}
