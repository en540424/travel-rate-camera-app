/**
 * 契約プラン（Free / Pro / Pro+）の判定（純粋関数）。
 *
 * **importを一切持たない自己完結モジュール。**
 * `node --test`から直接importして検証できる状態を保つ（`revenuecat-package-core.ts`・`revenuecat-purchase-core.ts`と
 * 同じ規律）。RevenueCatのEntitlement識別子は`config/revenuecat.ts`が単一ソースで、このモジュールには
 * 呼び出し側（`lib/plan-tier.ts`）が引数として渡す。
 *
 * ■ 位置づけ（2026-11-04 Human決定：Free・Pro・Pro+の3段階を目指す。Pro+の価格・機能は未承認）
 *   この層は「どのプランか」を1か所で決めるだけで、**Pro+に何を含めるかは一切定義しない**。
 *   Pro+固有の機能が確定したら、呼び出し側は`isTierAtLeast(tier, 'pro_plus')`で判定する。
 *
 * ■ 階層と包含
 *   free < pro < pro_plus。上位は下位の権利をすべて含む（Pro+はProの機能を使える）。
 *   包含はこのクライアント側の**権利判定（gate）**で保証し、RevenueCat Dashboardで「Pro+商品を`pro`と`pro_plus`の
 *   両Entitlementへ紐付ける」設定に依存しない。表示用の読み取り（`useProPlanDetails`：月額/年額・期限・自動更新）は
 *   別で、現状`pro`のEntitlementしか読まない（Pro+の表示を作る時に扱う。今回は触れていない）。
 *
 * ■ 従来の`isPro`との関係
 *   従来：`'pro' in customerInfo.entitlements.active` → isPro。
 *   現在：`resolvePlanTierFromActive(active)`の`tier >= pro` → isPro。
 *   結果が変わるのは`pro_plus`だけが有効な場合のみ（従来はfalse、今回はtrue）。`pro_plus`はどの商品にも紐付いて
 *   いない（Dashboard未登録）ため、現時点で到達できる`entitlements.active`では従来と一致する。
 *   その等価性は`plan-tier-core.test.mjs`が、実オブジェクトと旧式（`in`）の突き合わせで固定している。
 */

/** 契約プラン。昇順（下ほど上位）。表示名ではなく判定用の識別子。 */
export const PLAN_TIERS = ['free', 'pro', 'pro_plus'] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

/** 判定に使うRevenueCatのEntitlement識別子。値は`config/revenuecat.ts`が正。 */
export type PlanTierEntitlementIds = {
  /** Proの権利（現行の`pro`） */
  pro: string;
  /** Pro+の権利（暫定・未登録。登録されるまでは有効になるCustomerInfoが存在しない） */
  proPlus: string;
};

/**
 * 階層の序列。未知のtierは序列に無いので`isTierAtLeast`が常にfalseを返す（権利を与える側に倒さない）。
 * オブジェクトではなくMapで持つのは、`'constructor'`などの継承プロパティ名が序列として引けてしまうのを避けるため。
 */
const TIER_RANK: ReadonlyMap<string, number> = new Map(PLAN_TIERS.map((tier, rank) => [tier, rank]));

/**
 * 有効なEntitlement識別子の一覧から契約プランを決める。
 *
 * - `proPlus`が有効 → `pro_plus`（`pro`の有無に依らない。Pro+はProを包含する）
 * - それ以外で`pro`が有効 → `pro`
 * - どちらも無い → `free`（無関係なEntitlementや空配列も`free`）
 *
 * 識別子は完全一致で比較する（`includes`。オブジェクトの`in`のようにプロトタイプ上の名前へ当たらない）。
 */
export function resolvePlanTier(
  activeEntitlementIds: readonly string[],
  ids: PlanTierEntitlementIds,
): PlanTier {
  if (activeEntitlementIds.includes(ids.proPlus)) return 'pro_plus';
  if (activeEntitlementIds.includes(ids.pro)) return 'pro';
  return 'free';
}

/**
 * RevenueCatの`customerInfo.entitlements.active`（識別子→EntitlementInfoの辞書）から契約プランを決める。
 *
 * `resolvePlanTier`への変換（辞書のキー列挙）と、取得できていない場合の扱いをここに集約する。
 * - `null`／`undefined`（CustomerInfo未取得）→ `free`。ただし**復元・購入の結果判定ではこの値で権利を消してはいけない**ので、
 *   呼び出し側（`revenuecat.native.ts`）は未取得をエラーとして扱い、この関数に渡さない。
 * - キーは`Object.keys`（自身の列挙可能プロパティ）。値は見ない（旧式の`in`と同じく、キーがあれば有効）。
 */
export function resolvePlanTierFromActive(
  active: object | null | undefined,
  ids: PlanTierEntitlementIds,
): PlanTier {
  if (active == null) return 'free';
  return resolvePlanTier(Object.keys(active), ids);
}

/** `tier`が`required`以上か。序列に無い値（実行時の想定外入力）はfalse＝権利を与えない。 */
export function isTierAtLeast(tier: PlanTier, required: PlanTier): boolean {
  const have = TIER_RANK.get(tier);
  const need = TIER_RANK.get(required);
  if (have === undefined || need === undefined) return false;
  return have >= need;
}

/**
 * Pro以上（Pro・Pro+）の権利があるか。既存の`isPro`の定義。
 * 保存件数・複数旅行・カテゴリー分析・CSVなど、従来Proに開放している機能の判定はこれに揃える。
 */
export function hasProAccess(tier: PlanTier): boolean {
  return isTierAtLeast(tier, 'pro');
}
