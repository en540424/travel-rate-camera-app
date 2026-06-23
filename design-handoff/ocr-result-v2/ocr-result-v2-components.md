# v2 OCR結果（成功）・ components

`ocr-result-v2/` は保存フローの中心。**既存 domain/ui 部品を最大限流用**し、新規は最小限に。

## 既存 `src/components/ui/` で使うべき部品

| 部品 | この画面での用途 |
|---|---|
| `SectionCard` | OCR結果カード／入力カードの白角丸器。 |
| `PrimaryButton` | 保存CTA「¥xxx を候補に保存 / 購入済みとして保存」。`loading/disabled` 対応済み。 |
| `SecondaryButton` | 「もう一度読み取る」を出す場合（既存 index.tsx にあり）。 |
| `FormInput` | メモ入力を共通化する場合（現状はインライン TextInput）。`suffix/error` 対応。 |

## 既存 `src/components/domain/` で使うべき部品

| 部品 | この画面での用途 |
|---|---|
| `PriceResultCard` | **円換算ヒーロー（主役）**。`jpyAmount, foreignAmount, currency, rate, label='日本円で'`。light variant。 |
| `SaveLimitBanner` | 保存件数が上限近接（`totalCount >= FREE_LIMITS.saves-5`）かつ非Pro時のみ。`currentCount, isPro`。 |
| `RateInfoRow` | レート確認行を別出しする場合。`PriceResultCard` のサブ行で足りるなら不要。 |

## 新規作成が必要そうな小コンポーネント

| 候補 | 役割 | 備考 |
|---|---|---|
| `OcrResultCard` | 価格候補チップ＋メモ候補＋全文折りたたみ | 現状 `index.tsx` インライン。切り出すなら domain 候補。 |
| `PriceCandidateChip` | teal チップ（単一=大ボタン/複数=pill、選択=primaryDark） | 表示専用＋`onPress`。 |
| `SaveTargetToggle` | 候補(amber)/購入済み(teal) の2択 | `value, onChange`。`statusColor` を使う。 |
| `SavePhotoRow` | サムネ＋変更/削除＋OCR写真スワップ | `imageUri, onChange, onDelete, ocrPhotoUri?`。 |

## props設計の注意

- **円換算は計算済みの数値を渡すだけ**。`PriceResultCard` 内でレート計算しない（保存時レート固定の整合）。
- `SaveTargetToggle` の `value` は `'candidate' | 'purchased'`。保存時に `isPurchased` へマップ（既存 `saveAsPurchased`）。
- 価格チップの `onPress` は金額を入力欄へ反映するだけ（`handlePickPrice`）。OCRカードは閉じない（既存仕様）。
- メモ追記は最大100文字（既存 `slice(0,100)`）。

## 独立画面ではなく index.tsx の状態として扱うべき箇所

- **この画面全体**が `index.tsx` の `ocrResult != null && prices.length>0` 状態。新ルートを作らない。
- 保存成功で入力リセット → `main-v2`（撮影前）へ戻る。**保存完了の独立画面は作らない**（haptics＋リセットの既存挙動）。
- 写真変更は `photo-action-sheet-v2`（モーダル）を内包。
