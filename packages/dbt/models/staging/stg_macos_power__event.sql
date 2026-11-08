{{ config(tags=['macos', 'macos_power']) }}

select
  power_event_id,
  machine_bk,
  person_id,
  computer_name,
  model,
  os_version,
  machine_hashdiff,
  occurred_at,
  kind,
  message,
  raw_line,
  hashdiff,
  batch_id,
  record_source,
  received_at as load_dts
from {{ source('staging', 'macos_power_event_inbox') }}
where vault_loaded_at is null
