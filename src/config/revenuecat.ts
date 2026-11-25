/**
 * RevenueCat 関連設定の単一ソース。
 * Public SDK Key は EXPO_PUBLIC_REVENUECAT_IOS_KEY 環境変数（.env / EAS環境変数）から読む。
 * 実値はGit管理下に置かない。未設定時は undefined を返し、呼び出し側でRevenueCatを無効化する。
 */

// RevenueCat Dashboard側のEntitlement識別子（表示名ではなくSDK参照用ID）
export const REVENUECAT_ENTITLEMENT_ID = 'pro';

// Pro+（Proの上位プラン）のEntitlement識別子。**暫定・未確定**。
// RevenueCat Dashboardには未作成で、Pro+の価格・商品構成・機能は未承認（調査H-2・H-3）。
// どの商品にも紐付いていないため、このIDが有効になるCustomerInfoは現時点で存在せず、判定結果は従来と同一。
// Dashboardへ登録する名前が変わる場合はここだけを直す（判定は`lib/plan-tier.ts`経由で参照される）。
// Pro+の商品ID（暫定）は下に置く。購入画面の対象は現時点でProの2商品のみ（Pro+の購入画面は未実装）。
export const REVENUECAT_PRO_PLUS_ENTITLEMENT_ID = 'pro_plus';

// RevenueCat Dashboard側のOffering識別子
export const REVENUECAT_OFFERING_ID = 'default';

// App Store Connect側のProduct ID（表示用の月額/年額判定にのみ使用。Dashboard設定自体はここでは変更しない）
export const REVENUECAT_MONTHLY_PRODUCT_ID = 'com.estep.travelratecamera.pro.monthly';
export const REVENUECAT_ANNUAL_PRODUCT_ID = 'com.estep.travelratecamera.pro.yearly';

// ── Pro+（**暫定・未登録**。2026-11-25時点でASC・RevenueCatのどちらにも存在しない） ──
// 値は調査（Vault `旅レートカメラ_Free-Pro-ProPlus_3プラン実現調査_2026-11-04` §8-1）の提案。ASCで商品を作ると
// Product IDは変更できないため、HumanがASCで作る名前を確定したらここだけを直す。価格はコードに持たない（StoreKitの表示値を使う）。
// Pro+の商品はPro+専用のOfferingに置き、`default`（Proの2商品）へ入れない。`default`へ入れると、配布済みBuild
// （Build 9等）がPro+のPackageをProの月額・年額として表示し得るため（`revenuecat-package-core.ts`の解決順）。
export const REVENUECAT_PRO_PLUS_OFFERING_ID = 'pro_plus';
export const REVENUECAT_PRO_PLUS_MONTHLY_PRODUCT_ID = 'com.estep.travelratecamera.proplus.monthly';
export const REVENUECAT_PRO_PLUS_ANNUAL_PRODUCT_ID = 'com.estep.travelratecamera.proplus.yearly';

export function getRevenueCatIosApiKey(): string | undefined {
  return process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
}
