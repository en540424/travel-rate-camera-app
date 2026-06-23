# 読み取り中 ・ spec

- **フォルダ**：`scanning/`
- **画面名**：読み取り中
- **状態**：スキャン中（`phase='scanning'`）
- **下タブ active**：カメラ
- **元デザイン**：`メイン画面 最終案 v4`

`main/` と同一画面のフェーズ違い。**差分のみ**。

## 差分

| 項目 | 値 |
|---|---|
| ModeSegment | `opacity:0.55`・操作不可（高さ34に縮小） |
| カメラ枠オーバーレイ | 全面 `rgba(16,33,31,0.36)` で暗転 |
| reticle | 184×108・border 2px rgba(255,255,255,**0.55**)・中央 |
| スキャンライン | 左右 8% inset・高さ 2px・`linear-gradient(90deg,transparent,#34D8C6,transparent)`・glow `0 0 12px 2px rgba(52,216,198,0.6)`・`scanmove 1.8s ease-in-out infinite`（top 16%↔74%） |
| 状態pill | 下16中央・`rgba(16,33,31,0.6)`・padding 8×15・radius 999・スピナー＋「読み取り中…」12.5/600 白 |
| 下部ボタン | 無効：bg `#EEF1F0`・文字 `#A6AEAB` 16/600・「金額とメモを認識中…」 |

## RN移植メモ（差分）

- スキャンラインは `Animated.View` の `translateY` ループ（`Animated.loop` + `useNativeDriver:true`）。`scanmove` の top% は枠高に対する translateY に変換。
- 状態pill のスピナーは `ActivityIndicator`（color白）でも可。
- OCR完了で `phase='result'`、`ocrStatus` により `ocr-result/` か `ocr-failed/` へ。
- 認識中は ModeSegment / シャッターを `disabled`。
