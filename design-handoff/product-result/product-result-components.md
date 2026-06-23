# 結果パネル（商品写真から）・ components

| Component | この画面での状態 | 流用元 |
|---|---|---|
| `ResultSheet` | 同一 | ocr-result/ |
| `ProductPhotoBlock` | 写真サムネ60＋手入力＋換算カード＋OCR追加点線ボタン（**この画面のHero位置**） | 新規 |
| `ManualAmountBlock` | 金額手入力 | ocr-failed/ と共用 |
| `AddOcrButton` | 点線「価格OCRで金額を読み取る」 | 新規（小） |
| `ResultFooter` | BucketToggle＋保存 | ocr-result/ |

## ツリー
```
<ResultSheet entryType="product">
  <ScrollArea>
    <ProductPhotoBlock>      // Heroの位置
      <PhotoThumb size={60}/> 「商品写真を保存」 変更
      <ManualAmountBlock/>
      <ConvertedRow jpy={3792}/>   // teal50カード
      <AddOcrButton/>              // 点線
    </ProductPhotoBlock>
  </ScrollArea>
  <ResultFooter bucket="candidate" amountJpy={3792}/>
</ResultSheet>
```

## ポイント
- OCR成功/失敗/商品写真の**3入口を同じ ResultSheet に集約**。Hero位置のブロックだけ差し替える。
- `ResultFooter` は `ocr-result/` と完全共通。
