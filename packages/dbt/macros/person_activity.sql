{% macro haversine_m_sql(lat1, lon1, lat2, lon2) %}
(
  2 * 6371000 * asin(least(1.0, sqrt(
    power(sin(radians(({{ lat2 }}) - ({{ lat1 }})) / 2), 2)
    + cos(radians({{ lat1 }})) * cos(radians({{ lat2 }}))
      * power(sin(radians(({{ lon2 }}) - ({{ lon1 }})) / 2), 2)
  )))
)
{% endmacro %}

{# significant_change_v1. See docs/architecture/person-activity.md §3.4. #}
{% macro position_model_sql(start_trigger, end_trigger, duration_seconds, implied_speed_kmh) %}
case
  when {{ start_trigger }} = 't'
    and {{ end_trigger }} = 't'
    and {{ duration_seconds }} >= 60
    and {{ duration_seconds }} <= 20 * 60
    and {{ implied_speed_kmh }} >= 0.4
    and {{ implied_speed_kmh }} <= 130
    then 'linear'
  when {{ implied_speed_kmh }} > 150
    or {{ duration_seconds }} > 12 * 60 * 60
    then 'unknown'
  else 'hold_start'
end
{% endmacro %}

{# Null accuracy counts as 500m in both formulas. #}
{% macro estimate_radius_m_sql(position_model, start_accuracy_m, end_accuracy_m, distance_m) %}
case
  when {{ position_model }} = 'hold_start'
    then greatest(coalesce({{ start_accuracy_m }}, 500), 500)
  when {{ position_model }} = 'linear'
    then greatest(
      coalesce({{ start_accuracy_m }}, 500),
      coalesce({{ end_accuracy_m }}, 500),
      coalesce({{ distance_m }}, 0) / 4.0
    )
  else null
end
{% endmacro %}
