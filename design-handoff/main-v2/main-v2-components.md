# v2 メイン画面（価格OCR）・ components

`main-v2/` を実装単位に分解。表示は純粋（props）、操作はコールバック。
**新規コンポーネントは乱立させない**。既存 `src/components/ui` / `src/components/domain` / `src/components/camera` を最大限流用する。

## 既存 `src/components/ui/` で使うべき部品

| 部品 | この画面での用途 |
|---|---|
| `EmptyState`（tone=`neutral`） | 旅行未選択時のヘッダー差し替え（「旅行が選択されていません」＋設定導線）。既存実装に存在。 |
| `PrimaryButton` | 撮影前では未使用。保存CTAは `ocr-result-v2` / 手入力カードで使う。 |

## 既存 `src/components/domain/` で使うべき部品

| 部品 | この画面での用途 |
|---|---|
| `SaveLimitBanner` | 撮影前は非表示。保存件数が上限近接（`totalCount >= saves-5`）時に入力カード内で表示（既存挙動）。 |
| （`ActiveTripBanner`） | 本画面の簡易ヘッダーはこれを使わず軽量な `TripRateHeader` を使う。黒ヒーローは履歴側で再利用想定。 |

## 既存 `src/components/camera/` で使うべき部品

| 部品 | この画面での用途 |
|---|---|
| `CameraPreview`（`.native` / `.web`） | カメラ本体。四隅コーナー・ガイド文・ズーム・「読み取る」・OCR・写真キャプチャを内包。**OCR/写真キャプチャの配線は変更しない**。 |

## 新規作成が必要そうな小コンポーネント（最小限）

| 候補 | 役割 | 備考 |
|---|---|---|
| `TripRateHeader` | 旅行名 ＋ レートチップ（primary pill） | 現状 `index.tsx` 内のインライン。共通化するなら domain 候補。OCR成功/失敗/読み取り中/商品写真モードでも再利用。 |
| `ModeSegment` | 価格OCR / 商品写真 のセグメント（選択=白+影） | 現状インライン。`product-camera-v2` と共有。`value:'ocr'|'photo', onChange` |
| `BudgetSummary` | 残り / 今日 / 手入力 の3分割カード | 現状インライン。`remaining, todayCount, onManual` |

> いずれも**既存 `index.tsx` 内に既にインライン実装がある**。v2では「新規ファイルを作る」より、まず**インラインのスタイルを tokens.ts に寄せて更新**するのが安全。共通化（切り出し）は再利用が確定してからで良い。

## props設計の注意

- 表示専用に保つ：レート・残予算・件数は親（hooks）が計算済みの値を渡す。コンポーネント内でDB/レート計算をしない。
- 金額・レートは整形済み文字列 or 数値＋`formatJpy/formatRate`。表示は必ず `tabular-nums`。
- `ModeSegment` の `onChange` は state 更新のみ。**商品写真モードでもOCR配線を壊さない**。

## 独立画面ではなく index.tsx の状態として扱うべき箇所

- **OCR成功**（`ocr-result-v2`）：`ocrResult != null && prices.length > 0`
- **OCR失敗**（`ocr-failed-v2`）：`ocrResult != null && prices.length === 0`
- **読み取り中**（`scanning-v2`）：`CameraPreview` の `scanning` 状態
- **商品写真モード**（`product-camera-v2`）：`captureMode === 'photo'`
- **写真アクションシート**（`photo-action-sheet-v2`）：モーダル／ボトムシートとして内包

→ これらは別ルートを作らない。`src/app/(tabs)/index.tsx` 内の条件分岐／モーダルで表現する。
