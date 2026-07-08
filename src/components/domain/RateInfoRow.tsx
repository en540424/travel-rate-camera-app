import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { CurrencyFlagImage } from '@/components/domain/CurrencyFlagImage';
import type { CurrencyCode } from '@/constants/currencies';
import { color, radius, spacing, typography } from '@/theme/tokens';
import { formatRate } from '@/utils/format';

export interface RateInfoRowProps {
  currency: CurrencyCode;
  rate: number;
  style?: StyleProp<ViewStyle>;
}

/** 「1 USD = ¥150.00」のレート確認行。RatePreviewCard相当 */
export function RateInfoRow({ currency, rate, style }: RateInfoRowProps) {
  return (
    <View style={[styles.container, style]}>
      <CurrencyFlagImage currency={currency} size={16} />
      <Text style={styles.text}>{formatRate(rate, currency)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: color.primarySoft,
    borderRadius: radius.chip,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    alignSelf: 'flex-start',
  },
  text: {
    ...typography.label,
    color: color.primaryDark,
    fontVariant: ['tabular-nums'],
  },
});
