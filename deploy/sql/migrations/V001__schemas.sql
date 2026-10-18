-- Vault DDL evolves via forward-only migrations (do not edit after apply).

create schema if not exists staging;
create schema if not exists raw_vault;
create schema if not exists business_vault;
create schema if not exists mart;
create schema if not exists ops;

create table if not exists ops.ingest_batch (
  batch_id uuid primary key,
  record_source text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  bronze_prefix text,
  error_message text
);

create table if not exists ops.dbt_run_log (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  invocation_id text,
  status text,
  batch_id uuid
);
