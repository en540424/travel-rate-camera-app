# OCR結果（成功）・ spec

- **フォルダ**：`ocr-result/`
- **画面名**：OCR結果（成功）/ 結果パネル
- **状態**：OCR成功・1画面完結（`phase='result' / entryType='ocr' / ocrStatus='success'`）
- **下タブ**：なし（カメラ上のボトムシートとして表示・PhoneBareフレーム）
- **元デザイン**：`メイン画面 最終案 v4`
- **route**：`app/(tabs)/index.tsx` 内のシート（`@gorhom/bottom-sheet` 推奨）

---

## 数値仕様

| 項目 | 値 |
|---|---|
| 画面上部 camera peek | 高さ 40・縞＋`rgba(16,33,31,0.5)` |
| 結果シート | bg `#fff`・上端 radius **24**・`margin-top:-18`でpeekに重ねる・`box-shadow:0 -10px 30px rgba(16,33,31,0.2)` |
| ハンドル | 38×5・radius 999・`#E0E5E2`・中央 |
| シート内 padding | 左右 **15**・上 9 |
| ConvertedHero 円 | **48**/700・ls -0.035em・等幅（`¥788`） |
| 外貨（右） | 16/700 ＋ ラベル 10.5/600 `#939E9B`（`$4.99` / 会員価格） |
| 残予算pill | bg `#E7F5F2`・radius 999・padding 5×12・文字 `#0A766E`（ラベル11/600・値13/700等幅） |
| CandidateChips | 3列 flex gap6・各 radius 12・padding 7×5。**選択** border 2px `#0E9488` ＋ bg `#E7F5F2`／非選択 border 1.5px `#E7EBE9`。金額14/700・外貨9.5/600 |
| MemoPicker | ラベル「メモ」11/600 ＋ チップ群（選択=teal塗り白字／候補=`#F5F7F6`／自由入力=白枠）。pill padding 5×9 |
| SavePhotoRow | bg `#F5F7F6`・radius 13・padding 10/11/11。見出し「履歴に残す写真」11.5/700 ＋ 補足9/500。サムネ44×44 radius10 ＋ 左下「値札」タグ（黒pill 7.5/700）。**「商品写真を撮る」=teal塗り 38高**（独立ボタン）／「他から」=白枠 |
| OCR全文 | 「OCR全文を見る」11.5/600 ＋ シェブロン（折りたたみ） |
| **ResultFooter（固定）** | 上線 `#EEF1F0`・padding 9/15/13・bg `#fff` |
| BucketToggle | セグメント radius11 padding3。**候補=選択時 bg `#FBF1DE` 文字 `#B5731A`**／購入済み=未選択 `#7E8986`。各高32 |
| 保存ボタン | 高さ **52**・radius 15・teal・CTAグロー・「¥788 を候補に保存」16/600 等幅 |
| 保存せず次へ | 「保存せず次の商品へ →」13/600 `#7E8986`・高さ22 |

---

## レイアウト構造（ScrollView ＋ 固定フッター）

```
PhoneBare（暗背景）
└─ camera peek(40) ＋ 結果シート(白・上端24・-18で重ね)
   ├─ ハンドル
   ├─ ScrollArea（padding 0/15・スクロール）
   │   ├─ CapturedThumbRow（サムネ＋読み取り完了＋撮り直す＋✕）
   │   ├─ ConvertedHero（¥788 ＋ $4.99/会員価格）
   │   ├─ RemainingBudgetPill（保存後の残り予算）
   │   ├─ CandidateChips（3候補・選択切替）
   │   ├─ MemoPicker（メモ候補＋自由入力）
   │   ├─ SavePhotoRow（履歴に残す写真・商品写真を撮る/他から）
   │   └─ OcrFullDisclosure（OCR全文を見る）
   └─ ResultFooter（固定）
       ├─ BucketToggle（候補/購入済み）
       ├─ 保存ボタン（¥788 を候補に保存）
       └─ 保存せず次の商品へ →
```

---

## 動作・注意

- OCR後はカメラを**小サムネに退避**し、円換算が最も目立つ。
- **保存系3要素（候補/購入済み・保存・次へ）はフッター固定**。スクロールの奥に入れない（`paddingBottom:132`）。
- `CandidateChips` の選択で Hero / 残予算 / 保存ボタンの金額が**即再計算**。
- 保存ボタン文言は `bucket` ＋ 金額から動的生成（「¥788 を候補に保存」/「¥788 を購入済みに」）。
- 「商品写真を撮る」は「他から」より**一段強く**（teal塗り・独立ボタン）。

## RN移植メモ（差分）

- シートは `@gorhom/bottom-sheet`（スナップ1段・約88%）。背面 dim `rgba(16,33,31,0.42)`。
- フッターは絶対配置＋`insets.bottom`（共通メモ §3）。手入力時のみキーボードで持ち上げ。
- BucketToggle の選択色は**候補=amber / 購入済み=teal**（statusColor を参照）。
- 「OCR全文を見る」は折りたたみ（`Collapsible` 等）。
