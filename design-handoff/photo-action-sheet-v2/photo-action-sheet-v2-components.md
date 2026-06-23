# v2 写真アクションシート・ components

`photo-action-sheet-v2/` は既存 `PhotoChangeSheet` のビジュアル更新版。土台は `ActionSheet`。

## 既存 `src/components/ui/` で使うべき部品

| 部品 | この画面での用途 |
|---|---|
| `ActionSheet` | ボトムシート土台（`visible, onClose, dimmed, closeOnBackdropPress`）。上端radius22・背面dim・safe-area対応。 |

## 既存 `src/components/domain/` で使うべき部品

| 部品 | この画面での用途 |
|---|---|
| `PhotoChangeSheet` | **これを更新する**（新規作成ではない）。撮る/ライブラリ/削除/キャンセルの行スタイルを踏襲。 |

> `PhotoChangeSheet` / `OcrQuotaSheet` / `SaveLimitSheet` / `ActiveTripSwitchSheet` は domain/index.ts に**未export**で、
> 個別 import されている。**import経路を確認してから**手を入れる。勝手に export 構造を変えない（v2方針）。

## 新規作成が必要そうな小コンポーネント

| 候補 | 役割 | 備考 |
|---|---|---|
| `SheetRow`（任意） | 共通の行ボタン（tone=`primary`/`default`/`danger`/`cancel`） | `PhotoChangeSheet` 内のローカルで十分。乱立させない。 |

## props設計の注意

- 行の出し分けは props で：`hasPhoto`（削除行）、`hasOcrPhoto`（OCR写真行・メイン文脈のみ）。
- 各 `onXxx` は**既存ハンドラを渡すだけ**（取得・削除の実体はシートに持たせない）。
- メイン文脈と編集文脈で必要な行が違う：編集では「OCR写真を使う」を出さない（既存 `PhotoChangeSheet` の設計を尊重）。
- 削除は `onClose()` → 既存の削除確認 `Alert` → 実削除、の順を維持。

## 独立画面ではなく index.tsx の状態として扱うべき箇所

- **これはボトムシート**（モーダル）。ルートを追加せず、親（`index.tsx` / 編集画面）に内包。
- メイン画面の「変更」「＋商品写真を追加」「OCR写真に変更」を、このシート1つに集約するのが狙い。
