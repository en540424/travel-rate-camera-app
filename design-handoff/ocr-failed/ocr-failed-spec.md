# OCR結果（失敗）・ spec

- **フォルダ**：`ocr-failed/`
- **画面名**：OCR結果（失敗）
- **状態**：OCR失敗 → 手入力（`entryType='ocr' / ocrStatus='failed'`）
- **下タブ**：なし（結果シート・PhoneBare）
- **元デザイン**：`メイン画面 最終案 v4`

`ocr-result/` と**同一の ResultSheet**。Hero部分が手入力ブロックに差し替わる差分のみ。

## 差分

| 項目 | 値 |
|---|---|
| ヘッダー行 | サムネ32 ＋「読み取り結果」＋ ✕（撮り直すリンクは無し） |
| 警告ブロック | bg `#FBF6EC`・border 1px `#F0E6CF`・radius 16・padding 16・中央。丸アイコン42（bg `#FBF1DE` / icon `#B5731A`）＋「金額を読み取れませんでした」14.5/700 ＋ 補足12/500 |
| 手入力欄 | ラベル「金額を手入力」11/600。入力枠 高さ58・radius15・**フォーカス枠 border 1.5px `#0E9488`**・値 28/700 `#B7BFBC`(placeholder) 等幅・右に「$ USD」14/600 |
| メモ | 「メモ」＋「＋ BBQ BEEF」候補チップ |
| フッター | 2ボタン横並び：**撮り直す**（白枠・幅110・48高）＋ **手入力で記録**（teal・flex1・48高・グロー） |

## 注意
- 失敗で**行き止まりにしない**：手入力 / 撮り直す / 商品写真化に必ず進める。
- パネル構造（peek＋白シート＋固定フッター）は `ocr-result/` と同一。

## RN移植メモ（差分）
- `HeroSlot` で `ocrStatus==='failed'` のとき `ManualAmountBlock` を Hero の位置に描画（`ocr-result.rn.tsx` の `ConvertedHero` 差し替え）。
- 入力は `TextInput keyboardType="decimal-pad"`。フォーカスで border を `teal600` に。
- フッターは `ResultFooter` を**2ボタン構成**に切替（保存系トグルは出さない）。
