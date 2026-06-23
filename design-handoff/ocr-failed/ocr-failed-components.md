# OCR結果（失敗）・ components

`ResultSheet` を再利用し、中身（Hero位置）を差し替える。

| Component | この画面での状態 | 流用元 |
|---|---|---|
| `ResultSheet` | 同一（peek＋白シート＋固定フッター） | ocr-result/ |
| `CapturedThumbRow` | 「読み取り結果」＋✕ | ocr-result/ |
| `OcrFailedNotice` | アンバー警告ブロック「金額を読み取れませんでした」（**この画面のみ**） | 新規 |
| `ManualAmountBlock` | 金額手入力欄（フォーカス枠teal・$ USD） | product-result/ と共用 |
| `MemoPicker` | メモ候補 | ocr-result/ |
| `ResultFooter` | 2ボタン版（撮り直す＋手入力で記録） | ocr-result/（派生） |

## ツリー
```
<ResultSheet entryType="ocr" ocrStatus="failed">
  <ScrollArea>
    <CapturedThumbRow title="読み取り結果"/>
    <OcrFailedNotice/>
    <ManualAmountBlock/>     // Heroの位置
    <MemoPicker/>
  </ScrollArea>
  <ResultFooter variant="retryOrManual"/>
</ResultSheet>
```

## ポイント
- `ConvertedHero` → `OcrFailedNotice` ＋ `ManualAmountBlock` に同じ位置で入れ替え。
- フッターは保存トグルを出さず「撮り直す / 手入力で記録」の2択。
