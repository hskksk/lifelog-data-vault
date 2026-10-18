# モノレポ概要設計: lifelog-data-vault

## 1. 目的とスコープ

| 項目 | 内容 |
|------|------|
| **目的** | 個人ライフログ（ヘルス・PC 等）の取り込みと **Data Vault 2.0 風**の履歴管理・マート生成 |
| **リポジトリ** | `hskksk/lifelog-data-vault`（単一モノレポ） |
| **実行環境** | 本番 compute: **OCI Always Free A1**（Postgres + cron + ingest + dbt） |
| **Bronze** | **Cloudflare R2**（生ファイル不変保管） |
| **非スコープ（初期）** | 公開 Web アプリ、マルチユーザー SaaS、リアルタイムストリーミング |

## 2. 設計原則

1. **レイヤー = ディレクトリ境界** — Bronze ingest / Staging / Raw Vault / Business Vault / Mart をコード上も分離
2. **ソース追加は横展開** — 新フィールドは `ingest` + `dbt staging` + `sat` を足す
3. **batch_id ファースト** — ingest と dbt run が `batch_id` と `record_source` で追跡可能
4. **Secrets はリポジトリ外** — `.env` / OCI secrets / GitHub Environments
5. **ローカル = Docker Compose** — 本番 OCI と同じ Postgres major、R2 は dev バケット or MinIO
6. **IaC は薄く始める** — `deploy/` の compose + systemd テンプレ、必要になったら Terraform

## 3. 論理アーキテクチャ

```
Sources → ingest (OCI cron) → Bronze R2 + ops.ingest_batch
R2 / staging → dbt → raw_vault → business_vault → mart
GitHub → CI (lint, dbt parse/compile); 本番 dbt は OCI cron
```

- **ingest**: 外部 → **R2**（`_meta/batch.json`）→ 任意で `ops.ingest_batch`
- **dbt**: Staging → Raw Vault insert-only → BV → mart
- **GitHub Actions**: CI 中心。日次本番 run は OCI

## 4. モノレポツール

| 領域 | ツール |
|------|--------|
| Python ingest | **uv** workspace |
| SQL | **dbt Core** |
| タスク | **Makefile** |
| CI | GitHub Actions |

## 5. ディレクトリ構成

```
packages/lifelog_core/   # batch, R2, DB 共有
packages/ingest/         # ソース別 CLI → Bronze
packages/dbt/            # staging / raw_vault / business_vault / marts
deploy/docker/           # local Postgres
deploy/sql/migrations/   # Hub/Link/Sat DDL（dbt 外）
deploy/oci/systemd/      # timers（Phase 2）
.github/workflows/       # CI
docs/                    # architecture, runbooks, ADR
config/sources.yml       # 非 secret のソース設定
```

**DDL を dbt 外に置く理由**: Raw Vault は insert-only・長寿命。dbt は transform に集中。

## 6. Bronze（R2）パス

```
bronze/<record_source>/dt=YYYY-MM-DD/batch=<uuid>/
  data/...
  _meta/batch.json
```

## 7. PostgreSQL スキーマ

| スキーマ | 内容 |
|----------|------|
| staging | dbt staging |
| raw_vault | hub_*, link_*, sat_* |
| business_vault | bv_* |
| mart | mart_* |
| ops | ingest_batch, dbt_run_log |

## 8. dbt 命名

- `stg_<source>__<entity>`
- `hub_*`, `link_*`, `sat_*`, `bv_*`, `mart_*`

Sat 必須: `load_dts`, `record_source`, `batch_id`, hash keys（macros）

## 9. 本番オーケストレーション（OCI）

1. `lifelog-ingest run-all`
2. `dbt run` / `dbt test`（batch vars または未処理 batch から）
3. `ops` に成功/失敗記録

## 10. Data Vault 初期エンティティ

**Hub**: person, device, observation_definition  
**Link**: person_device, person_observation（任意）  
**Sat**: device_details, observation_value, observation_quality  
**BV**: observation_daily, sleep_session  
**Mart**: health_daily, pc_activity_daily  

詳細: `docs/architecture/data-vault-model.md`

## 11. テスト・品質

- ingest: pytest + fixtures
- dbt: generic tests + hub/link/sat relationships
- 運用: 同一 batch 再投入で sat 行数不変（hashdiff）

## 12. フェーズ

| Phase | 成果物 |
|-------|--------|
| 0 | 骨格、compose、migration、dbt parse CI ← **本リポ initial commit** |
| 1 | 1 ソース E2E → mart |
| 2 | ops.ingest_batch、backfill、2 ソース目 |
| 3 | BV ルール、Metabase、R2 バックアップ |
| 4 | Terraform OCI、PIT/Bridge |

## 13. リスク

| リスク | 対応 |
|--------|------|
| Apple Health XML 巨大 | ストリームパース、Bronze は zip そのまま |
| Sat 肥大 | パーティション方針、Bronze アーカイブ |
| OCI idle 回収 | 日次 cron 必須、ops heartbeat |

---

この Issue を設計の参照点とし、Phase 1 以降は子 Issue または PR で分解する。
