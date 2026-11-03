-- Dedicated login for GitHub Actions dbt (no ops / service_role URL in CI).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'dbt_runner') then
    create role dbt_runner with login;
  end if;
end
$$;

comment on role dbt_runner is
  'dbt Core (GitHub Actions). Set password in prod: alter role dbt_runner password ''...''; URL in GitHub Secret SUPABASE_DB_URL (session pooler).';

grant connect on database postgres to dbt_runner;

grant usage on schema staging, raw_vault, business_vault, mart to dbt_runner;
grant create on schema staging, raw_vault, business_vault, mart to dbt_runner;

grant select, insert, update, delete on all tables in schema staging to dbt_runner;
grant all privileges on all tables in schema raw_vault, business_vault, mart to dbt_runner;

grant usage, select on all sequences in schema staging, raw_vault, business_vault, mart to dbt_runner;

alter default privileges for role postgres in schema staging
  grant select, insert, update, delete on tables to dbt_runner;
alter default privileges for role postgres in schema raw_vault
  grant all privileges on tables to dbt_runner;
alter default privileges for role postgres in schema business_vault
  grant all privileges on tables to dbt_runner;
alter default privileges for role postgres in schema mart
  grant all privileges on tables to dbt_runner;

alter default privileges for role postgres in schema staging
  grant usage, select on sequences to dbt_runner;
alter default privileges for role postgres in schema raw_vault
  grant usage, select on sequences to dbt_runner;
alter default privileges for role postgres in schema business_vault
  grant usage, select on sequences to dbt_runner;
alter default privileges for role postgres in schema mart
  grant usage, select on sequences to dbt_runner;

revoke all on schema ops from dbt_runner;
