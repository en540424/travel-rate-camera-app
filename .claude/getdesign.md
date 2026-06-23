# 旅レートカメラ デザイン参照メモ

> **旧資料・現行正ではない。** 現行のデザイントークンは `src/theme/tokens.ts`、方針は `.claude/design-sync-v2-plan.md` を正とする。詳細は `AI_CONTEXT.md` を参照。

Claude Code が UI/UX 改善時に参照するデザイン方針・トークン抽出ルールのメモ。
`designTokens.ts` を作る際はこのファイルを起点にすること。

---

## 1. デザイン方針（コンセプト）

### 基本方針
- **白ベース**の清潔感ある画面。背景は白 or 極薄グレー。
- **ミント/ティール系アクセント**を1色に絞る。複数アクセント色は使わない。
- **Apple純正アプリ風の読みやすさ**：余白多め、情報密度を下げる、フォントの太さで階層を作る。
- **Wise / Revolut風の金額・通貨表示**：金額は大きく、通貨コードはコンパクトに添える。
- **家計簿アプリ風の集計カード**：購入済み合計・残り予算・候補合計を1枚のカードにまとめる。
- 有名アプリの丸コピーはしない。参考にするのは「読みやすさの原則」のみ。

### 避けること
- 原色・高彩度カラーの多用
- カード間の余白がゼロのリスト表示
- アイコンのみのボタン（ラベルなし）
- 影が強すぎるカード（浮きすぎる）
- 小さいフォントによる情報詰め込み

---

## 2. カラートークン

```ts
// --- ベース ---
background:          '#FFFFFF'   // メイン背景
backgroundSecondary: '#F7F8FA'   // セクション背景・カード内背景
backgroundTertiary:  '#EEF0F3'   // 入力フィールド背景

// --- アクセント（ミント/ティール）---
accent:              '#3ECFB2'   // プライマリアクション、アクティブバッジ
accentLight:         '#D6F5EF'   // アクセントの薄背景（バッジ背景など）
accentDark:          '#2AA891'   // ホバー・押下時

// --- テキスト ---
textPrimary:         '#1A1A2E'   // 見出し・金額
textSecondary:       '#6B7280'   // サブラベル・メモ・日付
textTertiary:        '#9CA3AF'   // プレースホルダー・無効テキスト
textOnAccent:        '#FFFFFF'   // アクセント背景上のテキスト

// --- ステータス ---
purchased:           '#3ECFB2'   // 購入済み（アクセントと同一）
purchasedBg:         '#D6F5EF'   // 購入済みバッジ背景
candidate:           '#F59E0B'   // 候補（アンバー系）
candidateBg:         '#FEF3C7'   // 候補バッジ背景

// --- 警告・エラー ---
warning:             '#F59E0B'   // 警告
warningBg:           '#FEF3C7'
error:               '#EF4444'   // エラー・削除
errorBg:             '#FEE2E2'

// --- ボーダー・影 ---
border:              '#E5E7EB'   // カード・入力フィールドの境界線
borderFocus:         '#3ECFB2'   // フォーカス時
shadow:              'rgba(0,0,0,0.06)'  // カードの影（やさしめ）
shadowMedium:        'rgba(0,0,0,0.10)'  // 浮かせたいカード
```

### 購入済み / 候補 の色分け方針
| 状態 | テキスト色 | バッジ背景 | 用途 |
|------|-----------|-----------|------|
| 購入済み | `#3ECFB2` (accent) | `#D6F5EF` (accentLight) | 確定した支出。金額はフル表示 |
| 候補 | `#F59E0B` (candidate) | `#FEF3C7` (candidateBg) | 未確定。金額は薄表示（opacity 0.6）|
| 削除 | `#EF4444` (error) | `#FEE2E2` (errorBg) | 削除ボタン・取り消し線 |

---

## 3. タイポグラフィトークン

```ts
// --- 金額表示 ---
amountLarge:   { fontSize: 40, fontWeight: '700', letterSpacing: -1 }  // メイン金額
amountMedium:  { fontSize: 28, fontWeight: '700', letterSpacing: -0.5 }
amountSmall:   { fontSize: 20, fontWeight: '600' }

// --- 通貨コード ---
currencyCode:  { fontSize: 14, fontWeight: '600', letterSpacing: 0.5 } // "USD" "JPY"

// --- 見出し ---
heading1:      { fontSize: 22, fontWeight: '700' }
heading2:      { fontSize: 18, fontWeight: '600' }
heading3:      { fontSize: 15, fontWeight: '600' }

// --- ボディ ---
body:          { fontSize: 15, fontWeight: '400' }
bodySmall:     { fontSize: 13, fontWeight: '400' }

// --- ラベル・メタ ---
label:         { fontSize: 12, fontWeight: '500', letterSpacing: 0.3 }
caption:       { fontSize: 11, fontWeight: '400', color: textSecondary }
```

---

## 4. スペーシング・角丸トークン

```ts
// --- スペーシング ---
spacing: {
  xs:  4,
  sm:  8,
  md:  12,
  lg:  16,
  xl:  24,
  xxl: 32,
  xxxl: 48,
}

// --- 角丸 ---
radius: {
  sm:   8,   // 小さいバッジ・タグ
  md:   12,  // 入力フィールド・小カード
  lg:   16,  // メインカード
  xl:   20,  // ボトムシート・大カード
  full: 9999, // ピル型バッジ・ボタン
}

// --- カード内パディング ---
cardPadding:     16   // 標準カード
cardPaddingLg:   20   // サマリーカード・大きいカード
```

---

## 5. 影トークン

```ts
// やさしい影（浮かせすぎない）
shadowSm: {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.06,
  shadowRadius: 4,
  elevation: 2,
}
shadowMd: {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.10,
  shadowRadius: 8,
  elevation: 4,
}
// ボトムシート・モーダル用
shadowLg: {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: -2 },
  shadowOpacity: 0.08,
  shadowRadius: 12,
  elevation: 8,
}
```

---

## 6. カードUI方針

### 標準履歴カード
- 背景: `#FFFFFF`、角丸: `radius.lg (16)`、影: `shadowSm`
- 左端に縦ライン（購入済み: accent / 候補: candidate）で状態を視覚化
- 外貨金額を大きく（`amountSmall`）、JPY換算をサブで右寄せ
- メモ・日付・レートは `bodySmall` + `textSecondary` でコンパクトに

### サマリー（残り予算）カード
- 背景: `backgroundSecondary`、角丸: `radius.xl (20)`、影: `shadowMd`
- 残り予算を `amountLarge` で中央表示
- プログレスバーは accent 色、高さ 6pt
- 購入済み / 候補 / 予算を3列でグリッド表示

### OCRカード（カメラ画面）
- 背景: `#FFFFFF`、角丸上部: `radius.xl`、下部フラット（スライドアップ型）
- 価格候補ボタンは accent 背景の pill 型
- 全文展開部は `backgroundSecondary` に切り替え

---

## 7. バッジUI方針

```ts
// 購入済みバッジ
{ bg: '#D6F5EF', text: '#2AA891', borderRadius: 9999, px: 8, py: 3, fontSize: 12, fontWeight: '600' }

// 候補バッジ
{ bg: '#FEF3C7', text: '#D97706', borderRadius: 9999, px: 8, py: 3, fontSize: 12, fontWeight: '600' }

// 通貨コードバッジ（例: USD, JPY）
{ bg: '#EEF0F3', text: '#1A1A2E', borderRadius: 8, px: 6, py: 2, fontSize: 12, fontWeight: '600' }
```

---

## 8. 下タブバー方針

- 背景: `#FFFFFF` + 上ボーダー `#E5E7EB`
- アクティブ色: `accent (#3ECFB2)`
- 非アクティブ色: `textTertiary (#9CA3AF)`
- アイコン + ラベル両方表示（アイコンのみ禁止）
- タブ高さ: 64pt + SafeArea分
- アクティブタブにはアイコン下に 3pt の accent ドットを表示（または fill アイコンで区別）

---

## 9. designTokens.ts を作るときのルール

1. このファイルの値をそのまま `designTokens.ts` に写す（ハードコード値の二重管理を避ける）
2. カラーは `as const` で型安全にする
3. `shadowSm` 等の影は Platform.OS でエレベーション分岐を忘れずに
4. 金額表示系フォントは `Platform.select` で iOS: SF Pro / Android: Roboto をデフォルト継承
5. アクセント色を変えるだけで全体テーマが変わる構造にする（将来のブランド変更に備える）

---

## 10. 参考にするアプリのUI原則（コピー禁止）

| アプリ | 参考にする点 |
|--------|------------|
| Wise | 通貨コード + 金額の横並び、レート表示のコンパクトさ |
| Revolut | サマリーカードの情報密度、プログレスバーのシンプルさ |
| Moneytree | 日本語家計簿アプリの色の落ち着き、購入済み/候補の視覚的区別 |
| iOS 標準アプリ（株価・ヘルスケア） | 余白の使い方、グラフの薄さ、フォント階層 |
| Zaim | 日本語ラベルの自然な短さ、カテゴリアイコンの扱い |
