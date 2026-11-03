-- Materialize schedule moved to GitHub Actions (.github/workflows/owntracks-materialize.yml).
-- Keep invoke_owntracks_materialize() for manual SQL / debugging.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'owntracks-materialize') then
    perform cron.unschedule('owntracks-materialize');
  end if;
end;
$$;
