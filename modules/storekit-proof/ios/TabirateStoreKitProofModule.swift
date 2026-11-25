import ExpoModulesCore
import StoreKit

/// Pro+ の本人認証の証拠を取り出す（StoreKit 2）。
///
/// `Transaction.currentEntitlements` を読むだけで、**購入・復元・取引の完了（finish）は行わない**。
/// 購入の経路は RevenueCat（react-native-purchases）のままで、ここはその経路に触れない。
/// 返す JWS は Apple が署名した文字列で、中継（tabirate-ai-gateway `src/auth/storekit-jws.mjs`）が証明書の鎖と署名を検証する。
/// 端末側では中身を信じない（`.verified` は StoreKit の端末側の検証で、中継の検証の代わりにはならない）。
public class TabirateStoreKitProofModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TabirateStoreKitProof")

    /// 指定した商品のうち、今有効な取引の JWS を返す（取り消し済みは除く）。無ければ空の配列
    AsyncFunction("currentEntitlementJws") { (productIds: [String]) async -> [String] in
      let wanted = Set(productIds)
      var out: [String] = []
      for await result in Transaction.currentEntitlements {
        guard case .verified(let transaction) = result else { continue }
        guard wanted.contains(transaction.productID), transaction.revocationDate == nil else { continue }
        out.append(result.jwsRepresentation)
      }
      return out
    }
  }
}
