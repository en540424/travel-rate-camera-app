import ExpoModulesCore
import StoreKit

/// Pro+ の本人認証の証拠を取り出す（StoreKit 2）。
///
/// `Transaction.currentEntitlements` を読むだけで、**購入・復元・取引の完了（finish）は行わない**。
/// 購入の経路は RevenueCat（react-native-purchases）のままで、ここはその経路に触れない。
/// 返す JWS（取引・更新情報）は Apple が署名した文字列で、中継（tabirate-ai-gateway `src/auth/storekit-jws.mjs`）が証明書の鎖と署名を検証する。
/// 端末側では中身を信じない（`.verified` は StoreKit の端末側の検証で、中継の検証の代わりにはならない）。
public class TabirateStoreKitProofModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TabirateStoreKitProof")

    /// 指定した商品のうち、今有効な取引の証拠を返す（取り消し済みは除く）。無ければ空の配列。
    /// 1件は { "jws": 取引の JWS, "renewalJws": 同じ購読の更新情報の JWS（取れた時だけ）}。
    /// 更新情報は、取引の期限が過ぎた後の Billing Grace Period（猶予中も提供が必要）を中継が Apple の署名で確かめるのに使う。
    /// `currentEntitlements` は猶予中の購読の最新の取引も返す（Apple の文書）。更新情報は購読グループの状態から同じ取引IDのものを選ぶ
    AsyncFunction("currentEntitlementProofs") { (productIds: [String]) async -> [[String: String]] in
      let wanted = Set(productIds)
      var out: [[String: String]] = []
      for await result in Transaction.currentEntitlements {
        guard case .verified(let transaction) = result else { continue }
        guard wanted.contains(transaction.productID), transaction.revocationDate == nil else { continue }
        var proof: [String: String] = ["jws": result.jwsRepresentation]
        if let groupID = transaction.subscriptionGroupID,
           let statuses = try? await Product.SubscriptionInfo.status(for: groupID) {
          for status in statuses {
            guard case .verified(let t) = status.transaction, t.originalID == transaction.originalID else { continue }
            proof["renewalJws"] = status.renewalInfo.jwsRepresentation
            break
          }
        }
        out.append(proof)
      }
      return out
    }
  }
}
