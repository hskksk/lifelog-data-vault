# Monorepo overview design

See GitHub issue #4 for the canonical design discussion snapshot.

Source-specific designs: [owntracks.md](./owntracks.md) (location / H3), [macos-local-ingest.md](./macos-local-ingest.md) (Mac power, Screen Time, Health). Where a person was and what they were doing at a time: [person-activity.md](./person-activity.md).

**Production runtime (dbt 以外):** [supabase-runtime.md](./supabase-runtime.md) — Postgres, Edge ingest/materialize, Storage Bronze.

## Purpose

Ingest personal lifelog data (health, PC activity, manual metrics), store immutable Bronze (Supabase Storage), model **Data Vault 2.0** in **Supabase Postgres**, expose marts for BI. **dbt** runs outside Supabase (e.g. GitHub Actions).

## Principles

1. Layer boundaries match directories (ingest / staging / raw_vault / business_vault / mart).
2. New sources add ingest module + dbt staging + satellites (hubs stable).
3. Every load is traceable via `batch_id`, `record_source`, `load_dts`.
4. Secrets never committed; Supabase Edge Secrets + GitHub Secrets for dbt.
5. Local dev via `supabase start`; dbt uses pooler URL from `.env` (not committed).
6. Vault DDL in SQL migrations; dbt owns transforms into existing tables.

## Logical architecture

```
Sources → Edge ingest → Storage Bronze + ops.ingest_batch
Cron → Edge materialize → staging inbox
GitHub Actions → dbt → raw_vault → business_vault → mart
Metabase (bi_reader, session pooler) → mart, business_vault, raw_vault
GitHub → CI (ingest typecheck, dbt parse)
```

Detail for **production Supabase + GitHub Actions dbt** is below. Ingest/materialize runtime: [supabase-runtime.md](./supabase-runtime.md). dbt triggers and secrets: [../operations/dbt-ci-setup.md](../operations/dbt-ci-setup.md).

### End-to-end data flow

Bronze and inbox rows are written by **Edge + pg_cron**. Vault and marts are built only by **dbt** (session pooler, `dbt_runner`). Deploy `db push` applies DDL, RPCs, and cron definitions; it does not run transforms.

```mermaid
flowchart TB
  subgraph sources["Sources"]
    OT[OwnTracks app]
    MAC[Mac Lifelog Collect]
  end

  subgraph supabase_ingest["Supabase ingest"]
    EF_OT_IN[Edge: owntracks-ingest]
    EF_MAC_IN[Edge: macos-ingest]
    BR_OT[(Storage bronze)]
    BR_MAC[(Storage bronze)]
    OPS_BATCH[(ops.ingest_batch)]
  end

  subgraph supabase_mat["Materialize ~15 min pg_cron"]
    CRON[pg_cron]
    EF_OT_MAT[Edge: owntracks-materialize]
    EF_MAC_MAT[Edge: macos-materialize]
  end

  subgraph staging_pg["Postgres staging DDL from migrations"]
    IN_OT[staging.owntracks_location_inbox]
    IN_PWR[staging.macos_power_event_inbox]
    IN_ST[staging.macos_screentime_interval_inbox]
  end

  subgraph dbt_layers["dbt GitHub Actions"]
    STG[staging views stg_*]
    RV[raw_vault hub link sat]
    BV[business_vault bv_*]
    MART[mart mart_*]
  end

  MB[Metabase bi_reader]

  OT -->|POST| EF_OT_IN
  MAC -->|POST| EF_MAC_IN
  EF_OT_IN --> BR_OT
  EF_OT_IN --> OPS_BATCH
  EF_MAC_IN --> BR_MAC
  EF_MAC_IN --> OPS_BATCH

  CRON --> EF_OT_MAT
  CRON --> EF_MAC_MAT
  EF_OT_MAT --> BR_OT
  EF_OT_MAT --> IN_OT
  EF_MAC_MAT --> BR_MAC
  EF_MAC_MAT --> IN_PWR
  EF_MAC_MAT --> IN_ST

  IN_OT --> STG
  IN_PWR --> STG
  IN_ST --> STG
  STG --> RV
  RV --> BV
  BV --> MART
  MART --> MB
  RV --> MB
  BV --> MB
```

### Jobs and what they build

```mermaid
flowchart LR
  subgraph jobs["Runners"]
    J1["Deploy to Supabase"]
    J2["pg_cron materialize"]
    J3["owntracks-dbt hourly + manual"]
    J4["macos-dbt manual"]
    J5["dbt-after-deploy"]
  end

  subgraph artifacts["Artifacts"]
    DDL["schemas RLS RPC cron"]
    EDGE["Edge Functions"]
    INBOX["inbox INSERTs"]
    D_STG["dbt staging views"]
    D_RV["dbt raw_vault"]
    D_BV["dbt business_vault"]
    D_MART_TR["mart_location_trail"]
    D_MART_PA["mart_person_activity_minute"]
  end

  J1 --> DDL
  J1 --> EDGE
  J1 -->|when migrations need dbt| J5

  J2 --> INBOX

  J3 --> D_STG
  J3 --> D_RV
  J3 --> D_BV
  J3 --> D_MART_TR
  J3 -.->|not in select| D_MART_PA

  J4 --> D_STG
  J4 --> D_RV
  J4 --> D_BV
  J4 --> D_MART_TR
  J4 --> D_MART_PA

  J5 --> D_STG
  J5 --> D_RV
  J5 --> D_BV
  J5 --> D_MART_TR
  J5 -.->|not in select| D_MART_PA
```

Dashed arrows: `mart_person_activity_minute` has tag `person_activity` only; **owntracks-dbt** and **dbt-after-deploy** use `dbt build --select +tag:owntracks +tag:macos` and therefore do not build that mart. **macos-dbt** adds `+tag:person_activity` (Mac-side shortcut that still pulls location BV upstream via `+`). See [person-activity.md](./person-activity.md).

### dbt workflow vs model tags

```mermaid
flowchart TB
  subgraph sel_shared["+tag:owntracks +tag:macos owntracks-dbt and dbt-after-deploy"]
    O1["stg_owntracks__location"]
    O2["stg_macos_*"]
    O3["raw_vault shared hubs e.g. hub_person"]
    O4["bv_location_*"]
    O5["bv_power_interval bv_app_usage_interval"]
    O6["mart_location_trail"]
  end

  subgraph sel_pa["+tag:person_activity macos-dbt only"]
    P1["mart_person_activity_minute"]
    P2["person_activity tests"]
  end

  WF_OT["owntracks-dbt / dbt-after-deploy"]
  WF_MAC["macos-dbt"]

  WF_OT --> sel_shared
  WF_MAC --> sel_shared
  WF_MAC --> sel_pa

  O4 --> P1
  O5 --> P1
```

The `+` prefix includes **parents** of tagged models, not children. BV models carry both source tags (`owntracks`, `macos`) and `person_activity`; hourly build refreshes BV tables but not the minute mart unless `person_activity` is in the select.

### Deploy and dbt-after-deploy

```mermaid
sequenceDiagram
  participant GH as push to main
  participant Dep as Deploy workflow
  participant DB as Supabase Postgres
  participant Chg as changes job
  participant Dbt as dbt-after-deploy

  GH->>Dep: supabase paths or workflow_dispatch
  par
    Dep->>DB: db push migrations
    Dep->>DB: Edge deploy Vault sync
    Chg->>Chg: migration diff run_dbt gate
  end
  Note over Chg: Edge-only or ops-only migrations skip dbt
  Dep->>Dbt: success and run_dbt true
  Dbt->>DB: dbt build same select as owntracks-dbt
```

All remote dbt jobs share [`.github/workflows/dbt-build-remote.yml`](../../.github/workflows/dbt-build-remote.yml) and concurrency group `owntracks-dbt` so hourly, post-deploy, and manual runs do not overlap.

| Job | Trigger | Writes data? | dbt layers built |
|-----|---------|--------------|------------------|
| **materialize** | pg_cron ~15m | inbox from bronze | — |
| **owntracks-dbt** | hourly UTC + manual | — | staging, raw_vault, BV, `mart_location_trail` |
| **macos-dbt** | manual | — | above + `mart_person_activity_minute` |
| **Deploy** | main push paths / manual | DDL, Edge | — |
| **dbt-after-deploy** | after Deploy when gated | — | same as owntracks-dbt |

## Repository layout

```
packages/ingest/         TypeScript ingest (Hono webhook, materialize → Bronze)
packages/dbt/            dbt project lifelog_vault
deploy/docker/           local Postgres; Metabase compose (see metabase.md)
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
| raw_vault | hub_*, link_*, sat_* (Metabase via `bi_reader`, [metabase.md](./metabase.md)) |
| business_vault | bv_* (Metabase via `bi_reader`, [metabase.md](./metabase.md)) |
| mart | mart_* (Metabase via `bi_reader`, [metabase.md](./metabase.md)) |
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
| 3 | Business Vault rules, Metabase ([metabase.md](./metabase.md): `bi_reader` + local compose), backup to R2 |
| 4 | Terraform OCI, PIT/Bridge |
