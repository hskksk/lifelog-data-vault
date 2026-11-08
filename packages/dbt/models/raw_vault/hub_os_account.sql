{{ config(
    materialized='incremental',
    unique_key='os_account_hk',
    schema='raw_vault',
    tags=['macos', 'macos_screentime'],
) }}

select
  {{ hash_key(['os_account_bk']) }} as os_account_hk,
  os_account_bk,
  current_timestamp as load_dts,
  min(record_source) as record_source
from {{ ref('stg_macos_screentime__interval') }}
group by os_account_bk
{% if is_incremental() %}
having {{ hash_key(['os_account_bk']) }} not in (select os_account_hk from {{ this }})
{% endif %}
