-- Edge ingest writes ops.ingest_batch without exposing the ops schema via PostgREST.

create or replace function public.register_ingest_batch(
  p_batch_id uuid,
  p_record_source text,
  p_bronze_prefix text,
  p_status text default 'received'
)
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
begin
  insert into ops.ingest_batch (batch_id, record_source, bronze_prefix, status)
  values (p_batch_id, p_record_source, p_bronze_prefix, p_status)
  on conflict (batch_id) do update set
    bronze_prefix = excluded.bronze_prefix,
    status = excluded.status;
end;
$$;

revoke all on function public.register_ingest_batch(uuid, text, text, text) from public;
revoke all on function public.register_ingest_batch(uuid, text, text, text) from anon, authenticated;
grant execute on function public.register_ingest_batch(uuid, text, text, text) to service_role;
