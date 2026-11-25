/**
 * 購入結果の判定（純粋関数）。
 *
 * **react-native・nativeモジュール・値のimportを一切持たない自己完結モジュール。**
 * `node --test`から直接importして検証できる状態を保つ
 * （`revenuecat-package-core.ts`・`budget-core.ts`と同じ規律）。
 *
 * ■ なぜ「purchasePackageが正常にresolveした」だけで成功扱いにしないのか
 *   StoreKitの処理完了と、RevenueCat上でpro Entitlementが有効になることは別の事象。
 *   商品とEntitlementの紐付け不備などがあると、決済は通ったのにEntitlementが付かない
 *   （＝完了画面は「Pro有効」なのに実際のgateはFreeのまま）状態になり得る。
 *   そのため**正常終了時もCustomerInfoのpro有効を確認**し、無ければ成功扱いにしない。
 *
 * ■ なぜ例外後の救済に「購入前はProでなかったこと」を要求するのか
 *   purchasePackageが例外を投げても、Apple側で購入が成立している場合がある
 *   （例: 購入完了直後のStoreKitError.unknown）。その救済として例外後にpro有効なら成功扱いにするが、
 *   **購入前から既にProだったユーザー**では、有効なEntitlementが「今回の購入の成立」の証明にならない
 *   （既存契約がそのまま残っているだけ）。既存Proを今回の成功と誤認しないため、救済は
 *   「購入前は非Pro → 例外 → 今はPro」の遷移が観測できた時に限る。
 */

export type PurchaseResolution =
  /** 決済処理が終わり、pro Entitlementが有効。完了画面へ進んでよい */
  | 'success'
  /** 利用者のキャンセル。エラー表示はしない */
  | 'cancelled'
  /** 決済処理は正常終了したが、pro Entitlementが有効になっていない。「復元を試す」案内へ */
  | 'entitlement_missing'
  /** 本当の失敗 */
  | 'error';

export type PurchaseObservation = {
  /** purchasePackageが例外を投げたか */
  threw: boolean;
  /** 例外が利用者キャンセルを示すか（threw=falseなら無視） */
  cancelled: boolean;
  /** 購入呼び出し前の時点でpro Entitlementが有効だったか */
  wasProBefore: boolean;
  /** 購入呼び出し後（例外時は再取得後）のCustomerInfoでpro Entitlementが有効か。取得できなければnull */
  proActiveAfter: boolean | null;
};

/**
 * 観測結果から購入の最終判定を導く（Proの商品を買う場合）。
 *
 * - 正常終了: proActiveAfter=true → success / それ以外 → entitlement_missing
 * - キャンセル: cancelled
 * - 例外: 購入前が非Proかつ今はPro → success（Apple側で成立していた）／それ以外 → error
 *
 * 規則は `resolveTierPurchaseOutcome`（目標＝pro）と同じで、真理値表は従来と同一（テストで固定）。
 */
export function resolvePurchaseOutcome(o: PurchaseObservation): PurchaseResolution {
  return resolveTierPurchaseOutcome({
    threw: o.threw,
    cancelled: o.cancelled,
    tierBefore: o.wasProBefore ? 'pro' : 'free',
    tierAfter: o.proActiveAfter == null ? null : o.proActiveAfter ? 'pro' : 'free',
    targetTier: 'pro',
  });
}

/**
 * 契約プラン。`plan-tier-core.ts` の `PlanTier` と同じ値・同じ順序（free < pro < pro_plus）。
 * このファイルを自己完結に保つため、ここで値を持つ（`proplus-access-core.ts` と同じ扱い）。
 */
export type PurchaseTier = 'free' | 'pro' | 'pro_plus';
const PURCHASE_TIER_RANK: ReadonlyMap<string, number> = new Map([
  ['free', 0],
  ['pro', 1],
  ['pro_plus', 2],
]);

/** 序列に無い値・null（不明）は false＝権利を与えない側 */
function atLeast(tier: PurchaseTier | null, required: PurchaseTier): boolean {
  if (tier == null) return false;
  const have = PURCHASE_TIER_RANK.get(tier);
  const need = PURCHASE_TIER_RANK.get(required);
  if (have === undefined || need === undefined) return false;
  return have >= need;
}

export type TierPurchaseObservation = {
  /** purchasePackageが例外を投げたか */
  threw: boolean;
  /** 例外が利用者キャンセルを示すか（threw=falseなら無視） */
  cancelled: boolean;
  /** 購入呼び出し前の契約プラン（storeの`planTier`） */
  tierBefore: PurchaseTier;
  /** 購入呼び出し後（例外時は再取得後）の契約プラン。CustomerInfoを取得できなければnull */
  tierAfter: PurchaseTier | null;
  /** 今回買う商品のプラン（Proの商品なら'pro'、Pro+の商品なら'pro_plus'） */
  targetTier: PurchaseTier;
};

/**
 * 目標のプランを指定して購入の最終判定を導く（Pro・Pro+の両方の購入で使う）。
 *
 * - 正常終了: 購入後のプランが目標以上 → success／それ以外 → entitlement_missing
 *   （ProからPro+を買って`pro_plus`が付かなかった時に、残っている`pro`を成功と誤認しない）
 * - キャンセル: cancelled
 * - 例外: 購入前は目標未満かつ今は目標以上 → success（Apple側で成立していた救済）／それ以外 → error
 *   （ProからPro+への購入では`pro`が既に有効なこと自体は今回の成立の証明にならない。見るのは目標への昇格）
 */
export function resolveTierPurchaseOutcome(o: TierPurchaseObservation): PurchaseResolution {
  if (!o.threw) {
    return atLeast(o.tierAfter, o.targetTier) ? 'success' : 'entitlement_missing';
  }
  if (o.cancelled) return 'cancelled';
  if (!atLeast(o.tierBefore, o.targetTier) && atLeast(o.tierAfter, o.targetTier)) return 'success';
  return 'error';
}
