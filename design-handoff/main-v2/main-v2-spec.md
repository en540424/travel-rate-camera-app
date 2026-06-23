# v2 メイン画面（価格OCR）・ spec

- **フォルダ**：`main-v2/`
- **画面名**：メイン画面（価格OCRモード）・撮影前
- **状態**：撮影前・起動時（**必ず価格OCRから**）
- **下タブ active**：カメラ
- **route**：`src/app/(tabs)/index.tsx`（既存を部分修正で寄せる。全面書き換えしない）
- **正トークン**：`src/theme/tokens.ts`（v1 `_common/design-tokens.md` は正にしない）

---

## 1. 画面の目的

旅行中、値札やメニューにカメラを向けて**金額をその場で円換算・記録**するアプリの主役画面。
撮影前は「カメラを主役」にし、入力カード等は出さない。起動直後は迷わず価格OCRが使える状態にする。

## 2. 状態の説明

- これは**撮影前の単一状態**。OCR成功／失敗／読み取り中は同じ `index.tsx` の別状態として
  `ocr-result-v2` / `ocr-failed-v2` / `scanning-v2` を参照（独立画面にしない）。
- `captureMode` 初期値は `'ocr'`（価格OCR）。`'photo'`（商品写真）は `product-camera-v2`。
- 旅行未選択時は本ヘッダーの代わりに `EmptyState`（tone=neutral）を出す（既存実装どおり）。

## 3. レイアウト構造

```
screen (flex column, paddingH 15, paddingTop insets.top+8, paddingBottom 12, gap 14)
├─ TripRateHeader   旅行名(left, flex) ＋ レートチップ(right, primarySoft pill)  space-between
├─ ModeSegment      価格OCR(選択=白+影) / 商品写真           track=line2
├─ CameraStage      flex:1（残り全部）・四隅コーナー・3×・ガイド・読み取るCTA
└─ BudgetSummary    残り¥ | 今日件数 | 手入力で記録          白カード3分割
```

カメラ枠が `flex:1` で残り高さを占有。ヘッダー・セグメント・サマリーは固定高。

## 4. 数値仕様（tokens.ts 準拠）

| 項目 | 値 | トークン |
|---|---|---|
| 画面背景 | `#F4F6F5` | `color.bgScreen` |
| 画面左右 padding | 15 | `spacing.lg` |
| セクション間 gap | 14 | （`spacing.md`〜`lg`相当） |
| 旅行名 | 20 / 700 / ls -0.3 | （`typography.h2`系の拡大） |
| レートチップ | bg `#E7F5F2` / fg `#0A766E` / 13・700 / pad 6×12 / radius 999 | `color.primarySoft` `primaryDark` `radius.pill` |
| モードセグメント track | bg `#EEF1F0` / radius 12 / padding 3 | `color.line2` `radius.chip` |
| セグメント 選択側 | bg `#fff` ＋ `shadow.card`（0 1 2 / 0.04〜0.13）/ 14・700 `#16211F` | `color.card` `shadow.card` |
| セグメント 非選択 | 14・600 `#7E8986` | `color.muted` |
| カメラ枠 radius | 16 | `radius.card` |
| ビューファインダー四隅 | 28×28・border 3px `rgba(255,255,255,0.85)` | （CameraPreview 実装と一致） |
| ズームバッジ | top/right 14・bg `rgba(16,33,31,0.52)`・pad 6×12・radius 14・14/700 白 | |
| ガイド文 | 中央・12/600・`rgba(255,255,255,0.55)`・ls 0.4 | |
| 読み取るCTA | min幅120・h40・radius20・`rgba(14,148,136,0.92)`・14/700 白（カメラ内下部中央） | `color.primary` |
| BudgetSummary カード | 白・border 1 `#ECEFED`・radius 12・pad縦10・`shadow.card`・3分割（縦線 `#ECEFED`） | `color.card` `color.line` |
| サマリー ラベル/値 | 10.5/600 `#7E8986` ／ 15/700 `#16211F`（tabular-nums） | `color.muted` `color.text` |
| 手入力で記録 | 13/700 `#0E9488` | `color.primary` |

### 使用色（teal/amber中心・青不可）
`primary #0E9488`（CTA/アイコン/手入力リンク）・`primaryDark #0A766E`・`primarySoft #E7F5F2`・
`text #16211F`・`body #5B6764`・`muted #7E8986`・`bgScreen #F4F6F5`・`card #FFFFFF`・
`line #ECEFED`・`line2 #EEF1F0`。**candidate/amber はこの画面では未使用**（保存先トグルで初出）。

## 5. 角丸・影

- 角丸：カメラ枠/サマリー `radius.card 16`、チップ/セグメント `radius.pill / chip`。
- 影：セグメント選択側・サマリーカードは `shadow.card`（薄）。読み取るCTAの teal グローは
  OCR結果カードの保存ボタン（`ocr-result-v2`）で `shadow.cta` を使う。撮影前のカメラ内シャッターは控えめ。

## 6. 主要コンポーネント

`main-v2-components.md` 参照。新規は最小限（`ModeSegment` / `CameraStage` ラッパ / `BudgetSummary`）に留め、
カメラ本体は既存 `components/camera/CameraPreview`、空状態は既存 `EmptyState` を使う。

## 7. 既存React Native実装に反映するときの注意

- **既存 `src/app/(tabs)/index.tsx` を部分修正で寄せる**。撮影前は `showInputCard=false` の分岐＝
  「カメラ＋ヘッダー＋セグメント＋下部サマリー」だけを表示する現構造を維持し、見た目だけ更新する。
- レートチップのタップ＝`cycleCurrency`（旅行が外貨のとき通貨巡回）、JPYモードは「🇯🇵 JPY 国内」表示の既存挙動を保持。
- カメラは `CameraPreview`（`expo-camera`）。四隅コーナー・ガイド文・ズーム（`zoom` 0–1）は既存実装に存在。
- 横スワイプ切替を足す場合も**セグメントのタップを必ず残す**（スワイプ単独に依存しない）。
- SafeArea：上は `insets.top`、下タブは `(tabs)/_layout.tsx` が正。**画面内に独自タブを足さない**。

## 8. 触ってはいけないロジック（この画面で関係するもの）

- 保存時の `currency = activeTrip.base_currency` / `rate = JPY?1:activeTrip.manual_rate`（保存時レート固定）。
- 写真保存先 `documentDirectory/photos/`（`handleSaveCandidate`）。
- 旅行切替（`setActiveTrip`）・下タブ6構成・`FREE_LIMITS`（saves=30）。
- OCR処理（`CameraPreview.handleScan` / `extractTextFromImage`）・価格候補抽出（`utils/extract-prices`）。
- → 本画面はUIのみ変更。上記の引数・保存値・呼び出し関係は不変。

## 9. v1から変えた点

- 背景を `#F5F7F6`(v1) → **`#F4F6F5`（tokens.ts `bgScreen`）** に統一。
- レートチップを白border pill(v1) → **`primarySoft` pill（teal系）** にし、状態色の2系統ルールに寄せた。
- レート表記を「1ドル ¥158.00」→ **「1 USD = ¥158.00」**（`formatRate` と同形）。
- 下部サマリーを1行テキスト(v1) → **白カードの3分割（残り/今日/手入力）** にし、既存 `index.tsx` の実装に一致させた。
- カメラ枠 radius を 22(v1) → **16（`radius.card`）**、reticle長方形 → **四隅コーナー**（既存 `CameraPreview` の実装に合わせた）。
