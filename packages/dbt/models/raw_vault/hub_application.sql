{{ config(
    materialized='incremental',
    unique_key='application_hk',
    schema='raw_vault',
    tags=['macos', 'macos_screentime'],
) }}

select
  {{ hash_key(['bundle_id']) }} as application_hk,
  bundle_id as application_bk,
  current_timestamp as load_dts,
  min(record_source) as record_source
from {{ ref('stg_macos_screentime__interval') }}
group by bundle_id
{% if is_incremental() %}
having {{ hash_key(['bundle_id']) }} not in (select application_hk from {{ this }})
{% endif %}
