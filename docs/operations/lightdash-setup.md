# Lightdash セットアップ

設計: [../architecture/lightdash.md](../architecture/lightdash.md)

## 前提

- `make supabase-reset` 済み（`bi_reader` / `local-bi-reader`）
- Docker / Docker Compose
- dbt プロファイル: `cp packages/dbt/profiles.yml.example packages/dbt/profiles.yml`（`bi_reader` 出力を含む）

## 1. ローカル Lightdash

`.env` に任意で次を書ける（未設定でも起動する既定値あり）。

```bash
LIGHTDASH_PORT=8081
LIGHTDASH_APP_DB_PASSWORD=lightdash
LIGHTDASH_SECRET=local-dev-lightdash-secret-not-for-production
```

```bash
make lightdash-up    # http://127.0.0.1:8081
```

初回は DB マイグレーションで 1〜3 分かかることがある。ログは `make lightdash-logs`。

### 1.1 初回オンボーディング（UI）

1. ブラウザで `http://127.0.0.1:8081` を開き、組織・管理者ユーザーを作る。
2. **Create project** → **dbt** → プロジェクトパスはコンテナ内の `/usr/app/dbt`（マウント済み）。
3. **Warehouse**（Postgres）:

   | 項目 | 値 |
   |------|-----|
   | Host | `host.docker.internal` |
   | Port | `54422` |
   | Database | `postgres` |
   | User | `bi_reader` |
   | Password | `local-bi-reader` |
   | SSL | オフ |

4. dbt **target** を `bi_reader` にする（`profiles.yml` の `target: bi_reader` と一致させる）。
5. **Compile project** → Explore で `mart_location_trail` などが見えることを確認。

`staging` / `ops` が見える場合は倉庫ユーザーを見直す（`bi_reader` 以外で繋いでいないか）。

止める: `make lightdash-down`。アプリ DB ごと消す: `make lightdash-reset`（`LIGHTDASH_SECRET` を変えたあと復旧できないときも同様）。

## 2. 本番（hosted Supabase）

倉庫は Metabase と同じ Session pooler + `bi_reader.<project-ref>`。

1. Vault `bi_reader_password` と deploy sync（[metabase-setup.md](./metabase-setup.md) §2 と同じ）。
2. 接続 JSON:

```bash
# パスワードなし（値は Vault から手入力）
pnpm lightdash-print-warehouse

# profiles.yml 断片（パスワード入り・ログに残さない）
pnpm lightdash-print-warehouse --print-yaml > /tmp/profiles-bi-reader-snippet.yml
```

3. Lightdash の Warehouse 画面に Host / Port / User / Password / SSL require を入れる。スキーマは `mart` を主にし、必要なら `business_vault` / `raw_vault` も許可。
4. dbt 接続は **GitHub** タイプ（`repository` + `branch` + `project_sub_path: packages/dbt`）か、デプロイ VM でリポジトリをマウントする。

Network restrictions がある場合は Lightdash ホスト IP を許可する。

## 3. Metabase との併用

| 項目 | 目安 |
|------|------|
| 合計 DB 接続 | ≤ 10（`bi_reader` ロール上限） |
| Metabase | `MB_JDBC_DATA_WAREHOUSE_MAX_CONNECTION_POOL_SIZE=3` |
| Lightdash | UI の接続プールを小さく（3 前後） |

## 4. トラブルシュート

| 症状 | 対処 |
|------|------|
| `dbt project directory not found` | `make lightdash-up` をリポジトリルートから実行し、`packages/dbt` がマウントされているか確認 |
| Compile 失敗（profiles） | ホストで `packages/dbt/profiles.yml` があり、`bi_reader` が `host.docker.internal:54422` を指すか |
| モデルが空 | `dbt build` 後、Lightdash で Sync dbt / Compile |
| ヘルスチェック失敗 | `make lightdash-logs`。初回マイグレーション待ち |