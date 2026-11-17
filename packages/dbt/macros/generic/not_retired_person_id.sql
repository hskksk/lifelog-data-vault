{#- Fails when a business vault column holds a retired person id.
    Attached per model so a source-specific build does not test tables it did
    not rebuild. See macros/retired_person_ids.sql. -#}
{% test not_retired_person_id(model, column_name) %}
select {{ column_name }}
from {{ model }}
where {{ is_retired_person_id(column_name) }}
{% endtest %}
