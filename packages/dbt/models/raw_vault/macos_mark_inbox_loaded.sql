{{ config(
    materialized='view',
    schema='raw_vault',
    tags=['macos', 'macos_power', 'macos_screentime'],
    post_hook=[
      "{{ mark_macos_power_inbox_loaded() }}",
      "{{ mark_macos_screentime_inbox_loaded() }}",
    ],
) }}

select
  (select count(*) from {{ ref('hub_person') }}) as people,
  (select count(*) from {{ ref('hub_machine') }}) as machines,
  (select count(*) from {{ ref('hub_os_account') }}) as os_accounts,
  (select count(*) from {{ ref('hub_application') }}) as applications,
  (select count(*) from {{ ref('hub_power_event') }}) as power_events,
  (select count(*) from {{ ref('hub_usage_interval') }}) as usage_intervals,
  (select count(*) from {{ ref('link_person_machine') }}) as person_machines,
  (select count(*) from {{ ref('link_machine_power_event') }}) as machine_power_events,
  (select count(*) from {{ ref('link_person_os_account') }}) as person_os_accounts,
  (select count(*) from {{ ref('link_machine_os_account') }}) as machine_os_accounts,
  (select count(*) from {{ ref('link_os_account_usage_interval') }}) as os_account_intervals,
  (select count(*) from {{ ref('link_usage_interval_application') }}) as interval_applications,
  (select count(*) from {{ ref('sat_macos_power_event') }}) as power_sats,
  (select count(*) from {{ ref('sat_macos_screentime_interval') }}) as screentime_sats,
  (select count(*) from {{ ref('sat_machine_details') }}) as machine_sats
