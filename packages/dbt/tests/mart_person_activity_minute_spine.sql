{{ config(tags=['person_activity']) }}

with active_power as (
    select
        minute.person_id,
        minute.minute_at,
        exists (
            select 1
            from jsonb_array_elements(minute.machines) as machine
            where machine ->> 'power_state' in ('on', 'dark_wake', 'asleep')
        ) as has_active_power
    from {{ ref('mart_person_activity_minute') }} as minute
),

only_off as (
    select minute.person_id, minute.minute_at
    from {{ ref('mart_person_activity_minute') }} as minute
    inner join active_power
        on active_power.person_id = minute.person_id
        and active_power.minute_at = minute.minute_at
    where minute.app_count = 0
        and not active_power.has_active_power
        and minute.position_model is distinct from 'linear'
),

open_power_past_cap as (
    select minute.person_id, minute.minute_at
    from {{ ref('mart_person_activity_minute') }} as minute
    inner join lateral jsonb_array_elements(minute.machines) as machine on true
    where machine ->> 'power_open' = 'true'
        and minute.minute_at >= (machine ->> 'started_at')::timestamptz + interval '36 hours'
),

duplicate_minutes as (
    select person_id, minute_at
    from {{ ref('mart_person_activity_minute') }}
    group by person_id, minute_at
    having count(*) > 1
)

select person_id, minute_at, 'only_off' as failure
from only_off
union all
select person_id, minute_at, 'open_power_past_36h' as failure
from open_power_past_cap
union all
select person_id, minute_at, 'duplicate_minute' as failure
from duplicate_minutes
