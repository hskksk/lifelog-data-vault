# Monorepo overview design

See GitHub issue #4 for the canonical design discussion snapshot.

Source-specific designs: [owntracks.md](./owntracks.md) (location / H3).

## Purpose

Ingest personal lifelog data (health, PC activity, manual metrics), store immutable Bronze on R2, model **Data Vault 2.0** in PostgreSQL, expose marts for BI.

## Principles

1. Layer boundaries match directories (ingest / staging / raw_vault / business_vault / mart).
2. New sources add ingest module + dbt staging + satellites (hubs stable).
3. Every load is traceable via `batch_id`, `record_source`, `load_dts`.
4. Secrets never committed; runtime env on OCI VM.
5. Local dev via Docker Compose Postgres; R2 dev bucket or MinIO optional.
6. Vault DDL in SQL migrations; dbt owns transforms into existing tables.

## Logical architecture

```
Sources → ingest (OCI cron) → Bronze R2 + ops.ingest_batch
Bronze / staging inputs → dbt → raw_vault → business_vault → mart
GitHub → CI (parse, compile, tests); production dbt on OCI
```

## Repository layout

```
packages/ingest/         TypeScript ingest (Hono webhook, materialize → Bronze)
packages/dbt/            dbt project lifelog_vault
deploy/docker/           local Postgres
deploy/sql/migrations/   Hub/Link/Sat DDL
deploy/oci/systemd/      timers (future)
.github/workflows/       CI
docs/                    architecture, runbooks, ADR
```

## Bronze path convention

```
bronze/<record_source>/dt=YYYY-MM-DD/batch=<uuid>/
  data/...
  _meta/batch.json
```

## PostgreSQL schemas

| Schema | Role |
|--------|------|
| staging | dbt staging models |
| raw_vault | hub_*, link_*, sat_* |
| business_vault | bv_* |
| mart | mart_* |
| ops | ingest_batch, dbt_run_log |

## dbt naming

- `stg_<source>__<entity>`
- `hub_*`, `link_*`, `sat_*`, `bv_*`, `mart_*`

## Production orchestration (OCI)

1. `lifelog-ingest run-all`
2. `dbt run` / `dbt test` with batch vars
3. Log to `ops`

## Phases

| Phase | Deliverable |
|-------|-------------|
| 0 | Skeleton, compose, migrations shell, dbt parse CI |
| 1 | One source end-to-end to mart |
| 2 | ops.ingest_batch, backfill runbook, second source |
| 3 | Business Vault rules, Metabase, backup to R2 |
| 4 | Terraform OCI, PIT/Bridge |
