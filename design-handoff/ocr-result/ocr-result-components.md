# OCR結果（成功）・ components

結果パネル（ResultSheet）の分解。OCR成功/失敗/商品写真スタートは**同じ ResultSheet** で出し分ける（中身だけ差し替え）。

| Component | 役割 | 見た目 | 主なprops | 再利用先 |
|---|---|---|---|---|
| `ResultSheet` | 結果パネルの器（peek＋白シート＋ハンドル） | 上端radius24・上向き影・ScrollArea＋固定Footer | `entryType, ocrStatus, children` | ocr-failed / product-result |
| `CapturedThumbRow` | 撮影サムネ＋撮り直す＋閉じる | サムネ32・「読み取り完了」・撮り直す（teal）・✕ | `thumbUri, onRetake, onClose` | ocr-failed / product-result |
| `ConvertedHero` | 円換算の主役表示 | ¥788(48/700) ＋ 右に $4.99/会員価格 | `jpy, foreign, currency, label?` | 設定/Pro（PriceHero流用） |
| `RemainingBudgetPill` | 保存後の残予算 | teal50 pill・`¥55,344` | `amount` | save-complete / カレンダー |
| `CandidateChips` | 複数候補の選択 | 3列・選択=teal枠+teal50 | `items, selectedId, onSelect` | （メイン専用） |
| `MemoPicker` | メモ候補トグル＋自由入力 | pill群・選択=teal塗り | `options, selected, onToggle, onFree` | item-edit |
| `SavePhotoRow` | 保存写真の概念＋アクション | F5F7F6カード・サムネ＋値札タグ・「商品写真を撮る」teal独立＋「他から」 | `source, thumbUri, onShootProduct, onOpenSheet` | product-result / item-detail |
| `OcrFullDisclosure` | OCR全文の折りたたみ | 「OCR全文を見る」＋シェブロン | `text, open, onToggle` | （メイン専用） |
| `ResultFooter` | 固定フッター | 上線＋白地。Toggle＋保存＋次へ | `bucket, amountJpy, onBucketChange, onSave, onSkipNext` | ocr-failed / product-result |
| `BucketToggle` | 候補/購入済み切替 | セグメント・候補=amber/購入済み=teal | `value, onChange` | item-detail/編集 |
| `PrimarySaveButton` | 保存CTA | 高さ52・teal・グロー・動的文言 | `label, onPress` | 共通 |
| `SkipNextLink` | 保存せず次へ | 文字リンク＋→ | `onPress` | （メイン専用） |

## ツリー

```
<ResultSheet entryType="ocr" ocrStatus="success">
  <ScrollArea>
    <CapturedThumbRow/>
    <ConvertedHero jpy={788} foreign={4.99} currency="$" label="会員価格"/>
    <RemainingBudgetPill amount={55344}/>
    <CandidateChips/>
    <MemoPicker/>
    <SavePhotoRow source="ocr"/>
    <OcrFullDisclosure/>
  </ScrollArea>
  <ResultFooter bucket="candidate" amountJpy={788}/>
</ResultSheet>
```

## 差し替えポイント

- `ConvertedHero` は **成功＝換算ヒーロー**、失敗＝`ManualAmountBlock`、商品写真＝`ProductPhotoBlock` に同じ位置で入れ替わる。
- `ResultFooter` は全ケース共通（保存系3要素）。
