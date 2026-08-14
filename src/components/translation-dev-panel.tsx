// Apple Translationの透明な翻訳ホストView。__DEV__ビルドでのみマウントする。
//
// **このファイルはトップレベルで`modules/translation`をimportしないこと。**
// Androidにはnative実体が無く、`requireNativeViewManager`がimport時点で例外を投げるため、
// ホストViewは実行時に動的importで読み込む。
import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { Platform, StyleSheet } from 'react-native';
import type { ViewProps } from 'react-native';

/**
 * 透明な翻訳ホストView。これがマウントされている間だけ`translateBatch`が成功する。
 *
 * `position: absolute` + `pointerEvents: none`で、既存レイアウトへの影響とタッチの奪取を防ぐ
 * （PoC画面の1x1 flex childをそのまま流用すると、置き場所によっては行が1px押し出される）。
 */
export function DevTranslationHost({ active }: { active: boolean }) {
  const [Host, setHost] = useState<ComponentType<ViewProps> | null>(null);

  useEffect(() => {
    if (!__DEV__ || Platform.OS !== 'ios') return;
    let cancelled = false;
    import('../../modules/translation')
      .then((m) => {
        if (!cancelled) setHost(() => m.TabirateTranslationHost);
      })
      .catch((error: unknown) => {
        console.warn('[TranslationDev] ホストViewを読み込めませんでした', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!__DEV__ || !active || Host == null) return null;
  return <Host style={styles.host} pointerEvents="none" />;
}

const styles = StyleSheet.create({
  // レイアウトへ影響させないため絶対配置。描画物を持たないViewなので見た目にも出ない。
  host: { position: 'absolute', top: 0, left: 0, width: 1, height: 1, opacity: 0 },
});
