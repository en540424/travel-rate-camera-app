# 結果パネル（商品写真から）・ spec

- **フォルダ**：`product-result/`
- **画面名**：結果パネル（商品写真から）
- **状態**：商品写真スタート・金額手入力（`entryType='product'`）
- **下タブ**：なし（結果シート・PhoneBare）
- **元デザイン**：`メイン画面 最終案 v4`

`ocr-result/` と同一 ResultSheet。Hero位置が「商品写真＋手入力」に差し替わる差分。

## 差分

| 項目 | 値 |
|---|---|
| 上部 | 商品写真サムネ60×60 radius13 ＋「商品写真を保存 / この写真を履歴に残します」＋ 右に「変更」(teal) |
| 金額 | 「金額（手入力）」ラベル ＋ 入力枠 高さ56 radius15 border1.5 `#DCE3E0`・値26/700 等幅 ＋「$ USD」 |
| 換算表示 | teal50カード radius12 padding9/13：「日本円で 約」＋「¥3,792」22/700 `#0A766E` 等幅 |
| OCR追加 | **点線ボタン** border 1px dashed `#CDEAE5`・radius12・teal文字「価格OCRで金額を読み取る」 |
| フッター | BucketToggle（候補/購入済み）＋ 保存ボタン48高「¥3,792 を保存」 |

## 注意
- 商品写真を主役に、金額は手入力。**後から価格OCR追加**（点線ボタン）も可。集約先は成功パネルと同じ。

## RN移植メモ（差分）
- Hero位置に `ProductPhotoBlock`（写真＋手入力＋換算カード＋OCR追加点線ボタン）。
- 点線枠は RN では `borderStyle:'dashed'`（iOSは radius と併用で崩れやすい→ `react-native-svg` の dashed rect で代替可）。
- 換算は手入力金額 × rate のリアルタイム計算。
