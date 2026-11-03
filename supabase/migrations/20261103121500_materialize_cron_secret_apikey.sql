-- Materialize cron: use secret API key (sb_secret_...) on apikey header, not legacy service_role JWT Bearer.
-- Prod: alter database postgres set app.supabase_secret_key = 'sb_secret_...';

do $$
begin
  if exists (select 1 from cron.job where jobname = 'owntracks-materialize') then
    perform cron.unschedule('owntracks-materialize');
  end if;
end;
$$;

select cron.schedule(
  'owntracks-materialize',
  '*/15 * * * *',
  $$
    select net.http_post(
      url := current_setting('app.supabase_functions_url', true) || '/owntracks-materialize',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', current_setting('app.supabase_secret_key', true)
      ),
      body := '{}'::jsonb
    )
    where coalesce(current_setting('app.supabase_functions_url', true), '') <> ''
      and coalesce(current_setting('app.supabase_secret_key', true), '') <> '';
  $$
);
