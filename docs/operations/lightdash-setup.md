# Lightdash セットアップ

設計: [../architecture/lightdash.md](../architecture/lightdash.md)

## 前提

- `make supabase-reset` 済み（`bi_reader` / `local-bi-reader`）
- Docker / Docker Compose
- dbt プロファイル: `cp packages/dbt/profiles.yml.example packages/dbt/profiles.yml`（`bi_reader` 出力を含む）

**Apple Silicon (arm64):** Lightdash の公式イメージは **amd64 のみ**。Compose は `platform: linux/amd64` でエミュレーション起動する。`no matching manifest for linux/arm64` が出たら、Docker Desktop → Settings → General で **Use Rosetta for x86_64/amd64 emulation on Apple Silicon** を有効にしてから `make lightdash-up` をやり直す（初回 pull は数 GB・数分かかることがある）。

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

3. **Warehouse（グラフ・Explore のクエリはここが効く。CLI の `NODE_TLS_*` は deploy 時だけ）**

   | フィールド | 値 |
   |------------|-----|
   | Host / Port | session pooler `….pooler.supabase.com` / `5432` |
   | User / Password | `bi_reader.<project-ref>` / Vault |
   | SSL mode | **`no-verify`**（推奨・手早い）または **`verify-full`** + **SSL root certificate** に Dashboard の CA をアップロード |
   | SSL mode `require` だけ | 多くの場合チャート時に **self-signed certificate in certificate chain** のまま |

   変更後: **Test connection** → 保存 → チャートを開き直す。

   **自己ホスト Lightdash（`make lightdash-up`）で hosted 倉庫** なら、CA を `deploy/docker/lightdash/certs/supabase-ca.pem` に置き `.env` に `NODE_EXTRA_CA_CERTS=/certs/supabase-ca.pem` を足して `make lightdash-up` し直す（UI は `no-verify` か `verify-full`+CA）。

   **本番 VM 上の Lightdash** なら、そのプロセスの環境に `NODE_EXTRA_CA_CERTS=...` を入れるか、UI で **`no-verify`**。
4. dbt ソースは次のどちらか（**個人 lifelog なら A が簡単**）。

### 2.1 dbt を GitHub から取る（本番）

#### A. プロジェクト作成で Personal Access Token（おすすめ）

Organization の **Connect GitHub（OAuth）** は使わない。プロジェクト新規作成フローで:

1. **Git connection** → **GitHub**
2. 認証は **Personal access token**（Classic で `repo`、または fine-grained で当リポジトリ read）
3. Repository: `hskksk/lifelog-data-vault`（実際の owner/repo）
4. Branch: `main`（追従させたいブランチ）
5. Project directory: `packages/dbt`

Lightdash サーバー側に GitHub App を置かなくてよい。dbt write-back（PR 作成）が要らなければこれで足りる。

#### B. Organization の GitHub OAuth（GitHub App 必須）

**Settings → Integrations → GitHub** の OAuth や、UI が推奨する「OAuth で接続」は、セルフホストでは **自分用の GitHub App** と環境変数がないと動かない。未設定のとき、コールバックが Lightdash 社の開発用プロキシ `github-proxy-dev.onrender.com` に飛び、`Bad request: missing parameter` になりやすい（スクリーンショットの URL）。

手順（要約）:

1. GitHub で **New GitHub App**（[公式手順](https://docs.lightdash.com/self-host/customize-deployment/configure-github-for-lightdash)）
2. **Callback URL**（GitHub App 側）: `https://<あなたの公開ホスト名>/api/v1/github/oauth/callback`  
   ※ `github-proxy-dev.onrender.com` は **登録しない**
3. Lightdash プロセスに渡す（テンプレート: [`deploy/docker/lightdash/github-app.env.example`](../../deploy/docker/lightdash/github-app.env.example)）:

   | 変数 | 内容 |
   |------|------|
   | `GITHUB_APP_NAME` / `GITHUB_APP_ID` / `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | App 設定から |
   | `GITHUB_PRIVATE_KEY` | 秘密鍵 PEM の **base64 1 行** |
   | `GITHUB_REDIRECT_DOMAIN` | ホスト名のみ（例 `bi.example.com`。`https://` は付けない） |
   | `SITE_URL` | ユーザーが開く URL 全体（例 `https://bi.example.com`） |
   | `TRUST_PROXY` / `SECURE_COOKIES` | リバースプロキシの前なら通常 `true` |

4. 環境変数を入れたあと Lightdash を再起動し、Organization から GitHub 接続をやり直す。

#### C. VM 上で dbt ディレクトリをマウント（Git 不要）

本番 VM でローカルと同様 `packages/dbt` を `/usr/app/dbt` にマウントし、GitHub 連携は使わない。pull / deploy のたびにホストで `git pull` して Lightdash で Compile。

Network restrictions がある場合は Lightdash ホスト IP を許可する。

### 2.3 本番 SSL の適用（3 か所）

Supabase pooler 用 CA は **Dashboard → Database → SSL Configuration → Download** で 1 回取得する（拡張子 `.crt` / `.cer` でよい。中身が `-----BEGIN CERTIFICATE-----` ならそのまま PEM）。**本番サーバーにコピー**し、git には入れない。

| か所 | 誰が繋ぐか | おすすめ（本番） | 設定 |
|------|------------|------------------|------|
| **A. Lightdash UI → Warehouse** | グラフ・Explore・スケジューラ | **verify-full** + **SSL root certificate** に同じ CA ファイルをアップロード | Project settings → Warehouse。`require` だけは不可。個人用途の簡易策は **`no-verify`**（暗号化のみ・MITM 耐性は弱い） |
| **B. Lightdash サーバー本体** | 上と同じ Node ランタイム | CA をマウントし **`NODE_EXTRA_CA_CERTS=/path/to/supabase-ca.pem`** | Docker: `deploy/docker/lightdash/certs/supabase-ca.pem` + compose の env（[docker-compose.lightdash.yml](../../deploy/docker/docker-compose.lightdash.yml)）。VM/systemd も同様に Lightdash プロセスにだけ渡す。`NODE_TLS_REJECT_UNAUTHORIZED=0` は本番で常時使わない |
| **C. 手元 / CI の `lightdash deploy`** | deploy 時の dbt + 倉庫疎通 | `profiles.yml` の **`bi_reader_hosted`**: `sslmode: require` + **`sslrootcert` 絶対パス** | 同じ CA。`NODE_EXTRA_CA_CERTS=同パス` を deploy コマンドに付ける（dbt と Node の両方） |

**手順例（正式運用・B + A + C）**

1. 本番 Lightdash ホストに `/etc/lightdash/supabase-ca.pem`（権限 644 程度）を置く。
2. Lightdash コンテナ／サービスを再起動: `NODE_EXTRA_CA_CERTS=/etc/lightdash/supabase-ca.pem`（Compose ならホストを `lightdash/certs/` にマウントして `/certs/supabase-ca.pem` でも可）。
3. UI Warehouse: session pooler、`bi_reader.<ref>`、**SSL `verify-full`**、**SSL root certificate** で同ファイルを指定 → Test connection。
4. 開発マシン: `profiles.yml` の `sslrootcert` をそのマシン上の CA パスに。deploy は `NODE_EXTRA_CA_CERTS=... npx @lightdash/cli@3.350.1 deploy ... --target bi_reader_hosted --selector lightdash`。

**動作確認:** リポ root で `pnpm verify-bi-reader-ssl`（pooler と CA の openssl 検証）。グラフは UI の Test connection 後に試す。

Metabase 本番は JDBC の `sslmode=require` だけで通ることが多いが、Lightdash は **Node の検証**が厳しいため上記 A+B がセットになる。

### 2.2 Semantic layer connection = CLI（GitHub 不要）

プロジェクト設定で dbt 接続を **CLI** にすると、GitHub OAuth / PAT は不要。手元（または CI）から manifest を送る。

**CLI の入れ方（mise aqua を避ける）:** このリポジトリの `.mise.toml` に Lightdash は入っていない。`lightdash` を mise の aqua で入れていると、実行のたびに registry 更新が走り失敗することがある。**npm / npx を使う**。

```bash
cd packages/dbt
cp profiles.yml.example profiles.yml   # bi_reader_local を含む
source ../../.venv-dbt/bin/activate      # dbt 1.12.x（1.13 や mise の dbt は使わない）
dbt --version                            # 1.12.* であること

npx --yes @lightdash/cli@3.350.1 login http://127.0.0.1:8081   # 本番は SITE_URL

# 初回プロジェクト作成（@3.350.1 を必ず付ける。未指定だと CLI 1.x になりサーバ 3.x と不整合）
npx --yes @lightdash/cli@3.350.1 deploy --create \
  --profiles-dir . --project-dir . \
  --target bi_reader_local \
  --selector lightdash

# 2 回目以降: --create を外し、必要なら --project <uuid>
```

`login` はブラウザまたは PAT。**`--selector lightdash`** は `dbt_project.yml` で定義した **marts のみ**（`raw_vault` に YAML カラムが無く `No dimensions available` になるのを避ける）。deploy は **手元の `profiles.yml`** を使う。

| 接続先 | `--target` |
|--------|------------|
| ローカル `make supabase-reset` | `bi_reader_local`（`sslmode: disable`） |
| 本番 session pooler | `bi_reader_hosted` + **`SUPABASE_DB_SSLROOTCERT`**（下記 SSL） |

**Hosted の SSL**

| エラー | 原因と対処 |
|--------|------------|
| `self-signed certificate in certificate chain` | **二重設定:** (1) `profiles.yml` の `sslrootcert` 絶対パス（dbt） (2) **`export NODE_EXTRA_CA_CERTS=同じ CA`**（Lightdash CLI / Node）。`make lightdash-deploy-hosted` は後者を自動で付ける |
| `requires sslcert, sslkey and sslrootcert when sslmode is verify-full` | CLI は **`verify-full` だと client 証明書まで要求**する。プロファイルは **`sslmode: require` + `sslrootcert`**（Supabase は client cert 不要） |
| `env_var('SUPABASE_DB_SSLROOTCERT')` なのに SSL エラー | Lightdash CLI は **Jinja を展開しない**ことがある。`profiles.yml` に **`sslrootcert: /Users/.../supabase-prod-ca.crt` のように直書き** |

1. Dashboard → **Database** → **SSL Configuration** で **Download certificate**（拡張子 `.crt` / `.cer` どちらでもよい）
2. **PEM 変換は通常不要** — 中身が `-----BEGIN CERTIFICATE-----` ならそのまま使う（`.crt` と `.pem` は中身が同じ形式なら別名でしかない）
3. DER のときだけ: `openssl x509 -inform DER -in 落としたファイル -out ~/.postgresql/supabase.pem`
4. 確認: `pnpm verify-bi-reader-ssl`（CA の openssl 検証 + pooler の `s_client`）
5. `bi_reader_hosted.sslrootcert` に **絶対パス**（`.pem` にリネームしてもよいが必須ではない）
6. CLI deploy: **`NODE_EXTRA_CA_CERTS` に同じファイル** + **`--selector lightdash`**
7. **Lightdash UI の Warehouse**: `verify-full` + CA アップロード、または **`no-verify`**

```bash
# CA が本当に読めるか（deploy 前）
export SUPABASE_DB_SSLROOTCERT=~/.postgresql/supabase-prod-ca.crt
pnpm verify-bi-reader-ssl

openssl x509 -in "$SUPABASE_DB_SSLROOTCERT" -noout -subject   # 失敗したら DER 変換か再ダウンロード

NODE_EXTRA_CA_CERTS="$SUPABASE_DB_SSLROOTCERT" \
  npx --yes @lightdash/cli@3.350.1 deploy --create \
  --profiles-dir . --project-dir . \
  --target bi_reader_hosted --selector lightdash
```

**まだ `self-signed certificate in chain` のとき**

- Dashboard から **別プロジェクト用**の CA を入れていないか確認
- pooler ホスト（`aws-0-….pooler.supabase.com`）と profiles の `host` が一致しているか
- Nix 等で `NIX_SSL_CERT_FILE` を使っている場合、**Supabase CA だけ**の `NODE_EXTRA_CA_CERTS` にして再試行（システム束と競合することがある）
- **`NODE_TLS_REJECT_UNAUTHORIZED=0`** は **CLI deploy の一瞬だけ**有効。グラフは **Warehouse の SSL mode**（上記 §2）か **Lightdash サーバー本体**の `NODE_EXTRA_CA_CERTS` で直す

dbt / `_marts.yml` を変えたあと本番 Lightdash を更新するたびに、同じ `deploy` を再実行する（Git の **Refresh** は CLI プロジェクトでは使わない）。

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
| `no matching manifest for linux/arm64` | 上記 Apple Silicon の Rosetta 設定。compose の `platform: linux/amd64` が入っているか確認 |
| OAuth 後 `github-proxy-dev.onrender.com` + `missing parameter` | セルフホストに GitHub App 未設定。§2.1 **A（PAT）** か **B（GitHub App + `GITHUB_REDIRECT_DOMAIN`）** に切り替え |
| `lightdash deploy` 前に mise + `aqua-registry` / `origin does not appear to be a git repository` | Lightdash 本体のエラーではない。**mise の aqua レジストリキャッシュが壊れている**。§2.2 の `npx @lightdash/cli` を使うか、キャッシュを削除して mise を直す（下記） |

**mise aqua キャッシュの修復（任意）:**

```bash
rm -rf ~/Library/Caches/mise/aqua-registry
mise install   # または最初に失敗した aqua ツールを再 install
```

別案: `brew install node` 経由で `npm i -g @lightdash/cli`、または毎回 `npx` のみ（グローバル不要）。
| CLI 1.154.x とサーバ 3.350.1 の警告 | `@lightdash/cli` に **バージョンを付ける**（上記 `3.350.1`） |
| dbt 1.13.0-b1 の警告 | [requirements-ci.txt](../../packages/dbt/requirements-ci.txt) の venv を有効化 |
| `No dimensions available`（raw_vault など） | **`--selector lightdash`** または `--select path:models/marts`。全モデルを上げない |
| `The server does not support SSL connections` | ローカル倉庫に **`--target bi_reader_local`**（SSL オフ）。`profiles.yml` の `target: ci` や `sslmode: require` をローカル deploy に使っていないか確認 |
| `self-signed certificate in certificate chain`（hosted） | `profiles` の CA **と** `NODE_EXTRA_CA_CERTS`（上表）。直 deploy 例: `NODE_EXTRA_CA_CERTS=$SUPABASE_DB_SSLROOTCERT npx ... deploy ...` |
| 23 × `No dimensions available` on deploy | **`--selector lightdash`** を付ける |
| `sslcert, sslkey and sslrootcert` + `verify-full` | `verify-full` をやめ **`require` + sslrootcert**（上表） |