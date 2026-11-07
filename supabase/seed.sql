-- LOCAL ONLY — not applied by normal production deploy.
--
-- Runs when: local `supabase db reset` (or `make supabase-reset`) after migrations.
-- Does NOT run when: `supabase db push` to linked remote (default prod path).
-- Optional (avoid on prod): `supabase db push --include-seed --remote`.
-- Destructive: `supabase db reset --remote` replays migrations + seed unless `--no-seed`.
--
-- Vault secrets + sync (prod uses Dashboard / deploy, not this file):
--   dbt_runner_password → dbt_runner
--   bi_reader_password  → bi_reader (local password local-bi-reader; Metabase)
do $$
declare
  v_id uuid;
begin
  if not exists (select 1 from pg_roles where rolname = 'dbt_runner') then
    return;
  end if;

  select id into v_id from vault.secrets where name = 'dbt_runner_password' limit 1;
  if v_id is null then
    perform vault.create_secret(
      'local-dbt-runner',
      'dbt_runner_password',
      'dbt_runner login (local supabase db reset)'
    );
  else
    perform vault.update_secret(
      v_id,
      'local-dbt-runner',
      'dbt_runner_password',
      'dbt_runner login (local supabase db reset)'
    );
  end if;

  perform ops.sync_dbt_runner_password_from_vault();
end
$$;

do $$
declare
  v_id uuid;
begin
  if not exists (select 1 from pg_roles where rolname = 'bi_reader') then
    return;
  end if;

  select id into v_id from vault.secrets where name = 'bi_reader_password' limit 1;
  if v_id is null then
    perform vault.create_secret(
      'local-bi-reader',
      'bi_reader_password',
      'bi_reader login (local supabase db reset)'
    );
  else
    perform vault.update_secret(
      v_id,
      'local-bi-reader',
      'bi_reader_password',
      'bi_reader login (local supabase db reset)'
    );
  end if;

  perform ops.sync_bi_reader_password_from_vault();
end
$$;
