# v2 写真アクションシート・ spec

- **フォルダ**：`photo-action-sheet-v2/`
- **画面名**：写真アクションシート（保存写真の取得／変更）
- **状態**：**独立画面ではなくボトムシート**。親は `src/app/(tabs)/index.tsx`（保存写真行から起動）
- **下タブ active**：カメラ（親画面に従う）
- **正トークン**：`src/theme/tokens.ts`
- **既存対応**：`src/components/domain/PhotoChangeSheet` の**ビジュアル更新版**

---

## 1. 画面の目的

履歴で見返すための「保存する写真」を、撮影／ライブラリ／OCR写真流用／削除から設定する。
危険操作（削除）は danger 表現で明確に区別する。

## 2. 状態の説明

- `ActionSheet`（ui）を土台にしたボトムシート。背面 dim、上端 radius22。
- 行の出し分け：
  - **OCR撮影した写真を使う** … メイン画面で OCR 撮影済み（`ocrPhotoUri != null`）のときのみ表示。
  - **写真を削除** … 既に保存写真がある（`hasPhoto`）ときのみ表示（danger）。
- ⚠️ 既存の `PhotoChangeSheet` は**編集文脈用**で「OCR写真を使う」を意図的に持たない。本v2はメイン画面文脈で
  OCR写真スワップ（既存 `handleUseOcrPhoto`）を1行に統合する想定。**用途の違いに注意**。

## 3. レイアウト構造

```
ActionSheet（背面 dim rgba(17,32,30,0.4)・上端 radius22・shadow.sheet）
└─ sheet (paddingTop16 / H18 / Bottom insets+大きめ, gap10)
    ├─ grabber（38×5 pill）
    ├─ タイトル「保存する写真」＋ サブ「履歴で見返す写真を設定します」
    ├─ 商品写真を撮る        （teal淡・主導線）
    ├─ 写真ライブラリから選ぶ （白＋枠）
    ├─ OCR撮影した写真を使う  （白＋枠・条件表示）
    ├─ 写真を削除            （danger・条件表示）
    └─ キャンセル            （白＋枠・muted字）
```

## 4. 数値仕様（tokens.ts 準拠）

| 項目 | 値 | トークン |
|---|---|---|
| シート背景 | 白・上端 radius22・`shadow.sheet`（上向き影） | `card` `radius.sheet` `shadow.sheet` |
| 背面 dim | `rgba(17,32,30,0.4)` | `ActionSheet` 既定 |
| グラバー | 38×5・radius999・`#E2E7E4` | |
| タイトル | 17/700 `#16211F`・中央 | `typography.title` |
| サブ | 13/500 `#7E8986`・中央 | `color.muted` |
| 行（共通） | radius16・border1.5 `#ECEFED`・白・pad縦15・15/700 中央 | `radius.card` `color.line` |
| 撮る（主導線） | bg `#E7F5F2`・border `#D7EDE7`・字 `#0A766E` | `primarySoft` `primaryBorder` `primaryDark` |
| 削除（danger） | bg `#FBF3F1`・border `#F0D9D4`・字 `#C2543F` | `dangerSoft` `dangerBorder` `danger` |
| キャンセル | border `#DCE3E0`・字 `#5B6764`・marginTop2 | `inputBorder` `body` |

### 使用色
主導線＝teal淡、削除＝danger、その他＝白＋ニュートラル枠。青は使わない。

## 5. 角丸・影

- シート上端 `radius.sheet 22`、行 `radius.card 16`。
- シートの影は `shadow.sheet`（上向き・iOS）。Android は elevation。背面 dim は `ActionSheet` が担う。

## 6. 主要コンポーネント

- 土台は既存 `ActionSheet`（ui）。`photo-action-sheet-v2-components.md` 参照。
- 行は `PhotoChangeSheet` の行スタイルを踏襲（rowPrimary / rowDanger / rowCancel）。

## 7. 既存React Native実装に反映するときの注意

- **既存 `PhotoChangeSheet`（domain・未export）を更新**する形にする。`index.ts` 経由ではなく
  個別 import されている可能性があるため、**import経路を確認してから**変更する（v2方針）。勝手に export 構造を変えない。
- メイン画面では現状、写真選択を `Alert.alert`（`showPhotoPickerSheet`）で出し、OCR写真スワップは
  インライン（`handleUseOcrPhoto`）。v2は**これらを1つのボトムシートに統合**するのが狙い。ただし
  各アクションの中身（`launchCameraAsync` / `launchImageLibraryAsync` / `setPendingPhotoUri` / 削除）は変えない。
- 削除確認（`Alert`「写真を削除しますか？」）は既存挙動を維持。シートの「写真を削除」→ 確認 → 実削除の順。

## 8. 触ってはいけないロジック

- 写真取得 → `pendingPhotoUri` セットの経路（`handleTakeProductPhoto` / `handlePickPhotoFromLibrary` / `handleUseOcrPhoto`）。
- 写真保存処理・保存先 `documentDirectory/photos/`（保存は `handleSaveCandidate` 側）。
- 削除時に金額・メモは残す（写真のみ削除）既存挙動。
- → シートはUIの統合・配色更新のみ。各アクションのハンドラ実体は不変。

## 9. v1から変えた点

- v1 `photo-action-sheet` の行構成に「**OCR撮影した写真を使う**」を明示追加（メイン画面文脈）。
- 削除を **danger（`dangerSoft`/`danger`）** で明確化。撮る＝teal淡で主導線化。
- 既存 `PhotoChangeSheet`（編集文脈・OCR行なし）との**用途差**を spec に明記し、import経路の保護を強調。
- グラバー＋タイトル＋サブの定型に整理し、`ActionSheet`（ui）土台に統一。
