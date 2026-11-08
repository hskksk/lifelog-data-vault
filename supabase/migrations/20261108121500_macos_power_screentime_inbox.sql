-- Mac power and Screen Time landing tables. ops.ingest_batch is unchanged.
-- hub_device stays the OwnTracks topic; these inboxes carry machine and OS account keys.

create table if not exists staging.macos_power_event_inbox (
  id bigserial primary key,
  batch_id uuid not null references ops.ingest_batch (batch_id),
  record_source text not null default 'macos_power',
  bronze_key text not null,
  received_at timestamptz not null default now(),
  power_event_id text not null,
  machine_bk text not null,
  person_id text not null,
  computer_name text not null,
  model text not null default '',
  os_version text not null default '',
  machine_hashdiff text not null,
  occurred_at timestamptz not null,
  kind text not null,
  message text not null,
  raw_line text not null,
  payload jsonb not null,
  hashdiff text not null,
  vault_loaded_at timestamptz,
  unique (power_event_id, batch_id)
);

create index if not exists idx_macos_power_inbox_vault_loaded
  on staging.macos_power_event_inbox (vault_loaded_at);

alter table staging.macos_power_event_inbox enable row level security;

create table if not exists staging.macos_screentime_interval_inbox (
  id bigserial primary key,
  batch_id uuid not null references ops.ingest_batch (batch_id),
  record_source text not null default 'macos_screentime',
  bronze_key text not null,
  received_at timestamptz not null default now(),
  usage_interval_id text not null,
  os_account_bk text not null,
  hardware_uuid text not null,
  uid integer not null,
  person_id text not null,
  machine_person_id text not null,
  computer_name text not null,
  model text not null default '',
  os_version text not null default '',
  machine_hashdiff text not null,
  stream text not null,
  bundle_id text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_seconds double precision not null,
  source_device_ref text not null default '',
  payload jsonb not null,
  hashdiff text not null,
  vault_loaded_at timestamptz,
  unique (usage_interval_id, batch_id)
);

create index if not exists idx_macos_screentime_inbox_vault_loaded
  on staging.macos_screentime_interval_inbox (vault_loaded_at);

alter table staging.macos_screentime_interval_inbox enable row level security;

revoke all on staging.macos_power_event_inbox from anon, authenticated;
revoke all on staging.macos_screentime_interval_inbox from anon, authenticated;

grant select, insert, update, delete on staging.macos_power_event_inbox to dbt_runner;
grant select, insert, update, delete on staging.macos_screentime_interval_inbox to dbt_runner;
grant usage, select on sequence staging.macos_power_event_inbox_id_seq to dbt_runner;
grant usage, select on sequence staging.macos_screentime_interval_inbox_id_seq to dbt_runner;

drop policy if exists "dbt_runner macos power inbox" on staging.macos_power_event_inbox;
create policy "dbt_runner macos power inbox"
  on staging.macos_power_event_inbox
  for all
  to dbt_runner
  using (true)
  with check (true);

drop policy if exists "dbt_runner macos screentime inbox" on staging.macos_screentime_interval_inbox;
create policy "dbt_runner macos screentime inbox"
  on staging.macos_screentime_interval_inbox
  for all
  to dbt_runner
  using (true)
  with check (true);

create or replace function public.insert_macos_power_inbox(
  p_batch_id uuid,
  p_bronze_key text,
  p_received_at timestamptz,
  p_power_event_id text,
  p_machine_bk text,
  p_person_id text,
  p_computer_name text,
  p_model text,
  p_os_version text,
  p_machine_hashdiff text,
  p_occurred_at timestamptz,
  p_kind text,
  p_message text,
  p_raw_line text,
  p_payload jsonb,
  p_hashdiff text
)
returns boolean
language plpgsql
security definer
set search_path = staging, public
as $$
begin
  insert into staging.macos_power_event_inbox (
    batch_id, bronze_key, received_at, power_event_id, machine_bk, person_id,
    computer_name, model, os_version, machine_hashdiff, occurred_at, kind,
    message, raw_line, payload, hashdiff
  ) values (
    p_batch_id, p_bronze_key, p_received_at, p_power_event_id, p_machine_bk, p_person_id,
    p_computer_name, p_model, p_os_version, p_machine_hashdiff, p_occurred_at, p_kind,
    p_message, p_raw_line, p_payload, p_hashdiff
  )
  on conflict (power_event_id, batch_id) do nothing;
  return found;
end;
$$;

create or replace function public.insert_macos_screentime_inbox(
  p_batch_id uuid,
  p_bronze_key text,
  p_received_at timestamptz,
  p_usage_interval_id text,
  p_os_account_bk text,
  p_hardware_uuid text,
  p_uid integer,
  p_person_id text,
  p_machine_person_id text,
  p_computer_name text,
  p_model text,
  p_os_version text,
  p_machine_hashdiff text,
  p_stream text,
  p_bundle_id text,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_duration_seconds double precision,
  p_source_device_ref text,
  p_payload jsonb,
  p_hashdiff text
)
returns boolean
language plpgsql
security definer
set search_path = staging, public
as $$
begin
  insert into staging.macos_screentime_interval_inbox (
    batch_id, bronze_key, received_at, usage_interval_id, os_account_bk,
    hardware_uuid, uid, person_id, machine_person_id, computer_name, model,
    os_version, machine_hashdiff, stream, bundle_id, started_at, ended_at,
    duration_seconds, source_device_ref, payload, hashdiff
  ) values (
    p_batch_id, p_bronze_key, p_received_at, p_usage_interval_id, p_os_account_bk,
    p_hardware_uuid, p_uid, p_person_id, p_machine_person_id, p_computer_name, p_model,
    p_os_version, p_machine_hashdiff, p_stream, p_bundle_id, p_started_at, p_ended_at,
    p_duration_seconds, p_source_device_ref, p_payload, p_hashdiff
  )
  on conflict (usage_interval_id, batch_id) do nothing;
  return found;
end;
$$;

create or replace function public.mark_ingest_batch_finished(
  p_batch_id uuid,
  p_status text,
  p_error_message text default null
)
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
begin
  if p_status not in ('staged', 'rejected', 'error') then
    raise exception 'unsupported ingest batch status %', p_status;
  end if;
  update ops.ingest_batch
  set status = p_status,
      finished_at = now(),
      error_message = p_error_message
  where batch_id = p_batch_id;
end;
$$;

revoke all on function public.insert_macos_power_inbox(
  uuid, text, timestamptz, text, text, text, text, text, text, text,
  timestamptz, text, text, text, jsonb, text
) from public, anon, authenticated;
grant execute on function public.insert_macos_power_inbox(
  uuid, text, timestamptz, text, text, text, text, text, text, text,
  timestamptz, text, text, text, jsonb, text
) to service_role;

revoke all on function public.insert_macos_screentime_inbox(
  uuid, text, timestamptz, text, text, text, integer, text, text, text,
  text, text, text, text, text, timestamptz, timestamptz, double precision,
  text, jsonb, text
) from public, anon, authenticated;
grant execute on function public.insert_macos_screentime_inbox(
  uuid, text, timestamptz, text, text, text, integer, text, text, text,
  text, text, text, text, text, timestamptz, timestamptz, double precision,
  text, jsonb, text
) to service_role;

revoke all on function public.mark_ingest_batch_finished(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mark_ingest_batch_finished(uuid, text, text) to service_role;

-- Same Vault lookup as invoke_owntracks_materialize().
create or replace function public.invoke_macos_materialize()
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
    url := base_url || '/macos-materialize',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', secret_key
    ),
    body := '{}'::jsonb
  );

  return request_id;
end;
$$;

revoke all on function public.invoke_macos_materialize() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'macos-materialize') then
    perform cron.unschedule('macos-materialize');
  end if;
end;
$$;

select cron.schedule(
  'macos-materialize',
  '*/15 * * * *',
  $$ select public.invoke_macos_materialize(); $$
);
