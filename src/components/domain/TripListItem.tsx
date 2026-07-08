import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { SectionCard } from '@/components/ui';
import { CurrencyFlagImage } from '@/components/domain/CurrencyFlagImage';
import type { CurrencyCode } from '@/constants/currencies';
import { color, spacing, typography } from '@/theme/tokens';
import { formatJpy, formatRate } from '@/utils/format';

export interface TripListItemProps {
  name: string;
  currency: CurrencyCode;
  rate: number;
  budgetJpy: number;
  /** 進行中の旅行か */
  isActive?: boolean;
  /** 選択中（旅行切替シートなど） */
  selected?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** 旅行の行（一覧/切替シート）。選択時はprimary枠＋チェック。TripRow相当 */
export function TripListItem({
  name,
  currency,
  rate,
  budgetJpy,
  isActive = false,
  selected = false,
  onPress,
  style,
}: TripListItemProps) {
  return (
    <Pressable onPress={onPress} disabled={onPress == null}>
      <SectionCard padding={spacing.md} style={[styles.container, selected && styles.selected, style]}>
        <CurrencyFlagImage currency={currency} size={22} outlined />
        <View style={styles.body}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>
            {isActive && (
              <View style={styles.activeBadge}>
                <Text style={styles.activeBadgeText}>進行中</Text>
              </View>
            )}
          </View>
          <Text style={styles.meta}>
            {formatRate(rate, currency)} ・ 予算 {formatJpy(budgetJpy)}
          </Text>
        </View>
        {selected && <View style={styles.check} />}
      </SectionCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  selected: {
    borderColor: color.primary,
    backgroundColor: color.primarySoft,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  name: {
    ...typography.bodyLg,
    color: color.text,
    flexShrink: 1,
  },
  meta: {
    ...typography.caption,
    color: color.muted,
    fontVariant: ['tabular-nums'],
  },
  activeBadge: {
    backgroundColor: color.primarySoft,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  activeBadgeText: {
    ...typography.caption,
    color: color.primaryDark,
  },
  check: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: color.primary,
  },
});
