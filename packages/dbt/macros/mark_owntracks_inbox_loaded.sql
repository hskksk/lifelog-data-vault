{% macro mark_owntracks_inbox_loaded() %}
  update staging.owntracks_location_inbox as i
  set vault_loaded_at = current_timestamp
  where i.vault_loaded_at is null
    and exists (
      select 1
      from {{ ref('stg_owntracks__location') }} as s
      where s.location_event_id = i.location_event_id
        and s.batch_id = i.batch_id
    );
{% endmacro %}
