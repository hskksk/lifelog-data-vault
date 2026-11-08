{{ config(
    materialized='table',
    schema='mart',
    tags=['person_activity'],
) }}

with app_minutes as (
    select
        person_hk,
        person_id,
        gs as minute_at
    from {{ ref('bv_app_usage_interval') }}
    cross join lateral generate_series(
        date_trunc('minute', started_at),
        date_trunc('minute', ended_at - interval '1 microsecond'),
        interval '1 minute'
    ) as gs
    where usage_device_scope = 'this_mac'
        and ended_at > started_at
        and gs < now()
),

power_minutes as (
    select
        person_hk,
        person_id,
        gs as minute_at
    from {{ ref('bv_power_interval') }}
    cross join lateral generate_series(
        date_trunc('minute', started_at),
        date_trunc(
            'minute',
            least(
                case
                    when power_open then least(now(), started_at + interval '36 hours')
                    else ended_at
                end,
                now()
            ) - interval '1 microsecond'
        ),
        interval '1 minute'
    ) as gs
    where power_state in ('on', 'dark_wake', 'asleep')
        and (
            case
                when power_open then least(now(), started_at + interval '36 hours')
                else ended_at
            end
        ) > started_at
),

linear_minutes as (
    select
        person_hk,
        person_id,
        gs as minute_at
    from {{ ref('bv_location_segment') }}
    cross join lateral generate_series(
        date_trunc('minute', start_tst),
        date_trunc('minute', least(end_tst, now()) - interval '1 microsecond'),
        interval '1 minute'
    ) as gs
    where position_model = 'linear'
        and end_tst > start_tst
),

spine as (
    select
        person_hk,
        person_id,
        minute_at,
        bool_or(source_name = 'mac') as mac_activity
    from (
        select person_hk, person_id, minute_at, 'mac' as source_name from app_minutes
        union all
        select person_hk, person_id, minute_at, 'mac' as source_name from power_minutes
        union all
        select person_hk, person_id, minute_at, 'location' as source_name from linear_minutes
    ) as minutes
    group by person_hk, person_id, minute_at
),

segment_at_minute as (
    select
        person_hk,
        person_id,
        minute_at,
        mac_activity,
        device_hk,
        device_bk,
        position_model,
        start_tst,
        end_tst,
        start_lat,
        start_lon,
        end_lat,
        end_lon,
        start_accuracy_m,
        end_accuracy_m,
        distance_m,
        start_motion_activities,
        end_motion_activities,
        start_location_event_hk,
        end_location_event_hk
    from (
        select
            spine.person_hk,
            spine.person_id,
            spine.minute_at,
            spine.mac_activity,
            segment.device_hk,
            segment.device_bk,
            segment.position_model,
            segment.start_tst,
            segment.end_tst,
            segment.start_lat,
            segment.start_lon,
            segment.end_lat,
            segment.end_lon,
            segment.start_accuracy_m,
            segment.end_accuracy_m,
            segment.distance_m,
            segment.start_motion_activities,
            segment.end_motion_activities,
            segment.start_location_event_hk,
            segment.end_location_event_hk,
            row_number() over (
                partition by spine.person_id, spine.minute_at, segment.device_hk
                order by segment.start_tst desc
            ) as segment_rank
        from spine
        inner join {{ ref('bv_location_segment') }} as segment
            on segment.person_hk = spine.person_hk
            and segment.start_tst <= spine.minute_at
            and spine.minute_at < segment.end_tst
    ) as candidates
    where segment_rank = 1
),

located as (
    select
        person_hk,
        person_id,
        minute_at,
        mac_activity,
        device_hk,
        device_bk,
        position_model,
        start_motion_activities,
        end_motion_activities,
        start_location_event_hk,
        end_location_event_hk,
        case
            when position_model = 'linear' then start_lat + alpha * (end_lat - start_lat)
            when position_model = 'hold_start' and mac_activity then start_lat
        end as lat,
        case
            when position_model = 'linear' then start_lon + alpha * (end_lon_unwrapped - start_lon)
            when position_model = 'hold_start' and mac_activity then start_lon
        end as lon,
        case
            when position_model = 'linear'
                or (position_model = 'hold_start' and mac_activity)
                then {{ estimate_radius_m_sql(
                    'position_model',
                    'start_accuracy_m',
                    'end_accuracy_m',
                    'distance_m'
                ) }}
        end as estimate_radius_m
    from (
        select
            *,
            extract(epoch from (minute_at - start_tst))
                / extract(epoch from (end_tst - start_tst)) as alpha,
            case
                when end_lon - start_lon > 180 then end_lon - 360
                when start_lon - end_lon > 180 then end_lon + 360
                else end_lon
            end as end_lon_unwrapped
        from segment_at_minute
    ) as interpolated
),

located_wrapped as (
    select
        *,
        case
            when lon > 180 then lon - 360
            when lon < -180 then lon + 360
            else lon
        end as lon_wrapped
    from located
),

machine_name as (
    select distinct on (machine_hk)
        machine_hk,
        computer_name
    from {{ ref('sat_machine_details') }}
    order by machine_hk, load_dts desc
),

power_at_minute as (
    select
        spine.person_id,
        spine.minute_at,
        power.machine_bk,
        machine_name.computer_name,
        power.power_state,
        power.power_confidence,
        power.power_open,
        power.started_at
    from spine
    inner join {{ ref('bv_power_interval') }} as power
        on power.person_hk = spine.person_hk
        and power.started_at <= spine.minute_at
        and (power.ended_at is null or spine.minute_at < power.ended_at)
        and (
            not power.power_open
            or spine.minute_at < power.started_at + interval '36 hours'
        )
    left join machine_name
        on machine_name.machine_hk = power.machine_hk
),

power_agg as (
    select
        person_id,
        minute_at,
        case when count(*) = 1 then min(power_state) end as power_state,
        case when count(*) = 1 then min(power_confidence) end as power_confidence,
        case when count(*) = 1 then bool_and(power_open) end as power_open,
        jsonb_agg(
            jsonb_build_object(
                'machine_bk', machine_bk,
                'computer_name', computer_name,
                'power_state', power_state,
                'power_confidence', power_confidence,
                'power_open', power_open,
                'started_at', started_at
            )
            order by machine_bk
        ) as machines
    from power_at_minute
    group by person_id, minute_at
),

app_at_minute as (
    select
        spine.person_id,
        spine.minute_at,
        array_agg(distinct app.bundle_id order by app.bundle_id) as app_bundle_ids
    from spine
    inner join {{ ref('bv_app_usage_interval') }} as app
        on app.person_hk = spine.person_hk
        and app.usage_device_scope = 'this_mac'
        and app.started_at < spine.minute_at + interval '1 minute'
        and app.ended_at > spine.minute_at
    group by spine.person_id, spine.minute_at
),

location_payload as (
    select
        person_id,
        minute_at,
        count(*) filter (where lat is not null) as located_devices,
        jsonb_agg(
            jsonb_build_object(
                'device_bk', device_bk,
                'lat', lat,
                'lon', lon_wrapped,
                'position_model', position_model,
                'estimate_radius_m', estimate_radius_m,
                'start_location_event_hk', start_location_event_hk,
                'end_location_event_hk', end_location_event_hk
            )
            order by device_bk
        ) as locations
    from located_wrapped
    where lat is not null
        or position_model = 'unknown'
    group by person_id, minute_at
),

single_location as (
    select located.*
    from located_wrapped as located
    inner join location_payload
        on location_payload.person_id = located.person_id
        and location_payload.minute_at = located.minute_at
        and location_payload.located_devices = 1
    where located.lat is not null
)

select
    spine.person_id,
    spine.minute_at,
    single_location.lat,
    single_location.lon_wrapped as lon,
    single_location.position_model,
    single_location.estimate_radius_m,
    single_location.device_bk as location_device_bk,
    coalesce(location_payload.located_devices, 0) > 1 as location_ambiguous,
    location_payload.locations,
    case
        when single_location.position_model = 'linear'
            and jsonb_typeof(single_location.start_motion_activities) = 'array'
            and jsonb_array_length(single_location.start_motion_activities) = 1
            and single_location.start_motion_activities = single_location.end_motion_activities
            then single_location.start_motion_activities ->> 0
    end as motion_label,
    single_location.start_motion_activities::text as motion_at_start,
    single_location.end_motion_activities::text as motion_at_end,
    power_agg.power_state,
    power_agg.power_confidence,
    power_agg.power_open,
    coalesce(power_agg.machines, '[]'::jsonb) as machines,
    coalesce(app_at_minute.app_bundle_ids, array[]::text[]) as app_bundle_ids,
    coalesce(cardinality(app_at_minute.app_bundle_ids), 0) as app_count
from spine
left join location_payload
    on location_payload.person_id = spine.person_id
    and location_payload.minute_at = spine.minute_at
left join single_location
    on single_location.person_id = spine.person_id
    and single_location.minute_at = spine.minute_at
left join power_agg
    on power_agg.person_id = spine.person_id
    and power_agg.minute_at = spine.minute_at
left join app_at_minute
    on app_at_minute.person_id = spine.person_id
    and app_at_minute.minute_at = spine.minute_at
