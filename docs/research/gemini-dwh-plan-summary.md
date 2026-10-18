# Gemini 共有チャット要点まとめ

- **共有リンク:** https://share.gemini.google/GbGGAlQcaqAJ  
- **チャット題材:** 個人用データの DWH 構築（Data Vault 検証兼ねる）  
- **本リポジトリとの関係:** Issue #4 のモノレポ設計を前提に、**データソース候補・抽出手法・DV モデル案**の調査メモとして扱う。

---

## 1. ゴール（チャット全体）

- **Data Vault 2.0**（Hub / Link / Satellite）の検証を兼ね、**個人 PC + iPhone** のデータを収集・蓄積する DWH を構築する。
- iOS サンドボックスと PC ローカル権限を踏まえ、**現実的な抽出パイプライン**を優先する。

---

## 2. データソースと抽出手法（要点）

### 個人 PC（macOS / Linux / WSL2）

| ソース | 内容 | 抽出の現実解 |
|--------|------|----------------|
| CLI / シェル履歴 | コマンド、日時、CWD、exit code | `atuin` の SQLite、または zsh フック |
| Git | リポジトリ、コミット、変更行数 | ワークスペース走査 + `git log` パース |
| ブラウザ履歴 | URL、タイトル、滞在 | Safari/Chrome `History.db` を **コピーして** SQLite クエリ |
| PC 利用時間 | アプリ名、ウィンドウ、時間 | **ActivityWatch**（REST）、または macOS Biome DB |

### iPhone（iOS）

| ソース | 内容 | 抽出の現実解 |
|--------|------|----------------|
| Apple Health | 歩数、心拍、睡眠等 | **Health Auto Export** → Webhook / iCloud / S3 |
| 位置 | 緯度経度、滞在 | **OwnTracks** → Webhook、またはショートカット |
| 写真メタ | 撮影日時、位置、EXIF | Mac 同期時 Photos.sqlite、またはショートカット |
| カレンダー / リマインダー | イベント、タスク | Mac 側 EventKit / AppleScript 等 |

### 追加トピック（チャット後半）

| ソース | 要点 |
|--------|------|
| **Google Maps（iPhone）** | タイムラインは **アプリから JSON エクスポート**（`Timeline.json` 等）が現実的。Takeout で保存場所も。完全自動は OwnTracks / ショートカットが代替。DV では Hub_Location、滞在/移動 Link + Sat。Place ID や H3 をビジネスキー候補。 |
| **Spotify** | **Web API** `recently-played`（直近 50 曲、定期ポーリング + `played_at` で dedupe）と **Extended Streaming History**（過去一括 JSON）の併用。Hub_Track / Hub_Artist / Hub_Device、Link_Play_Event、Sat_Play_Detail 等。 |

---

## 3. Data Vault モデル案（チャットで出た Hub / Link / Sat）

### コア（PC + iPhone 一般）

- **Hub:** Device, Application, Project（Git）, Location  
- **Link:** App_Activity（Device × App × Project）, Location_Health（Device × Location）  
- **Sat:** CLI_History, Browser_History, Health_Daily, App_Usage  

### Google Maps タイムライン

- **Hub_Location**（Place ID / H3）  
- **Link_Timeline_Stay / Trip**（Device との関係）  
- **Sat:** 滞在・移動手段・距離・confidence 等  

### Spotify

- **Hub_Track, Hub_Artist, Hub_Device**  
- **Link_Track_Artist, Link_Play_Event**  
- **Sat_Play_Detail, Sat_Track_Detail**  

---

## 4. アーキテクチャ案（チャット時点）

```
[iPhone/PC] → Webhook / Cron → Landing（Raw JSON / Parquet, MinIO 等）
            → DWH（DuckDB または PostgreSQL）
            → dbt（dbt-vault / Datavault4dbt 等）→ Raw Vault → BV（PIT/Bridge）→ Mart
```

- **Landing:** 軽量 Webhook 受信（FastAPI 等）、未加工 JSON を Raw Landing に保存（DV 原則）。  
- **DWH 選定:** 手軽さは DuckDB、恒常運用・並行書き込みは PostgreSQL。  
- **変換:** dbt + **dbt-vault 系**で hash key / insert-only Sat を SQL 化。

---

## 5. ロードマップ（チャット案）

| Phase | 内容 |
|-------|------|
| 1 | Webhook、Health Auto Export、PC（atuin 等）→ Staging |
| 2 | dbt-vault で Hub_Device + Sat_CLI + Sat_Health のロード検証 |
| 3 | ブラウザ / Git / ActivityWatch / 位置情報追加、PIT・Bridge・Mart |

---

## 6. 横断分析の例（チャット）

- 位置 × Spotify（場所とジャンル）  
- PC アクティビティ × Spotify（作業中の BPM / 曲）  
- Health × Spotify（心拍・運動とプレイリスト）  

---

## 7. 本リポジトリ（lifelog-data-vault）への取り込みメモ

| Gemini 案 | 現在の lifelog-data-vault 方針 |
|-----------|-------------------------------|
| MinIO + ローカル Webhook | **Bronze = R2**、ingest = Python + OCI cron（Issue #4） |
| DuckDB or Postgres | **Postgres** を Vault 本体（DV 運用練習優先） |
| dbt-vault パッケージ | dbt Core + 自前 macros（必要なら dbt-vault を後から追加） |
| FastAPI 常駐 Webhook | Phase 2 以降で `packages/ingest` に Webhook または n8n を検討 |

**ソース優先度の候補（チャットと整合）:** Apple Health → PC ActivityWatch / atuin → Spotify API → Google Maps エクスポート（半自動）。

---

## 8. 参考（チャット内の次アクション候補）

- dbt-vault の具体 SQL/YAML  
- Webhook レシーバー実装  
- DuckDB vs PostgreSQL の比較  
- Spotify 収集 Python / DV モデル  

これらは本リポジトリでは **Phase 1 以降の Issue / PR** に分解する。
