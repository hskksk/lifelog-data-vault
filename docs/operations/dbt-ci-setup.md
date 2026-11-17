# dbt GitHub Actions（本番）

[`dbt.yml`](../../.github/workflows/dbt.yml) は **毎時**（`schedule: 0 * * * *` UTC）と **手動** `workflow_dispatch`。**dbt 1.12 GA**（[`requirements-ci.txt`](../../packages/dbt/requirements-ci.txt)）では Postgres プロファイルに `url:` を使わない。CI は deploy と同じ [pooler-url.ts](../../scripts/lib/supabase-pooler-url.ts) で session pooler を組み立て、**Vault** の `dbt_runner_password` で `dbt_runner.<project-ref>` として接続し、[`resolve-dbt-connection.ts`](../../scripts/resolve-dbt-connection.ts) が **`packages/dbt/profiles.yml` を `--write-profiles` で生成**（パスワードを GITHUB_OUTPUT / env に載せない。**`SUPABASE_DB_URL` secret は不要**）。スキーマは migration 済みのため dbt は `+create_schema: false`。デバッグ用 URL 一行は [`resolve-dbt-db-url.ts`](../../scripts/resolve-dbt-db-url.ts)。

## 1. 本番 Vault（1 回）

Dashboard → **Vault**（または SQL）:

```sql
select vault.create_secret(
  'ここに強いパスワード',
  'dbt_runner_password',
  'dbt_runner login for session pooler / GitHub dbt'
);
```

既にある場合は Dashboard で値を更新するか `vault.update_secret(...)`。

## 2. ロールへ反映

migration `ops.sync_dbt_runner_password_from_vault()` が Vault の値を `dbt_runner` ロールに **`ALTER ROLE`** する（手動 `alter role` は不要）。

**Deploy**（[`deploy.ts`](../../scripts/deploy.ts)）のたびに sync を試行する。初回は migration 適用後、Vault を入れたうえで **Deploy to Supabase** を 1 回走らせる。

任意: GitHub secret **`DBT_RUNNER_PASSWORD`** を deploy に渡すと、deploy が Vault を upsert してから sync する（Vault だけ運用なら不要）。

## 3. GitHub Secrets（dbt workflow）

| Secret | 用途 |
|--------|------|
| `SUPABASE_ACCESS_TOKEN` | `supabase link` |
| `SUPABASE_PROJECT_REF` | 同上 |
| `SUPABASE_DB_PASSWORD` | **postgres** ロール（Vault 読み取り + pooler ホスト解決） |
| （任意）`SUPABASE_DB_PUSH_URL` | deploy と同じ pooler 上書き |

**不要:** `SUPABASE_DB_URL`（workflow 内で組み立て）。

## 4. 実行

| 経路 | 内容 |
|------|------|
| **定期** | [`dbt.yml`](../../.github/workflows/dbt.yml) が毎時 0 分（UTC）に**全モデル**（`--select` なし） |
| **Deploy 連鎖** | [`deploy.yml`](../../.github/workflows/deploy.yml) 成功後、`supabase/migrations/` に **dbt 要否がある変更** が含まれる push だけ `dbt-after-deploy`（**全モデル**） |
| **手動・全体** | Actions → **dbt** |
| **部分実行** | ローカルで `dbt build --select …`。mart を含めたいときは `+tag:person_activity` のように祖先も付ける |

mart は OwnTracks と Mac の両方を入力にする。`+tag:owntracks` / `+tag:macos` のような**ソース別の選択では mart が選ばれない**（`+` は祖先だけ）ため、定期実行と deploy は全モデルを回す。Mac だけの workflow は、`person_activity` の祖先に OwnTracks が入って実質ほぼ全体になるので廃止した。

Deploy 連鎖で **dbt をスキップ**する migration（ファイル名パターン）: `dbt_runner_password` / `dbt_runner_grants_ensure` / `sync_*_password` / `dbt_runner_database_create`。Edge Functions や ingest-core だけの deploy は migration diff が空なのでスキップ。**workflow_dispatch** の Deploy は常に dbt を試行。

実体は [`dbt-build-remote.yml`](../../.github/workflows/dbt-build-remote.yml)（`workflow_call`）。`select` を省略すると全モデル。本番 dbt は concurrency `dbt-build` で直列化する（毎時実行と deploy 連鎖が同じ group で順番待ち。同時に 2 つの `dbt build` が同じテーブルを作り直さない）。

**`stg_owntracks__location` が空:** ビューは `where vault_loaded_at is null` のみ（Vault 投入済み行は inbox に残るが stg には出ない）。未処理行があるのに stg が空なら **RLS** — migration `20261104100000_dbt_runner_staging_inbox_rls.sql` を `db push` してから dbt を再実行。データ本体は `raw_vault.*` / `mart.*` を見る。

## 5. ローカル

`make supabase-reset` の seed が Vault `dbt_runner_password` = `local-dbt-runner` を入れ sync する。`profiles.yml` の `supabase_dbt_runner` ターゲットを使う。

mart、business_vault、raw_vault の post-hook は `bi_reader` に `SELECT` を付ける（ロールが無い DB では no-op）。手順は [metabase-setup.md](./metabase-setup.md)。
