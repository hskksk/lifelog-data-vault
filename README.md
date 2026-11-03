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

Local API/DB ports are **5442x** (see `supabase/config.toml`) so this stack can run beside other Supabase projects on the default 5432x ports.

`make supabase-start` builds `@lifelog/ingest-core` (Edge imports `dist/*.js`) then passes `-x logflare,vector,realtime`. OwnTracks / Vault only needs Postgres, Kong, Storage, Auth, Studio, Edge runtime.

**Edge ingest (S2):** with the stack up and migrations applied:

```bash
make supabase-functions-serve   # terminal 2; uses .env INGEST_BEARER_TOKEN
make demo-owntracks-edge        # POST .../functions/v1/owntracks-ingest (Hono basePath = function name)
```

If Edge returns **404**, the Hono routes likely omit `basePath('/owntracks-ingest')`. If **Storage/DB errors** appear after 404 is fixed, set `SUPABASE_URL` in `.env` to reach Kong from the Edge container (often `http://host.docker.internal:54421` on Docker Desktop Mac, not `127.0.0.1`).

**Materialize (S3):** after ingest, run Bronze → inbox staging:

```bash
make demo-materialize-edge   # uses SUPABASE_SERVICE_ROLE_KEY from .env
```

Or serve both functions: `make supabase-functions-serve`. Production Cron (`*/15`) is defined in migrations when `app.supabase_functions_url` and `app.supabase_service_role_key` database settings are set.

If startup still fails, stop cleanly and retry (migrations already applied are fine):

```bash
make supabase-stop
make supabase-start
```

Realtime **`DB_HOST: nxdomain`** on older commits came from the Realtime container starting before Docker DNS was ready; excluding/disabling Realtime fixes that. Supabase recommends ~7GB RAM for the full stack; this project starts a smaller subset.

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
