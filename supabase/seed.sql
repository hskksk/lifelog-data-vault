-- Local-only convenience for dbt_runner (supabase db reset). Do not reuse this password in prod.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'dbt_runner') then
    alter role dbt_runner password 'local-dbt-runner';
  end if;
end
$$;
