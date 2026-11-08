{{ config(
    materialized='table',
    schema='business_vault',
    tags=['owntracks', 'person_activity'],
) }}

with latest_sat as (
    select distinct on (location_event_hk)
        location_event_hk,
        lat,
        lon,
        tst,
        trigger_code,
        accuracy_m,
        velocity_kmh,
        motion_activities
    from {{ ref('sat_owntracks_location') }}
    order by location_event_hk, load_dts desc
),

linked as (
    select
        sat.location_event_hk,
        person.person_hk,
        person.person_bk as person_id,
        device.device_hk,
        device.device_bk,
        sat.tst,
        sat.lat,
        sat.lon,
        sat.accuracy_m,
        sat.trigger_code,
        sat.velocity_kmh,
        sat.motion_activities
    from latest_sat as sat
    inner join {{ ref('link_device_location_event') }} as device_event
        on device_event.location_event_hk = sat.location_event_hk
    inner join {{ ref('hub_device') }} as device
        on device.device_hk = device_event.device_hk
    inner join {{ ref('link_person_device') }} as person_device
        on person_device.device_hk = device.device_hk
    inner join {{ ref('hub_person') }} as person
        on person.person_hk = person_device.person_hk
),

ranked as (
    select
        *,
        row_number() over (
            partition by person_hk, device_hk, tst
            order by accuracy_m asc nulls last, location_event_hk
        ) as same_tst_rank
    from linked
)

select
    location_event_hk,
    person_hk,
    person_id,
    device_hk,
    device_bk,
    tst,
    lat,
    lon,
    accuracy_m,
    trigger_code,
    velocity_kmh,
    motion_activities
from ranked
where same_tst_rank = 1
