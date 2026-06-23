# メイン画面（価格OCR）・ components

`main/` 画面を実装単位に分解。各コンポーネントは表示は純粋（props）・操作はコールバック。

| Component | 役割 | 見た目 | 主なprops | 再利用先 |
|---|---|---|---|---|
| `TripRateHeader` | 上部の旅行名＋レートチップ | 旅行名 19/700 ＋ 右に🇺🇸 1ドル ¥158.00 の白pill（border） | `tripName, currency, rate` | 商品写真モード/読み取り中/結果パネル上部 |
| `ModeSegment` | 価格OCR / 商品写真の切替 | 角丸セグメント、選択側=白＋影、アイコン＋ラベル | `value:'ocr'\|'product', onChange, disabled?` | product-camera / scanning（半透明 disabled） |
| `CameraStage` | カメラプレビュー＋ガイド | 角丸22の枠、reticle、3×バッジ、ガイド文 | `mode, zoom?, onShutter` | product-camera（reticle正方）/ scanning（暗転＋ライン） |
| `ShutterButton` | 撮影/読み取りCTA | 高さ52・teal・CTAグロー。文言はモードで変化 | `mode, onPress` | product-camera（チャコール「商品を撮る」） |
| `BudgetSummary` | 残予算と今日の件数の小サマリー | 11.5/600の1行、値だけ強調、右に手入力導線 | `remaining, todayCount, onManual` | カレンダー（残予算表示） |
| `BottomTabBar` | 下タブ（6項目） | カメラ/換算/履歴/カレンダー/分析/設定。activeはteal | `active` | 全タブ画面（**(tabs) で単一の正**） |

## ツリー

```
<MainCameraScreen>            // app/(tabs)/index.tsx ・ active=カメラ
├─ <TripRateHeader/>
├─ <ModeSegment value="ocr"/>
├─ <CameraStage mode="ocr"/>  // flex:1
├─ <ShutterButton mode="ocr"/> // 「読み取る」
└─ <BudgetSummary/>
// 下タブは (tabs)/_layout.tsx 側
```

## 状態の出し分け（同一画面内）

- `mode='ocr'`（既定）→ シャッター「読み取る」teal / reticle横長 / ガイド「値札・メニューの金額を枠に」
- `mode='product'` → `product-camera/` 参照（シャッター「商品を撮る」チャコール / reticle正方）
- シャッター押下 → `scanning/`

## 流用元

- `ModeSegment`・`ShutterButton`・`CameraStage` は `メイン画面 最終案 v4` の撮影前2モードが出典。
- `BottomTabBar` は `Phone` モックの共通フッター。
