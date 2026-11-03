-- LOCAL ONLY — not applied by normal production deploy.
--
-- Runs when: local `supabase db reset` (or `make supabase-reset`) after migrations.
-- Does NOT run when: `supabase db push` to linked remote (default prod path).
-- Optional (avoid on prod): `supabase db push --include-seed --remote`.
-- Destructive: `supabase db reset --remote` replays migrations + seed unless `--no-seed`.
--
-- Sets dbt_runner password to `local-dbt-runner` for local profiles only.
-- Production: set password manually (Dashboard SQL); never reuse this value.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'dbt_runner') then
    alter role dbt_runner password 'local-dbt-runner';
  end if;
end
$$;
