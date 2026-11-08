{% macro mark_macos_power_inbox_loaded() %}
  update staging.macos_power_event_inbox as i
  set vault_loaded_at = current_timestamp
  where i.vault_loaded_at is null
    and exists (
      select 1
      from {{ ref('stg_macos_power__event') }} as s
      where s.power_event_id = i.power_event_id
        and s.batch_id = i.batch_id
    );
{% endmacro %}

{% macro mark_macos_screentime_inbox_loaded() %}
  update staging.macos_screentime_interval_inbox as i
  set vault_loaded_at = current_timestamp
  where i.vault_loaded_at is null
    and exists (
      select 1
      from {{ ref('stg_macos_screentime__interval') }} as s
      where s.usage_interval_id = i.usage_interval_id
        and s.batch_id = i.batch_id
    );
{% endmacro %}
