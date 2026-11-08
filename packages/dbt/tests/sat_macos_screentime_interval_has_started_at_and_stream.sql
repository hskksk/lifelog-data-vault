{{ config(tags=['macos', 'macos_screentime']) }}

select
  usage_interval_hk,
  sat_pk
from {{ ref('sat_macos_screentime_interval') }}
where started_at is null
   or stream is null
