import { NativeModule, registerWebModule } from 'expo';

import type {
  TranslationAvailability,
  TranslationBatchResponse,
  TranslationPrepareResponse,
} from './TabirateTranslation.types';

// Apple Translation Frameworkはweb未対応。
// 呼び出し側（__DEV__ PoCパネル）はPlatform.OS === 'ios'でガードしているため、
// ここに到達するのは想定外の呼び出し時のみ。
class TabirateTranslationModule extends NativeModule<{}> {
  isSupportedOs(): boolean {
    return false;
  }

  async getSupportedLanguages(): Promise<string[]> {
    return [];
  }

  async getAvailability(_source: string, _target: string): Promise<TranslationAvailability> {
    throw new Error('TabirateTranslation is not supported on web.');
  }

  async prepare(_source: string, _target: string): Promise<TranslationPrepareResponse> {
    throw new Error('TabirateTranslation is not supported on web.');
  }

  async translateBatch(
    _texts: string[],
    _source: string,
    _target: string,
  ): Promise<TranslationBatchResponse> {
    throw new Error('TabirateTranslation is not supported on web.');
  }

  async cancelAll(): Promise<void> {
    // webでは保留リクエスト自体が存在しないため何もしない
  }
}

export default registerWebModule(TabirateTranslationModule, 'TabirateTranslationModule');
