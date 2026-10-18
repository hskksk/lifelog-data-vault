{% macro hash_key(fields) -%}
  md5({{ dbt.concat(fields) }})
{%- endmacro %}
