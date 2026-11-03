# OwnTracks → Supabase ingest の設定

本番 ingest は Supabase Edge Function **`owntracks-ingest`** 1 本に POST する。Legacy（自前 Hono + Cloudflare Tunnel、`/ingest/owntracks`）は [owntracks.md](../architecture/owntracks.md) の OCI 節を参照し、**新規は Supabase 版のみ**。

関連: [supabase-runtime.md §4.1](../architecture/supabase-runtime.md#41-owntracks-ingest), [OwnTracks HTTP モード](https://owntracks.org/booklet/tech/http/), [configuration keys（`httpHeaders` 等）](https://owntracks.org/booklet/tech/json/)

---

## 1. サーバー側（先に済ませる）

Deploy が成功していること（[deploy.yml](../../.github/workflows/deploy.yml) または `pnpm deploy`）。ingest だけなら **Vault / materialize Cron は不要**。

| 設定する場所 | 項目名 | 入れる値 | OwnTracks アプリに書く？ |
|--------------|--------|----------|---------------------------|
| GitHub → Repository secrets | `INGEST_BEARER_TOKEN` | 推測困難なランダム文字列（例: 32+ 文字） | **Bearer 値として iOS では使う**（下記） |
| Supabase（Edge secrets） | `INGEST_BEARER_TOKEN` | **GitHub と同じ文字列** | アプリには URL 以外で渡す（GitHub にだけ置いて deploy 任せでも可） |
| Supabase Dashboard → Settings → General | **Reference ID** | `abcdefghijklmnop` 形式の project ref | URL の `<project-ref>` 部分 |

`INGEST_BEARER_TOKEN` は deploy の `supabase secrets set --env-file .env` で Edge に載る。Dashboard → Edge Functions → Secrets から手動設定してもよいが、**GitHub Secret と Edge の値は一致**させる。

**OwnTracks に入れてはいけないもの:** Supabase **secret key**（`sb_secret_...`）、**service_role / legacy JWT**、DB パスワード。ingest は **`INGEST_BEARER_TOKEN` の Bearer のみ**。

---

## 2. OwnTracks アプリ（端末）

### 2.1 接続モード

| UI（目安） | 設定値 |
|------------|--------|
| Mode / 接続モード | **HTTP**（booklet 上 `mode`: **3**） |

MQTT ではなく HTTP にする。

### 2.2 URL（HTTP モードの URL 欄）

```
https://<project-ref>.supabase.co/functions/v1/owntracks-ingest
```

- `<project-ref>` … Supabase の Reference ID（Dashboard → Settings → General）。
- パス末尾は **`owntracks-ingest`**（関数名＝Hono `basePath`）。`/ingest/owntracks` など **旧パスではない**。
- スキームは **`https://`**（[OwnTracks も TLS 推奨](https://owntracks.org/booklet/tech/http/)）。

例: `https://xyzcompanyabc123.supabase.co/functions/v1/owntracks-ingest`

### 2.3 認証（Bearer）

Edge の実装は **`Authorization: Bearer <INGEST_BEARER_TOKEN>` と完全一致**のみ許可する（[owntracks-ingest/index.ts](../../supabase/functions/owntracks-ingest/index.ts)）。  
OwnTracks 標準の **HTTP Basic**（URL の `user:password@` や Identification の username/password）**だけでは 401** になる。

| プラットフォーム | Bearer の付け方 |
|------------------|-----------------|
| **iOS** | Connection 設定に加え、設定 JSON（`.otrc` 等）の **`httpHeaders`** で付与する。[booklet: `httpHeaders`](https://owntracks.org/booklet/tech/json/) — 1 行 1 ヘッダ、`名前:値`、複数行は `\n`。例: `Authorization:Bearer <INGEST_BEARER_TOKEN>`（`:` の直後にスペースを入れない形式が一般的）。 |
| **Android** | **2025 時点でカスタム HTTP ヘッダ未対応**（[discussion #2144](https://github.com/owntracks/android/issues/2144)）。Basic だけでは本 ingest と接続できない。**iOS と同じ Bearer が必要なら**、TLS 終端の前段（Cloudflare Worker / 自前 reverse proxy 等）で Basic を検証し、Origin へ **`Authorization: Bearer …` を付与**するか、Android の custom header 対応を待つ。 |

Identification の **username / device name** は Bearer とは別。HTTP では [`X-Limit-U` / `X-Limit-D`](https://owntracks.org/booklet/tech/http/) や JSON の `topic`（例: `owntracks/<user>/<device>`）の識別に使う。materialize 時の `person_map` と整合させる（[config/person_map.yml](../../config/person_map.yml)）。

### 2.4 その他（推奨）

| 項目 | 推奨 |
|------|------|
| TLS 証明書検証 | 有効（本番） |
| Payload 暗号化（`encryptionKey`） | 使う場合は Edge は **復号前の blob を Bronze に保存**する運用のまま。`topic` は復号後 JSON に含まれる — [HTTP booklet](https://owntracks.org/booklet/tech/http/) |
| 成功判定 | OwnTracks は **2xx** を成功とみなす。Edge は **202** + `{ batch_id, bronze_prefix }` を返す |

---

## 3. 設定対応表（一覧）

| レイヤ | 設定項目 | 値 |
|--------|----------|-----|
| GitHub | `INGEST_BEARER_TOKEN` | 共有秘密（ランダム） |
| Supabase Edge secret | `INGEST_BEARER_TOKEN` | 上と同じ |
| OwnTracks | Mode | HTTP (`3`) |
| OwnTracks | URL | `https://<project-ref>.supabase.co/functions/v1/owntracks-ingest` |
| OwnTracks（iOS） | `httpHeaders` | `Authorization:Bearer <INGEST_BEARER_TOKEN>` |
| OwnTracks | Identification → user / device | 任意だが `topic`・`person_map` 用に推奨 |
| OwnTracks（Android） | URL + Basic のみ | **そのままでは不可** → 2.3 の回避 |

ingest **以降**（Bronze → staging → dbt）は端末設定不要。materialize Cron は Vault（[supabase-runtime.md](../architecture/supabase-runtime.md)）。

---

## 4. 動作確認

### 4.1 curl（サーバー側）

`<project-ref>` と `<token>` を置き換える。

```bash
curl -sS -w "\nHTTP %{http_code}\n" -X POST \
  "https://<project-ref>.supabase.co/functions/v1/owntracks-ingest" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"_type":"location","topic":"owntracks/me/iphone","tid":"ip","tst":1700000000,"lat":35.6812,"lon":139.7671,"t":"u","acc":10}'
```

期待: HTTP **202**、本文に `batch_id` / `bronze_prefix`。

### 4.2 Supabase 上

- Storage → bucket **`bronze`** → `bronze/owntracks/dt=…/batch=…/`
- SQL: `select batch_id, status, bronze_prefix from ops.ingest_batch order by started_at desc limit 5;` → `status = received`

約 15 分後（materialize Cron）に `staged` へ進む。詳細は [supabase-runtime.md](../architecture/supabase-runtime.md)。

---

## 5. エラー早見

| HTTP | 意味 | 確認 |
|------|------|------|
| **401** | Bearer 不一致 | `INGEST_BEARER_TOKEN`（Edge）とアプリの `Authorization` / `httpHeaders` |
| **503** | ingest 未設定 | Edge に `INGEST_BEARER_TOKEN` が無い → deploy / Dashboard Secrets |
| **404** | パス誤り | URL が `…/functions/v1/owntracks-ingest` か |
| **400** | JSON 不正 | `_type` 等のペイロード |

---

## 6. ローカル開発（参考）

| 項目 | 値 |
|------|-----|
| URL | `http://127.0.0.1:54421/functions/v1/owntracks-ingest`（`make supabase-start` 後） |
| Bearer | `.env` の `INGEST_BEARER_TOKEN` |
| 手順 | [README.md](../../README.md) の `make supabase-functions-serve` / `make demo-owntracks-edge` |

実機 OwnTracks からローカルへ送る場合は、PC の LAN IP とポート公開が別途必要（通常は本番 URL のみ端末に設定する）。
