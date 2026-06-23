# 商品写真モード ・ components

`main/` と同じ部品を `mode='product'` で再利用。新規部品なし。

| Component | この画面での状態 | 流用元 |
|---|---|---|
| `TripRateHeader` | 同一 | main/ |
| `ModeSegment` | `value='product'`（商品写真=選択） | main/ |
| `CameraStage` | reticle 正方150・暖色プレビュー・ガイド差し替え | main/ |
| `ShutterButton` | `mode='product'`（チャコール「商品を撮る」） | main/ |
| `ProductModeHint` | 「金額はあとで手入力 / 価格OCRで追加できます」中央の補助文（**この画面のみ**・BudgetSummaryと差し替え） | 新規（小） |
| `BottomTabBar` | active=カメラ | 共通 |

## ツリー

```
<MainCameraScreen mode="product">   // app/(tabs)/index.tsx
├─ <TripRateHeader/>
├─ <ModeSegment value="product"/>
├─ <CameraStage mode="product"/>     // flex:1・正方reticle
├─ <ShutterButton mode="product"/>   // 「商品を撮る」チャコール
└─ <ProductModeHint/>                // BudgetSummary の位置に補助文
```

## ポイント

- `main/` と**同一スクリーン**。状態（`mode`）だけが違う。実装は1ファイルで分岐。
- 撮影 → `entryType='product'` → `product-result/`（結果パネル）へ。
