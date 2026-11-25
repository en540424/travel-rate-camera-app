/**
 * RevenueCatのOfferingから月額/年額Packageを解決する（純粋関数）。
 *
 * **react-native・nativeモジュール・値のimportを一切持たない自己完結モジュール。**
 * `node --test`から直接importして検証できる状態を保つため
 * （`categories.ts`・`csv-export-core.ts`・`budget-core.ts`と同じ規律）。
 *
 * ■ なぜ`offering.monthly` / `offering.annual`だけに頼らないのか
 *   SDKの`PurchasesOffering.monthly` / `.annual`は
 *   「Dashboardで**定義済みidentifier**（`$rc_monthly` / `$rc_annual`）を使って
 *   構成されたpackage」の時だけ埋まる。Dashboard側でpackage identifierを
 *   独自の文字列（例: `Monthly` / `Yearly`）にしていると、
 *   `availablePackages`には入っているのに`monthly` / `annual`がnullになり、
 *   価格が「—」・購入ボタンがdisabledのまま、という状態になる。
 *
 *   そのため次の順で解決する（前段が取れなければ後段へ落ちるだけで、挙動を悪化させない）:
 *     1. `offering.monthly` / `offering.annual`（定義済みidentifier構成なら最短で当たる）
 *     2. `availablePackages`の`packageType`が`MONTHLY` / `ANNUAL`のもの
 *     3. `availablePackages`の`product.identifier`がApp Store側のProduct IDと一致するもの
 *   3が最終的な安全網で、Dashboardのpackage identifier命名に一切依存しない。
 */

/** 解決に必要な最小のPackage形。SDKの`PurchasesPackage`から必要な分だけを受け取る */
export type PackageLike = {
  identifier: string;
  /** SDKの`PACKAGE_TYPE`。`'MONTHLY'` / `'ANNUAL'` / `'CUSTOM'`などの文字列 */
  packageType: string;
  product: { identifier: string };
};

/** 解決に必要な最小のOffering形 */
export type OfferingLike<P extends PackageLike = PackageLike> = {
  availablePackages: readonly P[];
  monthly?: P | null;
  annual?: P | null;
};

function findByPackageType<P extends PackageLike>(
  packages: readonly P[],
  packageType: string,
): P | null {
  return packages.find((pkg) => pkg.packageType === packageType) ?? null;
}

function findByProductId<P extends PackageLike>(
  packages: readonly P[],
  productId: string,
): P | null {
  return packages.find((pkg) => pkg.product?.identifier === productId) ?? null;
}

/** 除外するProduct IDの商品か（上位プランの商品をProの候補として拾わないため） */
function isExcluded(pkg: PackageLike, excludeProductIds: readonly string[]): boolean {
  return excludeProductIds.includes(pkg.product?.identifier);
}

function resolveByPeriod<P extends PackageLike>(
  offering: OfferingLike<P> | null | undefined,
  preset: P | null | undefined,
  packageType: string,
  productId: string,
  excludeProductIds: readonly string[],
): P | null {
  if (offering == null) return null;
  const packages = offering.availablePackages ?? [];
  const allowed = packages.filter((pkg) => !isExcluded(pkg, excludeProductIds));
  const presetAllowed = preset != null && !isExcluded(preset, excludeProductIds) ? preset : null;
  return presetAllowed ?? findByPackageType(allowed, packageType) ?? findByProductId(packages, productId);
}

/**
 * 月額Packageを解決する。見つからなければ`null`。
 * `monthlyProductId`にはApp Store Connect側のProduct IDを渡す。
 * `excludeProductIds`（Pro+の商品ID）に当たるPackageは、1・2段目（`offering.monthly`・`packageType`）で拾わない。
 * Proの商品だけのOffering（現行の`default`）では、除外の有無で結果は変わらない（テストで固定）。
 */
export function resolveMonthlyPackage<P extends PackageLike>(
  offering: OfferingLike<P> | null | undefined,
  monthlyProductId: string,
  excludeProductIds: readonly string[] = [],
): P | null {
  return resolveByPeriod(offering, offering?.monthly, 'MONTHLY', monthlyProductId, excludeProductIds);
}

/**
 * 年額Packageを解決する。見つからなければ`null`。
 * `annualProductId`にはApp Store Connect側のProduct IDを渡す。除外の扱いは`resolveMonthlyPackage`と同じ。
 */
export function resolveAnnualPackage<P extends PackageLike>(
  offering: OfferingLike<P> | null | undefined,
  annualProductId: string,
  excludeProductIds: readonly string[] = [],
): P | null {
  return resolveByPeriod(offering, offering?.annual, 'ANNUAL', annualProductId, excludeProductIds);
}

/**
 * Product IDが完全に一致するPackageだけを返す（Pro+の商品向け）。
 * Pro+は`offering.monthly`・`packageType`を見ない：Dashboardのpackageの付け方に関わらず、Proの商品を取り違えないため。
 */
export function resolvePackageByProductId<P extends PackageLike>(
  offering: OfferingLike<P> | null | undefined,
  productId: string,
): P | null {
  if (offering == null) return null;
  return findByProductId(offering.availablePackages ?? [], productId);
}

/**
 * 課金まわりが今どの状態で詰まっているかを1つに畳んだ診断結果。
 * **原因の切り分け専用**で、UIの出し分けには使わない。
 */
export type PurchaseDiagnosis =
  /** SDKのconfigureに至っていない。iOS以外か、APIキーがBuildへ埋まっていない */
  | 'not_configured'
  /** configureは成功したが、Offeringを取得できていない（通信失敗・Offering未設定） */
  | 'no_offering'
  /** Offeringはあるが商品が0件。App Store側の要因（契約・商品状態・Sandbox未サインイン等） */
  | 'no_packages'
  /** 商品はあるが月額/年額のどちらも解決できない。package構成の問題 */
  | 'packages_unresolved'
  /** 月額・年額の少なくとも一方を解決できている（正常） */
  | 'ok';

/**
 * 価格が出ない原因を3系統へ切り分ける。
 *
 * `not_configured`はコード/Build設定（APIキー）、
 * `no_packages`はApp Store側（Humanの外部作業）、
 * `packages_unresolved`はpackage解決ロジックの問題、と読み替えられるようにしている。
 */
export function diagnosePurchaseSetup(params: {
  isConfigured: boolean;
  offering: OfferingLike | null | undefined;
  monthlyResolved: boolean;
  annualResolved: boolean;
}): PurchaseDiagnosis {
  if (!params.isConfigured) return 'not_configured';
  if (params.offering == null) return 'no_offering';
  if ((params.offering.availablePackages ?? []).length === 0) return 'no_packages';
  if (!params.monthlyResolved && !params.annualResolved) return 'packages_unresolved';
  return 'ok';
}
