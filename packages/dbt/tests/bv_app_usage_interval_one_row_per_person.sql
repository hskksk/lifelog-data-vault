{{ config(tags=['macos', 'macos_screentime', 'person_activity']) }}

select
    usage_interval_hk,
    person_id
from {{ ref('bv_app_usage_interval') }}
group by usage_interval_hk, person_id
having count(*) > 1
