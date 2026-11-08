{# Post-hook for mart and business_vault models. One statement so Postgres accepts it.
   No-op when bi_reader is absent (legacy Compose Postgres has no Vault migration).
   Views stay security_invoker = false, so the owner reads raw_vault and bi_reader does not need USAGE there. #}
{% macro grant_mart_to_bi_reader() %}
do $bi_reader$
begin
  if to_regrole('bi_reader') is null then
    return;
  end if;
  {% if config.get('materialized') == 'view' %}
  execute 'alter view {{ this }} set (security_invoker = false)';
  {% endif %}
  execute 'grant select on {{ this }} to bi_reader';
end
$bi_reader$;
{% endmacro %}
