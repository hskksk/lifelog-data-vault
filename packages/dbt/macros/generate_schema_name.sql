{# Use +schema from dbt_project.yml as the real Postgres schema (staging, raw_vault, mart).
   Default dbt would prefix profile schema → staging_staging, staging_raw_vault, etc. #}
{% macro generate_schema_name(custom_schema_name, node) -%}
  {%- if custom_schema_name is none -%}
    {{ target.schema }}
  {%- else -%}
    {{ custom_schema_name | trim }}
  {%- endif -%}
{%- endmacro %}
