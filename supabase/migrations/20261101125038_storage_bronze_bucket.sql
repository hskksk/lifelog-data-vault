-- Private Bronze bucket for OwnTracks raw JSON (Edge Functions only).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bronze', 'bronze', false, null, array['application/json', 'text/plain'])
on conflict (id) do nothing;

create policy "service role bronze objects"
  on storage.objects
  for all
  to service_role
  using (bucket_id = 'bronze')
  with check (bucket_id = 'bronze');
