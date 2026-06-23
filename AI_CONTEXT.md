# AI_CONTEXT — 旅レートカメラ AI運用索引

このファイルは**索引**です。制約の内容そのものをここに複製せず、どの文書が正かだけを示します。
内容を確認したいときは、必ずリンク先の原本を読んでください。

## 最初に読むべき文書（この順）

1. `design/旅レートカメラ_実装引き継ぎ資料.md` — 最上位仕様（MVP範囲・Pro範囲・全画面仕様・designTokens・実装順序）
2. `.claude/design-sync-v2-plan.md` — 現行デザイン移行方針（v2トークン移行・触ってはいけないロジック一覧・ロールアウト計画）
3. このファイルの「絶対に勝手に触らないもの」「作業前に確認すること」

## 領域別の正本

| 領域 | 正となる文書 |
|---|---|
| 最上位仕様（MVP/Pro/全画面） | `design/旅レートカメラ_実装引き継ぎ資料.md` |
| 現行デザイン移行方針 | `.claude/design-sync-v2-plan.md` |
| DB保護 | `.claude/agents/db-guardian.md` |
| リリース判断 | `.claude/agents/release-reviewer.md` |
| 実機QA | `TEST_CHECKLIST.md` |
| 現行デザイントークン（実コード） | `src/theme/tokens.ts` |
| 無料版上限・Pro回数（実コード） | `src/config/limits.ts`（`FREE_LIMITS.saves = 30` を含む） |

## 旧資料として扱うもの（現行の正ではない）

- `.claude/getdesign.md` — 旧デザイン覚書。配色が現行 `src/theme/tokens.ts` と一致しない
- `.claude/design-references/token-comparison.md` — 旧トークン（`src/constants/designTokens.ts` / DT）を基準にした比較表
- `src/constants/designTokens.ts`（DT） — `design-sync-v2-plan.md` と `src/theme/tokens.ts` のヘッダーコメントの両方で「段階移行中の旧トークン」と明記されている
- `design-handoff-v1-before-sync/` 一式（独自の `CLAUDE.md` を含む） — v2同期前のv1スナップショット。比較材料として保持されており、廃止物ではないが現行の正でもない

## 絶対に勝手に触らないもの

実装変更時は、変更前に必ず以下に該当しないか確認すること。詳細・根拠は各リンク先を参照。

- DBスキーマ／migration（`.claude/agents/db-guardian.md`）
- OCR処理・価格候補抽出処理
- 保存処理、保存時レート固定（`activeTrip.manual_rate` / `activeTrip.base_currency`）
- 写真の保存処理・保存先
- 旅行切り替えロジック
- 固定の下タブ構成（`(tabs)` 単一構成）
- `FREE_LIMITS.saves = 30`（`src/config/limits.ts`）
- RevenueCat 未接続という前提（Pro購入処理は未実装）
- `design-handoff-v1-before-sync/` の内容（削除・上書き禁止、比較材料として保持）

（一覧の根拠・詳細は `.claude/design-sync-v2-plan.md` §6、`.claude/agents/db-guardian.md`、`.claude/agents/release-reviewer.md`、`design/旅レートカメラ_実装引き継ぎ資料.md` §10/§12 を参照）

## 作業前に確認すること

1. 今回の変更が上記「絶対に勝手に触らないもの」に該当しないか
2. 該当する場合は、対応する正本（db-guardian.md / release-reviewer.md / design-sync-v2-plan.md）の判定手順に従う
3. デザイン変更は `src/theme/tokens.ts` を正として行い、`getdesign.md` や旧 `designTokens.ts`（DT）を基準にしない
4. 無料版の上限・回数を変更しない（変更が必要な場合は `src/config/limits.ts` の数値変更が必要であることを明示し、承認を得る）

## 作業後に報告すること

1. 変更したファイル一覧
2. 各変更の理由
3. 「絶対に勝手に触らないもの」に抵触していないことの確認結果
4. 実行したコマンド・テスト結果（型チェック等）
5. git操作を行った場合はその内容（行っていない場合は「git操作なし」と明記）
