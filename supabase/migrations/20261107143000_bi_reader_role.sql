-- Read-only login for Metabase. SELECT on schema mart only.
-- Password is not set here. Local: supabase/seed.sql. Prod: Vault bi_reader_password
-- via ops.sync_bi_reader_password_from_vault() (deploy calls it).
-- Design: docs/architecture/metabase.md

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'bi_reader') then
    create role bi_reader with login;
  end if;
end
$$;

-- Hosted postgres is not a superuser. ALTER ROLE ... NOSUPERUSER is rejected
-- there (SQLSTATE 42501). CREATE ROLE already defaults to NOSUPERUSER.
alter role bi_reader with
  login
  nobypassrls
  nocreatedb
  nocreaterole
  noinherit
  connection limit 10;

comment on role bi_reader is
  'Metabase. SELECT on schema mart only. Password: Vault bi_reader_password. Session pooler port 5432.';

alter role bi_reader set statement_timeout = '60s';
alter role bi_reader set lock_timeout = '5s';
alter role bi_reader set idle_in_transaction_session_timeout = '60s';
alter role bi_reader set search_path = mart;

do $$
begin
  execute format('grant connect on database %I to bi_reader', current_database());
end
$$;

revoke all privileges on schema staging, raw_vault, business_vault, ops from bi_reader;
revoke all privileges on all tables in schema staging, raw_vault, business_vault, ops from bi_reader;
revoke all privileges on all sequences in schema staging, raw_vault, business_vault, ops from bi_reader;

revoke create on schema public from bi_reader;

grant usage on schema mart to bi_reader;
grant select on all tables in schema mart to bi_reader;
revoke insert, update, delete, truncate, references, trigger on all tables in schema mart from bi_reader;

-- Objects created later by the migration role (postgres).
alter default privileges for role postgres in schema mart
  grant select on tables to bi_reader;

-- dbt builds mart views as dbt_runner. Hosted postgres may not be allowed to
-- set that role's default privileges; the dbt post-hook grants SELECT directly.
do $$
begin
  begin
    execute 'alter default privileges for role dbt_runner in schema mart grant select on tables to bi_reader';
  exception
    when insufficient_privilege then
      raise notice 'bi_reader: default privileges for dbt_runner not set (%). dbt post-hook still grants SELECT.', sqlerrm;
  end;
end
$$;

-- Data API roles do not assume bi_reader. Revoke only a direct grant so a fresh
-- database does not warn "role has not been granted membership".
do $$
declare
  member_name text;
begin
  foreach member_name in array array['anon', 'authenticated', 'authenticator']
  loop
    if exists (
      select 1
      from pg_auth_members m
      join pg_roles granted on granted.oid = m.roleid
      join pg_roles member on member.oid = m.member
      where granted.rolname = 'bi_reader'
        and member.rolname = member_name
    ) then
      execute format('revoke bi_reader from %I', member_name);
    end if;
  end loop;
end
$$;

create or replace function ops.sync_bi_reader_password_from_vault()
returns void
language plpgsql
security definer
set search_path = vault, pg_catalog, pg_temp
as $$
declare
  pw text;
begin
  select nullif(trim(decrypted_secret), '')
    into pw
  from vault.decrypted_secrets
  where name = 'bi_reader_password'
  limit 1;

  if pw is null then
    raise exception 'Vault secret bi_reader_password is missing (Dashboard → Vault or deploy upsert)';
  end if;

  execute format('alter role bi_reader password %L', pw);
end;
$$;

comment on function ops.sync_bi_reader_password_from_vault() is
  'Copy Vault secret bi_reader_password onto role bi_reader. Called by scripts/deploy.ts.';

revoke all on function ops.sync_bi_reader_password_from_vault() from public;
revoke all on function ops.sync_bi_reader_password_from_vault() from anon, authenticated;
revoke all on function ops.sync_bi_reader_password_from_vault() from bi_reader;
