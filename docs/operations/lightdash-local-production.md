# Lightdash ローカル本番（単独利用）

設計: [../architecture/lightdash.md](../architecture/lightdash.md)  
共通手順: [lightdash-setup.md](./lightdash-setup.md)

**前提:** Lightdash は **自分の Mac 上だけ**（`127.0.0.1:8081`）。倉庫は **hosted Supabase** の `bi_reader`。自分だけが使う。TLS は暗号化するが、**証明書チェーン検証はしない**（Supabase pooler + Lightdash の Node 向け）。

## セキュリティの切り口

| 項目 | 設定 |
|------|------|
| 公開 | Compose は **127.0.0.1** のみ |
| 認証 | Lightdash ログイン必須。地図の public link は作らない |
| 倉庫 | `bi_reader` のみ・session pooler **5432** |
| TLS | 接続は SSL。**検証:** `deploy/docker/lightdash/hosted-warehouse.env` の **`NODE_TLS_REJECT_UNAUTHORIZED=0`**（Lightdash コンテナ）。CLI deploy も同値 |
| テレメトリ | `RUDDERSTACK_ANALYTICS_DISABLED`、スケジューラ off |

CA 検証（`verify-full` / `NODE_EXTRA_CA_CERTS`）はこの運用では使わない。後から厳格化する場合は [lightdash-setup.md](./lightdash-setup.md) §2.3 と `make lightdash-install-ca` を参照。

## 1. 初回セットアップ

```bash
cp packages/dbt/profiles.yml.example packages/dbt/profiles.yml
# bi_reader_hosted: host / user / password は pnpm lightdash-print-warehouse
# sslmode: require で可（sslrootcert は省略可）

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
   | SSL mode | **`no-verify`**（または **`require`**） |

3. **Test connection** → 保存
4. dbt 接続タイプ **CLI**

コンテナ側は **`make lightdash-prod-up` が `NODE_TLS_REJECT_UNAUTHORIZED=0` を渡す**ので、UI は `no-verify` が最も素直。`verify-full` は使わない。

## 3. dbt / Lightdash 同期

```bash
source .venv-dbt/bin/activate
npx --yes @lightdash/cli@3.350.1 login http://127.0.0.1:8081

CREATE=1 make lightdash-prod-deploy   # 初回
make lightdash-prod-deploy            # 以降
```

`lightdash-prod-deploy` は **`NODE_TLS_REJECT_UNAUTHORIZED=0`** を付けて deploy する（手元で毎回付けなくてよい）。

## 4. 日常運用

```bash
make lightdash-prod-up
make lightdash-prod-down
make lightdash-prod-deploy
make lightdash-logs
```

## 5. ローカル Supabase 倉庫だけ試す場合

`make lightdash-up` + Warehouse `host.docker.internal:54422` / `bi_reader_local`（CA 不要）。