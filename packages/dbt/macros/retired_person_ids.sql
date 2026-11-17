{#- Person ids that must not reach the business vault.

    Raw vault keeps the history (insert-only). The business vault and the marts
    drop these ids, so a retired identity (for example the old `me` sender)
    stops appearing in BI while the source facts stay auditable.

    Set in dbt_project.yml `vars.retired_person_ids` or per run:
      dbt build --vars '{retired_person_ids: [me, other]}'
-#}
{% macro exclude_retired_person_ids(column) %}
  {%- set retired = var('retired_person_ids', []) -%}
  {%- if retired | length == 0 -%}
  true
  {%- else -%}
  {{ column }} not in (
    {%- for person_id in retired -%}
    '{{ person_id }}'{% if not loop.last %}, {% endif %}
    {%- endfor -%}
  )
  {%- endif -%}
{% endmacro %}

{#- True when the column holds a retired person id. Used by the singular test. -#}
{% macro is_retired_person_id(column) %}
  {%- set retired = var('retired_person_ids', []) -%}
  {%- if retired | length == 0 -%}
  false
  {%- else -%}
  {{ column }} in (
    {%- for person_id in retired -%}
    '{{ person_id }}'{% if not loop.last %}, {% endif %}
    {%- endfor -%}
  )
  {%- endif -%}
{% endmacro %}
