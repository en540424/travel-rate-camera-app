# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

# プロジェクト固有の制約

作業前に `AI_CONTEXT.md` を読み、現行の正となる文書・触ってはいけない領域を確認してください。

---

# Claude Code / Codex 共通ルール（2026-07-15追加）

このrepoは、Claude CodeとCodexのどちらでも実装・レビューを担当できる。**役割は固定しない**。実装前後にどちらのSkillを使うか（`common-safe-implementation`／`common-code-review`／`tabirate-safe-review`／`tabirate-ui-review`）も固定せず、作業内容に応じて自動選択してよい。

## プロジェクト種別

Expo（v56系）／React Native／TypeScript／expo-router。

## 正本・現在地

- Vault側Project Kit入口：`旅レートカメラ_Kit概要_2026-07-14`（Vault: `AI-Workflow-System/07_project-kits/tabirate-camera/`）
- repo内索引：`AI_CONTEXT.md`（既存記載のとおり最優先）
- プロダクト最上位仕様：`design/旅レートカメラ_実装引き継ぎ資料.md`
- UIビジュアル正本：`design/*-v4.png`（v4が最新・唯一の完全網羅セット）
- 実装ハンドオフ：`design-handoff/{screen}/`（`-v2`が現行、無印はv1相当）
- 現行デザイントークン：`src/theme/tokens.ts`（`src/constants/designTokens.ts`は旧トークン、正ではない）
- 無料/Pro上限値：`src/config/limits.ts`（`FREE_LIMITS`の単一ソース）
- 実装タスク管理：`.claude/mvp-tasks.md`
- Vaultから読めない環境（Vault未接続でCodex単独稼働時等）でも、少なくとも本ファイルと`AI_CONTEXT.md`・`.claude/mvp-tasks.md`の3点だけで安全に停止・報告できる状態を保つ

## 触ってはいけない領域

- DBスキーマ・migration
- 保存処理・保存時レート固定・過去履歴の再計算
- OCRパイプライン（OCR写真は現行仕様としてDBに保存しない。保存するよう変更しない）
- 旅行切替ロジック
- `FREE_LIMITS`の数値そのもの（RevenueCat連携ロジック自体は対象外）
- 下タブ構成（二重生成禁止）
- 既存の1画面主義・確定済みUIの破壊的変更

UI修正がこれらへ波及しそうな場合は、実装せず変更案の提示に留め、確認を取る。

## Git・テスト・検収

- commit・push運用は`AI-Workflow-System/01_harness/ChatGPT共同作業ルール正本`（Vault側正本）の共通条件＋アプリ・プロダクトrepo追加条件に従う
- 変更前に必ず現在のbranch・HEAD・upstream・working tree状態を確認する
- 検収コマンド：`npx tsc --noEmit`、`npm run lint`（`expo lint`）。自動テストスクリプトは未整備のため実機確認中心で運用する
- 変更範囲は指定されたファイル・機能に限定する

## Human-only（このrepoでは自動実行しない）

- RevenueCat Dashboard設定、App Store Connect商品登録、Sandboxアカウント操作
- EAS production build、TestFlight配信、App Store提出
- 課金・契約・銀行情報・本番デプロイ
- `.env`・APIキー・認証情報の読み書き

## Expo MCP・Hookについて

- Expo MCPが未認証・未接続の状態でも、通常のコード読み取り・実装・レビュー作業は止めない
- Expo由来のHook・自動承認設定を勝手に信頼・有効化しない

## Claude Code ⇄ Codex 移管

作業を途中で他方のエージェントへ引き継ぐ場合は、Vault側正本`AI-Workflow-System/01_harness/Claude-Code_Codex_双方向移管_正本`の移管パック形式（対象repo・branch・commit・完了/未完了作業・次の1工程・変更禁止領域・Secret/Human-only項目等）に従う。

## 作業ログ（EN-Knowledge-Vaultへのcross-repo記録）

このrepoでの開発作業の記録先は、このrepo内ではなく**EN-Knowledge-Vaultの`02_Development-Logs/YYYY-MM/`**である。
`.claude/mvp-tasks.md`・`AI_CONTEXT.md`の更新は現在地docsの更新であり、作業ログを書いたことにはならない。

共通ルールは`.claude/en-devlog-cross-repo.md`（EN-Knowledge-Vaultから配布。このrepo内で編集しない）を参照する。
判断基準の正本はVault側`AI-Workflow-System/01_harness/作業ログ自動運用_正本.md`。

`git commit`前に`.claude/hooks/guard-devlog-before-commit.js`が機械的にログの有無を確認し、
コード・設定・Skillの変更に対応するVault側ログが無い場合はcommitを拒否する（Hookの無効化・迂回はHuman-only）。
