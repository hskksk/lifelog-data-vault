{#-
  Supabase: dbt_runner has no CREATE on database postgres, but schemas already
  exist from supabase/migrations. dbt 1.12 still runs CREATE SCHEMA in before_run
  when a schema name is missing from its cache (+create_schema: false does not
  disable that path).
-#}
{% macro postgres__create_schema(relation) -%}
  {# dbt calls commit_if_has_connection() after this macro; run a no-op so a txn exists. #}
  {%- call statement('create_schema') -%}
    select 1 as dbt_schema_noop
  {%- endcall -%}
{%- endmacro %}
