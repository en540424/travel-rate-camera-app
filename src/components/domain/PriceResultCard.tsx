import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import type { CurrencyCode } from '@/constants/currencies';
import { color, spacing, typography } from '@/theme/tokens';
import { formatForeign, formatJpy, formatRate } from '@/utils/format';

export type PriceResultCardVariant = 'light' | 'dark';

export interface PriceResultCardProps {
  /** 円換算結果（メイン値） */
  jpyAmount: number;
  /** 元の外貨金額（サブ表示用） */
  foreignAmount?: number;
  currency?: CurrencyCode;
  /** レート（指定するとサブ行に「1 USD = ¥150.00」のように表示） */
  rate?: number;
  label?: string;
  /** 'dark' は暗い背景（旅行ヒーロー/Pro等）の上で使う配色 */
  variant?: PriceResultCardVariant;
  style?: StyleProp<ViewStyle>;
}

/** 円換算の巨大表示（明/暗）。typography.display + numeric。PriceHero相当 */
export function PriceResultCard({
  jpyAmount,
  foreignAmount,
  currency,
  rate,
  label = '日本円で',
  variant = 'light',
  style,
}: PriceResultCardProps) {
  const isDark = variant === 'dark';

  return (
    <View style={[styles.container, style]}>
      <Text style={[styles.label, isDark && styles.labelDark]}>{label}</Text>
      <Text
        style={[styles.value, isDark && styles.valueDark]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.5}>
        {formatJpy(jpyAmount)}
      </Text>
      {foreignAmount != null && currency != null && (
        <Text style={[styles.sub, isDark && styles.subDark]} numberOfLines={1} ellipsizeMode="tail">
          {formatForeign(foreignAmount, currency)}
          {rate != null && rate > 0 ? `  ・  ${formatRate(rate, currency)}` : ''}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'flex-start',
  },
  label: {
    ...typography.overline,
    color: color.muted,
    marginBottom: spacing.xs,
  },
  labelDark: {
    color: color.darkMuted,
  },
  value: {
    ...typography.display,
    color: color.text,
    fontVariant: ['tabular-nums'],
  },
  valueDark: {
    color: '#FFFFFF',
  },
  sub: {
    ...typography.body,
    color: color.muted,
    marginTop: spacing.xs,
    fontVariant: ['tabular-nums'],
  },
  subDark: {
    color: color.darkSub,
  },
});
