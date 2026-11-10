# knowledgeC.db リファレンス（ER 図・コミュニティ調査まとめ）

Apple **CoreDuet** が macOS / iOS の利用行動を記録する SQLite（Core Data 永続化）です。Screen Time のアプリ利用区間、Safari 履歴、ロック状態などが **ストリーム名**（`ZSTREAMNAME`）で分類され、ほぼすべてが **`ZOBJECT` の1行**として格納されます。

lifelog-data-vault ではユーザー領域の DB だけをコピーし、Phase 1 はストリーム **`/app/usage`** のみを ingest します（設計: [macos-local-ingest.md](../architecture/macos-local-ingest.md)）。

> **注意:** スキーマは macOS バージョンで列が増減します。本書の列一覧はコミュニティ調査・Plaso パーサ等のスナップショットであり、手元の DB では必ず `sqlite3 knowledgeC.db ".schema ZOBJECT"` や `pragma table_info` で確認してください。

## ファイルの場所

| インスタンス | パス | 備考 |
|-------------|------|------|
| **ユーザー** | `~/Library/Application Support/Knowledge/knowledgeC.db` | Screen Time 等。lifelog のコレクタが読むのはこちら |
| **システム** | `/private/var/db/CoreDuet/Knowledge/knowledgeC.db` | デバイス全体の行動。別ファイル |

必ず **`knowledgeC.db-wal`** と **`knowledgeC.db-shm`** を本体と一緒にコピーしないと、直近数分〜数十分の行が欠けることがあります。

アクセスには **フルディスクアクセス**（TCC）が必要なことが多く、SIP 下ではライブ読取が難しいです。

## ER 図（論理モデル）

中心はイベント表 `ZOBJECT`。出所は `ZSOURCE`、ストリーム固有の詳細は `ZSTRUCTUREDMETADATA` に FK でぶら下がります。iCloud 同期端末の名前解決に **`ZSYNCPEER`** を `ZDEVICEID` で結合する例がコミュニティ（rud.is, APOLLO 系）にあります。

```mermaid
erDiagram
    ZOBJECT {
        int Z_PK PK
        string ZSTREAMNAME "イベント種別"
        string ZVALUESTRING "主値(バンドルID等)"
        real ZSTARTDATE "区間開始(MAT)"
        real ZENDDATE "区間終了(MAT)"
        real ZCREATIONDATE "行作成(MAT)"
        int ZSECONDSFROMGMT "当時のUTCオフセット秒"
        int ZSTARTDAYOFWEEK "1=日曜"
        string ZUUID "イベントUUID"
        int ZVALUEINTEGER "数値(状態系)"
        real ZVALUEDOUBLE "数値(計測系)"
        int ZSOURCE FK
        int ZSTRUCTUREDMETADATA FK
    }

    ZSOURCE {
        int Z_PK PK
        string ZBUNDLEID "記録元バンドル"
        string ZDEVICEID "端末ID(同期デバイス識別)"
        int ZUSERID
        string ZGROUPID
        string ZITEMID
        string ZSOURCEID
    }

    ZSTRUCTUREDMETADATA {
        int Z_PK PK
        string "Z_DK*METADATAKEY__*" "ストリーム別・OS版別に列が増減"
    }

    ZSYNCPEER {
        int Z_PK PK
        string ZDEVICEID
        string ZUUID
        string ZCLOUDID
        string ZRAPPORTID
    }

    ZOBJECT }o--|| ZSOURCE : "ZSOURCE = Z_PK"
    ZOBJECT }o--o| ZSTRUCTUREDMETADATA : "ZSTRUCTUREDMETADATA = Z_PK"
    ZSOURCE }o--o| ZSYNCPEER : "ZDEVICEID"
```

Core Data のメタ表（`Z_PRIMARYKEY`, `Z_METADATA`, `Z_MODELCACHE` など）や同期用の `ACHANGE` / `ATRANSACTION` なども存在しますが、利用タイムライン分析の主役は上記4表です。

### 参照関係（調査でよく使う JOIN）

```sql
-- Screen Time アプリ利用（rud.is / Sarah Edwards 系）
SELECT
  o.ZVALUESTRING AS bundle_id,
  (o.ZENDDATE - o.ZSTARTDATE) AS duration_seconds,
  datetime(o.ZSTARTDATE + 978307200, 'unixepoch') AS start_utc,
  datetime(o.ZENDDATE + 978307200, 'unixepoch') AS end_utc,
  s.ZBUNDLEID,
  s.ZDEVICEID,
  peer.ZUUID AS peer_uuid
FROM ZOBJECT o
LEFT JOIN ZSOURCE s ON o.ZSOURCE = s.Z_PK
LEFT JOIN ZSTRUCTUREDMETADATA m ON o.ZSTRUCTUREDMETADATA = m.Z_PK
LEFT JOIN ZSYNCPEER peer ON s.ZDEVICEID = peer.ZDEVICEID
WHERE o.ZSTREAMNAME = '/app/usage';
```

## テーブル定義の詳細

### ZOBJECT（メインイベント表）

1行 = 1イベントまたは1区間。意味は **`ZSTREAMNAME`** で決まり、`ZVALUESTRING` / `ZVALUEINTEGER` / `ZVALUEDOUBLE` のどれが主になるかはストリーム依存です。

Plaso `macos_knowledgec` プラグインが想定する CREATE 文（**ある OS 世代の代表例**）:

| 列 | 型（例） | コミュニティ上の意味 |
|----|----------|---------------------|
| `Z_PK` | INTEGER PK | 行ID（再コピーで変わり得る → lifelog ではビジネスキーに使わない） |
| `Z_ENT`, `Z_OPT` | INTEGER | Core Data 内部 |
| `ZSTREAMNAME` | VARCHAR | ストリーム識別子（下表参照） |
| `ZVALUESTRING` | VARCHAR | 文字列の主値。`/app/usage` では **アプリの bundle ID** |
| `ZVALUEINTEGER`, `ZINTEGERVALUE` | INTEGER | 状態ストリームの 0/1 等 |
| `ZVALUEDOUBLE`, `ZDOUBLEVALUE` | FLOAT | 計測値 |
| `ZSTARTDATE`, `ZENDDATE` | TIMESTAMP (REAL) | 区間の開始・終了（Mac Absolute Time, UTC 基準で保存） |
| `ZCREATIONDATE` | TIMESTAMP | デーモンが行を書いた時刻 |
| `ZSECONDSFROMGMT` | INTEGER | イベント時点のローカルオフセット（秒）。現地時刻復元用 |
| `ZSTARTDAYOFWEEK`, `ZENDDAYOFWEEK` | INTEGER | 曜日（1 = 日曜） |
| `ZUUID` | VARCHAR | イベント UUID |
| `ZSOURCE` | INTEGER FK → `ZSOURCE.Z_PK` | 記録の出所 |
| `ZSTRUCTUREDMETADATA` | INTEGER FK | 拡張メタデータ |
| `ZCONFIDENCE` | FLOAT | 推論信頼度（一部ストリーム） |
| `ZMETADATA` | BLOB | バイナリメタ（解析はストリーム依存） |
| その他 | — | `ZEVENT`, `ZVERBPHRASE`, `ZSHOULDSYNC` など。版によって有無が変わる |

**lifelog-data-vault が必須とみなす列**（`collectors/macos` / Go コレクタ）:

`ZSTREAMNAME`, `ZVALUESTRING`, `ZSTARTDATE`, `ZENDDATE`, `ZSOURCE`

任意: `ZSOURCE.ZDEVICEID`（列があれば `source_device_ref` として送信）

### ZSOURCE（イベントの出所）

| 列 | 意味 |
|----|------|
| `Z_PK` | PK |
| `ZBUNDLEID` | イベントを生成したバンドル（記録デーモンやアプリ） |
| `ZDEVICEID` | 端末識別子。**iPhone 等と Screen Time 共有した行**の切り分けに使われることがある |
| `ZUSERID` | ユーザー関連ID（版依存） |
| `ZGROUPID`, `ZITEMID`, `ZSOURCEID` | Handoff / アイテム識別など |

lifelog は `ZDEVICEID` を **解釈せず** 文字列のまま `source_device_ref` に保存します。

### ZSTRUCTUREDMETADATA（ストリーム固有ペイロード）

列名は **`Z_<Framework>...METADATAKEY__<名前>`** 形式で、macOS リリースごとに大幅に増減します。

例（コミュニティ文書より）:

| 列の例 | 関連ストリーム |
|--------|----------------|
| `Z_DKDIGITALHEALTHMETADATAKEY__WEBDOMAIN` | `/app/webUsage` |
| `Z_DKSAFARIHISTORYMETADATAKEY__TITLE` | `/safari/history` |
| `Z_DKAPPLICATIONMETADATAKEY__EXTENSIONCONTAININGBUNDLEIDENTIFIER` | `/app/inFocus` |
| `Z_DKLOCATIONAPPLICATIONACTIVITYMETADATAKEY__URL` | Handoff / アクティビティ系 |

クエリを固定化する前に `.schema ZSTRUCTUREDMETADATA` を必ず実行してください。

### ZSYNCPEER（同期ピア / 端末名簿）

| 列 | 意味 |
|----|------|
| `ZDEVICEID` | `ZSOURCE.ZDEVICEID` と結合 |
| `ZUUID`, `ZCLOADID`, `ZRAPPORTID` | クラウド・Rapport 識別 |

`ZMODEL` 列を `ZOBJECT` から読む古い例もありますが、版によってはメタデータ側に移っています。

## ZSTREAMNAME 一覧（調査でよく参照されるもの）

| ストリーム | 記録内容 | Screen Time / フォレンジックでの用途 |
|-----------|----------|--------------------------------------|
| `/app/usage` | アプリ利用時間の区間 | **macOS Screen Time の公式相当**（lifelog Phase 1） |
| `/app/inFocus` | フォアグラウンドアプリ区間 | セッション単位の利用タイムライン |
| `/app/webUsage` | アプリ内 Web ドメイン利用 | ブラウジング推定（Digital Wellbeing 系） |
| `/app/activity` | NSUserActivity / Handoff | ユーザー操作・アクティビティ |
| `/safari/history` | Safari 訪問 | 履歴クリア後も残ることがある |
| `/device/isLocked` | ロック状態 | 人在判定 |
| `/display/isBacklit` | ディスプレイ点灯 | 稼働ウィンドウ |
| `/media/nowPlaying` | 再生中メディア | 補助的プレゼンス |
| `/notification/usage` | 通知対話 | 注意の指標 |
| `/siri/usage` | Siri 利用 | プレゼンス |

同一マシンでも OS バージョンによって **存在しないストリーム** や **名前変更** があります。傾向把握には `SELECT ZSTREAMNAME, count(*) FROM ZOBJECT GROUP BY ZSTREAMNAME` が有効で、lifelog はこの件数だけを `extract.stream_counts` に載せます。

## 時刻（Mac Absolute Time）

- 基準: **2001-01-01 00:00:00 UTC** からの秒（小数あり）
- Unix 秒へ: **`+ 978307200`**
- SQLite 例:

```sql
datetime(ZSTARTDATE + 978307200, 'unixepoch')        -- UTC
datetime(ZSTARTDATE + ZSECONDSFROMGMT + 978307200, 'unixepoch')  -- 当時のローカル相当
```

lifelog のコレクタは UTC の ISO8601（`Z`）で Edge に送ります。

## 運用上の既知事項

| トピック | コミュニティ・プロダクト上の合意 |
|---------|-------------------------------|
| 保持 | 細かい行は **おおよそ数週間** でローリング・要約される報告が多い（4週間前後と言及する DFIR 文書あり） |
| WAL | 本ファイルだけコピーすると最新行が欠ける |
| スキーマドリフト | メジャーアップデートで列追加・ストリーム変更。`pragma table_info` 必須 |
| iPhone データ | 「デバイス間で Screen Time を共有」時のみ同一 DB に混在し得る |
| 使わない経路 | `/var/folders/.../com.apple.ScreenTimeAgent/Store` は TCC で閉じており lifelog では不使用 |

## lifelog-data-vault との対応

| knowledgeC | lifelog ingest |
|------------|----------------|
| `ZSTREAMNAME = '/app/usage'` | `stream` |
| `ZVALUESTRING` | `bundle_id` |
| `ZSTARTDATE`, `ZENDDATE` | `started_at`, `ended_at`（UTC） |
| `ZENDDATE - ZSTARTDATE` | `duration_seconds`（≤ 0 は破棄） |
| `ZSOURCE.ZDEVICEID` | `source_device_ref`（任意） |
| — | `usage_interval_id = md5(hw_uuid ‖ uid ‖ stream ‖ bundle ‖ started_at ‖ source_device_ref)` |

将来の候補（設計メモ）: `/app/webUsage`, `/safari/history` — allowlist 拡張として別変更扱い。

## 参考リンク（コミュニティ・DFIR）

- [KnowledgeC Parser — forensics guide & glossary](https://www.knowledgecparser.com/en/blog/knowledgec-db-forensics-guide)（ZOBJECT 列の整理、時刻の注意）
- [Spelunking macOS ScreenTime (rud.is, 2019)](https://rud.is/b/2019/10/28/spelunking-macos-screentime-app-usage-with-r/) — `ZOBJECT` + JOIN パターン、OmniGraffle ER 図
- Sarah Edwards — *Knowledge is Power!*（`knowledgeC.db` 入門、**APOLLO** の SQL 集）
- [Forenza — Knowledge-C DFIR 長文](https://forenza.io/macos-knowledge-c/) — ストリーム taxonomy、2インスタンス設計
- [Mac Forensics — knowledgeC and Biome](https://www.macforensics.app/en/blog/knowledgec-and-biome)
- [Plaso `macos_knowledgec` プラグイン（CREATE TABLE スナップショット）](https://plaso.readthedocs.io/en/stable/_modules/plaso/parsers/sqlite_plugins/macos_knowledgec.html)
- [한국어: macOS 포렌식 핸드북 — knowledgeC 구조](https://urock-ailab.github.io/forensics-handbook/mac/02-artifacts/execution/knowledgec/structure.html) — ストリーム別メタデータ列対応表

---

*調査メモ用。Apple はスキーマを非公開のまま変更し続けるため、本ドキュメントは「よく引用されるモデル」であり、公式仕様ではありません。*
