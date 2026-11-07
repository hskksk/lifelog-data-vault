# Metabase セットアップ

設計: [../architecture/metabase.md](../architecture/metabase.md)

## 1. ローカル

```bash
make supabase-start
make supabase-reset    # bi_reader / local-bi-reader
# mart が空なら、取り込みのあと
make dbt-owntracks      # post-hook が mart.* に SELECT を付ける
make metabase-up        # http://127.0.0.1:3000
```

初回は Liquibase のマイグレーションで数分かかることがある。その間 `/api/health` は 503 で、画面はセットアップまで進まない。`make metabase-connect-remote` は 200 になるまで待つ。ブラウザは `http://127.0.0.1:3000` を開く。Docker はこのアドレスだけを公開する。止めるときは `make metabase-down`（ボリュームは残る。質問定義も残る）。ログは `make metabase-logs`。ポートを変えるときは `METABASE_PORT=3001 make metabase-up`。

ログに `Database has migration lock` と出て再起動を繰り返すときは、前回の JVM がマイグレーションの途中で落ちてロックが H2 に残っている。`make metabase-up` は起動前にそのロックを外す。質問定義ごと捨ててやり直すときは `make metabase-reset`。

ブラウザで管理者ユーザーを作る。これは H2（Docker volume `lifelog-metabase_metabase_data`）に保存される。Supabase のユーザーではない。

**Admin → Databases → Add database**

| フィールド | 値 |
|------------|----|
| Database type | PostgreSQL |
| Display name | lifelog mart |
| Host | `host.docker.internal` |
| Port | `54422` |
| Database name | `postgres` |
| Username | `bi_reader` |
| Password | `local-bi-reader` |
| Schemas | Only these… `mart` |
| Use a secure connection (SSL) | オフ |

追加設定で接続プールがあれば **3**。Show でスキーマ `mart` だけが見えれば成功。`raw_vault` が見える、または `postgres` スーパーユーザーで繋いでいるときは、その接続を消して `bi_reader` で作り直す。

### ダッシュボード

SQL 質問を 2 つ作り、1 枚のダッシュボードに載せる。

ピン地図:

```sql
select tst, lat, lon, trigger_code, accuracy_m, velocity_kmh, battery_pct
from mart.mart_location_trail
```

Visualization → Map。`lat` / `lon` が緯度・経度になっていなければ、歯車 → Table Metadata で型を付ける。

日次件数（日本時間）:

```sql
select (tst at time zone 'Asia/Tokyo')::date as day, count(*) as fixes
from mart.mart_location_trail
group by 1
order by 1
```

`mart_location_trail` が無いときは、先に `make dbt-owntracks`。0 行なら materialize と dbt の未処理 inbox を確認する（[dbt-ci-setup.md](./dbt-ci-setup.md)）。

## 2. 本番（手元の Metabase から hosted Supabase）

同じ Metabase に、ローカルとは別のデータベース `lifelog mart (remote)` を足す。中身は hosted の `mart` だけ。

1. この migration を含む deploy（`db push`）が `bi_reader` を作る。パスワードはまだ空。
2. Dashboard → **Vault**（または SQL）:

```sql
select vault.create_secret(
  'ここに強いパスワード',
  'bi_reader_password',
  'bi_reader login for Metabase session pooler'
);
```

既にあるときは `vault.update_secret` か Dashboard で値を更新する。

3. **Deploy to Supabase** を 1 回走らせる。`ops.sync_bi_reader_password_from_vault()` がロールに反映する。Vault が空のときは deploy ログに warning が出て、他の処理は続く。

任意: その deploy の環境に `BI_READER_PASSWORD` があると、deploy が Vault を upsert してから sync する。GitHub Actions ではリポジトリ secret `BI_READER_PASSWORD` を読む（空なら upsert しない）。

4. Actions で `dbt build`（owntracks）を 1 回走らせ、post-hook の `GRANT` を既存 view に付ける。migration 時点で view が既にある場合は migration の `GRANT SELECT ON ALL TABLES` でも付く。

5. Metabase を起動し、管理者ユーザーを作ったあと、倉庫を登録する。

```bash
make metabase-up
# .env に SUPABASE_DB_PASSWORD, SUPABASE_PROJECT_REF,
# および METABASE_API_KEY か METABASE_EMAIL + METABASE_PASSWORD
# METABASE_URL を書くときは http://127.0.0.1:3000
make metabase-connect-remote
```

`METABASE_API_KEY` があるとその値だけを送る。Admin → Settings → Authentication → API keys で Administrators グループに作り、`mb_` で始まる値を入れる。画面に一度だけ出る。キーが無いときはその行を空にして、セットアップ画面で作った管理者のメールとパスワードを `METABASE_EMAIL` / `METABASE_PASSWORD` に書く。401 `Unauthenticated` は Metabase のログイン拒否で、倉庫のパスワードとは別。

このコマンドは dbt と同じ Session pooler URL を解決し、Vault の `bi_reader_password` で `bi_reader.<project-ref>` としてログインできることを確認してから、Metabase に `lifelog mart (remote)` を作る（既にあれば更新する）。同期スキーマは `mart` のみ。SSL は require。ポートは 5432。

画面で足すときの値は次のとおり。ホスト欄は pooler の公開名。Metabase コンテナからもその名前で届く。

| フィールド | 値 |
|------------|----|
| Display name | lifelog mart (remote) |
| Host | Session pooler のホスト |
| Port | `5432` |
| Database name | `postgres` |
| Username | `bi_reader.<project-ref>` |
| Password | Vault に入れた値 |
| Schemas | `mart` のみ |
| SSL | require |
| SSL mode | require |
| 接続プール | 3 |

`pnpm metabase-connect-remote --print` は同じ接続を JSON で出す（パスワードを含む。ログに残さない）。

Transaction pooler（ポート 6543）には繋がない。

Network restrictions を有効にしているプロジェクトでは、Metabase を動かしているホストの IP を許可する。

## 3. 常時起動

Compose の H2 は手元用。VM や Metabase Cloud ではアプリ DB を別 Postgres にする。ホストは Supabase ではない。

```text
MB_DB_TYPE=postgres
MB_DB_HOST=<metabase-app-db-host>
MB_DB_PORT=5432
MB_DB_DBNAME=metabase
MB_DB_USER=metabase
MB_DB_PASS=<app-db-password>
JAVA_TIMEZONE=Asia/Tokyo
```

倉庫側の接続は §2 の `bi_reader` のまま。UI はログイン必須。地図の public link は作らない。イメージは `metabase/metabase:v0.64.4` をピンしたまま上げる。
