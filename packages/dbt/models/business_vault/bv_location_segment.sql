{{ config(
    materialized='table',
    schema='business_vault',
    tags=['owntracks', 'person_activity'],
) }}

with endpoints as (
    select
        person_hk,
        person_id,
        device_hk,
        device_bk,
        tst as start_tst,
        lat as start_lat,
        lon as start_lon,
        accuracy_m as start_accuracy_m,
        trigger_code as start_trigger_code,
        velocity_kmh as start_velocity_kmh,
        motion_activities as start_motion_activities,
        location_event_hk as start_location_event_hk,
        lead(tst) over pair as end_tst,
        lead(lat) over pair as end_lat,
        lead(lon) over pair as end_lon,
        lead(accuracy_m) over pair as end_accuracy_m,
        lead(trigger_code) over pair as end_trigger_code,
        lead(velocity_kmh) over pair as end_velocity_kmh,
        lead(motion_activities) over pair as end_motion_activities,
        lead(location_event_hk) over pair as end_location_event_hk
    from {{ ref('bv_location_fix') }}
    window pair as (
        partition by person_hk, device_hk
        order by tst, location_event_hk
    )
),

measured as (
    select
        *,
        extract(epoch from (end_tst - start_tst)) as duration_seconds,
        {{ haversine_m_sql('start_lat', 'start_lon', 'end_lat', 'end_lon') }} as distance_m
    from endpoints
    where end_tst is not null
        and end_tst > start_tst
),

paced as (
    select
        *,
        distance_m * 3.6 / duration_seconds as implied_speed_kmh
    from measured
)

select
    person_hk,
    person_id,
    device_hk,
    device_bk,
    start_tst,
    end_tst,
    start_lat,
    start_lon,
    end_lat,
    end_lon,
    start_accuracy_m,
    end_accuracy_m,
    start_trigger_code,
    end_trigger_code,
    start_velocity_kmh,
    end_velocity_kmh,
    start_motion_activities,
    end_motion_activities,
    start_location_event_hk,
    end_location_event_hk,
    distance_m,
    duration_seconds,
    implied_speed_kmh,
    {{ position_model_sql(
        'start_trigger_code',
        'end_trigger_code',
        'duration_seconds',
        'implied_speed_kmh'
    ) }} as position_model
from paced
