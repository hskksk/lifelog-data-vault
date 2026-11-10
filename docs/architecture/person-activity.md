# ある時刻の場所と行動（Business Vault → Mart）

関連: [data-vault-model.md](./data-vault-model.md), [owntracks.md](./owntracks.md), [macos-local-ingest.md](./macos-local-ingest.md), [metabase.md](./metabase.md)

問い: ある person が、ある時刻に、どこで、何をしていたか。

「何を」は、raw vault にある次の三つの事実から読む。

| 事実 | ソース | raw vault での記録の単位 |
|------|--------|--------------------------|
| 位置と、その瞬間の移動状態 | OwnTracks `_type=location` | 点（`tst`） |
| Mac の電源状態 | `macos_power` | 点（`occurred_at` の Sleep / Wake / …） |
| 使っていたアプリ | `macos_screentime` の `/app/usage` | 区間（開始はビジネスキーの中、終了は sat） |

収集側の前提として、位置は 500m–1km 動くまで送られない。この設計はその前提に従う。アプリを使っていたちょうどその秒の計測点は無い。

## 1. 結論

Business vault を先に作り、マートはその上に置く。

次の三つは、ソースが記録した事実ではない。

- 補間
- 電源イベントを前後で組にして区間にすること
- スクリーンタイムの「いまの終了時刻」

これらの規則は business vault にだけ書く。raw vault に書くと、あとから規則を変えたときに実測と推定が混ざる。日次マートや地図が同じ規則を再実装することにもなる。

The business vault keeps one row per source-level object: one adopted location fix, one segment between two consecutive fixes, one power-state interval, and one current app-usage interval. A segment is derived by pairing fixes, so it is not itself a raw source row, but its grain is still that pair. None of these tables is expanded into one row per minute.

分刻みの表を作るのはマートだけである。分への展開は問いの形から来るもので、ビジネスルールではない。

マートは「電話が報告した位置」と「Mac が報告した状態」を並べる。同時刻であっても、電話の位置と Mac の操作を、同じ場所のものとは扱わない。`link_device_machine` はまだ作らない（[macos-local-ingest.md](./macos-local-ingest.md) の同一視の節）。

## 2. レイヤー

```
raw vault
  実測の点と、終了時刻が伸びる区間
        │  規則を raw vault に書かない
        ▼
business vault
  bv_location_fix          採用する位置点
  bv_location_segment      隣り合う二点と、補間してよいか
  bv_power_interval        マシンの電源状態の区間
  bv_app_usage_interval    採用するアプリ区間
        │  規則を mart で再実装しない
        ▼
mart
  mart_person_activity_minute
  既存の mart_location_trail は実測点のまま残す
```

| 層 | 持つもの | 持たないもの |
|----|----------|--------------|
| raw vault | insert-only の実測。hashdiff | 補間座標、電源の区間、「現在の」区間 |
| business vault | 上の四つのテーブルに書く規則。テーブルは全件を再計算する | 分刻みの行、Metabase 用にまとめた配列 |
| mart | person × 分。推定値であることが分かる列 | 規則の分岐そのもの |

business vault もマートも `materialized='table'` にし、実行のたびに全件を作り直す。個人のデータ量ならこれで足りる。位置の末尾の区間は、次の fix が届くと終わる。増分で末尾だけ直すより、全件再計算の方が規則が一つで済む。行数が問題になったら、増分にする。

時刻は UTC で持つ。表示のタイムゾーンは Metabase 側で決める。

## 3. 位置

### 3.1 実測と推定を分ける

`mart_location_trail` は、従来どおり `sat_owntracks_location` の実測だけを出す。補間点をここに足すと、地図が、計測していない点を fix として描いてしまう。

推定を持つのは、`bv_location_segment` と、それを分ごとに計算したマートの列だけである。

### 3.2 `bv_location_fix`

`bv_location_fix` の 1 行は、一つの `location_event_hk` である。

| 項目 | 決め |
|------|------|
| 同じイベントの sat が複数ある | `load_dts` が新しい行を採用する |
| person | `link_device_location_event` → `link_person_device` でたどる |
| device のビジネスキー | OwnTracks の topic のまま |
| 同じ `(person, device, tst)` の行が複数ある | `accuracy_m` が小さい行を残す。`accuracy_m` が無い行は、残す候補の中で最後にする |

### 3.3 `bv_location_segment`

`bv_location_segment` の 1 行は、同じ person・同じ device の fix を `tst` 順に並べたときの、隣り合う二つの fix である。以下、これを「位置区間」と呼ぶ。

| 列 | 内容 |
|----|------|
| `person_hk`, `device_hk` | この位置区間の person と device |
| `start_*`, `end_*` | 両端の `tst`, lat, lon, `accuracy_m`, `trigger_code`, `velocity_kmh`, `motion_activities`, `location_event_hk` |
| `distance_m` | ハバーサイン距離。補間の結果ではない |
| `duration_seconds` | `end_tst - start_tst` |
| `implied_speed_kmh` | `distance_m / duration_seconds` |
| `position_model` | `linear` / `hold_start` / `unknown` |
| `lerp_alpha_at(t)` に使う値 | α はマートが計算する。位置区間の行は、両端の値だけを持つ |

Do not create the segment row when `end_tst = start_tst`. Implied speed is undefined at duration 0, so the row is omitted rather than stored with a null speed.

補間は、緯度経度の線形補間とする。距離が短いときの近似である。大圏補間は使わない。`abs(end_lon - start_lon) > 180` のときは、経度の折り返しを解いてから α を掛ける。

時刻 `t`（`start_tst <= t < end_tst`）の補間座標:

```
α = (t - start_tst) / (end_tst - start_tst)
lat = start_lat + α * (end_lat - start_lat)
lon = start_lon + α * (end_lon - start_lon)
```

α は分の始まりの時刻で、一度だけ計算する。分の途中の動きは、このデータの分解能では見えない。

### 3.4 いつ線形補間するか

OwnTracks の trigger `v`（有意な位置変化）では、「十分動いた」ときに点が一つ増える。点と点のあいだの移動が、ずっと等速だったとは限らない。

例: 家に 8 時間いて、最後の 10 分で 700m 歩いたとする。このとき線形補間は、時間の中点（4 時間後）に「350m 進んだ場所」を返す。実測にその裏付けは無い。

補間式は常に計算できる。ただし、マートが推定位置に使うのは `position_model = linear` の位置区間だけである。

初期の規則の名前は `significant_change_v1` である。定数は `bv_location_segment` のモデルにだけ書き、マートには写さない。

| `position_model` | 条件 | マートの推定位置 |
|------------------|------|------------------|
| `linear` | 次の三つをすべて満たす。両端の `trigger_code` がどちらも `t`（move mode のタイマー）。`duration_seconds` が 60 秒以上 20 分以下。`implied_speed_kmh` が 0.4 以上 130 以下 | その分の始まりの α で線形補間する |
| `hold_start` | `linear` に当てはまらず、`implied_speed_kmh` が 150 以下、かつ `duration_seconds` が 12 時間以下。trigger `v`、手動の `u`、長い間隔の位置区間はここに入る | 始点の lat/lon のまま。次の fix の時刻になると、その fix の位置に移る |
| `unknown` | `implied_speed_kmh` が 150 を超える、または `duration_seconds` が 12 時間を超える | 座標は出さない。両端の fix キーだけ残す |

この収集間隔では、`hold_start` が既定のモデルである。500m–1km 動くまでは、最後に届いた点を位置とする。

誤差の半径 `estimate_radius_m` は、次のとおり決める。

| `position_model` | 半径（メートル） |
|------------------|------------------|
| `hold_start` | `greatest(start_accuracy_m, 500)` |
| `linear` | 両端の `accuracy_m` の大きい方と、`distance_m` の 4 分の 1 のうち、大きい方 |

A null `accuracy_m` is replaced with 500 before either comparison. For `hold_start`, the radius is `greatest(coalesce(start_accuracy_m, 500), 500)`. For `linear`, each end uses `coalesce(accuracy_m, 500)`, and the radius is the greatest of those two values and `distance_m / 4`.

`hold_start` の位置は、位置区間の終わり近くで最大約 1km ずれる。ずれは「まだ始点にいる」向きに出る。線形補間のように、途中の道の上に人を置くことはない。

trigger が欠ける古い行は、`hold_start` にする。`t` と確認できない位置区間は、等速移動として扱わない。

## 4. 移動状態

`motion_activities` と `velocity_kmh` は、その fix の時点の値である。位置区間全体を表すラベルではない。OwnTracks が iOS から取得して位置に付ける活動は、静止・歩行・走行・自動車・自転車・不明のいずれかである。

位置区間は、両端の `motion_activities` の配列をそのまま持つ。

マートの `motion_label` を埋めるのは、次の二つを両方満たすときだけである。

- `position_model = linear`
- 両端の配列がどちらも空でなく、同じ一つの活動だけを含む

それ以外の分では、`motion_label` を null にする。出すのは `motion_at_start` と `motion_at_end` だけである。fix と fix のあいだ、ずっと歩いていたとは書かない。

## 5. 電源

`bv_power_interval` の 1 行は、マシンごとの半開区間 `[occurred_at, next_occurred_at)` である。

イベントは `link_machine_power_event` でマシンに結ぶ。`sat_macos_power_event` の `occurred_at` と `kind` を使う。同じ `power_event_hk` の sat が複数あるときは、`load_dts` が新しい行を採用する。

区間の状態は、その区間を開いたイベントの `kind` だけで決まる。次のイベントは、区間の終端にだけ使う。

| 開いた `kind` | `power_state` |
|---------------|---------------|
| `Wake`, `Start`, `Restart` | `on` |
| `Sleep` | `asleep` |
| `DarkWake` | `dark_wake` |
| `Shutdown` | `off` |
| それ以外 | 区間の行を作らない（raw vault には残る） |

`DarkWake` は `on` とは別の `dark_wake` にする。マシンが起きている状態であり、人が画面を見ている状態ではないからである。

最後のイベントの区間は、終端を null、`power_open = true` とする（開いた区間）。マートがこの区間から分を作るのは、イベントから 36 時間以内で、かつ dbt の実行時刻より前の分だけである。`pmset` の履歴は、時間がたつと消える。36 時間より古い開いた区間は、「まだその状態」と出さない。

収集の穴を示す情報は、いまの vault に無い。`covered_from` / `covered_until` が inbox の外に残っていないためである。そのため、長い `asleep` には、本当のスリープの場合と、取りこぼした Wake がある場合の両方があり得る。

`power_confidence` は、区間が 12 時間を超えると `low`、それ以外は `high` にする。`low` の区間も `power_state` は元のまま残し、`off` には書き換えない。

コンピュータ名は区間の行に持たせない。改名は `sat_machine_details` に別の行として入る。マートが最新の `computer_name` を付ける。

## 6. アプリ

`bv_app_usage_interval` は、`usage_interval_hk` と `person_id` の組ごとに 1 行である。同じ区間でも、OS アカウントに結ばれた人が複数いればその人数ぶんの行になる。終了時刻が伸びて sat に行が増えたときは、`load_dts` が新しい行を採用する。`load_dts` が同じなら、`ended_at` が遅い行を採用する。

区間は `[started_at, ended_at)` とする。区間どうしの重なりは、そのまま残す。同時に複数の bundle を使っていることがある。

`source_device_ref` で、`usage_device_scope` を決める。

| `source_device_ref` | `usage_device_scope` | business vault | このマートのアプリ配列 |
|---------------------|----------------------|----------------|------------------------|
| 空 | `this_mac` | 残す | 入れる |
| 空でない | `other_or_unknown` | 残す | 入れない |

この扱いは、知識 DB に他デバイスの分が混ざることがある、という [macos-local-ingest.md](./macos-local-ingest.md) の前提に沿っている。

### 6.1 開始時刻は sat の列

`usage_interval_id` は、`hardware_uuid`, uid, stream, `bundle_id`, `started_at`, `source_device_ref` の md5 である。md5 から元の値には戻せない。そのため、`started_at` と `stream` は `sat_macos_screentime_interval` の列として持つ。この二つは、区間が続くあいだ変わらない。hashdiff には入れない。終了時刻が伸びて sat に新しい行ができても、どの行にも同じ `started_at` が入る。

`bundle_id` は `hub_application.application_bk` から分かる。`ended_at` と `source_device_ref` は sat にある。

新しい行は、staging の `started_at` と `stream` を sat に書く。

これらの列を足す前に取り込んだ行は、この二列が空である。staging は `vault_loaded_at is null` の inbox だけを読む。そのため、通常の増分実行では、その行の inbox を読み直さない。空欄は、同じ dbt 実行の post-hook が inbox から埋める。

The post-hook fills a satellite row only when every inbox row with that `usage_interval_id` agrees: `min(started_at) = max(started_at)` and `min(stream) = max(stream)`. It does not decode the md5 or compare the hash with the inbox columns. If the inbox rows disagree, `started_at` and `stream` stay null. Once nothing is null, the update matches 0 rows.

## 7. マート

`mart_person_activity_minute` の 1 行は、`person_id × minute_at` である。`minute_at` は UTC の分の始まりである。

行を作るのは、その分が次のどれかに当てはまるときだけである。

- `usage_device_scope = this_mac` のアプリ区間と重なる
- `power_state` が `on`, `dark_wake`, `asleep` のいずれかで、[§5](#5-電源) の生成上限（36 時間）を超えていない
- `position_model = linear` の位置区間と重なる

`off` だけの分と、`unknown` の位置だけの分は作らない。

A minute that exists because of Mac activity still receives a location when the covering segment is `hold_start`. Mac activity here means an overlapping `this_mac` app interval, or a power state of `on`, `dark_wake`, or `asleep`. It does not mean power `on` alone. A minute covered by a `linear` segment is kept even when the Mac is off and no app interval overlaps that minute.

| 列 | 内容 |
|----|------|
| `person_id` | `hub_person` のビジネスキー |
| `minute_at` | UTC |
| `lat`, `lon` | 推定位置。出せないときは null |
| `position_model` | その分の位置に使った位置区間の値。位置が無いときは null |
| `estimate_radius_m` | [§3.4](#34-いつ線形補間するか) |
| `location_device_bk` | topic。その分の推定位置が一つのときだけ入れる |
| `location_ambiguous` | その分に推定位置を持つ device が二つ以上なら true。このとき `lat` / `lon` は null |
| `locations` | device ごとの推定位置。要素は topic, lat, lon, `position_model`, `estimate_radius_m`, 両端の `location_event_hk` |
| `motion_label`, `motion_at_start`, `motion_at_end` | [§4](#4-移動状態)。device が一つのときだけ埋める |
| `power_state` | マシンが一つのときの状態。複数なら null |
| `power_confidence`, `power_open` | マシンが一つのときだけ入れる |
| `machines` | マシンごとの `machine_bk`, 最新の `computer_name`, `power_state`, `power_confidence`, `power_open`, 区間の `started_at` |
| `app_bundle_ids` | その分と重なる `this_mac` の bundle。重複を除いて並べ替える |
| `app_count` | `app_bundle_ids` の長さ |

device が二つ以上ある分は、緯度経度を平均しない。`lat` / `lon` は null にする。Metabase のピンは `lat` / `lon` の列を使うので、`location_ambiguous` の分にはピンが立たない。内訳は `locations` で見る。いまの person は電話一台を想定している。

各列の出自は別である。アプリ配列は Mac、位置は電話、電源はマシンの記録である。三つが同じ分に揃っていても、人がその座標でそのアプリを使っていたことの記録としては扱わない。

既存の日次案（`bv_screentime_daily`, `mart_pc_activity_daily`, `mart_location_daily`, `mart_machine_power_daily`）は、この分マートを再集計せず、次のテーブルから作る。

| 集計 | 元 |
|------|----|
| 秒の合計 | `bv_app_usage_interval` と `bv_power_interval` |
| 移動距離 | `bv_location_segment` の `distance_m` |

分に丸めてから合計すると、分の境界で秒がずれる。

## 8. 人の結び方

位置は OwnTracks topic の user、電源とアプリは Mac 収集アプリの `person_id` で結ぶ。同じ文字列なら同じ `hub_person` になる。

| 経路 | link |
|------|------|
| 位置 | `link_device_location_event`, `link_person_device` |
| 電源 | `link_machine_power_event`, `link_person_machine` |
| アプリ | `link_os_account_usage_interval`, `link_person_os_account`, `link_usage_interval_application`, `link_machine_os_account` |

このマートのために、topic と hardware UUID を結ぶ link は作らない。

## 9. 実装の順

1. `sat_macos_screentime_interval` の `started_at` と `stream` を実装する。モデルに列は既にあり、空欄は post-hook が inbox から埋める。
2. `bv_location_fix` と `bv_location_segment` を作る。先に `position_model` のテストを書いて固定する。
3. `bv_power_interval` を作る。
4. `bv_app_usage_interval` を作る。
5. `mart_person_activity_minute` を作る。
6. dbt のテストを書く。Metabase の質問は、このリポジトリの外にある。

テストに含めるケース:

- 位置区間の始点で α は 0、終点で α は 1 になる。補間座標は、それぞれ始点・終点の fix の座標と一致する。
- 8 時間・700m・trigger `v` の位置区間は `hold_start` になる。時間の中点でも、道の中点の位置にはならない。
- 10 分・2km・両端 `t` で、時速が `linear` の範囲内なら `linear` になる。
- 時速 200km の位置区間は `unknown` になり、マートの `lat` は null になる。
- `Sleep` のあとに `Wake` が来たとき、そのあいだの区間は `asleep` になる。`DarkWake` は `on` ではなく `dark_wake` になる。
- 同じ区間で `ended_at` が伸びた sat 行が複数あるとき、business vault に残るのは `load_dts` が最も新しい行だけである。
- `off` だけの分は、マートに行が無い。
- 開いた電源区間では、イベントから 36 時間を超えた分の行を作らない。

## 10. この設計でまだ決めないこと

- ヘルスケアと `bv_sleep_session`。日次の健康マートは別の問いなので、この設計に含めない。
- H3。推定座標からセルを求めるなら、マートで行う。セル ID は補間しない。resolution 9 のセルは一辺がおよそ 174m で、500m の移動ではセルをまたぐ。最初のマートには、セルの列を置かない。
- Google Maps の場所名。`hub_location_place` は [owntracks.md](./owntracks.md) の Phase 2 のまま。
- trigger が混在する位置区間（片方の端だけ `t`）。初期の規則では `linear` にしない。
- 分より細かい「ちょうどこの秒」を返す API。必要になったら、同じ business vault に対して `t` を渡せる view を足す。その view は business vault から作り、分マートは材料にしない。
