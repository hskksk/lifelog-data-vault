{{ config(
    materialized='incremental',
    unique_key='machine_hk',
    schema='raw_vault',
    tags=['macos', 'macos_power', 'macos_screentime'],
) }}

with machines as (
  select machine_bk, record_source from {{ ref('stg_macos_power__event') }}
  union all
  select machine_bk, record_source from {{ ref('stg_macos_screentime__interval') }}
)

select
  {{ hash_key(['machine_bk']) }} as machine_hk,
  machine_bk,
  current_timestamp as load_dts,
  min(record_source) as record_source
from machines
group by machine_bk
{% if is_incremental() %}
having {{ hash_key(['machine_bk']) }} not in (select machine_hk from {{ this }})
{% endif %}
