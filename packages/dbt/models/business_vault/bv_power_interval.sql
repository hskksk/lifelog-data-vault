{{ config(
    materialized='table',
    schema='business_vault',
    tags=['macos', 'macos_power', 'person_activity'],
) }}

with latest_sat as (
    select distinct on (power_event_hk)
        power_event_hk,
        occurred_at,
        kind
    from {{ ref('sat_macos_power_event') }}
    order by power_event_hk, load_dts desc
),

machine_events as (
    select
        machine.machine_hk,
        machine.machine_bk,
        sat.power_event_hk,
        sat.occurred_at as started_at,
        sat.kind,
        lead(sat.occurred_at) over (
            partition by machine.machine_hk
            order by sat.occurred_at, sat.power_event_hk
        ) as ended_at
    from latest_sat as sat
    inner join {{ ref('link_machine_power_event') }} as machine_event
        on machine_event.power_event_hk = sat.power_event_hk
    inner join {{ ref('hub_machine') }} as machine
        on machine.machine_hk = machine_event.machine_hk
    where sat.kind in ('Wake', 'Start', 'Restart', 'Sleep', 'DarkWake', 'Shutdown')
),

intervals as (
    select *
    from machine_events
    where ended_at is null
        or ended_at > started_at
)

select
    person.person_hk,
    person.person_bk as person_id,
    intervals.machine_hk,
    intervals.machine_bk,
    intervals.power_event_hk,
    intervals.started_at,
    intervals.ended_at,
    case intervals.kind
        when 'Wake' then 'on'
        when 'Start' then 'on'
        when 'Restart' then 'on'
        when 'Sleep' then 'asleep'
        when 'DarkWake' then 'dark_wake'
        when 'Shutdown' then 'off'
    end as power_state,
    intervals.ended_at is null as power_open,
    case
        when coalesce(intervals.ended_at, now()) - intervals.started_at > interval '12 hours'
            then 'low'
        else 'high'
    end as power_confidence
from intervals
inner join {{ ref('link_person_machine') }} as person_machine
    on person_machine.machine_hk = intervals.machine_hk
inner join {{ ref('hub_person') }} as person
    on person.person_hk = person_machine.person_hk
