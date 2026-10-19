{{ config(
    materialized='incremental',
    unique_key='person_hk',
    schema='raw_vault',
    tags=['owntracks'],
) }}

select distinct
  {{ hash_key(['person_id']) }} as person_hk,
  person_id as person_bk,
  current_timestamp as load_dts,
  'owntracks'::text as record_source
from {{ ref('stg_owntracks__location') }}
{% if is_incremental() %}
where {{ hash_key(['person_id']) }} not in (select person_hk from {{ this }})
{% endif %}
