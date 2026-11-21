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

3. Lightdash の Warehouse 画面に Host / Port / User / Password / SSL require を入れる。スキーマは `mart` を主にし、必要なら `business_vault` / `raw_vault` も許可。
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

### 2.2 Semantic layer connection = CLI（GitHub 不要）

プロジェクト設定で dbt 接続を **CLI** にすると、GitHub OAuth / PAT は不要。手元（または CI）から manifest を送る。

**CLI の入れ方（mise aqua を避ける）:** このリポジトリの `.mise.toml` に Lightdash は入っていない。`lightdash` を mise の aqua で入れていると、実行のたびに registry 更新が走り失敗することがある。**npm / npx を使う**。

```bash
cd packages/dbt
cp profiles.yml.example profiles.yml   # 未作成なら
# 本番倉庫へ deploy するときは profiles の target を bi_reader（session pooler）に合わせる

npx --yes @lightdash/cli@3.350.1 login https://<LightdashのSITE_URL>
npx --yes @lightdash/cli@3.350.1 deploy --create --profiles-dir . --project-dir .
# 既存プロジェクトへ: deploy --project <uuid>（--create なし）
```

`login` はブラウザまたは PAT。deploy は **手元の `profiles.yml` とカレントの dbt ファイル**を使う（未コミット変更も含む）。`dbt` コマンドが PATH にあること（venv の `dbt` を推奨、[dbt-ci-setup.md](./dbt-ci-setup.md) と同じ 1.12 系）。

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