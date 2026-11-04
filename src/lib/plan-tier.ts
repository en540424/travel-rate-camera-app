/**
 * CustomerInfo → 契約プランの導出。「どのプランか」を決める**唯一の入口**。
 *
 * これまで「proのEntitlementが有効か」は3か所（`purchases-store`の`isPro`、`revenuecat.native.ts`の購入成否判定、
 * 同ファイルの復元結果）に重複して書かれていた。3か所を必ずこの関数に揃える（揃っていないと、購入は完了したのに
 * storeはFreeのまま、という不整合になる。S2-2で塞いだ不具合と同種）。
 *
 * 判定の中身は`plan-tier-core.ts`（純粋関数・単体テスト済み）。ここはEntitlement識別子（`config/revenuecat.ts`）と
 * SDKの`CustomerInfo`型を結ぶだけの薄い層で、型importのみのため実行時にreact-native-purchasesを読み込まない。
 */
import type { CustomerInfo } from 'react-native-purchases';

import { REVENUECAT_ENTITLEMENT_ID, REVENUECAT_PRO_PLUS_ENTITLEMENT_ID } from '@/config/revenuecat';
import { resolvePlanTierFromActive, type PlanTier } from '@/lib/plan-tier-core';

/** CustomerInfoから契約プランを決める。取得できていない（null）間はfree。 */
export function getPlanTier(customerInfo: CustomerInfo | null | undefined): PlanTier {
  return resolvePlanTierFromActive(customerInfo == null ? null : customerInfo.entitlements.active, {
    pro: REVENUECAT_ENTITLEMENT_ID,
    proPlus: REVENUECAT_PRO_PLUS_ENTITLEMENT_ID,
  });
}
