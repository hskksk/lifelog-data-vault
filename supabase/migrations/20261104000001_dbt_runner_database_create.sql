-- Allow dbt's CREATE SCHEMA IF NOT EXISTS (before_run) when macro override is not yet deployed.
-- Schemas are owned by migrations; this is mainly for CI compatibility on hosted Postgres.
grant create on database postgres to dbt_runner;
