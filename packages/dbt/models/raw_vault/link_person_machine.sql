{{ config(
    materialized='incremental',
    unique_key='link_hk',
    schema='raw_vault',
    tags=['macos', 'macos_power', 'macos_screentime'],
) }}

with pairs as (
  select person_id, machine_bk from {{ ref('stg_macos_power__event') }}
  union all
  select machine_person_id as person_id, machine_bk from {{ ref('stg_macos_screentime__interval') }}
)

select distinct
  {{ hash_key(['person_id', 'machine_bk']) }} as link_hk,
  {{ hash_key(['person_id']) }} as person_hk,
  {{ hash_key(['machine_bk']) }} as machine_hk,
  current_timestamp as load_dts,
  'macos'::text as record_source
from pairs
{% if is_incremental() %}
where {{ hash_key(['person_id', 'machine_bk']) }} not in (select link_hk from {{ this }})
{% endif %}
