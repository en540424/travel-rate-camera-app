# 保存写真の変更シート ・ components

| Component | 役割 | 見た目 | props | 再利用先 |
|---|---|---|---|---|
| `ActionSheet` | 背面dim＋下シートの器 | radius20・上向き影・dim背面 | `visible, onClose, title, subtitle, children` | 削除確認/上限/OCRシートでも流用 |
| `ActionSheetHeader` | 中央見出し＋補足 | 14/700＋11.5/500・下線 | `title, subtitle` | 共通 |
| `ActionRowPrimary` | 強調アクション行 | bg `#F4FBF9`・teal塗りアイコン枠34 | `icon, label, sub, onPress` | （写真撮影など主導線） |
| `ActionRow` | 通常アクション行 | アイコン枠30＋ラベル14.5/600（右にcheck可） | `icon, label, checked?, tone?, onPress` | 各シート |
| `CancelCard` | キャンセル | 別カード・50高 | `onPress` | 共通 |

## ツリー
```
<ActionSheet title="保存する写真" subtitle="値札と商品写真は別でもOK">
  <ActionRowPrimary icon="camera" label="商品写真を撮る" sub="履歴で見返しやすい写真に"/>
  <ActionRow icon="image" label="写真ライブラリから選ぶ"/>
  <ActionRow icon="scan"  label="OCR写真を使う" checked/>
  <ActionRow icon="trash" label="写真を削除" tone="danger"/>
</ActionSheet>
<CancelCard/>
```

## ポイント
- `ActionSheet` / `ActionRow` は **削除確認・保存上限・OCR利用前** など他シートでも使う共通部品。
- 最上部だけ `ActionRowPrimary`（teal地）で導線の強弱を付ける。
