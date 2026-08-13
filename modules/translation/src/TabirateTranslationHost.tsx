import { requireNativeViewManager } from 'expo-modules-core';
import * as React from 'react';
import type { ViewProps } from 'react-native';

/**
 * 翻訳ホストView。描画物を持たない透明なViewで、SwiftUIの`translationTask`を張るためだけに存在する。
 *
 * **このViewがマウントされている間だけ`prepare` / `translateBatch`が使える。**
 * アンマウントすると未処理リクエストはERR_TRANSLATION_HOST_UNMOUNTEDで失敗する
 * （TranslationSessionをView消失後に使うとfatalErrorになるため、意図的にそう設計している）。
 */
const NativeView: React.ComponentType<ViewProps> = requireNativeViewManager('TabirateTranslation');

export function TabirateTranslationHost(props: ViewProps) {
  return <NativeView {...props} />;
}
