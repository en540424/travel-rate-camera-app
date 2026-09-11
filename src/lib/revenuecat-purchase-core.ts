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
 * 観測結果から購入の最終判定を導く。
 *
 * - 正常終了: proActiveAfter=true → success / それ以外 → entitlement_missing
 * - キャンセル: cancelled
 * - 例外: 購入前が非Proかつ今はPro → success（Apple側で成立していた）／それ以外 → error
 */
export function resolvePurchaseOutcome(o: PurchaseObservation): PurchaseResolution {
  if (!o.threw) {
    return o.proActiveAfter === true ? 'success' : 'entitlement_missing';
  }
  if (o.cancelled) return 'cancelled';
  if (!o.wasProBefore && o.proActiveAfter === true) return 'success';
  return 'error';
}
