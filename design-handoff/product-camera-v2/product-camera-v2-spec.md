# v2 商品写真モード・ spec

- **フォルダ**：`product-camera-v2/`
- **画面名**：商品写真モード（撮影前・補助）
- **状態**：`src/app/(tabs)/index.tsx` の `captureMode === 'photo'`（独立画面ではない）
- **下タブ active**：カメラ
- **正トークン**：`src/theme/tokens.ts`

---

## 1. 画面の目的

価格OCRではなく、**履歴で見返すための商品写真を保存する**ための補助モード。
「このモードは金額を読み取らない」ことを誤解なく伝え、撮った写真を `pendingPhotoUri` として保存フローに渡す。

## 2. 状態の説明

- `captureMode` が `'photo'` のときのメイン画面。`'ocr'` は `main-v2`。
- このモードは**補助**。視覚的に価格OCR（teal CTA）より強く見せない＝シャッターは**チャコール＋弱い影**。
- 起動時は必ず `'ocr'`。本モードはユーザーがセグメントをタップして入る。

## 3. レイアウト構造

```
screen (main-v2 と同骨格)
├─ TripRateHeader
├─ ModeSegment        商品写真=選択（白+影）
├─ PurposeBanner      amber淡バナー「…商品写真を撮るモードです。金額の読み取りはしません。」
├─ CameraStage        flex:1・正方ガイド(150²)・ガイド文・チャコール「商品を撮る」
└─ LibraryRow         「写真ライブラリから選ぶ」サブ導線（中央）
```

## 4. 数値仕様（tokens.ts 準拠）

| 項目 | 値 | トークン |
|---|---|---|
| 目的バナー | bg `#FDFAF3` / border 1 `#F0E6CF` / radius 12 / pad 10×12 / 文字 12・500 `#9A6516`（ls 太字700） | `candidateSoft2` `candidateBorder` `candidateText` |
| 正方フレーミングガイド | 150×150・border 2 `rgba(255,255,255,0.9)`・radius 14 | |
| ガイド文 | bottom 74・12/600 白 | |
| シャッター「商品を撮る」 | min幅140・h44・radius16・bg **`#36443F`（チャコール）**・15/700 白・弱い影（0 4 5 / op0.4） | `color.productShutter` |
| ライブラリ導線 | 中央・13/700 `#5B6764` | `color.body` |
| その他骨格 | `main-v2` と同一（ヘッダー/セグメント/カメラ枠） | |

### `#36443F`（チャコール）について
- **`src/theme/tokens.ts` の正式トークン `color.productShutter`**（`'#36443F'`）。v1 `design-tokens.md` の `productShutter #36443F` 由来。dark hero 系の並びに定義。
- 価格OCR（`color.primary #0E9488`）と区別しつつ、純黒・強い浮き影にはしない（補助モードの抑制表現）。
- 実装では `import { color } from '@/theme/tokens'` の `color.productShutter` を参照する（screen-local の直書きにしない）。

### 使用色
`candidate系`（目的バナー amber）・`productShutter #36443F`（シャッター）・`primarySoft/primaryDark`（ヘッダーチップ）・`body #5B6764`（ライブラリ導線）。青は使わない。teal CTA はこのモードでは使わない。

## 5. 角丸・影

- カメラ枠/バナー `radius.card 16` / `radius.chip 12`。
- シャッターは**弱い影**（`shadow.card` より少し強い程度、`shadow.cta` は使わない）。teal グローは価格OCR専用。

## 6. 主要コンポーネント

`product-camera-v2-components.md` 参照。`ModeSegment` は `main-v2` と共有。新規は `PurposeBanner` と
`ProductCameraStage`（チャコールシャッター差分）程度。

## 7. 既存React Native実装に反映するときの注意

- **現状の実装ギャップ（重要）**：`src/app/(tabs)/index.tsx` では `captureMode` の state はあるが、
  商品写真は `handleTakeProductPhoto`（`ImagePicker.launchCameraAsync`）/ `handlePickPhotoFromLibrary`
  （`launchImageLibraryAsync`）→ `setPendingPhotoUri` の経路で取得している。
  v2のフルなカメラ内シャッターUIは**ビジュアルの目標**。実装を寄せる場合も、**最終的に
  `pendingPhotoUri` にURIをセットする配線と保存ロジックは変えない**こと。
- まず安全に実現するなら、**バナー＋セグメント＋シャッター文言/色の更新**から着手し、
  撮影手段（ImagePicker か CameraPreview 直結か）は別タスクで判断する。
- 「商品を撮る」も「ライブラリから選ぶ」も、結果は `pendingPhotoUri` → `handleSaveCandidate` の写真保存に乗る。

## 8. 触ってはいけないロジック

- 写真キャプチャ → `pendingPhotoUri` の流れ（`handlePhotoCapture` / `handleTakeProductPhoto` / `handlePickPhotoFromLibrary`）。
- 写真保存処理・保存先 `documentDirectory/photos/`（`handleSaveCandidate`）。
- 保存時レート固定（このモードから保存しても `currency=base_currency` / `rate=manual_rate`）。
- OCR配線（`captureMode` 切替で OCR コールバックを壊さない）。
- → 本画面はUIのみ。撮影手段の取得経路と保存値は不変。

## 9. v1から変えた点

- 目的バナーの色を tokens.ts の **candidate（amber）系**に固定（注意・補助の意味づけを状態色ルールに統一）。
- シャッターのチャコールを `#36443F` で維持し、**`src/theme/tokens.ts` の正式トークン `color.productShutter` として追加**（screen-local の一時値から昇格）。
- レート表記・背景色・カメラ枠 radius を `main-v2` と統一（tokens.ts 準拠）。
- 「ライブラリから選ぶ」を**常設サブ導線**として下部に明示（v1では写真シート内のみ想定だった導線を表に出した）。
