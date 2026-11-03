-- Idempotent re-apply of dbt_runner privileges (e.g. after manual role/password work).
-- dbt uses existing schemas only (+create_schema: false in dbt_project.yml).

grant connect on database postgres to dbt_runner;

grant usage on schema staging, raw_vault, business_vault, mart to dbt_runner;
grant create on schema staging, raw_vault, business_vault, mart to dbt_runner;

grant select, insert, update, delete on all tables in schema staging to dbt_runner;
grant all privileges on all tables in schema raw_vault, business_vault, mart to dbt_runner;

grant usage, select on all sequences in schema staging, raw_vault, business_vault, mart to dbt_runner;
