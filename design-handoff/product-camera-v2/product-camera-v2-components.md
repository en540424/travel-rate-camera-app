# v2 商品写真モード・ components

`product-camera-v2/` は `main-v2` と同骨格の補助モード。差分コンポーネントのみ新規。

## 既存 `src/components/ui/` で使うべき部品

| 部品 | 用途 |
|---|---|
| （`ErrorMessage` の見た目を参考） | 目的バナーは `ErrorMessage`（amber枠）と同系統の見た目。流用 or 同等スタイルで作る。 |

## 既存 `src/components/domain/` で使うべき部品

| 部品 | 用途 |
|---|---|
| （なし・直接は使わない） | 撮った写真は入力カード（`ocr-result-v2` の保存写真行）→ `handleSaveCandidate` に乗る。 |

## 既存 `src/components/camera/` で使うべき部品

| 部品 | 用途 |
|---|---|
| `CameraPreview` | カメラ表示を流用する場合。ただし現状の商品写真取得は `ImagePicker` 経由（spec §7）。配線は変えない。 |

## 新規作成が必要そうな小コンポーネント

| 候補 | 役割 | 備考 |
|---|---|---|
| `ModeSegment`（共有） | `main-v2` と同一。`value='photo'` で選択状態 | 新規というより共有。 |
| `PurposeBanner` | 「金額の読み取りはしません」目的バナー（amber淡） | `ErrorMessage` 流用でも可。文言固定。 |
| `ProductShutter` | チャコール「商品を撮る」ボタン | `color.productShutter`（tokens.ts）を使う。teal CTA と区別。 |

## props設計の注意

- `PurposeBanner` は文言固定の表示専用。
- `ProductShutter` の `onPress` は**写真取得トリガのみ**。OCRは呼ばない。取得後は `pendingPhotoUri` に渡す既存経路へ。
- チャコール色 `#36443F` は **`src/theme/tokens.ts` の `color.productShutter`** として定義済み。直書きせず `color.productShutter` を参照する。

## 独立画面ではなく index.tsx の状態として扱うべき箇所

- **本モード全体**が `captureMode === 'photo'` の状態。ルートを追加しない。
- 価格OCR ⇄ 商品写真の切替は `ModeSegment` のタップ（横スワイプは補助）。**OCR配線を壊さない**。
