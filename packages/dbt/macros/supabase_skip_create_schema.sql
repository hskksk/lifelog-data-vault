{#-
  Supabase: dbt_runner has no CREATE on database postgres, but schemas already
  exist from supabase/migrations. dbt 1.12 still runs CREATE SCHEMA in before_run
  when a schema name is missing from its cache (+create_schema: false does not
  disable that path).
-#}
{% macro postgres__create_schema(relation) -%}
{%- endmacro %}
