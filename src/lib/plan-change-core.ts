/**
 * 商品（Product ID）の識別と、プラン変更の種類の判定（純粋関数・import 0件）。
 *
 * `node --test`から直接importして検証できる状態を保つ（`revenuecat-package-core.ts`と同じ規律）。
 * Product IDの値は`config/revenuecat.ts`が正で、ここには呼び出し側が引数で渡す。
 *
 * ■ 変更の種類（Appleの自動更新サブスクリプションの規則・調査§8-1【一次】）
 *   同じサブスクリプショングループの中で、Levelが上の商品へ＝Upgrade（即時・残りは日割りで返金）、
 *   下へ＝Downgrade（次回の更新日から）、同じLevelで期間が違う＝Crossgrade（次回の更新日から）。
 *   **Levelの並びは「Pro+＝Level 1、Pro＝Level 2、同じプランの月額・年額は同じLevel」を前提にする**
 *   （調査§8-1の提案。ASCでの設定はHuman）。ASCの並びが違えば、この判定も直す必要がある。
 *
 * ■ 使い方
 *   購入画面で「いつから切り替わるか」を前もって示すための判定で、権利の判定（gate）には使わない。
 *   権利は常にCustomerInfoの有効なEntitlementから決める（`plan-tier-core.ts`）。
 */

export type PlanPeriod = 'monthly' | 'annual';
export type PaidTier = 'pro' | 'pro_plus';
export type PlanProduct = { tier: PaidTier; period: PlanPeriod };

/** 4つの商品のProduct ID */
export type PlanProductCatalog = {
  proMonthly: string;
  proAnnual: string;
  proPlusMonthly: string;
  proPlusAnnual: string;
};

/** Product IDから商品を特定する。知らないIDはnull（推測しない） */
export function identifyPlanProduct(productId: string | null | undefined, catalog: PlanProductCatalog): PlanProduct | null {
  if (productId == null) return null;
  if (productId === catalog.proMonthly) return { tier: 'pro', period: 'monthly' };
  if (productId === catalog.proAnnual) return { tier: 'pro', period: 'annual' };
  if (productId === catalog.proPlusMonthly) return { tier: 'pro_plus', period: 'monthly' };
  if (productId === catalog.proPlusAnnual) return { tier: 'pro_plus', period: 'annual' };
  return null;
}

/**
 * 購入する商品の目標プラン（購入の結果判定 `resolveTierPurchaseOutcome` の targetTier）。
 * Pro+の商品ならpro_plus、それ以外（Proの商品・知らない商品）はpro＝従来のProの購入と同じ判定。
 */
export function purchaseTargetTier(productId: string | null | undefined, catalog: PlanProductCatalog): PaidTier {
  return identifyPlanProduct(productId, catalog)?.tier === 'pro_plus' ? 'pro_plus' : 'pro';
}

export type PlanChangeKind =
  /** 有料の契約が無い（Free）→ 新規の購入 */
  | 'new'
  /** Pro → Pro+ */
  | 'upgrade'
  /** Pro+ → Pro */
  | 'downgrade'
  /** 同じプランで月額⇔年額 */
  | 'crossgrade'
  /** 今の商品と同じ */
  | 'same'
  /** 有料の契約はあるが、今の商品を特定できない（推測しない。サブスクリプションの管理画面で確認してもらう） */
  | 'unknown';

/** 切り替わる時期。'none'＝変更が起きない（same）・判断しない（unknown） */
export type PlanChangeTiming = 'immediate' | 'next_renewal' | 'none';

export type PlanChange = { kind: PlanChangeKind; timing: PlanChangeTiming };

const PAID_RANK: ReadonlyMap<string, number> = new Map([
  ['pro', 1],
  ['pro_plus', 2],
]);

/**
 * 今の契約から目標の商品へ変えた時の種類と時期。
 *
 * @param currentTier 今の契約プラン（CustomerInfoから。'free'なら有料の契約なし）
 * @param currentProduct 今の契約の商品（有効なEntitlementのProduct IDを`identifyPlanProduct`で特定したもの）
 * @param target 買おうとしている商品
 */
export function classifyPlanChange(
  currentTier: 'free' | PaidTier,
  currentProduct: PlanProduct | null,
  target: PlanProduct,
): PlanChange {
  if (currentTier === 'free') return { kind: 'new', timing: 'immediate' };
  if (currentProduct == null || currentProduct.tier !== currentTier) return { kind: 'unknown', timing: 'none' };
  const have = PAID_RANK.get(currentProduct.tier);
  const want = PAID_RANK.get(target.tier);
  if (have === undefined || want === undefined) return { kind: 'unknown', timing: 'none' };
  if (want > have) return { kind: 'upgrade', timing: 'immediate' };
  if (want < have) return { kind: 'downgrade', timing: 'next_renewal' };
  if (currentProduct.period !== target.period) return { kind: 'crossgrade', timing: 'next_renewal' };
  return { kind: 'same', timing: 'none' };
}
