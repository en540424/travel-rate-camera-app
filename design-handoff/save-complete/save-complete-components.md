# 保存完了 ・ components

| Component | 役割 | 見た目 | props | 再利用先 |
|---|---|---|---|---|
| `SuccessBadge` | 完了の丸チェック | 外円72(teal50)＋内円50(teal塗り) | `tone?` | purchase-complete/ |
| `SavedItemCard` | 保存した商品の確認カード | サムネ52＋金額22＋状態バッジ | `item` | item-detail（簡易） |
| `RemainingBudgetCard` | 残予算の行カード | F5F7F6・「残り予算」＋値 | `amount` | カレンダー/分析 |
| `SavedActions` | 履歴を見る / 続けて撮影 | 2ボタン（白枠＋teal） | `onHistory, onContinue` | （保存完了専用） |

## ツリー
```
<SavedConfirm phase="saved" bucket="candidate">
  <SuccessBadge/>
  <Title>候補に保存しました</Title>
  <Sub>ハワイ旅行 ・ 買い物候補</Sub>
  <SavedItemCard item={...}/>
  <RemainingBudgetCard amount={55344}/>
  <SavedActions onContinue={resetToCapture}/>
</SavedConfirm>
```

## ポイント
- 見出し・状態バッジは `bucket` に追従（候補=amber「候補に保存しました」/ 購入済み=teal）。
- `SuccessBadge` は `purchase-complete/` でも流用（そちらはゴールド星を1点添える）。
