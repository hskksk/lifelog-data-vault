{{ config(tags=['owntracks', 'person_activity']) }}

select
    person_id,
    device_bk,
    start_tst,
    position_model
from {{ ref('bv_location_segment') }}
where position_model is distinct from {{ position_model_sql(
    'start_trigger_code',
    'end_trigger_code',
    'duration_seconds',
    'implied_speed_kmh'
) }}
    or duration_seconds <= 0
    or abs(implied_speed_kmh - (distance_m * 3.6 / duration_seconds)) > 0.000001
