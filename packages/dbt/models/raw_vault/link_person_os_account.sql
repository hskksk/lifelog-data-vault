{{ config(
    materialized='incremental',
    unique_key='link_hk',
    schema='raw_vault',
    tags=['macos', 'macos_screentime'],
) }}

select distinct
  {{ hash_key(['person_id', 'os_account_bk']) }} as link_hk,
  {{ hash_key(['person_id']) }} as person_hk,
  {{ hash_key(['os_account_bk']) }} as os_account_hk,
  current_timestamp as load_dts,
  record_source
from {{ ref('stg_macos_screentime__interval') }}
{% if is_incremental() %}
where {{ hash_key(['person_id', 'os_account_bk']) }} not in (select link_hk from {{ this }})
{% endif %}
