# ある時刻の場所と行動（Business Vault → Mart）

関連: [data-vault-model.md](./data-vault-model.md), [owntracks.md](./owntracks.md), [macos-local-ingest.md](./macos-local-ingest.md), [metabase.md](./metabase.md)

問い: ある person が、ある時刻に、どこで、何をしていたか。

「何を」は、いま raw vault にある三つの事実から読む。

| 事実 | ソース | raw vault の粒 |
|------|--------|----------------|
| 位置と、その瞬間の移動状態 | OwnTracks `_type=location` | 点（`tst`） |
| Mac の電源状態 | `macos_power` | 点（`occurred_at` の Sleep / Wake / …） |
| 使っていたアプリ | `macos_screentime` の `/app/usage` | 区間（開始はビジネスキーの中、終了は sat） |

位置は 500m–1km 動くまで送られない、という収集側の前提で設計する。アプリを見ていたその秒の計測点は無い。

## 1. 結論

Business vault を先に作る。マートはその上に載せる。

補間も、電源イベントのペアリングも、スクリーンタイムの「いまの終了時刻」も、ソースが記録した事実ではない。Raw vault に書くと、あとからルールを変えたときに実測と推定が混ざる。同じルールを日次マートや地図がもう一度実装することにもなる。

Business vault はソースの粒のまま持つ。分刻みの表はマートだけが作る。分への展開は問いの形であり、ビジネスルールではない。

電話の位置と Mac の操作は、同時刻でも同じ場所だとは扱わない。`link_device_machine` はまだ作らない（[macos-local-ingest.md](./macos-local-ingest.md) の同一視の節）。マートは「電話が報告した位置」と「Mac が報告した状態」を並べる。

## 2. レイヤー

```
raw vault
  実測の点と、終了時刻が伸びる区間
        │  ルールはここより下に書かない
        ▼
business vault
  bv_location_fix          採用する位置点
  bv_location_segment      隣り合う二点と、補間してよいか
  bv_power_interval        マシンの電源状態の区間
  bv_app_usage_interval    採用するアプリ区間
        │  ルールはここより上で再実装しない
        ▼
mart
  mart_person_activity_minute
  既存の mart_location_trail は実測点のまま残す
```

| 層 | 持つもの | 持たないもの |
|----|----------|--------------|
| raw vault | insert-only の実測。hashdiff | 補間座標、電源の区間、「現在の」区間 |
| business vault | 上の四つの規則。テーブル全件再計算 | 分刻みの行、Metabase 用に潰した配列 |
| mart | person × 分。推定だと分かる列 | ルールの分岐そのもの |

個人の量なら business vault もマートも `materialized='table'` で毎回組み直す。位置の末尾区間は次の fix が来ると終わるので、増分のまま末尾だけ直すより全件の方が規則が一つで済む。行数が問題になってから増分にする。

時刻は UTC。表示のタイムゾーンは Metabase 側に置く。

## 3. 位置

### 3.1 実測と推定を分ける

`mart_location_trail` はいまどおり `sat_owntracks_location` の実測だけを出す。補間点をここへ足すと、地図が計測していない点を fix として描く。

推定は `bv_location_segment` と、それを分に載せたマート列だけが持つ。

### 3.2 `bv_location_fix`

粒は `location_event_hk`。同じイベントの sat が複数あるときは `load_dts` が新しい行を採用する。

person は `link_device_location_event` → `link_person_device`。device のビジネスキーは OwnTracks の topic のまま。

同じ `(person, device, tst)` が複数あるときは `accuracy_m` が小さい行を残す。精度が無い行は残す方の後ろにする。

### 3.3 `bv_location_segment`

粒は、ある person のある device について、`tst` 順で隣り合う二つの fix。

| 列 | 内容 |
|----|------|
| `person_hk`, `device_hk` | セグメントの主体 |
| `start_*`, `end_*` | 両端の `tst`, lat, lon, `accuracy_m`, `trigger_code`, `velocity_kmh`, `motion_activities`, `location_event_hk` |
| `distance_m` | ハバーサイン。補間そのものではない |
| `duration_seconds` | `end_tst - start_tst` |
| `implied_speed_kmh` | `distance_m / duration_seconds`。0 秒は作らない |
| `position_model` | `linear` / `hold_start` / `unknown` |
| `lerp_alpha_at(t)` の材料 | マートが α を計算する。セグメント行には両端だけを置く |

緯度経度の線形補間は、距離が短いときの近似として使う。大圏補間はしない。`abs(end_lon - start_lon) > 180` のときは経度をほどいてから α を掛ける。

時刻 `t`（`start_tst <= t < end_tst`）の補間座標:

```
α = (t - start_tst) / (end_tst - start_tst)
lat = start_lat + α * (end_lat - start_lat)
lon = start_lon + α * (end_lon - start_lon)
```

α は分の始まりで一度だけ計算する。分の途中の移動は、このデータの分解能より細かい。

### 3.4 いつ線形補間するか

有意な位置変化（OwnTracks の trigger `v`）は、「十分動いた」ときに点が一つ増える。点と点のあいだは、ずっと等速だったとは限らない。家に 8 時間いて、最後の 10 分で 700m 歩くと、時間で半分の位置は「4 時間後に 350m 進んだ場所」になる。実測はそこを支持しない。

だから補間式は常に計算できるが、マートが推定位置として採用するのは `position_model = linear` のセグメントだけである。

初期ルールの名前は `significant_change_v1`。定数はこのモデルにだけ書き、マートにはコピーしない。

| `position_model` | 条件 | マートの推定位置 |
|------------------|------|------------------|
| `linear` | 両端の `trigger_code` が `t`（move mode のタイマー）。`duration_seconds` が 60 以上 20 分以下。`implied_speed_kmh` が 0.4 以上 130 以下 | その分の始まりの α で線形補間 |
| `hold_start` | 上に当てはまらず、`implied_speed_kmh` が 150 以下、かつ `duration_seconds` が 12 時間以下。`v` や手動の `u`、長いギャップはここ | 始点の lat/lon のまま。次の fix の時刻に跳ぶ |
| `unknown` | 時速 150km を超える、または 12 時間を超える | 座標は出さない。両端の fix キーだけ残す |

`hold_start` が、この収集間隔での既定である。500m–1km 動いていないあいだの位置として、最後に届いた点を使う。誤差の半径は `greatest(start_accuracy_m, 500)` メートル。`linear` の半径は両端の `accuracy_m` の大きい方と、`distance_m` の 4 分の 1の、大きい方。`accuracy_m` が null のときは 500 を使う。

`hold_start` は区間の終わり近くで最大約 1km ずれる。ずれる向きは「まだ始点にいる」側であり、線形補間のように途中の道に人を置くずれではない。

trigger が欠ける古い行は `hold_start` に落とす。`t` と分からないものを等速移動にはしない。

## 4. 移動状態

`motion_activities` と `velocity_kmh` は、その fix の瞬間の値である。OwnTracks が iOS から載せる活動は、静止・歩行・走行・自動車・自転車・不明のいずれかである。区間全体のラベルではない。

セグメントは両端の配列をそのまま持つ。マートの `motion_label` を埋めるのは次のときだけである。

- `position_model = linear`
- 両端の配列が、空でなく、同じ一つの活動だけを持つ

それ以外の分は `motion_label` を null にし、`motion_at_start` と `motion_at_end` だけを見せる。ギャップのあいだ歩き続けていた、とは書かない。

## 5. 電源

`bv_power_interval` の粒は、マシンごとの半開区間 `[occurred_at, next_occurred_at)`。

イベントは `link_machine_power_event` でマシンに結び、`sat_macos_power_event` の `occurred_at`, `kind` を使う。同じ `power_event_hk` の sat は `load_dts` が新しい行を採用する。

区間の状態は、区間を開いたイベントの `kind` で決まる。次のイベントは終端にしか使わない。

| 開いた `kind` | `power_state` |
|---------------|---------------|
| `Wake`, `Start`, `Restart` | `on` |
| `Sleep` | `asleep` |
| `DarkWake` | `dark_wake` |
| `Shutdown` | `off` |
| それ以外 | 行を作らない。raw vault には残る |

`DarkWake` はマシンが起きている状態であり、人が画面を見ている状態ではない。`on` にまとめない。

最後のイベントの終端は null、`power_open = true` とする。マートが分を生成するのは、そのイベントから 36 時間以内、かつ dbt 実行時刻より前だけである。`pmset` の履歴は落ちる。36 時間より古い未閉鎖は「まだその状態」とは出さない。

収集の穴は、いまの vault には無い。`covered_from` / `covered_until` は inbox の外に残っていない。長い `asleep` は、本当のスリープと、取りこぼした Wake の両方があり得る。12 時間を超える区間は `power_confidence = low`、それ以外は `high`。低信頼を `off` に書き換えない。

コンピュータ名は区間に焼かない。改名は `sat_machine_details` の別行である。マートが最新の `computer_name` を付ける。

## 6. アプリ

`bv_app_usage_interval` の粒は `usage_interval_hk` につき一行。終了時刻が伸びたあとの sat は `load_dts` が新しい行を採用する。同じ `load_dts` なら `ended_at` が遅い行を採用する。

区間は `[started_at, ended_at)`。重なりは潰さない。同時に複数の bundle があり得る。

`source_device_ref` が空の区間だけを `usage_device_scope = this_mac` とする。空でない区間は `other_or_unknown` として business vault には残し、このマートのアプリ配列には入れない。知識 DB に他デバイスが混ざることがある、という [macos-local-ingest.md](./macos-local-ingest.md) の前提のままである。

### 6.1 raw vault に無い開始時刻

`usage_interval_id` は `hardware_uuid`, uid, stream, `bundle_id`, `started_at`, `source_device_ref` の md5 である。`started_at` と `stream` は sat に載っていない。ハッシュから戻せない。

`bundle_id` は `hub_application.application_bk` から戻せる。`ended_at` と `source_device_ref` は sat にある。

Business vault は staging を読まない。先に `sat_macos_screentime_interval` へ `started_at` と `stream` を足す。どちらもビジネスキーの入力で、区間の寿命中に変わらない。hashdiff には入れない。終了時刻の更新で別の sat 行ができるときも、同じ開始時刻が各行に載る。

既に `vault_loaded_at` が入った inbox 行は、staging モデルのフィルタで sat の増分に戻ってこない。sat の full-refresh は、未ロード行だけを見て既存行を消す。バックフィルは一度だけの `UPDATE` とする。inbox を `usage_interval_id` で結合し、sat の `started_at` と `stream` が null の行を埋める。実測の訂正であり、以降の属性変更を `UPDATE` してよい、という先例にはしない。

## 7. マート

`mart_person_activity_minute`。粒は `person_id × minute_at`。`minute_at` は UTC の分の始まり。

行を作る分は、次のどれかを含む分だけである。

- `usage_device_scope = this_mac` のアプリ区間と重なる
- `power_state` が `on`, `dark_wake`, `asleep` のいずれかで、[§5](#5-電源) の生成上限に入る
- `position_model = linear` の位置セグメントと重なる

`off` だけの分と、`unknown` の位置だけの分は作らない。Mac を使っている分には、その分を覆うセグメントが `hold_start` でも位置を付ける。移動中で Mac が落ちていても、`linear` の分は残す。

| 列 | 内容 |
|----|------|
| `person_id` | `hub_person` のビジネスキー |
| `minute_at` | UTC |
| `lat`, `lon` | 推定。出せないときは null |
| `position_model` | その分に使ったセグメントの値。位置が無いときは null |
| `estimate_radius_m` | [§3.4](#34-いつ線形補間するか) |
| `location_device_bk` | topic。その分に推定が一つあるときだけ |
| `location_ambiguous` | その分に推定を持つ device が二つ以上なら true。このとき `lat` / `lon` は null |
| `locations` | device ごとの推定。要素は topic, lat, lon, `position_model`, `estimate_radius_m`, 両端の `location_event_hk` |
| `motion_label`, `motion_at_start`, `motion_at_end` | [§4](#4-移動状態)。device が一つのときだけフラット列を埋める |
| `power_state` | マシンが一つのときの状態。複数なら null |
| `power_confidence`, `power_open` | マシンが一つのとき |
| `machines` | `machine_bk`, 最新の `computer_name`, `power_state`, `power_confidence`, `power_open` |
| `app_bundle_ids` | その分と重なる `this_mac` の bundle。ソートして重複を除く |
| `app_count` | 配列の長さ |

device が二つある分は、緯度経度を平均しない。Metabase のピンはフラットな `lat` / `lon` を使い、`location_ambiguous` の分はピンを打たない。内訳は `locations` で見る。いまの person は電話一台を想定している。

アプリ配列は Mac、位置は電話、電源はマシン、と列の出自を固定する。三つの列が同じ分に揃っていても、人がその座標でそのアプリを使っていた、という事実にはしない。

既存の日次案（`bv_screentime_daily`, `mart_pc_activity_daily`, `mart_location_daily`, `mart_machine_power_daily`）は、この分マートを再集計して作らない。秒の合計は `bv_app_usage_interval` と `bv_power_interval` から、移動距離は `bv_location_segment` の `distance_m` から取る。分に丸めたあとの合計は境界で秒がずれる。

## 8. 人の結び方

三本とも `config/person_map.yml` の `person_id` に既に結んである。

| 経路 | link |
|------|------|
| 位置 | `link_device_location_event`, `link_person_device` |
| 電源 | `link_machine_power_event`, `link_person_machine` |
| アプリ | `link_os_account_usage_interval`, `link_person_os_account`, `link_usage_interval_application`, `link_machine_os_account` |

topic と hardware UUID を結ぶ link は、このマートのために作らない。

## 9. 実装の順

1. `sat_macos_screentime_interval` に `started_at` と `stream` を足し、ロード済み行を一度だけ埋める。
2. `bv_location_fix` と `bv_location_segment`。`position_model` のテストを先に固定する。
3. `bv_power_interval`。
4. `bv_app_usage_interval`。
5. `mart_person_activity_minute`。
6. dbt のテスト。Metabase の質問はリポジトリの外。

テストに含めるケース:

- セグメントの両端では α が 0 と 1 になり、座標が両端の fix と一致する。
- 8 時間・700m・trigger `v` は `hold_start`。時間の中点を道の中点にしない。
- 10 分・2km・両端 `t`・時速が範囲内なら `linear`。
- 時速 200km は `unknown` で、マートの `lat` は null。
- `Sleep` のあと `Wake` なら、そのあいだは `asleep`。`DarkWake` は `on` にしない。
- 同じ区間で `ended_at` が伸びた sat は、遅い `load_dts` だけが business vault に残る。
- `off` だけの分はマートに無い。
- 開いた電源区間は、イベントから 36 時間を超えた分を作らない。

## 10. この設計でまだ決めないこと

- ヘルスケアと `bv_sleep_session`。日次の健康マートは別の問いである。
- H3。推定座標からセルを計算するならマート側で、セル ID を補間しない。resolution 9 は一辺およそ 174m で、500m の移動はセルをまたぐ。最初のマートにはセルを置かない。
- Google Maps の場所名。`hub_location_place` は [owntracks.md](./owntracks.md) の Phase 2 のまま。
- trigger が混在する（片側だけ `t`）セグメント。初期ルールでは `linear` にしない。
- 分より細かい「ちょうどこの秒」の API。必要になったら同じ business vault に対して `t` を渡す view を足す。分マートをその view の材料にはしない。
