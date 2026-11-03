-- staging.owntracks_location_inbox has RLS enabled with no policies; GRANT alone does not
-- expose rows to dbt_runner. Without this, stg_owntracks__location is always empty in CI.

drop policy if exists "dbt_runner staging inbox" on staging.owntracks_location_inbox;

create policy "dbt_runner staging inbox"
  on staging.owntracks_location_inbox
  for all
  to dbt_runner
  using (true)
  with check (true);
