-- Apply dbt_runner login password from Vault (GitHub dbt uses session pooler as dbt_runner).

create or replace function ops.sync_dbt_runner_password_from_vault()
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
  where name = 'dbt_runner_password'
  limit 1;

  if pw is null then
    raise exception 'Vault secret dbt_runner_password is missing (Dashboard → Vault or deploy upsert)';
  end if;

  execute format('alter role dbt_runner password %L', pw);
end;
$$;

revoke all on function ops.sync_dbt_runner_password_from_vault() from public;
revoke all on function ops.sync_dbt_runner_password_from_vault() from anon, authenticated;
