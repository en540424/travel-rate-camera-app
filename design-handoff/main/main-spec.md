# メイン画面（価格OCR）・ spec

- **フォルダ**：`main/`
- **画面名**：メイン画面（価格OCRモード）
- **状態**：撮影前・起動時（**必ず価格OCRから**）
- **下タブ active**：カメラ
- **元デザイン**：`メイン画面 最終案 v4`（カメラ詳細 `カメラ画面 最終案 v3`）
- **route**：`app/(tabs)/index.tsx`

---

## 数値仕様

| 項目 | 値 |
|---|---|
| 画面幅（端末内・実機想定） | 390pt 基準（本HTMLのモックは 300px 幅で再現） |
| 背景色 | `#F5F7F6`（appBg） |
| 画面左右 padding | **15** |
| 上 padding | 8 / 下 padding 12 |
| セクション間 gap | **10**（縦 flex gap） |
| ヘッダー旅行名 fontSize | **19** / weight 700 / ls -0.01em |
| レートチップ高さ | padding 5×11、radius 999、border 1px `#ECEFED`、bg `#fff`、fontSize 12/600 |
| モードセグメント 外枠 | bg `#EFF2F0`、radius **12**、padding 3 |
| モードセグメント 各タブ | 高さ **38**、radius 9、選択側 bg `#fff` ＋ `box-shadow:0 1px 3px rgba(16,33,31,0.13)` |
| 選択side文字 | 13.5/700 `#16211F`（アイコン teal600） |
| 非選択side文字 | 13.5/600 `#7E8986` |
| カメラ枠 radius | **22** |
| カメラ枠 背景 | 縞プレースホルダ（実装は `expo-camera` プレビュー） |
| reticle（OCR枠） | 184×108、border 2px rgba(255,255,255,.92)、radius 13、top 42% 中央 |
| ズームバッジ「3×」 | top/right 12、bg rgba(16,33,31,.5)、padding 4×10、radius 999、11/700 |
| ガイド文 | bottom 16、中央、12.5/600 白＋text-shadow |
| シャッター「読み取る」 | 高さ **52**、radius **16**、bg `#0E9488`、文字 16.5/600 白、`box-shadow:0 8px 18px -8px rgba(14,148,136,0.6)`（CTAグロー） |
| 予算サマリー文字 | 11.5/600、残り/今日は値だけ 700 `#16211F`、等幅 |
| 「手入力で記録」 | 12/600 `#0E9488`（右寄せ・サブ導線） |
| 下部固定ボタン | なし（このフェーズはシャッターが主CTA） |

### 使用色
`teal600 #0E9488`（CTA/アイコン）・`ink #16211F`（見出し）・`ink2 #5B6764`（本文）・`ink3 #7E8986/#939E9B`（補助）・`appBg #F5F7F6`・セグメント地 `#EFF2F0`・border `#ECEFED`。

---

## レイアウト構造

```
screen-body (flex column, padding 8/15/12, gap 10)
├─ TripRateHeader   旅行名 ＋ レートチップ（space-between）
├─ ModeSegment      価格OCR(選択) / 商品写真
├─ CameraStage      flex:1（残り全部）・reticle・3×・ガイド
├─ ShutterBar       「読み取る」teal・高さ52
└─ BudgetSummary    残り¥/今日件数 ＋ 手入力で記録（space-between）
```

カメラ枠が `flex:1` で残り高さを占有。シャッターと予算サマリーは固定高で最下部。

---

## 動作・注意

- **起動時は必ず価格OCRモード**（mode の初期値 = `'ocr'`）。
- モード切替は**タップ主体＋横スワイプ補助**。選択側は白＋影で常時明示。
- カメラ枠タップ / 「読み取る」で `scanning` フェーズへ（→ `scanning/`）。
- 「手入力で記録」は常駐サブ導線（OCRを使わず記録）。

---

## RN移植メモ（差分）

- カメラ枠の縞は **`expo-camera` の `CameraView`** に置換。reticle は `View`（border）でオーバーレイ。
- ズームは `CameraView` の `zoom`（0–1）。「3×」表記はUI都合の固定ラベルでも可。
- 横スワイプ切替は枠上に `Gesture.Pan`（react-native-gesture-handler）。**スワイプ単独に依存しない**＝セグメントのタップを必ず残す。
- シャッターの teal グローは Android で出ないため、必要なら下に薄い teal の `View` を敷く（共通メモ §2）。
- この画面は下タブ active=カメラ。`(tabs)/index.tsx` に置く。
- 共通事項は `_common/rn-common-notes.md` 参照。
