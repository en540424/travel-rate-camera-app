# v2 読み取り中（scanning）・ components

`scanning-v2/` は独立画面ではなく、`main-v2` のカメラ枠に重ねるローディング状態。**新規は1つだけ**。

## 既存 `src/components/ui/` で使うべき部品

| 部品 | 用途 |
|---|---|
| （なし） | この状態は ui 部品を必要としない。`ActivityIndicator`（RN標準）で足りる。 |

## 既存 `src/components/domain/` で使うべき部品

| 部品 | 用途 |
|---|---|
| （なし） | サマリー・ヘッダーは `main-v2` の表示をそのまま流用（opacity を下げるだけ）。 |

## 既存 `src/components/camera/` で使うべき部品

| 部品 | 用途 |
|---|---|
| `CameraPreview`（`.native`） | `scanning` state を持つ本体。v2のオーバーレイはこの内部に重ねる。**`handleScan` は変更しない**。 |

## 新規作成が必要そうな小コンポーネント

| 候補 | 役割 | 備考 |
|---|---|---|
| `ScanningOverlay` | カメラ枠に重ねる暗転＋スピナー＋スキャンライン＋コピー | `CameraPreview` 内に閉じてよい。props不要（または `visible`）。 |

## props設計の注意

- `ScanningOverlay` は**表示専用・状態を持たない**。表示/非表示は `CameraPreview` の既存 `scanning` で制御。
- タイマーや疑似進捗を**追加しない**（処理時間は `extractTextFromImage` 実測に依存）。

## 独立画面ではなく index.tsx の状態として扱うべき箇所

- **この状態そのもの**が「独立画面にしない」対象。ルートを追加せず、`CameraPreview` の `scanning` に紐づける。
- 完了後の遷移先（`ocr-result-v2` / `ocr-failed-v2`）も同一 `index.tsx` 内の状態。
