import { NativeModule, requireNativeModule } from 'expo';

declare class TabirateStoreKitProofNativeModule extends NativeModule<{}> {
  currentEntitlementJws: (productIds: string[]) => Promise<string[]>;
}

export default requireNativeModule<TabirateStoreKitProofNativeModule>('TabirateStoreKitProof');
