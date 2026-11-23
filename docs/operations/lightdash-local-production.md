# Lightdash ローカル本番（単独利用）

設計: [../architecture/lightdash.md](../architecture/lightdash.md)  
共通手順: [lightdash-setup.md](./lightdash-setup.md)

**前提:** Lightdash は **自分の Mac 上だけ**（`127.0.0.1:8081`）。倉庫は **hosted Supabase** の `bi_reader`（本番データ）。自分だけが使うので URL を公開しないが、**Supabase への TLS は CA で検証**する（`NODE_TLS_REJECT_UNAUTHORIZED=0` は使わない）。

## セキュリティの切り口

| 項目 | 設定 |
|------|------|
| 公開 | Compose は **127.0.0.1** のみ（`docker-compose.lightdash.yml`） |
| 認証 | Lightdash ログイン必須。地図の public link は作らない（[metabase.md](../architecture/metabase.md) と同じ） |
| 倉庫 | `bi_reader` のみ・session pooler **5432** |
| TLS | **verify-full** + Supabase CA（UI + コンテナの `NODE_EXTRA_CA_CERTS`） |
| テレメトリ | `RUDDERSTACK_ANALYTICS_DISABLED`、スケジューラ off（compose 既定） |

## 1. 初回セットアップ

```bash
# Supabase Dashboard → Database → SSL Configuration で CA をダウンロード
export SUPABASE_DB_SSLROOTCERT="$HOME/.postgresql/supabase-prod-ca.crt"

make lightdash-install-ca    # → deploy/docker/lightdash/certs/supabase-ca.pem
pnpm verify-bi-reader-ssl "$HOME/.postgresql/supabase-prod-ca.crt"

cp packages/dbt/profiles.yml.example packages/dbt/profiles.yml
# bi_reader_hosted.sslrootcert をリポジトリ内 CA の絶対パスにする:
#   …/deploy/docker/lightdash/certs/supabase-ca.pem

make lightdash-prod-up         # http://127.0.0.1:8081
```

## 2. Lightdash UI（一度だけ）

1. 初回オンボーディング（組織・管理者）
2. **Project → Warehouse → Edit**

   | 項目 | 値 |
   |------|-----|
   | Host | `pnpm lightdash-print-warehouse` の host |
   | Port | `5432` |
   | User | `bi_reader.<project-ref>` |
   | Password | Vault `bi_reader_password` |
   | SSL mode | **`verify-full`** |
   | SSL root certificate | **`deploy/docker/lightdash/certs/supabase-ca.pem`** をアップロード（中身は Dashboard の CA と同じ） |

3. **Test connection** → 保存
4. dbt 接続タイプ **CLI** のまま manifest を deploy（下記）

`require` や `no-verify` ではなく **verify-full + root CA** にすると、グラフ実行時もコンテナの `NODE_EXTRA_CA_CERTS` と揃う。

## 3. dbt / Lightdash 同期

```bash
source .venv-dbt/bin/activate
npx --yes @lightdash/cli@3.350.1 login http://127.0.0.1:8081

make lightdash-prod-deploy    # CA を付けて deploy（初回は --create を付ける、下記）
```

初回プロジェクト作成:

```bash
make lightdash-prod-deploy CREATE=1
```

または:

```bash
CA="$(pwd)/deploy/docker/lightdash/certs/supabase-ca.pem"
NODE_EXTRA_CA_CERTS="$CA" npx --yes @lightdash/cli@3.350.1 deploy --create \
  --profiles-dir packages/dbt --project-dir packages/dbt \
  --target bi_reader_hosted --selector lightdash
```

## 4. 日常運用

```bash
make lightdash-prod-up      # 起動
make lightdash-logs         # ログ（prod も同じ compose ファイル）
make lightdash-prod-down    # 停止
make lightdash-prod-deploy  # _marts.yml 変更後
```

CA を Dashboard から取り直したときは `make lightdash-install-ca` → `make lightdash-prod-up` → UI の root certificate も差し替え。

## 5. ローカル Supabase 倉庫だけ試す場合

倉庫を `make supabase-reset` のみにする場合は **`make lightdash-up`**（CA 不要）と Warehouse `host.docker.internal:54422` / `bi_reader_local`。本ドキュメントの「ローカル本番」は **hosted 倉庫**向け。