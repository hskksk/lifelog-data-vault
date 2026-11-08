{{ config(tags=['macos', 'macos_screentime']) }}

select
  usage_interval_id,
  os_account_bk,
  hardware_uuid as machine_bk,
  uid,
  person_id,
  machine_person_id,
  computer_name,
  model,
  os_version,
  machine_hashdiff,
  stream,
  bundle_id,
  started_at,
  ended_at,
  duration_seconds,
  source_device_ref,
  hashdiff,
  batch_id,
  record_source,
  received_at as load_dts
from {{ source('staging', 'macos_screentime_interval_inbox') }}
where vault_loaded_at is null
