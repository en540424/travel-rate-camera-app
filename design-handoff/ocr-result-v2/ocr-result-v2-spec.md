# v2 OCR結果（成功）・ spec

- **フォルダ**：`ocr-result-v2/`
- **画面名**：OCR結果（成功・価格候補あり）
- **状態**：**独立画面ではなく** `src/app/(tabs)/index.tsx` の状態（`ocrResult != null && prices.length > 0`）
- **下タブ active**：カメラ
- **正トークン**：`src/theme/tokens.ts`

---

## 1. 画面の目的

OCRで読み取れた価格を**ワンタップで円換算 → 保存**まで運ぶ、保存フローの中心。
「円換算結果」を主役にし、外貨額は副表示。候補・購入済みのどちらに保存するかをその場で選ばせる。

## 2. 状態の説明

- `ocrResult` が存在し価格候補が1件以上のとき。`prices.length===0` は `ocr-failed-v2`。
- 同一 `index.tsx` 内で、撮影前（`main-v2`）から**カードが下に積み上がる**形（OCR結果カード＋入力カード）。
- 価格候補が1件なら大ボタン、複数ならチップ（既存実装どおり）。選択済みは `primaryDark` で反転。
- メモ候補タップで `メモ` に追記（追加済みは「✓ 追加済み」表示）。

## 3. レイアウト構造

```
ScrollView (padding 15, gap 12)
├─ TripRateHeader
├─ OCR結果カード（SectionCard）
│   ├─ ヘッダー「読み取り結果」＋ ✕（カードを閉じる）
│   ├─ 価格候補：単一=大ボタン / 複数=tealチップ（選択=primaryDark）
│   ├─ メモ候補：行＋「＋メモ」/「✓ 追加済み」
│   └─ ▶ 読み取った文字（全文・折りたたみ）
└─ 入力カード（SectionCard・保存確認）
    ├─ 入力モード切替（USD→JPY / JPY→USD）※JPYモードでは非表示
    ├─ 金額入力（外貨・36/800）
    ├─ 円換算ヒーロー（PriceResultCard・display 48）  ← 主役
    ├─ メモ（背景 bgScreen の行）
    ├─ 保存写真行（サムネ＋変更/削除、OCR写真スワップ）
    ├─ 保存先（候補=amber / 購入済み=teal トグル）
    ├─ SaveLimitBanner（上限近接時のみ）
    ├─ 保存CTA（PrimaryButton・teal・CTAグロー）「¥xxx を候補に保存」
    └─ 保存しないで次を撮る →
```

## 4. 数値仕様（tokens.ts 準拠）

| 項目 | 値 | トークン |
|---|---|---|
| カード | 白・border1 `#ECEFED`・radius16・pad14〜15・`shadow.card` | `card.base` |
| overline見出し | 11/700 `#7E8986`・ls0.6 | `typography.overline`系 |
| 価格チップ | bg `#0E9488`（選択 `#0A766E`）・radius999・pad10×18・18/700 白（tnum） | `color.primary`/`primaryDark` |
| メモ候補「＋メモ」 | border1 `#0E9488`・radius8・12/600 teal（追加済=`line2`地/`muted`字） | |
| 入力モード切替 | border1 `#ECEFED`・radius8・選択 bg`#0E9488`白 / 非選択 13/600 `#5B6764` | |
| 金額入力（外貨） | 記号28/700・数値36/800 `#16211F`・ls-0.5（tnum） | |
| **円換算ヒーロー** | ラベル overline `日本円で` / 値 **48/700 `#16211F`・ls-1.6**（tnum）/ サブ 13/500 `#7E8986` | `typography.display` `PriceResultCard` |
| メモ行 | bg `#F4F6F5`・radius8・ラベル12/700 `#7E8986` | `color.bgScreen` |
| 保存写真サムネ | 40×30・radius8 | |
| 保存先トグル 候補 | bg `#FBF1DE`・border `#F0E6CF`・13/600 `#9A6516` | candidate系 |
| 保存先トグル 購入済 | bg `#fff`・border `#ECEFED`・13/600 `#5B6764`（選択時 teal系） | purchased系 |
| 保存CTA | h52・radius15・bg `#0E9488`・17/700 白・**`shadow.cta`（teal グロー）** | `button.primary` `shadow.cta` |
| 次を撮る | 中央・13/600 `#5B6764` | |

### 使用色
円換算/CTA/価格チップ = **teal**、候補トグル = **amber**、購入済みトグル = **teal**。
ヒーロー数値は `text #16211F`。青は使わない。金額・レートは必ず `tabular-nums`。

## 5. 角丸・影

- カード `radius.card 16`、価格チップ `radius.pill`、入力系 `8`。
- 保存CTAのみ `shadow.cta`（teal色の影）。Android はグローが出ないため elevation 8 ＋ 必要なら下に薄い teal View（共通メモ §2）。

## 6. 主要コンポーネント

- **円換算ヒーローは既存 `PriceResultCard`（domain）を使う**（`jpyAmount/foreignAmount/currency/rate`）。
- 保存CTAは `PrimaryButton`（ui）、上限バナーは `SaveLimitBanner`（domain）、カード器は `SectionCard`（ui）。
- 価格チップ・保存先トグル・OCR結果カードは現状 `index.tsx` 内インライン。`ocr-result-v2-components.md` 参照。

## 7. 既存React Native実装に反映するときの注意

- このカード群は**既に `index.tsx` に実装済み**（`ocrCard` ＋ `inputCard`）。v2は配色・余白・タイポを
  tokens.ts に寄せ、円換算を `PriceResultCard` に統一するのが主作業。**ロジックは触らない**。
- 保存ボタン文言は `saveAsPurchased` で「¥xxx を候補に保存 / 購入済みとして保存」を出し分け（既存挙動）。
- 「保存しないで次を撮る」は入力リセット（`handleResetInput`）または再スキャン（`handleRescan`）に対応。文言を全パネルで統一。
- JPYモード（`base_currency==='JPY'`）では入力モード切替・外貨表示を出さない（既存分岐）。

## 8. 触ってはいけないロジック

- **保存時レート固定**：`handleSaveCandidate` の `currency = activeTrip.base_currency`、
  `rate = JPY?1:activeTrip.manual_rate`、`foreign/jpy` を保存時点で確定（`rate_used`）。
- 保存処理 `insertHistory` / 写真保存先 `documentDirectory/photos/`。
- 価格候補抽出 `utils/extract-prices`（`extractPriceCandidates` / `extractMemoLines`）。
- `FREE_LIMITS.saves=30` と `SaveLimitBanner` の上限判定。
- → 円換算の表示値・候補の中身・保存値の意味は不変。UIのみ変更。

## 9. v1から変えた点

- 円換算ヒーローを **`PriceResultCard`（display 48・tokens.ts）** に統一（v1 numberHero -1.7 → -1.6）。
- 保存CTA文言を「**¥xxx を候補に保存**」に統一（金額を含め、保存先トグルと整合）。
- 副CTAを「**保存しないで次を撮る →**」に統一（v1 CLAUDE.md の確定文言）。
- 保存先トグルの色を candidate=amber / purchased=teal の `statusColor` ペアに固定。
- レートチップ・背景・カードを tokens.ts に統一。
