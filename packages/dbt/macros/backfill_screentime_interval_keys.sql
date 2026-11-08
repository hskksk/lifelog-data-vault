{# started_at and stream are inputs to usage_interval_id. Rows loaded before those
   columns existed are not revisited by stg_macos_screentime__interval, which
   only reads inbox rows with vault_loaded_at is null. Copy the values onto
   satellite rows that still have them empty. A later attribute change still
   inserts a new sat row; this only fills the missing key columns. #}
{% macro backfill_screentime_interval_keys() %}
  update {{ this }} as sat
  set
    started_at = src.started_at,
    stream = src.stream
  from (
    select
      {{ hash_key(['usage_interval_id']) }} as usage_interval_hk,
      min(started_at) as started_at,
      min(stream) as stream
    from {{ source('staging', 'macos_screentime_interval_inbox') }}
    group by usage_interval_id
    having min(started_at) = max(started_at)
      and min(stream) = max(stream)
  ) as src
  where sat.usage_interval_hk = src.usage_interval_hk
    and (sat.started_at is null or sat.stream is null);
{% endmacro %}
