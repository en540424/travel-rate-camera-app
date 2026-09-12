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
| 実機QA | `TEST_CHECKLIST.md`（確認順の優先度は同ファイル「確認順の優先度（P0先行）」。項目番号は不変） |
| App Store提出文言・App Privacy・ASC入力値・スクショ設計 | Vault `AI-Workflow-System/07_project-kits/tabirate-camera/旅レートカメラ_AppStore提出パッケージ_2026-09-12.md`（**2026-09-12新設・コピペ可能な確定版**。旧`…提出文書セット_2026-09-11.md`／`_2026-07-07.md`はsuperseded） |
| repo側の技術設定（`app.json`／`eas.json`／credentials／環境変数／icon・splash・権限・production前提） | `RELEASE_PREP.md` |
| 現行デザイントークン（実コード） | `src/theme/tokens.ts` |
| 無料版上限・Pro回数（実コード） | `src/config/limits.ts`（現行値は `trips = 1` / `saves = 10`。2026-08-28のFree/Pro設計再整理でsavesを30→10へ変更済み。2026-09-11に`design/旅レートカメラ_実装引き継ぎ資料.md`・`.claude/design-sync-v2-plan.md`・`design-handoff/`各資料の記載も10へ整合済み。**数値は必ず`src/config/limits.ts`を正とする**）。**scope（2026-09-11 Human確定）：`saves`は「1つの旅行につき10件」（旅行ごと。端末全体ではない。判定は`getHistoryCountForTrip`）、`trips`は「同時に管理できる旅行1件」（非アーカイブ数で判定。アーカイブ後の新規作成・復元は同じ境界）。UI文言もこの表現へ整合済み** |
| Pro購入・復元・課金設定（実コード） | `src/config/revenuecat.ts`・`src/config/feature-flags.ts`（実装済み・`SHOW_PRO = true`。外部ダッシュボード設定はVault `旅レートカメラ_RevenueCat・AppStoreConnect課金設定メモ.md`。**ただし同メモの価格欄は旧価格（¥480/¥3,800）。確定価格は月額¥500／年額¥4,000で、正本はVault提出パッケージ2026-09-12 §C-4**） |
| 多言語OCR・翻訳・テキスト入力（中核構想） | Vault `AI-Workflow-System/07_project-kits/tabirate-camera/旅レートカメラ_多言語OCR・翻訳・テキスト入力_中核構想設計書_v1.md`（2026-07-22決定済み構想。2026-08-14時点：Apple TranslationをRelease正式経路へ接続済み。Release build実証・iOS16.4〜17.x weak-link実証は未実施。オンデバイス方式が第一候補、無料/Pro境界は未決定。詳細な現在地は`.claude/mvp-tasks.md`の該当節を参照） |
| KRW/JPY価格OCR改善（実コード） | `src/utils/extract-prices.ts`・`src/utils/extract-prices.test.mjs`。2026-08-15時点：**条件付き合格・Release候補として採用**（`.claude/mvp-tasks.md`の該当節を参照。OCR完全解決・100%認識という位置づけではない） |

## 旧資料として扱うもの（現行の正ではない）

- `.claude/getdesign.md` — 旧デザイン覚書。配色が現行 `src/theme/tokens.ts` と一致しない
- `.claude/design-references/token-comparison.md` — 旧トークン（`src/constants/designTokens.ts` / DT）を基準にした比較表
- `src/constants/designTokens.ts`（DT） — `design-sync-v2-plan.md` と `src/theme/tokens.ts` のヘッダーコメントの両方で「段階移行中の旧トークン」と明記されている
- `design-handoff-v1-before-sync/` 一式（独自の `CLAUDE.md` を含む） — v2同期前のv1スナップショット。比較材料として保持されており、廃止物ではないが現行の正でもない
- Vault `旅レートカメラ_AppStore提出文書セット_2026-09-11.md` / `_2026-07-07.md` — **どちらもsuperseded（2026-09-12）**。09-11版は説明文・キーワード・スクショを07-07版へ委譲した差分文書で、その07-07版は「純無料・課金なし・Pro露出ゼロ・保存30件」という**現在と逆の前提**。提出には必ず `旅レートカメラ_AppStore提出パッケージ_2026-09-12.md` を使う
- Vault `旅レートカメラ_RevenueCat・AppStoreConnect課金設定メモ.md` の**価格欄のみ旧価格**（¥480/¥3,800）。設定手順としては有効だが、**価格は提出パッケージ§C-4（月額¥500／年額¥4,000）が正**

## 絶対に勝手に触らないもの

実装変更時は、変更前に必ず以下に該当しないか確認すること。詳細・根拠は各リンク先を参照。

- DBスキーマ／migration（`.claude/agents/db-guardian.md`）
- OCR処理・価格候補抽出処理
- 保存処理、保存時レート固定（`activeTrip.manual_rate` / `activeTrip.base_currency`）
- 写真の保存処理・保存先
- 旅行切り替えロジック
- 固定の下タブ構成（`(tabs)` 単一構成）
- `FREE_LIMITS`（`trips = 1` / `saves = 10`、`src/config/limits.ts`）の数値そのもの、および保存上限のscope（旅行ごと＝`getHistoryCountForTrip`で数える。2026-09-11 Human確定）
- RevenueCat購入・復元・Entitlement判定（`SHOW_PRO = true`、`src/config/feature-flags.ts`）は実装済み。Entitlement ID／Offering ID／Product ID（`src/config/revenuecat.ts`）・購入/復元フローを動作確認なしに変更しない
- `design-handoff-v1-before-sync/` の内容（削除・上書き禁止、比較材料として保持）

（一覧の根拠・詳細は `.claude/design-sync-v2-plan.md` §6、`.claude/agents/db-guardian.md`、`.claude/agents/release-reviewer.md`、`design/旅レートカメラ_実装引き継ぎ資料.md` §10/§12 を参照）

コードレビュー（`common-code-review` 等）を行う際も、この一覧を重点チェック観点として使う。

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
6. `common-dev-log` 等のログ系Skillを使う場合、ログファイルはこのリポジトリに作成せず、内容をチャット上に出力する（リポジトリへのログファイル追加は明示的に依頼された場合のみ行う）
