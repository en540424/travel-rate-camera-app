# v2 OCR結果（失敗）・ components

`ocr-failed-v2/` は `index.tsx` の失敗状態。**既存 ui 部品でほぼ組める**。

## 既存 `src/components/ui/` で使うべき部品

| 部品 | この画面での用途 |
|---|---|
| `SectionCard` | 失敗カードの白角丸器。 |
| `EmptyState` | 🔍アイコン＋タイトル＋説明＋主/副アクションの構造に流用可（`icon, title, body, primary, secondary, tone`）。 |
| `PrimaryButton` | 主導線「✎ 手入力で金額を入れる」。 |
| `SecondaryButton` | 副導線「もう一度読み取る」「商品写真を保存」。 |

## 既存 `src/components/domain/` で使うべき部品

| 部品 | この画面での用途 |
|---|---|
| （なし） | 失敗状態自体は domain 部品不要。手入力後の保存で `PriceResultCard` 等が登場（`ocr-result-v2`）。 |

## 新規作成が必要そうな小コンポーネント

| 候補 | 役割 | 備考 |
|---|---|---|
| `OcrRawBlock` | 「読み取った文字（全文）」折りたたみ＋「全文をメモにコピー」 | `ocr-result-v2` と共有可。`raw, onCopy`。 |

> 失敗ブロックは `EmptyState` の `primary`/`secondary` で大半を表現できる。**新規は最小限**に。

## props設計の注意

- `EmptyState` 流用時：`tone='default'`（amberアイコンにしたい場合はアイコンを amber 背景の `View` で渡す）。
- 主CTA `onPress` = 手入力表示（`openManualInput`）。副CTA = 再スキャン／写真追加。
- 全文コピーは最大100文字（既存 `handleCopyRawToMemo` の `slice(0,100)`）。
- **赤（danger）を渡さない**（失敗を責めないトーン）。

## 独立画面ではなく index.tsx の状態として扱うべき箇所

- **この画面全体**が `ocrResult != null && prices.length === 0` の状態。新ルートを作らない。
- 手入力に進むと `ocr-result-v2` の入力カードへ遷移（同一画面内）。
- 「商品写真を保存」は `product-camera-v2`（`captureMode='photo'`）／写真追加フローへ。
