# GX-05 基準通貨のデータ設計（案α・スキーマ変更なし）— 設計書（2026-11-28・db-guardian と Fable 5.2 の再監査で条件付き合格）

正本：Vault `旅レートカメラ_多言語多通貨海外展開_機能正本・実装追跡表_2026-11-28`（GX-05・H-GX03・H-GX04）。
この文書は**設計だけ**で、コードは変えていない。**§11・§12・§13 は §1〜§9 より優先する**（食い違う所は §11〜§13 を正とする）。審査（db-guardian・Fable）に合格してから GX-06 で実装する。

## 0. 前提と承認境界

- Human は「円固定の解消・既存記録の互換維持」を正式に承認した（2026-11-28）。ただし AI_CONTEXT の「絶対に勝手に触らないもの」（DB スキーマ・migration・保存処理・保存時レート固定・旅行切替）は残る。
- **本書の解釈（H-GX04・仮決定・Human が却下できる）**：スキーマ変更・migration・既存行の書き換えをしない案αは承認範囲内として進める。保存処理への変更は、db-guardian と Fable の合格、および「基準通貨が円の旅行で保存される行が変更前と同じ」回帰テストを条件にする。スキーマ変更（案β）は保留。
- DB v8 下書き（`design/proplus-db-v8-draft.md`）の「既存の表へ列を足さない」原則と矛盾しない。

## 1. 列の意味（名前は変えない・意味を「基準通貨」へ広げる）

| 列 | 今の意味 | 新しい意味 | 既存の行 |
|---|---|---|---|
| `trips.base_currency` | 旅行の現地通貨 L | 同じ | 変わらない |
| `trips.target_currency` | （常に 'JPY'・読まない） | **旅行の基準通貨 H** | すべて 'JPY'（INSERT は列を指定せず既定値、v3 移行も既定値、`updateTrip` は型で除外） |
| `trips.manual_rate` | 1 L あたりの円 | **1 L あたりの H** | H='JPY' なので同じ |
| `trips.budget_jpy` | 予算（円） | **予算（H）** | 同じ |
| `conversion_history.currency` | 記録の現地通貨 | 同じ | 変わらない |
| `conversion_history.foreign_amount` | 現地通貨の額 | 同じ | 変わらない |
| `conversion_history.jpy_amount` | 円の額 | **記録の基準通貨の額** | H='JPY' なので同じ |
| `conversion_history.rate_used` | 保存時の 1 L あたりの円 | **保存時の 1 L あたりの H** | 同じ |
| `exchange_rates.rate` | 1単位あたりの円 | 同じ（円を軸にした表のまま） | 変わらない |

**記録の基準通貨**は「その記録の旅行の `target_currency`」。`trip_id` が NULL の古い行（v1 時代）は **'JPY'**。
→ 既存のすべての行は H='JPY' と読まれ、意味は変わらない。**データ移行なし・行の書き換えなし。**

## 2. 基準通貨の決め方と固定（H-GX03・仮決定）

- 利用者の既定の基準通貨を端末に保存する（`expo-sqlite/kv-store`、キー `home_currency_v1`）。
  - 未設定で、既に旅行がある端末（既存の利用者）：'JPY'（今の利用者の挙動を変えない）
  - 未設定で旅行が無い端末：端末の地域の通貨（GX-02 の `expo-localization` の `currencyCode`）が7通貨にあればそれ、無ければ 'JPY'。どちらにしても**最初の旅行の作成画面で選べる**（自動で決め切らない）
- 旅行の作成時に既定値を `trips.target_currency` へ書く（`insertTrip` に列を足す。'JPY' の時は既定値と同じ行になる）。
- **記録が1件でもある旅行では基準通貨を変えない**（画面に出さない・`updateTrip` の型にも入れない）。記録が0件の旅行だけ編集で変えられる。
- 旅行の現地通貨（`base_currency`）は今どおり記録の後も変えられる。記録はそれぞれ自分の `currency` と `rate_used` を持つので、1つの旅行に現地通貨の違う記録が混ざってよい（集計は H だけで行う）。

## 3. 国内の判定を1つにまとめる

- 旅行：`isDomestic(trip.base_currency, trip.target_currency)`（`money-core.ts`）。今の `isJpyMode`（`base_currency === 'JPY'`）は H='JPY' の時に同じ値。
- 記録：`recordHome = tripOf(record)?.target_currency ?? 'JPY'`、`isDomesticRecord = record.currency === recordHome`。
- 今の判定（2026-11-28 の grep で 41 行。うち記録単位 13・旅行単位 22・その他）を、この2つの関数の呼び出しへ置き換える。記録だけを受け取る部品（`ItemCard`・`ConversionSummaryCard`・一覧の行）には**記録の基準通貨を一緒に渡す**（**記録の基準通貨は SQL の副問い合わせで行に載せる：§11 C1**。JOIN は使わない。`tripMap` で別に引く方式は使わない）。
- 置き換えの対象（2026-11-28 時点）：`calendar/index.tsx:516,526`・`converter.tsx:61`・`history/index.tsx:113`・`item-detail.tsx:111,208`・`item-edit.tsx:156,308`・`index.tsx:263,856,857`・`index.web.tsx:55`・`settings.tsx:158,183,239`・`rate-setup.tsx:19`・`trip-create.tsx:38,76,77`・`trip-created.tsx:24,58,85`・`trip-edit.tsx:83,114,115,130`・`trip-list.tsx:113,182`・`trip-records.tsx:165,231`・`ActiveTripSwitchSheet.tsx:47`・`ConversionSummaryCard.tsx:28`・`ItemCard.tsx:72`・`csv-export-core.ts:151`・`live-text-core.ts:1518`・`edit-amount-core.ts:46`・`format.ts:31`・`currencies.ts:27`（`FOREIGN_CURRENCY_CODES`）。`extract-prices.ts:242` は OCR の読み取り方式の選択（現地通貨）なので**変えない**。

## 4. 保存・編集（保護領域）

- 保存（経路は3つ：`index.tsx:855-866`・換算タブ `converter.tsx:63-74, 121`・Web `index.web.tsx:57-58, 105-106`。§12-1 B3）：`rateToSave = isDomestic ? 1 : manual_rate`、`foreignAmountToSave = isDomestic ? homeAmount : foreignAmount`。国内の入力は H の桁へ丸める（`roundMoney(input, H)`。H='JPY' なら今の `normalizeJpyInput`＝`Math.round` と同じ）。
- 実装の手順：**先に保存する行を作る部分を純粋関数へ切り出し、変更前の式と同じ値になる回帰テストを置く**（H='JPY'・国内／外貨・逆換算・0・小数・NaN）。その後で H を引数にする。
- 編集（`edit-amount-core.ts:46-52`）：国内の分岐の条件を `currency === recordHome` にし、丸めを H の桁にする。H='JPY' の結果は今と同じ（既存のテストがそのまま通ること）。**訪日客の記録（L='JPY'・H≠'JPY'）を国内として上書きしない**ことを新しいテストで固定する。
- 逆換算（基準通貨の額を入れる）：保存する `foreign_amount` を現地通貨の桁で丸めるかは変えない（今は丸めない）。編集欄の表示だけ現地通貨の桁で出す（`6.666666666666667` を出さない）が、**これは基準通貨が円以外の記録だけ**（§12-1 B2。基準通貨が円の記録は今の `String(foreign_amount)` のまま）。保存値は変えない。

## 5. 集計（全旅行の横断）

- 旅行ごとの合計：1件ずつ H の桁で丸めて最小単位で足す（`sumMoney`）。H が0桁の通貨（JPY・KRW・TWD）なら今の SQL `SUM(ROUND(jpy_amount))` と同じ値（回帰テストで固定。差は `ROUND(0.49999999999999994)` の1点だけで実害なし）。
- **H が小数の通貨（USD・EUR・GBP・THB）の合計には SQL の `ROUND`・`SUM` を使わない**。行を読んで JS の `sumMoney` で足す。SQLite の `ROUND(x,2)` は JS の丸めと一致しない（実測：`ROUND(1.005,2)`=1.0・`ROUND(2.675,2)`=2.67・`ROUND(1.115,2)`=1.11・`ROUND(0.285,2)`=0.28 に対し `sumMoney` は 1.01・2.68・1.12・0.29。`SUM` は 0.1+0.2 で 0.30000000000000004）。今の `SUM(ROUND(jpy_amount))`（`history.ts:123`）は小数の H を整数に丸めてしまうので、H が小数の旅行では使わない（GX-06）。
- カレンダー・分析・旅行一覧（全旅行）：**基準通貨ごとに分けて合計する**（`sumByCurrency`）。異なる通貨の額を足さない。
  - 全記録の基準通貨が同じ（今の利用者はすべて 'JPY'）なら、画面は今と同じ。
  - 混ざる時（H を変えて新しい旅行を作った利用者）だけ、通貨ごとの合計を並べる。棒グラフ・カテゴリー別は「主な基準通貨」（決め方は §12-2 S5。「最新の旅行の H」は使わない）の記録だけで描き、他の通貨は合計の行で示す（詳細な画面は GX-06 の実装時に ui の審査）。
- 予算の残り：旅行の中だけで計算（H は1つ）。

## 6. レート

- 入力：「1 L = x H」と「1 H = x L」のどちらでも入れられる（`normalizeRateInput`）。保存は今どおり「1 L あたりの H」（`manual_rate`）。
- 表示：**H='JPY' の旅行は今の表示（`formatRate`：`1 USD = ¥152.50`・`¥${manual_rate}`）を変えない**。H≠'JPY' の旅行だけ `describeRate`（既定は数が1以上になる向き、`local_first` で入力した向き）と `formatRateNumber`（小さいレートを 0.01 にしない・丸めは自前）を使う。今の `¥${manual_rate}` の直書き（5か所）は「H が円なら今の形、それ以外は `describeRate`」の1つの関数へ集める。
- 予備のレート（`exchange_rates`・円を軸にした表）：**書き込みは H='JPY' かつ L≠'JPY' の時だけ**（今と同じ条件。§12-1 S1）。読むのも **H='JPY' の時だけ**今どおり使う。H≠'JPY' の時は使わない（その表は円を基準にした利用者の値で、桁や鮮度の前提が違うため）。旅行のレートが未設定なら「レート未設定」。

## 7. CSV

- 全記録の基準通貨が 'JPY' なら、**今と同じ列・見出し・値**（回帰テスト）。
- 'JPY' 以外が含まれる時だけ、見出しを「換算金額」にし「換算通貨」の列を足す。値は各記録の H の桁で丸める。見出しの言語は表示言語（GX-07）。

## 8. Web 版の別実装

- `index.web.tsx:105` は旅行の通貨ではなく `selectedCurrency` を保存している（ネイティブと食い違う既存の不整合）。GX-06 でネイティブと同じ「旅行の L・H」に揃える。`use-*.web.ts` も同じ規則にする。

## 9. 戻し方・危険

- スキーマを変えないので、アプリを前の版へ戻しても DB は読める。
- ただし前の版は `jpy_amount` を円として読むため、**H≠'JPY' の旅行を作った後に前の版へ戻すと、その旅行の額が円として表示される**（データは壊れないが表示が誤る）。未公開のアプリで、該当するのは試験の端末だけ。公開後に版を戻す運用はしない（Build は前へ進めるだけ）。
- 既存のバックアップ（CSV の書き出し）はそのまま使える。

## 10. 審査で見てほしい点

1. 既存のすべての行が H='JPY' と読まれることの根拠（§1）に穴が無いか
2. 記録の基準通貨を旅行から引く方式（§3）で、旅行が削除された・見つからない記録の扱い（'JPY' で読む）が既存の画面と矛盾しないか
3. 保存・編集の変更（§4）が H='JPY' で今と同じ行になるか、回帰テストの範囲が足りるか
4. 全旅行の集計（§5）で、今の利用者の画面が変わらないか
5. スキーマを変えない前提で、見落としている保存先（Pro+ の JSON・CSV の読み込み・全データ削除）が無いか

## 11. 審査の条件（db-guardian・2026-11-28・条件付き合格。実装はこの条件を満たすこと）

判定：案α（スキーマ変更なし・migration なし・既存行の書き換えなし）は DB の観点で成立。破壊的変更なし。
根拠の追加確認：`target_currency` は NOT NULL（NULL の行なし）、`INSERT INTO trips` は `trips.ts` と `schema.ts` の2か所だけ、`DELETE FROM trips` は無い（旅行は archive のみ）、`trip-store` は永続化しない、全データ削除（`clearAll`）は記録だけを消し旅行は残す、Pro+ の `proplus-v1.json` に金額・通貨・予算の項目は無い、CSV の読み込み・復元は存在しない（書き出しだけ）。

- **C1 記録の基準通貨は SQL の副問い合わせで取る（Fable B1 で改訂）**：`history.ts` の各 SELECT を `SELECT *, COALESCE((SELECT target_currency FROM trips WHERE trips.id = conversion_history.trip_id), 'JPY') AS home_currency FROM conversion_history …（以降は今のまま）` にする。**JOIN は使わない**（`SELECT *` のままだと `trips` と同名の `id`・`created_at`・`updated_at` で記録の `id` が旅行の `id` に化け、`WHERE id = ?` と `history-date-core.ts` の無修飾の `created_at` が ambiguous で失敗する。Fable が node:sqlite で実測）。`tripMap` で別に引く方式も使わない（初期値が空の間や1件の読み直しで 'JPY' と誤読するため）
- **C2 基準通貨の変更はアトミックに**：専用の関数で `UPDATE trips SET target_currency = ?, manual_rate = ?, budget_jpy = ?, updated_at = datetime('now') WHERE id = ? AND NOT EXISTS (SELECT 1 FROM conversion_history WHERE conversion_history.trip_id = trips.id)` を1文で行う（件数の確認と更新の間に隙間を作らない。**旅行の id を bind するのは1か所だけ**。再監査 SF2：旧い文〈`… WHERE trip_id = ?` で id を2回 bind〉は、2つ目に別の旅行の id が入ると記録のある旅行を書き換えるので使わない）。**レートと予算は旧い基準通貨の単位なので、フォームの新しい値を同じ1文で SET する**（§12-2 S6）。`updateTrip` には実行時の列名の許可リストを持たせる（今は型で除外しているだけで、`Object.keys` をそのまま SET 句に使っている）
- **C3 読み取り時の正規化**：7通貨に無い `target_currency` は読み取り時に 'JPY' として扱う関数を1つ置く（列は TEXT で CHECK 制約が無い）
- **C4 新規作成だけで列を明示する**：`insertTrip` に `target_currency` を足すのは新規作成だけ。ネイティブと Web の作成の4経路（`createTrip`・`endCurrentAndCreateTrip` × 2）で同じ値にする
- **C5 回帰テストの追加**：読み出した行の `id`・`created_at`・`updated_at` が変更前と同じ（B1）／逆換算で保存した外貨の記録を金額に触れずメモだけ保存すると `changed: false`（B2）／換算タブの4つの値（予備レートの有無 × 基準通貨が円か否か）（B3）／C2 が拒否された時にレート・予算が書かれない／基準通貨が円以外の旅行で `exchange_rates` が書かれない（S1）／既存の小数の円の行（1200.5）で金額に触れずメモだけ保存すると `changed: false`／外貨の記録の編集（`Math.round(f * rateUsed)`）が基準通貨＝円で同じ値／`addEntry` に渡る4つの値（currency・foreign・jpy・rate）が変更前の式と完全に同じ／基準通貨が0桁の時に SQL の合計と JS の合計が一致／CSV が基準通貨＝円で今と同じ列・見出し・値。`record-jpy-total.test.mjs`・`budget-core.test.mjs` に基準通貨が円以外の例を足す。同じ合計の式の写し（`getBudgetTotalsForTrip`・`useHistory.budgetTotals`・`sumBudgetTotals`・`analytics-core`・Web 版）を1つでも旧い式のまま残さない
- **C6 既存の利用者の判定**：§2 の「既に旅行がある端末」は `getAllTrips`（アーカイブを含む）か記録の有無で判定する（`getActiveTrips` だと、全旅行をアーカイブした利用者が地域の通貨を既定にされる）
- **保存と編集の丸めの非対称**：今は保存時の外貨の記録の `jpy_amount` は丸めず、編集時は `Math.round(f * rateUsed)` で丸めて保存している。基準通貨が円以外でもこの非対称を保つ（保存は生値、編集は基準通貨の桁で丸める）。変えない

## 12. Fable 5.2 の審査（2026-11-28・条件付き合格）と GX-06 の実装条件

判定：案αは成立（§1 の「既存の行はすべて H='JPY'」に穴なし。`target_currency` を書く経路は存在しない）。ただし文面どおりに作ると円の利用者が壊れる経路が3つ（B1〜B3）あった。**B1〜B3・S1 は最初 §12-1 と §11 C1 にだけ書き、§3〜§6 の本文に食い違いが残っていた（再監査 SF1）。2026-11-28 の再監査の後、§3〜§6 の本文も直した。** S2〜S11 は GX-06 の実装条件。

### 12-1. 本文の修正（blocker と S1）

- **B1**：§11 C1 を副問い合わせの形へ改訂した（上）
- **B2（§4 を改訂）**：編集欄の初期値は**基準通貨が円の記録では今の `String(foreign_amount)` のまま変えない**。表示を丸めるのは基準通貨が円以外の記録だけで、その時は外貨の分岐の未変更の判定も「入力と現在値を同じ桁で丸めて比べる」にする（円の分岐 `edit-amount-core.ts:51` と同じ規律）。プレビュー（`item-edit.tsx:310-312`）も同じ規則。理由：¥1000 を 150 で逆換算した記録は `foreign_amount = 6.666666666666667`。欄を 6.67 で出すと、メモだけ直して保存した時に `jpy_amount` が 1000 → 1001 に書き換わる
- **B3（§4 に追記）**：**保存の経路は3つ**ある。`index.tsx:855-866`／換算タブ `converter.tsx:63-74, 121`（旅行のレートが0なら `exchange_rates` の円のレートで**保存まで**行う）／Web `index.web.tsx:57-58, 105-106`。3つとも「保存する4つの値を作る純粋関数」に切り出し、経路ごとに C5 の回帰テストを置く。換算タブは「旅行のレート0・予備あり・基準通貨＝円」で今と同じ値、「基準通貨≠円」では予備のレートを使わず保存できない（C2 でレートを0にした旅行に円のレートで保存しないため）
- **S1（§6 に追記）**：`exchange_rates` への書き込み（`rate-setup.tsx:38`・`trip-edit.tsx:130` の `saveRate`）は **H='JPY' かつ L≠'JPY' の時だけ**（今と同じ条件）。`cur !== 'JPY'` を `!isDomestic` に機械的に置き換えない（訪日客で `saveRate('JPY', 0.0067)` が入り、円の旅行の予備のレートが狂う）

### 12-2. GX-06 の実装条件（S2〜S11・nit）

- **S2 判定の3分類**：§3 の行は「国内の判定」「入力する通貨の小数の桁（`number-pad`／`decimal-pad`：`index.tsx:1645`・`converter.tsx:262`・`item-edit.tsx:546` は `decimalsOf(入力する通貨)` で決める）」「円の記号・ラベル（`item-detail.tsx:208`・`item-edit.tsx:551`・`index.tsx:1188,1607,1615,1626,1636`・`converter.tsx:233-268`・`history/index.tsx:156`・`trip-edit.tsx:250,263`）」に分けて扱う。旅行が無い時は `isDomestic` を呼ばず false
- **S3 基準通貨の額の表示・丸めの棚卸し**：`formatJpy(` 27ファイル59か所（§3 に無い `proplus/place-edit.tsx:121`・`SmartCameraLayer.tsx:117`・`translation-price-format.ts:21`・`ActiveTripBanner.tsx:41,46`・`TripListItem.tsx:49`・`PriceResultCard`・`AnalysisSummaryCard`・`CategorySpendCard`・`SpendBarChart`・`analytics.tsx:262,311` を含む）と、整数に丸める式（`index.tsx:286,319,1892,1965`・`index.web.tsx:78`・`item-edit.tsx:312`・`trip-create.tsx:42`）。完了条件：`formatJpy`・`Math.round(…jpy…)`・`¥` の直書きが、基準通貨を受け取る1つの関数を経由する。翻訳ページの型 `TripPriceConversion`（`live-text-core.ts:1509`）に基準通貨を足す
- **S4 分析**：`formatCompactYen`・`formatAxisLabels`（`analytics-core.ts:183-235`）は通貨と表示言語を引数に取る。`summarizePeriodSpending` は基準通貨を受け取り、合計・棒・カテゴリー別を**最小単位の整数で足してから戻す**（浮動小数で足すと3つの合計の一致が崩れる）
- **S5 主な基準通貨**：「表示期間内の記録の基準通貨（1種類ならそれ、複数なら件数が最多か最新の記録）、記録が無い時だけ使用中の旅行の H」。§5 の「最新の旅行の H」は使わない。旅行なしの履歴（`use-history.ts:55`）も全旅行の横断として扱う
- **S6 C2 の運用**：`changes === 0` は拒否。基準通貨の変更は、フォームの新しいレート・予算を**同じ1文で SET** し、拒否なら全体を中止（旧い基準通貨の旅行に新しい単位の値を書かない）。`updated_at = datetime('now')`。条件は `NOT EXISTS (SELECT 1 FROM conversion_history WHERE conversion_history.trip_id = trips.id)`。成功後に `getTripById` → `setActiveTrip`。Web（`use-trips.ts:108-110`）にも同じ条件と許可リスト
- **S7 旅行ごとの合計**：**H が0桁の旅行は `BUDGET_GROUP_SQL`（`history.ts:122-124`）を1文字も変えずに使う**。H が小数の旅行だけ行を別に読んで JS の `sumMoney` で上書きする（同一性を構造で保証）。~~件数は SQL のまま~~ → **件数も同じ読み出しの行数にする**（GX-06 段階 c-2 で変更・db-guardian 確認済み：合計と件数を1回の読み出しにそろえる。行の集まりは同じなので値は SQL の COUNT と同じ）。残り予算も小数の H では最小単位で引く（`computeBudgetStatsFromTotals` の `units`）
- **S8 純粋モジュールの規律**：`edit-amount-core`・`budget-core`・`analytics-core`・`csv-export-core` は値の import を持たない（テストが直接 import）。桁や丸めは**引数で注入**する（`csv-export-core.ts` の `categoryLabelOf` と同じ方式）
- **S9 訪日客で検索に掛からない前提**：`translation-languages.ts:26` の `JPY: null`（スマートカメラの換算・メモの翻訳・翻訳タブの初期言語）、`live-text-core.ts:1531` の「元」を TWD と判定（日本語の「元祖」「地元」）、`getRateInputExample` は1通貨あたりの円。**訪日客の翻訳ページ・スマートカメラの換算は GX-09 で扱い、それまで出さない**。入力例は `crossRateFromJpyTable` で作る
- **S10 旅行編集のレート欄**：基準通貨が円以外の旅行では「欄の文字列が初期値から変わった時だけ `manual_rate` を書く」（名前だけの編集でレートを変えない）
- **S11 Web 版**：記録を読む場所は3つ（`use-history.web.ts:17`・`use-all-history.web.ts:14`・`trip-stats.ts:14`）。3つとも旅行の基準通貨を載せる（localStorage に書き戻さない）。`use-all-history.web.ts:99` の `Math.round` も写しの1つ。§8 の「Web は旅行の通貨で保存」は基準通貨が円でも挙動が変わるので、「今と同じ」の例外として**別の commit** にする
- nit：`HistoryRow` に `home_currency` を足すと `insertHistory` の `Omit` と Web の行の生成が型エラーになる（C3 の関数で絞る）／CSV は1旅行単位なので見出しは旅行の H で決まり、「H の桁で丸める」は H≠円の時だけ（既存の「外貨の記録は生値」の契約を保つ）／旅行の作成・編集に基準通貨の選択を足すのは「画面が同じ」の例外（ui の審査）／`expo-localization` は Build が要る（GX-02・Human GO）

## 13. 再監査（2026-11-28・Fable 5.2・条件付き合格）と GX-06 の完了条件の追加

判定：条件付き合格・blocker なし。B1〜B3・S1 の修正は実コードと実測（node:sqlite で実際の `migrateDatabase`・`history.ts`・`trips.ts`・`edit-amount-core.ts` を実行）に対して正しい。C1 の副問い合わせで `getHistory`・`getHistoryById`・`getHistoryInDateKeyRange`・`getHistoryForTrip` の全列・列順が今と一致。v2 の旧スキーマから v7 へ移行した DB でも旅行はすべて `target_currency='JPY'`。`rate_used` を書き換える文は無く、`foreign_amount`・`jpy_amount` を書き換えるのは `updateAmount`（`item-edit.tsx:418`・`changed:true` の時だけ）だけ。起動時・移行時に既存の旅行・記録を書き換える記述は無い。案αの前提を崩す記述は無い。

- **SF1（本文を直した）**：§3 の「JOIN」・§4 の保存の経路と編集欄の表示・§5 の「主な基準通貨」・§6 の書き込み条件。あわせて冒頭に「§11〜§13 が §1〜§9 より優先」と書いた
- **SF2（§11 C2 を直した）**：基準通貨の変更の SQL は S6 の相関の形1つだけ（旅行の id の bind は1か所）。回帰テスト：記録のある旅行は `changes = 0` で全列が不変／記録の無い旅行は `changes = 1` で他の旅行が不変
- **SF3（GX-06 の完了条件）**：編集欄の初期値とプレビューを作る式を `edit-amount-core` の純粋関数へ切り出し、`item-edit.tsx` はそれだけを使う。回帰テストは「初期値の関数の出力をそのまま `resolveEditedAmount` に渡すと `changed:false`」を、円の記録・小数の円（1200.5）・順方向の外貨・逆換算の外貨（6.666666666666667）・基準通貨が円以外の各組で確かめる（今のテストは文字列を手で渡しているので、画面が `6.67` を出す実装でも通ってしまう）。プレビューは、未変更の時は保存済みの額を基準通貨の桁で丸めた値、変更の時は保存される値を出す。基準通貨が円の時は今の式（`Math.round(f * rate_used)`）と同じ値
- **SF4（GX-06 の完了条件・保存処理への追加なので Human の確認の対象）**：`addEntry`（ネイティブ・Web）は INSERT の直前に旅行の `target_currency` を DB から読み直し、画面が金額の計算に使った基準通貨と違えば保存せずに止める（保存する4つの値は変えない。拒否を足すだけ）。C2 の成功後に store の更新が失敗した時は `activeTrip` を旧い値のまま残さない。回帰テスト：基準通貨が食い違う時に記録が1件も増えない。**これは基準通貨を変える操作（C2）を画面に出す時に必須**で、基準通貨が円だけの間（C2 を出す前）は起きない
- nit（GX-06 で対応）：C3 の正規化は記録の行の `home_currency` にも掛ける（`target_currency` が空文字だと `COALESCE` を素通りする）／S7 で小数の基準通貨の合計を JS で出す時、上限付きの `getHistoryForTrip`（50／500件）を使わず、上限なしで `is_purchased, jpy_amount` だけを読む／C5 の B1 のテストは `tools/store-assets/engine/fixtures/expo-sqlite-node.mjs` と `alias-hooks.mjs` で実際の `history.ts` を node:sqlite に掛けて書ける／基準通貨を変えた成功時に `index.tsx`・`converter.tsx` の入力中の金額を消す／§3 の `csv-export-core.ts` は `src/lib/csv-export-core.ts`
- Web の記録は `persistAll(loadAll())` で全行を localStorage へ書き戻すので（`use-history.web.ts:110`）、S11 の「書き戻さない」は保存の前に `home_currency` を落とす実装にする
- **db-guardian の再確認（2026-11-28・C1・C2 の最終形）：合格**。C1 は FROM が `conversion_history` だけのままなので `WHERE id = ?`・`WHERE trip_id = ?`・`history-date-core.ts` の無修飾の列はすべて記録の表に解決され、`trips.id` は `INTEGER PRIMARY KEY`（主キー検索）。C2 は1文で原子的・id の bind は1か所・記録のある旅行は `changes = 0`・`updated_at = datetime('now')` は既存の書き方と同じ。`conversion_history.trip_id` に索引は無いが、操作が稀なので許容（索引はスキーマ変更なので足さない）。実装時の注意：C1 を入れるのは `HistoryRow` を返す4関数（`getHistory`・`getHistoryById`・`getHistoryInDateKeyRange`・`getHistoryForTrip`）だけで、集計（`getBudgetTotals*`・`getHistoryCount*`・`getImageUris`）は変えない／`insertHistory` の `Omit<HistoryRow, …>` に `home_currency` を足す
