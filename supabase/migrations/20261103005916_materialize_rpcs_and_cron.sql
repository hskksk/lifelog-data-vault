-- Materialize Edge: list batches, insert inbox rows, mark staged (ops/staging not on PostgREST).

create or replace function public.list_ingest_batches_to_materialize(
  p_record_source text,
  p_limit integer default 20
)
returns table (batch_id uuid, bronze_prefix text)
language sql
security definer
set search_path = ops, public
as $$
  select ib.batch_id, ib.bronze_prefix
  from ops.ingest_batch ib
  where ib.record_source = p_record_source
    and ib.status = 'received'
    and ib.bronze_prefix is not null
  order by ib.started_at
  limit greatest(p_limit, 1);
$$;

create or replace function public.insert_owntracks_inbox(
  p_batch_id uuid,
  p_bronze_key text,
  p_received_at timestamptz,
  p_location_event_id text,
  p_topic text,
  p_person_id text,
  p_tid text,
  p_tst timestamptz,
  p_lat double precision,
  p_lon double precision,
  p_h3_index_r9 text,
  p_trigger_code text,
  p_accuracy_m double precision,
  p_altitude_m double precision,
  p_velocity_kmh double precision,
  p_battery_pct integer,
  p_in_regions jsonb,
  p_motion_activities jsonb,
  p_payload jsonb,
  p_hashdiff text
)
returns boolean
language plpgsql
security definer
set search_path = staging, public
as $$
begin
  insert into staging.owntracks_location_inbox (
    batch_id, bronze_key, received_at, location_event_id, topic, person_id,
    tid, tst, lat, lon, h3_index_r9, trigger_code, accuracy_m, altitude_m,
    velocity_kmh, battery_pct, in_regions, motion_activities, payload, hashdiff
  ) values (
    p_batch_id, p_bronze_key, p_received_at, p_location_event_id, p_topic, p_person_id,
    p_tid, p_tst, p_lat, p_lon, p_h3_index_r9, p_trigger_code, p_accuracy_m, p_altitude_m,
    p_velocity_kmh, p_battery_pct, p_in_regions, p_motion_activities, p_payload, p_hashdiff
  )
  on conflict (location_event_id, batch_id) do nothing;
  return found;
end;
$$;

create or replace function public.mark_ingest_batch_staged(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
begin
  update ops.ingest_batch
  set status = 'staged', finished_at = now()
  where batch_id = p_batch_id;
end;
$$;

revoke all on function public.list_ingest_batches_to_materialize(text, integer) from public;
revoke all on function public.list_ingest_batches_to_materialize(text, integer) from anon, authenticated;
grant execute on function public.list_ingest_batches_to_materialize(text, integer) to service_role;

revoke all on function public.insert_owntracks_inbox(
  uuid, text, timestamptz, text, text, text, text, timestamptz,
  double precision, double precision, text, text,
  double precision, double precision, double precision, integer,
  jsonb, jsonb, jsonb, text
) from public;
revoke all on function public.insert_owntracks_inbox(
  uuid, text, timestamptz, text, text, text, text, timestamptz,
  double precision, double precision, text, text,
  double precision, double precision, double precision, integer,
  jsonb, jsonb, jsonb, text
) from anon, authenticated;
grant execute on function public.insert_owntracks_inbox(
  uuid, text, timestamptz, text, text, text, text, timestamptz,
  double precision, double precision, text, text,
  double precision, double precision, double precision, integer,
  jsonb, jsonb, jsonb, text
) to service_role;

revoke all on function public.mark_ingest_batch_staged(uuid) from public;
revoke all on function public.mark_ingest_batch_staged(uuid) from anon, authenticated;
grant execute on function public.mark_ingest_batch_staged(uuid) to service_role;

-- pg_cron + pg_net: call materialize Edge every 15 minutes when DB settings are configured (prod).
create extension if not exists pg_cron;
create extension if not exists pg_net;

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
        'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key', true)
      ),
      body := '{}'::jsonb
    )
    where coalesce(current_setting('app.supabase_functions_url', true), '') <> ''
      and coalesce(current_setting('app.supabase_service_role_key', true), '') <> '';
  $$
);
