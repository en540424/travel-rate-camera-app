# 旅レートカメラ Design Sync / v2 方針

> このドキュメントは、Claude Design / Claude Code / Cursor / Codex に渡す今後の作業前提を固定するためのもの。
> v2ハンドオフ作成と React Native 実装時のズレを減らすことを目的とする。
> 内容を変更する場合は、必ず実装（`src/theme/tokens.ts` 等）との整合を確認してから更新すること。

---

## 1. v1の位置づけ

- `design-handoff-v1-before-sync` は、Section A〜D までの**旧ハンドオフ資料**。
- **破棄しない**。
- 用途：比較材料・画面一覧・文言（コピー）・`*-spec.md`・`*-components.md` の**たたき台**として使う。
- v1 の `.rn.tsx` は**直接移植しない**（既存共通コンポーネントを前提にしていないため、レイアウト参考に留める）。
- v1 の `_common/design-tokens.md` は実装と**一部ドリフト**があるため、v2では**正にしない**。
  - 既知のドリフト例：candidate dot（md `#E0992E` / 実装 `#E0A53B`）、画面背景（md `appBg #F5F7F6` / 実装 `bgScreen #F4F6F5`）、raised影の値、`tealScan` が実装トークンに未定義。

---

## 2. v2の正（source of truth）

- v2で正とするデザイントークンは **`src/theme/tokens.ts`**。
- `src/constants/designTokens.ts`（`DT`）は**段階移行中の旧トークン**として扱う（メイン画面・タブが現状まだ参照しているが、正ではない）。
- 色は **teal / amber を中心**にする。
- **青は使わない**。
- 金額表示は **tabular-nums**（`fontVariant: ['tabular-nums']`）を使う。
- **候補は amber、購入済みは teal**（`statusColor` のペア運用）。
- Pro の gold は**識別・バッジ用途が中心**で、**主CTAには使わない**（CTAは primary=teal）。
- 商品写真モードのシャッター（チャコール）は `src/theme/tokens.ts` の正式トークン **`color.productShutter`（`#36443F`）** を使う（screen-local の直書きにしない）。価格OCRの teal CTA と区別し、純黒は使わない。

---

## 3. v2初期スコープ

最初にv2で作るのは、**メイン画面のコア導線のみ**。

### 対象

- メイン画面・撮影前
- 商品写真モード
- OCR成功状態
- OCR失敗状態
- 写真アクションシート
- 読み取り中状態

### 注意

- **OCR成功 / OCR失敗 / 読み取り中は独立画面ではなく**、`src/app/(tabs)/index.tsx` の**状態バリエーション**として扱う。
- **写真アクションシートは既存 `PhotoChangeSheet` のビジュアル更新**として扱う（新規作成ではない）。
- **保存完了は現状、独立画面ではない**ため、v2初期スコープでは**新規画面を導入しない**。
- `save-complete`（v1）は**参考資料扱い**にする。

---

## 4. 既存共通UIの前提（`src/components/ui/`）

v2では、既存の共通UIを前提にする。**新規コンポーネントを乱立させず、既存UIを活かして設計する**。

- `PrimaryButton`
- `SecondaryButton`
- `GhostButton`
- `SectionCard`
- `FixedFooter`
- `FormInput`
- `ErrorMessage`
- `EmptyState`
- `ActionSheet`
- `SettingRow`
- `SettingSection`

---

## 5. 既存ドメインUIの前提（`src/components/domain/`）

v2では、既存のドメインUIを前提にする。

- `PriceResultCard`
- `RateInfoRow`
- `ConversionSummaryCard`
- `ActiveTripBanner`
- `SaveLimitBanner`
- `ItemCard`（`CandidateItemCard` / `PurchasedItemCard`）
- `TripListItem`
- `StatCard`
- `ProFeatureBadge`
- `ActiveTripSwitchSheet`
- `PhotoChangeSheet`
- `SaveLimitSheet`

（`OcrQuotaSheet`は2026-07-22にコードから削除済みのため一覧から除外）

注意：

- 未export のシート類（`ActiveTripSwitchSheet` / `PhotoChangeSheet` / `SaveLimitSheet`）は、**既存の import 経路を確認してから扱う**。
- **勝手に import 構造を変えない**。

---

## 6. 絶対に触ってはいけない重要ロジック

以下は UI改善・v2実装時に**変更しない**。

- DBスキーマ
- migration
- OCR処理
- 価格候補抽出処理
- 保存処理
- `addEntry` / `insertHistory` の保存時レート固定
- 写真保存処理
- 写真保存先
- 旅行切替ロジック
- 下タブ構成
- `FREE_LIMITS`
- RevenueCat未接続の前提
- Pro導線の価格取得仕様

### 特に守る

- 保存時の `currency` は **`activeTrip.base_currency` 基準**。
- 保存時の `rate` は **`activeTrip.manual_rate` 基準**。
- 保存済み履歴は**後からレート変動で再計算しない**。
- **下タブを二重化しない**（カメラ / 換算 / 履歴 / カレンダー / 分析 / 設定 の6タブ構成を固定）。
- **`FREE_LIMITS.saves = 30` を変えない**。

---

## 7. Claude Designへ渡す時の注意

Claude Design に v2 を依頼するときは、以下を必ず伝える。

- `src/theme/tokens.ts` を正とする。
- v1 の `design-tokens.md` は正にしない。
- v1 の `.rn.tsx` は直接移植しない。
- 既存共通UI / ドメインUIを前提にする。
- 対象はメイン画面の状態バリエーション。
- 保存完了の独立画面はまだ作らない。
- Pro / 履歴 / カレンダー / 分析 / 設定は今回対象外。

---

## 8. 実装時の進め方

React Native 側へ反映するときは、**一括実装しない**。

順番：

1. メイン画面の撮影前UI
2. 商品写真モード
3. OCR成功カード
4. OCR失敗カード
5. 写真アクションシート
6. 読み取り中状態
7. 実機スクショ比較
8. lint / tsc 確認
9. Codex で危険箇所レビュー

---

## 9. 今後の判断

- v2メイン導線の**再現性が高ければ**、その方式で**履歴・商品詳細・旅行作成・設定へ横展開**する。
- v2でも**ズレが大きい場合**は、Claude Design 側でのハンドオフ資料の作成方法を見直す。
