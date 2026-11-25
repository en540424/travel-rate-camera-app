import { NativeModule, registerWebModule } from 'expo';

// StoreKit は web に無い。呼び出し側（src/lib/ai/ai-auth-client.ts）は iOS でだけ読み込む。
class TabirateStoreKitProofModule extends NativeModule<{}> {
  async currentEntitlementProofs(_productIds: string[]): Promise<{ jws: string; renewalJws?: string }[]> {
    return [];
  }
}

export default registerWebModule(TabirateStoreKitProofModule, 'TabirateStoreKitProofModule');
