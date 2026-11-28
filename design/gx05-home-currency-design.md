# GX-05 基準通貨のデータ設計（案α・スキーマ変更なし）— 設計書（2026-11-28・審査前）

正本：Vault `旅レートカメラ_多言語多通貨海外展開_機能正本・実装追跡表_2026-11-28`（GX-05・H-GX03・H-GX04）。
この文書は**設計だけ**で、コードは変えていない。審査（db-guardian・Fable）に合格してから GX-06 で実装する。

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
- 今の判定（2026-11-28 の grep で 41 行。うち記録単位 13・旅行単位 22・その他）を、この2つの関数の呼び出しへ置き換える。記録だけを受け取る部品（`ItemCard`・`ConversionSummaryCard`・一覧の行）には**記録の基準通貨を一緒に渡す**（呼び出し側が旅行を引く。`useAllHistory` の `tripMap` を使う）。
- 置き換えの対象（2026-11-28 時点）：`calendar/index.tsx:516,526`・`converter.tsx:61`・`history/index.tsx:113`・`item-detail.tsx:111,208`・`item-edit.tsx:156,308`・`index.tsx:263,856,857`・`index.web.tsx:55`・`settings.tsx:158,183,239`・`rate-setup.tsx:19`・`trip-create.tsx:38,76,77`・`trip-created.tsx:24,58,85`・`trip-edit.tsx:83,114,115,130`・`trip-list.tsx:113,182`・`trip-records.tsx:165,231`・`ActiveTripSwitchSheet.tsx:47`・`ConversionSummaryCard.tsx:28`・`ItemCard.tsx:72`・`csv-export-core.ts:151`・`live-text-core.ts:1518`・`edit-amount-core.ts:46`・`format.ts:31`・`currencies.ts:27`（`FOREIGN_CURRENCY_CODES`）。`extract-prices.ts:242` は OCR の読み取り方式の選択（現地通貨）なので**変えない**。

## 4. 保存・編集（保護領域）

- 保存（`index.tsx:855-857`）：`rateToSave = isDomestic ? 1 : manual_rate`、`foreignAmountToSave = isDomestic ? homeAmount : foreignAmount`。国内の入力は H の桁へ丸める（`roundMoney(input, H)`。H='JPY' なら今の `normalizeJpyInput`＝`Math.round` と同じ）。
- 実装の手順：**先に保存する行を作る部分を純粋関数へ切り出し、変更前の式と同じ値になる回帰テストを置く**（H='JPY'・国内／外貨・逆換算・0・小数・NaN）。その後で H を引数にする。
- 編集（`edit-amount-core.ts:46-52`）：国内の分岐の条件を `currency === recordHome` にし、丸めを H の桁にする。H='JPY' の結果は今と同じ（既存のテストがそのまま通ること）。**訪日客の記録（L='JPY'・H≠'JPY'）を国内として上書きしない**ことを新しいテストで固定する。
- 逆換算（基準通貨の額を入れる）：保存する `foreign_amount` を現地通貨の桁で丸めるかは変えない（今は丸めない）。編集欄の表示だけ現地通貨の桁で出す（`6.666666666666667` を出さない）。保存値は変えない。

## 5. 集計（全旅行の横断）

- 旅行ごとの合計：1件ずつ H の桁で丸めて最小単位で足す（`sumMoney`）。H が0桁の通貨（JPY・KRW・TWD）なら今の SQL `SUM(ROUND(jpy_amount))` と同じ値（回帰テストで固定。差は `ROUND(0.49999999999999994)` の1点だけで実害なし）。
- **H が小数の通貨（USD・EUR・GBP・THB）の合計には SQL の `ROUND`・`SUM` を使わない**。行を読んで JS の `sumMoney` で足す。SQLite の `ROUND(x,2)` は JS の丸めと一致しない（実測：`ROUND(1.005,2)`=1.0・`ROUND(2.675,2)`=2.67・`ROUND(1.115,2)`=1.11・`ROUND(0.285,2)`=0.28 に対し `sumMoney` は 1.01・2.68・1.12・0.29。`SUM` は 0.1+0.2 で 0.30000000000000004）。今の `SUM(ROUND(jpy_amount))`（`history.ts:123`）は小数の H を整数に丸めてしまうので、H が小数の旅行では使わない（GX-06）。
- カレンダー・分析・旅行一覧（全旅行）：**基準通貨ごとに分けて合計する**（`sumByCurrency`）。異なる通貨の額を足さない。
  - 全記録の基準通貨が同じ（今の利用者はすべて 'JPY'）なら、画面は今と同じ。
  - 混ざる時（H を変えて新しい旅行を作った利用者）だけ、通貨ごとの合計を並べる。棒グラフ・カテゴリー別は「主な基準通貨（最新の旅行の H）」の記録だけで描き、他の通貨は合計の行で示す（詳細な画面は GX-06 の実装時に ui の審査）。
- 予算の残り：旅行の中だけで計算（H は1つ）。

## 6. レート

- 入力：「1 L = x H」と「1 H = x L」のどちらでも入れられる（`normalizeRateInput`）。保存は今どおり「1 L あたりの H」（`manual_rate`）。
- 表示：**H='JPY' の旅行は今の表示（`formatRate`：`1 USD = ¥152.50`・`¥${manual_rate}`）を変えない**。H≠'JPY' の旅行だけ `describeRate`（既定は数が1以上になる向き、`local_first` で入力した向き）と `formatRateNumber`（小さいレートを 0.01 にしない・丸めは自前）を使う。今の `¥${manual_rate}` の直書き（5か所）は「H が円なら今の形、それ以外は `describeRate`」の1つの関数へ集める。
- 予備のレート（`exchange_rates`・円を軸にした表）：**H='JPY' の時だけ**今どおり使う。H≠'JPY' の時は使わない（その表は円を基準にした利用者の値で、桁や鮮度の前提が違うため）。旅行のレートが未設定なら「レート未設定」。

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
