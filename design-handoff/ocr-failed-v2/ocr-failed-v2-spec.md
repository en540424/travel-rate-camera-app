# v2 OCR結果（失敗）・ spec

- **フォルダ**：`ocr-failed-v2/`
- **画面名**：OCR結果（失敗・価格候補なし）
- **状態**：**独立画面ではなく** `src/app/(tabs)/index.tsx` の状態（`ocrResult != null && prices.length === 0`）
- **下タブ active**：カメラ
- **正トークン**：`src/theme/tokens.ts`

---

## 1. 画面の目的

OCRが金額を取れなかったときに、**ユーザーを行き止まりにしない**。
責めない文言で状況を伝え、「手入力」を主導線に、やり直し・商品写真保存・全文メモ化を添える。

## 2. 状態の説明

- `ocrResult` は存在するが価格候補が0件（`extractPriceCandidates` の結果が空）。
- 全文（`ocrResult.raw`）は取れていることが多いので、**メモに転用できる**導線を残す。
- 主導線＝手入力（`手入力で記録` と同じ `showManualInput` 経路）。押すと入力カード（`ocr-result-v2` の入力カード）が出る。

## 3. レイアウト構造

```
ScrollView (padding 15, gap 12)
├─ TripRateHeader
└─ OCR結果カード（失敗）
    ├─ ヘッダー「読み取り結果」＋ ✕
    ├─ EmptyState風：🔍アイコン(amber淡) ＋「金額を読み取れませんでした」＋ 説明
    ├─ 主CTA（teal）「✎ 手入力で金額を入れる」
    ├─ 副CTA 2分割：「もう一度読み取る」「商品写真を保存」（SecondaryButton）
    └─ 全文ブロック：「▼ 読み取った文字（全文）」＋ 本文 ＋「全文をメモにコピー」
```

## 4. 数値仕様（tokens.ts 準拠）

| 項目 | 値 | トークン |
|---|---|---|
| カード | 白・border1 `#ECEFED`・radius16・pad16・gap14・`shadow.card` | `card.base` |
| アイコン枠 | 56×56・radius18・bg `#FBF1DE`（amber淡）・絵文字24 | `candidateSoft` / `emptyState.iconWrap`相当 |
| タイトル | 16/700 `#16211F`・中央 | `typography`系 |
| 説明文 | 12.5/500・lh19・`#7E8986`・中央・max幅230 | `color.muted` |
| 主CTA | h52・radius15・bg `#0E9488`・16/700 白・`shadow.cta` | `button.primary` `shadow.cta` |
| 副CTA（2つ） | h48・radius15・白・border1.5 `#DCE3E0`・14/700 `#16211F` | `button.secondary` `inputBorder` |
| 全文ブロック | 上border `#EEF1F0`・トグル12/600 `#7E8986`・本文12/500 `#5B6764` | `color.line2` |
| 「全文をメモにコピー」 | border1 `#0E9488`・radius8・12/600 teal | |

### 使用色
失敗アイコンは **amber 淡（candidateSoft）**＝「注意/未確定」。主導線は **teal CTA**＝前向きな次の一手。
赤（danger）は使わない（失敗を“エラー”として責めない）。青も使わない。

## 5. 角丸・影

- カード `radius.card 16`、ボタン `radius.button 15`、コピー枠 `8`、アイコン枠 `18`。
- 主CTAのみ `shadow.cta`。副CTAは影なし（白＋枠）。

## 6. 主要コンポーネント

- 失敗ブロックは `EmptyState`（ui）の構造に近い（icon/title/body/primary/secondary）。流用 or 同等で。
- 主CTA＝`PrimaryButton`、副CTA＝`SecondaryButton`。`ocr-failed-v2-components.md` 参照。

## 7. 既存React Native実装に反映するときの注意

- 現状 `index.tsx` では `prices.length === 0` のとき「認識できませんでした」と小さく出すのみ。
  v2は**この失敗を独立した見せ場**（カード）に格上げするが、状態判定（`prices.length===0`）と
  全文表示・メモコピー（`handleCopyRawToMemo`）は既存ロジックを使う。
- 「手入力で金額を入れる」＝`openManualInput`（`showManualInput=true`）→ 入力カードを表示してスクロール（既存）。
- 「もう一度読み取る」＝`handleRescan`、「商品写真を保存」＝`handleAddPhoto`/`captureMode='photo'` へ。
- 文言は不安にさせない（“失敗”“エラー”を主見出しにしない。「読み取れませんでした」止め）。

## 8. 触ってはいけないロジック

- 価格候補抽出 `utils/extract-prices`（`extractPriceCandidates` が空＝この状態のトリガ。判定は変えない）。
- OCR処理 `CameraPreview.handleScan`、全文 `ocrResult.raw` の取得。
- 手入力後に保存する場合も**保存時レート固定**（`currency=base_currency` / `rate=manual_rate`）。
- → 本状態はUIのみ。失敗判定・全文・保存値は不変。

## 9. v1から変えた点

- 失敗を独立画面（v1 `ocr-failed`）ではなく **`index.tsx` の状態**として扱うことを明文化。
- 失敗アイコンを **amber淡**にし、**赤（danger）を使わない**方針を明確化（責めないUI）。
- 主導線を「手入力」に固定し、副導線を「もう一度読み取る／商品写真を保存」の2分割に整理。
- 「全文をメモにコピー」を失敗時の標準導線として残した（`handleCopyRawToMemo` に対応）。
