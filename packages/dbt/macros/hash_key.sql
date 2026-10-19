{% macro hash_key(fields) -%}
  md5(concat_ws('||', {% for f in fields -%}
    coalesce({{ f }}::text, ''){% if not loop.last %}, {% endif %}
  {%- endfor %}))
{%- endmacro %}
