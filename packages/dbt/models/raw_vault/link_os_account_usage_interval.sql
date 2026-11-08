{{ config(
    materialized='incremental',
    unique_key='link_hk',
    schema='raw_vault',
    tags=['macos', 'macos_screentime'],
) }}

select distinct
  {{ hash_key(['os_account_bk', 'usage_interval_id']) }} as link_hk,
  {{ hash_key(['os_account_bk']) }} as os_account_hk,
  {{ hash_key(['usage_interval_id']) }} as usage_interval_hk,
  current_timestamp as load_dts,
  record_source
from {{ ref('stg_macos_screentime__interval') }}
{% if is_incremental() %}
where {{ hash_key(['os_account_bk', 'usage_interval_id']) }} not in (select link_hk from {{ this }})
{% endif %}
