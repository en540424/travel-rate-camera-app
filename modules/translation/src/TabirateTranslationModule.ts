import { NativeModule, requireNativeModule } from 'expo';

import type {
  TranslationAvailability,
  TranslationBatchResponse,
  TranslationPrepareResponse,
} from './TabirateTranslation.types';

declare class TabirateTranslationNativeModule extends NativeModule<{}> {
  isSupportedOs: () => boolean;
  getSupportedLanguages: () => Promise<string[]>;
  getAvailability: (source: string, target: string) => Promise<TranslationAvailability>;
  prepare: (source: string, target: string) => Promise<TranslationPrepareResponse>;
  translateBatch: (
    texts: string[],
    source: string,
    target: string,
  ) => Promise<TranslationBatchResponse>;
  cancelAll: () => Promise<void>;
}

export default requireNativeModule<TabirateTranslationNativeModule>('TabirateTranslation');
