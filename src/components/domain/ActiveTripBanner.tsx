import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { CURRENCIES, type CurrencyCode } from '@/constants/currencies';
import { color, radius, spacing, typography } from '@/theme/tokens';
import { formatJpy, formatRate } from '@/utils/format';

export interface ActiveTripBannerProps {
  tripName: string;
  currency: CurrencyCode;
  rate: number;
  budgetJpy: number;
  /** 指定すると「残り」を右側に表示 */
  remainingBudgetJpy?: number;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** 現在の旅行カード（黒ヒーロー型）。旅行名・通貨・レート・予算/残予算。TripCard相当 */
export function ActiveTripBanner({
  tripName,
  currency,
  rate,
  budgetJpy,
  remainingBudgetJpy,
  onPress,
  style,
}: ActiveTripBannerProps) {
  const info = CURRENCIES[currency];

  return (
    <Pressable onPress={onPress} disabled={onPress == null} style={[styles.container, style]}>
      <View style={styles.header}>
        <Text style={styles.flag}>{info.flag}</Text>
        <Text style={styles.name} numberOfLines={1}>
          {tripName}
        </Text>
      </View>
      <Text style={styles.rate}>{formatRate(rate, currency)}</Text>
      <View style={styles.budgetRow}>
        <View>
          <Text style={styles.budgetLabel}>予算</Text>
          <Text style={styles.budgetValue}>{formatJpy(budgetJpy)}</Text>
        </View>
        {remainingBudgetJpy != null && (
          <View style={styles.budgetItemRight}>
            <Text style={styles.budgetLabel}>残り</Text>
            <Text style={[styles.budgetValue, styles.remaining]}>{formatJpy(remainingBudgetJpy)}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: color.dark,
    borderRadius: radius.cardLg,
    padding: spacing.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  flag: {
    fontSize: 20,
  },
  name: {
    ...typography.h2,
    color: '#FFFFFF',
    flexShrink: 1,
  },
  rate: {
    ...typography.body,
    color: color.darkSub,
    marginBottom: spacing.lg,
    fontVariant: ['tabular-nums'],
  },
  budgetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  budgetItemRight: {
    alignItems: 'flex-end',
  },
  budgetLabel: {
    ...typography.caption,
    color: color.darkMuted,
    marginBottom: 2,
  },
  budgetValue: {
    ...typography.h2,
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  remaining: {
    color: color.primaryAccent,
  },
});
