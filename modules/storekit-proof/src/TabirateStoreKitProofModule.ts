import { NativeModule, requireNativeModule } from 'expo';

declare class TabirateStoreKitProofNativeModule extends NativeModule<{}> {
  currentEntitlementProofs: (productIds: string[]) => Promise<{ jws: string; renewalJws?: string }[]>;
}

export default requireNativeModule<TabirateStoreKitProofNativeModule>('TabirateStoreKitProof');
