import TabirateStoreKitProofModule from './src/TabirateStoreKitProofModule';

/**
 * Pro+ の本人認証の証拠：StoreKit 2 の今有効な取引の JWS と、同じ購読の更新情報の JWS（取れた時だけ）。どちらも Apple の署名付き。iOS 専用。
 *
 * **このファイルはアプリ側でトップレベル import しないこと。** native 実体の無い環境（Android・Expo Go 等）では
 * `requireNativeModule` が読み込み時点で例外を投げるので、`src/lib/ai/ai-auth-client.ts` が iOS でだけ動的に読み込む。
 * 証拠の方式の採用は Human の判断（未決定）。**実機・Sandbox での取り出し（特に更新情報・猶予期間）は未確認。**
 */
export type StoreKitProof = { jws: string; renewalJws?: string };

export async function currentEntitlementProofs(productIds: string[]): Promise<StoreKitProof[]> {
  return TabirateStoreKitProofModule.currentEntitlementProofs(productIds);
}
