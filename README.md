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

Set `SUPABASE_SECRET_KEY` (`sb_secret_...`; hosted: Dashboard → API Keys → default secret; local: copy from `npx supabase status -o json` when the CLI exposes secret keys) for `make supabase-functions-serve` / `make demo-materialize-edge`. Confirm `DATABASE_URL` from the same status output.

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
make demo-materialize-edge   # sources .env; sends `apikey: $SUPABASE_SECRET_KEY` (same as prod Cron)
```

Or serve both functions: `make supabase-functions-serve` (needs `SUPABASE_SECRET_KEY` in `.env`). **Production materialize:** GitHub Actions [`.github/workflows/owntracks-materialize.yml`](.github/workflows/owntracks-materialize.yml) every **15 minutes** (needs repo secrets `SUPABASE_PROJECT_REF`, `SUPABASE_SECRET_KEY`).

### dbt (S4 — GitHub Actions)

Run [`.github/workflows/owntracks-dbt.yml`](.github/workflows/owntracks-dbt.yml) manually (**Actions → owntracks-dbt → Run workflow**). It runs `dbt build --select tag:owntracks` (no cron until we turn scheduling back on).

**Production setup**

1. Apply migrations only: `supabase link` then `supabase db push`. **`supabase/seed.sql` does not run on push** (it runs only on local `supabase db reset`). Do not use `db push --include-seed --remote` on production. Details: [docs/architecture/supabase-runtime.md §7.2](docs/architecture/supabase-runtime.md#72-supabaseseedsql-と本番).
2. Role `dbt_runner` is created without a password in SQL. Supabase Dashboard → SQL: `alter role dbt_runner password '<strong-password>';`
3. Build **session mode** pooler URL for `dbt_runner` ([connecting guide](https://supabase.com/docs/guides/database/connecting-to-postgres)).
4. GitHub repo → Settings → Secrets → **`SUPABASE_DB_URL`** = full `postgresql://dbt_runner:...@...pooler.../postgres` URL (sslmode as required).

**Install dbt (local)** — match CI (`dbt-postgres` **1.9** on Python). Homebrew `dbt-core` **2.x** (`dbt-oss`) does not ship the Postgres adapter this project uses; prefer a venv:

```bash
python3 -m venv .venv-dbt && source .venv-dbt/bin/activate
pip install "dbt-postgres~=1.9"
dbt --version   # 1.9.x — ensure `which dbt` is the venv, not Homebrew
```

**Local dbt after `make supabase-reset`**

```bash
cp packages/dbt/profiles.yml.example packages/dbt/profiles.yml
# target: supabase_local (postgres) or supabase_dbt_runner (seed sets password local-dbt-runner)
cd packages/dbt && dbt deps && dbt build --select tag:owntracks --profiles-dir .
```

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

### Production deploy (GitHub Actions)

On push to **`main`** (paths under `supabase/`, `packages/ingest-core/`, etc.), [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs `pnpm deploy`: link → Edge secrets → **`supabase db push`** (migrations only, no `seed.sql`) → deploy `owntracks-ingest` and `owntracks-materialize`. Manual run: Actions → **Deploy to Supabase** → **Run workflow**.

**Repository secrets:** `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `INGEST_BEARER_TOKEN`, **`SUPABASE_SECRET_KEY`** (materialize Actions + deploy Vault). Deploy reads the pooler URL from **`supabase link`** (`supabase/.temp/pooler-url`) and runs `db push` with **`sslmode=require`** (not `ssl=true`). Optional override: `SUPABASE_DB_PUSH_URL`. Optional: `PERSON_MAP_YAML`. See [docs/architecture/supabase-runtime.md §7.1](docs/architecture/supabase-runtime.md#71-github-actions-deploysupabase).

Local equivalent (after `pnpm --filter @lifelog/ingest-core build`):

```bash
export SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... SUPABASE_DB_PASSWORD=...
echo "INGEST_BEARER_TOKEN=..." > .env
pnpm deploy
```

Cron / dbt / `dbt_runner` password remain one-time Dashboard or SQL setup (not in this workflow).

### OwnTracks (location)

Design: [docs/architecture/owntracks.md](docs/architecture/owntracks.md). Supabase runtime: [docs/architecture/supabase-runtime.md](docs/architecture/supabase-runtime.md). **OwnTracks app URL / Bearer:** [docs/operations/owntracks-ingest-setup.md](docs/operations/owntracks-ingest-setup.md).

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
