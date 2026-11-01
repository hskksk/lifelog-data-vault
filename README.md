# lifelog-data-vault

Personal lifelog data platform using **Data Vault 2.0** patterns: Bronze object storage, PostgreSQL Raw/Business Vault, dbt transforms, and TypeScript ingest. **Production runtime** targets [Supabase](docs/architecture/supabase-runtime.md) (Postgres, Storage, Edge Functions); dbt runs outside Supabase (e.g. GitHub Actions).

## Stack

| Layer | Technology |
|-------|------------|
| Bronze (prod) | Supabase Storage bucket `bronze` |
| Bronze (local CLI) | `var/bronze` or R2 (optional) |
| Vault DB | Supabase Postgres (pipeline schemas not exposed via API) |
| Transform | dbt Core (outside Supabase) |
| Ingest (prod) | Supabase Edge Functions |
| Ingest (local dev) | TypeScript `@lifelog/ingest` Hono server |
| CI | GitHub Actions |

## Quick start (local Supabase)

Requires Docker and the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) (or `npx supabase` via the Makefile).

```bash
cp .env.example .env
make supabase-start
make supabase-reset   # applies supabase/migrations + seed.sql
cd packages/dbt && dbt deps && dbt parse
```

Fill `SUPABASE_SERVICE_ROLE_KEY` and confirm `DATABASE_URL` from `npx supabase status -o json`.

If `supabase start` fails with Realtime **`DB_HOST: nxdomain`** or several containers **unhealthy**, stop cleanly and retry (migrations already applied are fine):

```bash
make supabase-stop   # or: npx supabase stop --no-backup
make supabase-start
```

This repo disables **Logflare analytics** and **Storage vector** in `supabase/config.toml` (not needed for Bronze ingest) and sets Realtime **`ip_version = "IPv4"`** to avoid Docker DNS races on macOS.

### Legacy Docker Postgres

```bash
make up && make migrate
```

Uses `deploy/sql/migrations/` (same DDL as initial Supabase migrations; see `deploy/sql/migrations/README.md`).

See [docs/architecture/overview.md](docs/architecture/overview.md) for monorepo layout and pipeline design.

### OwnTracks (location)

Design: [docs/architecture/owntracks.md](docs/architecture/owntracks.md). Supabase runtime: [docs/architecture/supabase-runtime.md](docs/architecture/supabase-runtime.md).

```bash
pnpm install
# DB: either make supabase-reset (DATABASE_URL from supabase status) or make up && make migrate
export BRONZE_LOCAL_DIR=var/bronze DATABASE_URL=postgresql://lifelog:lifelog@localhost:5432/lifelog
pnpm --filter @lifelog/ingest dev serve owntracks --port 8080   # terminal 2
make demo-owntracks
pnpm --filter @lifelog/ingest dev materialize owntracks
make dbt-owntracks
```

## License

MIT
