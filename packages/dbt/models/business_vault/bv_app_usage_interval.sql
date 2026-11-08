{{ config(
    materialized='table',
    schema='business_vault',
    tags=['macos', 'macos_screentime', 'person_activity'],
) }}

with latest_sat as (
    select distinct on (usage_interval_hk)
        usage_interval_hk,
        started_at,
        stream,
        ended_at,
        duration_seconds,
        source_device_ref
    from {{ ref('sat_macos_screentime_interval') }}
    order by usage_interval_hk, load_dts desc, ended_at desc nulls last
)

select
    sat.usage_interval_hk,
    person.person_hk,
    person.person_bk as person_id,
    os_account.os_account_hk,
    machine.machine_hk,
    machine.machine_bk,
    application.application_hk,
    application.application_bk as bundle_id,
    sat.stream,
    sat.started_at,
    sat.ended_at,
    sat.duration_seconds,
    sat.source_device_ref,
    case
        when coalesce(sat.source_device_ref, '') = '' then 'this_mac'
        else 'other_or_unknown'
    end as usage_device_scope
from latest_sat as sat
inner join {{ ref('link_os_account_usage_interval') }} as account_interval
    on account_interval.usage_interval_hk = sat.usage_interval_hk
inner join {{ ref('hub_os_account') }} as os_account
    on os_account.os_account_hk = account_interval.os_account_hk
inner join {{ ref('link_person_os_account') }} as person_account
    on person_account.os_account_hk = os_account.os_account_hk
inner join {{ ref('hub_person') }} as person
    on person.person_hk = person_account.person_hk
inner join {{ ref('link_machine_os_account') }} as machine_account
    on machine_account.os_account_hk = os_account.os_account_hk
inner join {{ ref('hub_machine') }} as machine
    on machine.machine_hk = machine_account.machine_hk
inner join {{ ref('link_usage_interval_application') }} as interval_application
    on interval_application.usage_interval_hk = sat.usage_interval_hk
inner join {{ ref('hub_application') }} as application
    on application.application_hk = interval_application.application_hk
where sat.started_at is not null
    and sat.ended_at is not null
    and sat.ended_at > sat.started_at
