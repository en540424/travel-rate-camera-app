/**
 * RevenueCat 関連設定の単一ソース。
 * Public SDK Key は EXPO_PUBLIC_REVENUECAT_IOS_KEY 環境変数（.env / EAS環境変数）から読む。
 * 実値はGit管理下に置かない。未設定時は undefined を返し、呼び出し側でRevenueCatを無効化する。
 */

// RevenueCat Dashboard側のEntitlement識別子（表示名ではなくSDK参照用ID）
export const REVENUECAT_ENTITLEMENT_ID = 'pro';

// RevenueCat Dashboard側のOffering識別子
export const REVENUECAT_OFFERING_ID = 'default';

export function getRevenueCatIosApiKey(): string | undefined {
  return process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
}
