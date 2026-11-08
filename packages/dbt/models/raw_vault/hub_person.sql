{{ config(
    materialized='incremental',
    unique_key='person_hk',
    schema='raw_vault',
    tags=['owntracks', 'macos'],
) }}

with people as (
  select person_id, record_source from {{ ref('stg_owntracks__location') }}
  union all
  select person_id, record_source from {{ ref('stg_macos_power__event') }}
  union all
  select person_id, record_source from {{ ref('stg_macos_screentime__interval') }}
)

select
  {{ hash_key(['person_id']) }} as person_hk,
  person_id as person_bk,
  current_timestamp as load_dts,
  min(record_source) as record_source
from people
group by person_id
{% if is_incremental() %}
having {{ hash_key(['person_id']) }} not in (select person_hk from {{ this }})
{% endif %}
