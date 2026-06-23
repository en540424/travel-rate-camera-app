# v2 読み取り中（scanning）・ spec

- **フォルダ**：`scanning-v2/`
- **画面名**：読み取り中（OCR処理中）
- **状態**：**独立画面ではなく** `src/app/(tabs)/index.tsx` のローディング状態
- **下タブ active**：カメラ
- **正トークン**：`src/theme/tokens.ts`

---

## 1. 画面の目的

「読み取る」押下後、撮影〜OCR完了までの**短い待ち時間に安心感を与える**ための状態表示。
「固まった？」と思わせず、処理中であることと、もうすぐ結果が出ることを伝える。

## 2. 状態の説明

- 実体は既存 `components/camera/CameraPreview` の `scanning`（`useState`）が `true` の間。
- フロー：`mode='ocr'` → 「読み取る」→ **scanning（本状態）** → OCR完了で `ocr-result-v2` か `ocr-failed-v2`。
- ヘッダー・セグメント・下部サマリーは**表示を維持**し、操作系だけ抑制（半透明・無効）。
- 実装容易性を優先し、**カメラ枠の上にオーバーレイを1枚重ねるだけ**の単純構成にする。

## 3. レイアウト構造

```
（main-v2 と同じ骨格。CameraStage の中身だけ差し替え）
├─ TripRateHeader   そのまま表示
├─ ModeSegment      opacity 0.5・操作不可
├─ CameraStage      暗転(#1B2422)＋薄い縞 → ScanningOverlay
│    └─ scanLine(teal) ＋ spinner ＋「読み取り中…」＋ 補助文
└─ BudgetSummary    opacity 0.7・手入力リンクは faint2 で非活性見せ
```

## 4. 数値仕様（tokens.ts 準拠）

| 項目 | 値 | トークン |
|---|---|---|
| カメラ暗転背景 | `#1B2422`（dark 近似のオーバーレイ `rgba(27,36,34,0.82)`） | `color.dark #11201E` 系 |
| スキャンライン | 高さ2・色 `#7FD8CC`・glow（blur 6〜12, op 0.7） | `color.primaryAccent` |
| スピナー | 30×30・白・border 3 | `ActivityIndicator color="#fff"` |
| メイン文 | 14/700 白「読み取り中…」 | |
| 補助文 | 11.5/500 `rgba(255,255,255,0.6)` | |
| セグメント | opacity 0.5（操作不可） | |
| サマリー | opacity 0.7・手入力リンク `#A6AEAB`（非活性） | `color.faint2` |

### 使用色
`primaryAccent #7FD8CC`（スキャンライン）・`dark #11201E`（暗面）・白／半透明白（テキスト）。青は使わない。

## 5. 角丸・影

- カメラ枠 `radius.card 16` を維持。オーバーレイは枠内クリップ（`overflow:hidden`）。
- スキャンラインの glow は iOS `shadow*`、Android は elevation で色が出ないため**省略可**（必須ではない）。

## 6. 主要コンポーネント

- 新規は `ScanningOverlay`（`CameraStage` に重ねる薄いオーバーレイ）のみ。`scanning-v2-components.md` 参照。
- 既存 `CameraPreview` の `scanning` 状態と差し替えるだけで、別コンポーネントツリーを作らない。

## 7. 既存React Native実装に反映するときの注意

- 現状は `CameraPreview.native.tsx` で `scanning` 中、シャッターが `ActivityIndicator` になるだけ。
  v2では**カメラ全面のオーバーレイ**に格上げするが、`handleScan` の処理本体は触らない。
- `scanning` の開始/終了は `handleScan` の `try/finally` で既に管理されている。**state追加・タイマー追加は不要**。
- アニメーション（スキャンライン移動）は任意。最小実装は静止ラインでも可（実装容易性優先）。

## 8. 触ってはいけないロジック

- OCR処理：`CameraPreview.handleScan`（`takePictureAsync` → `expo-text-extractor` の `extractTextFromImage`）。
- 写真キャプチャ：`onPhotoCapture(photo.uri)` の呼び出し順（OCR前に写真URIを親へ渡す）。
- 価格候補抽出：`utils/extract-prices`（結果は `ocr-result-v2` / `ocr-failed-v2` 側で扱う）。
- → 本状態は**表示のみ**。処理・state管理は現状維持。

## 9. v1から変えた点

- v1 `scanning` は独立フォルダだったが、v2では**独立画面化しない**方針を明文化（`index.tsx` の状態）。
- スキャンライン色を tokens.ts の **`primaryAccent #7FD8CC`** に固定（v1 md の `tealScan #34D8C6` は tokens 未定義のため不採用）。
- 暗転＋スピナー＋2行コピーの**最小構成**に整理し、実装容易性を優先。
