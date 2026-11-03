-- Materialize cron: read Edge URL + secret API key from Supabase Vault (hosted cannot set app.* GUCs).
-- Deploy upserts vault secrets supabase_project_id + supabase_secret_key (see scripts/deploy.ts).

create or replace function public.invoke_owntracks_materialize()
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  is_local boolean := coalesce(
    current_setting('app.settings.jwt_secret', true) = 'super-secret-jwt-token-with-at-least-32-characters-long',
    false
  );
  base_url text;
  secret_key text;
  request_id bigint;
begin
  if is_local then
    base_url := 'http://kong:8000/functions/v1';
    select nullif(trim(decrypted_secret), '')
      into secret_key
      from vault.decrypted_secrets
      where name = 'supabase_secret_key'
      limit 1;
  else
    select 'https://' || nullif(trim(decrypted_secret), '') || '.supabase.co/functions/v1'
      into base_url
      from vault.decrypted_secrets
      where name = 'supabase_project_id'
      limit 1;

    select nullif(trim(decrypted_secret), '')
      into secret_key
      from vault.decrypted_secrets
      where name = 'supabase_secret_key'
      limit 1;
  end if;

  if base_url is null or secret_key is null then
    return null;
  end if;

  request_id := net.http_post(
    url := base_url || '/owntracks-materialize',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', secret_key
    ),
    body := '{}'::jsonb
  );

  return request_id;
end;
$$;

revoke all on function public.invoke_owntracks_materialize() from public;
revoke all on function public.invoke_owntracks_materialize() from anon, authenticated;

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
  $$ select public.invoke_owntracks_materialize(); $$
);
