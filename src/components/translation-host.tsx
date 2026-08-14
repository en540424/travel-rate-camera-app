// Apple Translationの透明なホストView。**本番（Release）でも動作する正式なinfrastructure component。**
//
// これがマウントされている間だけnative側の`translateBatch` / `prepare`が成功する
// （モデルDLを要求できる`TranslationSession`は、SwiftUIの`translationTask`経由でしか取得できないため）。
// 描画物を持たない透明Viewなので、画面のレイアウト・タッチには影響しない。
//
// **このファイルはトップレベルで`modules/translation`をimportしないこと。**
// Androidにはnative実体が無く、`requireNativeViewManager`がimport時点で例外を投げるため、
// ホストViewは実行時に動的importで読み込む。
import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { Platform, StyleSheet } from 'react-native';
import type { ViewProps } from 'react-native';

/**
 * Apple Translationを実行できるプラットフォームか。
 *
 * Apple Translation FrameworkはiOS専用。Android/WebではnativeモジュールもホストViewも存在せず、
 * `translateMemoLines`は原文フォールバックへ進む（別providerの導入はしない）。
 */
export const isTranslationPlatformSupported = Platform.OS === 'ios';

/**
 * 翻訳ホストView。翻訳を使う画面がフォーカスされている間だけ`active`にする。
 *
 * `position: absolute` + `pointerEvents: none`で、既存レイアウトへの影響とタッチの奪取を防ぐ
 * （1x1 flex childとして置くと、位置によっては行が1px押し出される）。
 *
 * iOS 18.0未満ではホストView自体をマウントしない。Swift側も全てのTranslation参照を
 * `#available(iOS 18.0, *)`でガードしており、podspecも`weak_frameworks = 'Translation'`だが、
 * JS側でも`isSupportedOs()`で止めることで「iOS 16.4〜17.xはTranslation.frameworkに触れない」を
 * 二重に保証する（翻訳はunsupported_osとして原文フォールバックになる）。
 */
export function TranslationHost({ active }: { active: boolean }) {
  const [Host, setHost] = useState<ComponentType<ViewProps> | null>(null);

  useEffect(() => {
    if (!isTranslationPlatformSupported) return;
    let cancelled = false;
    import('../../modules/translation')
      .then((m) => {
        // iOS 18.0未満ではホストViewを作らない（作っても翻訳APIはunsupported_osで失敗する）
        if (cancelled || !m.isSupportedOs()) return;
        setHost(() => m.TabirateTranslationHost);
      })
      .catch((error: unknown) => {
        if (__DEV__) {
          console.warn('[Translation] ホストViewを読み込めませんでした', error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!active || Host == null) return null;
  return <Host style={styles.host} pointerEvents="none" />;
}

const styles = StyleSheet.create({
  // レイアウトへ影響させないため絶対配置。描画物を持たないViewなので見た目にも出ない。
  host: { position: 'absolute', top: 0, left: 0, width: 1, height: 1, opacity: 0 },
});
