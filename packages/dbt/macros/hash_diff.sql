{% macro hash_diff(fields) -%}
  md5(concat_ws('||', {% for f in fields -%}
    coalesce({{ f }}::text, ''){% if not loop.last %}, {% endif %}
  {%- endfor %}))
{%- endmacro %}
