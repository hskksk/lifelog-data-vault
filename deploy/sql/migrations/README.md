# Legacy Flyway-style migrations

**Source of truth:** [`supabase/migrations/`](../../supabase/migrations/) (append-only Supabase CLI migrations).

`V001__schemas.sql` and `V002__owntracks_staging.sql` remain for reference and for the optional Docker Compose Postgres path (`make migrate`). New DDL belongs in `supabase/migrations/` only.
