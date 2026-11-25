/**
 * Pro+の機能（買い物マップ・旅行スケジュール・AI翻訳）を出すかどうかの判定（純粋関数・import 0件）。
 *
 * - 公開フラグ（`SHOW_PRO_PLUS`）が無効なら、どのプランでも入口を出さない（未完成機能を露出しない）
 * - Pro+の契約中は全機能
 * - Pro+ではないが、以前Pro+で作ったデータがある（失効・解約・ダウングレード）なら閲覧のみ。データは消さない（設計書§3-2）
 * - それ以外は案内（購入画面ができるまでは「準備中」の案内）
 *
 * プランの順序は `plan-tier-core.ts` と同じ（free < pro < pro_plus）。このファイルは自己完結に保つため値を持たない。
 */

export type ProPlusAccess = 'hidden' | 'upsell' | 'read_only' | 'full';

export function getProPlusAccess(input: { flagEnabled: boolean; hasProPlus: boolean; hasExistingData: boolean }): ProPlusAccess {
  if (!input.flagEnabled) return 'hidden';
  if (input.hasProPlus) return 'full';
  return input.hasExistingData ? 'read_only' : 'upsell';
}

/**
 * 3つのフラグから「入口を出すか」と「契約を装うか」を決める。
 * - 入口：公開フラグ・開発ビルド・検証用ビルドのどれかが有効なら出す
 * - 契約を装う：開発ビルドで、かつ検証用ビルドでない時だけ（検証用ビルドは本物の権利で判定する）
 */
export function resolveProPlusFlags(input: { showProPlus: boolean; devPreview: boolean; qa: boolean }): {
  flagEnabled: boolean;
  simulateEntitlement: boolean;
} {
  return {
    flagEnabled: input.showProPlus || input.devPreview || input.qa,
    simulateEntitlement: input.devPreview && !input.qa,
  };
}

export function canEditProPlusData(access: ProPlusAccess): boolean {
  return access === 'full';
}

export function canViewProPlusData(access: ProPlusAccess): boolean {
  return access === 'full' || access === 'read_only';
}
