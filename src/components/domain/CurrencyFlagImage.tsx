import { Image, type ImageStyle } from 'expo-image';
import { StyleSheet, type StyleProp } from 'react-native';

import type { CurrencyCode } from '@/constants/currencies';
import { FLAG_IMAGES } from '@/constants/flags';

export interface CurrencyFlagImageProps {
  currency: CurrencyCode;
  /** 表示の高さ（px）。widthは元PNGの横縦比に合わせて自動計算する */
  size?: number;
  style?: StyleProp<ImageStyle>;
}

/**
 * 通貨ごとの国旗PNG表示。カレンダー画面のFLAG_IMAGESと同じ画像ソースを使う単一の表示コンポーネント。
 * 絵文字国旗（CURRENCIES[code].flag）の置き換え用。
 */
export function CurrencyFlagImage({ currency, size = 18, style }: CurrencyFlagImageProps) {
  const width = Math.round(size * 1.5);
  return (
    <Image
      source={FLAG_IMAGES[currency]}
      style={[styles.image, { width, height: size }, style]}
      contentFit="cover"
    />
  );
}

const styles = StyleSheet.create({
  image: {
    borderRadius: 2,
  },
});
