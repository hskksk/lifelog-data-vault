{{ config(
    materialized='incremental',
    unique_key='sat_pk',
    schema='raw_vault',
    tags=['macos', 'macos_power', 'macos_screentime'],
) }}

with attrs as (
  select
    machine_bk,
    computer_name,
    model,
    os_version,
    machine_hashdiff as hashdiff,
    batch_id,
    load_dts,
    record_source
  from {{ ref('stg_macos_power__event') }}
  union all
  select
    machine_bk,
    computer_name,
    model,
    os_version,
    machine_hashdiff as hashdiff,
    batch_id,
    load_dts,
    record_source
  from {{ ref('stg_macos_screentime__interval') }}
),
ranked as (
  select
    *,
    row_number() over (
      partition by machine_bk, hashdiff
      order by load_dts desc, batch_id desc
    ) as rn
  from attrs
)

select
  {{ hash_key(['machine_bk']) }} as machine_hk,
  {{ hash_key(['machine_bk']) }} || '-' || hashdiff as sat_pk,
  hashdiff,
  computer_name,
  model,
  os_version,
  batch_id,
  load_dts,
  record_source
from ranked
where rn = 1
{% if is_incremental() %}
  and ({{ hash_key(['machine_bk']) }} || '-' || hashdiff) not in (select sat_pk from {{ this }})
{% endif %}
