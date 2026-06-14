import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { FREE_LIMITS } from '@/config/limits';
import { color, radius, spacing, typography } from '@/theme/tokens';

export interface SaveLimitBannerProps {
  /** 現在の保存件数 */
  currentCount: number;
  /** 上限件数（既定: FREE_LIMITS.saves） */
  limit?: number;
  /** Pro契約済みなら非表示にする */
  isPro?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** 無料版の保存件数（FREE_LIMITS.saves）に対する現在の保存数を示すバナー */
export function SaveLimitBanner({ currentCount, limit = FREE_LIMITS.saves, isPro = false, style }: SaveLimitBannerProps) {
  if (isPro) {
    return null;
  }

  const ratio = limit > 0 ? Math.min(1, Math.max(0, currentCount / limit)) : 0;
  const isNearLimit = currentCount >= limit;

  return (
    <View style={[styles.container, style]}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>保存件数</Text>
        <Text style={[styles.count, isNearLimit && styles.countWarn]}>
          {currentCount} / {limit} 件
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${ratio * 100}%` }, isNearLimit && styles.fillWarn]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: color.primarySoft,
    borderRadius: radius.chip,
    padding: spacing.md,
    gap: spacing.xs,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    ...typography.label,
    color: color.primaryDark,
  },
  count: {
    ...typography.label,
    color: color.primaryDark,
    fontVariant: ['tabular-nums'],
  },
  countWarn: {
    color: color.candidateStrong,
  },
  track: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: color.primaryBorder,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: color.primary,
  },
  fillWarn: {
    backgroundColor: color.candidate,
  },
});
