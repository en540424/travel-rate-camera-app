import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { SectionCard } from '@/components/ui';
import { color, spacing, typography } from '@/theme/tokens';

export type StatCardTrendDirection = 'up' | 'down' | 'flat';

export interface StatCardTrend {
  direction: StatCardTrendDirection;
  label: string;
}

export interface StatCardProps {
  title: string;
  /** 表示用に整形済みの値（例: "¥12,345"） */
  value: string;
  caption?: string;
  trend?: StatCardTrend;
  /** 値の色味。candidate=候補色、purchased=購入済み色 */
  tone?: 'default' | 'candidate' | 'purchased';
  style?: StyleProp<ViewStyle>;
}

const TONE_COLOR: Record<NonNullable<StatCardProps['tone']>, string> = {
  default: color.text,
  candidate: color.candidateText,
  purchased: color.purchasedText,
};

const TREND_COLOR: Record<StatCardTrendDirection, string> = {
  up: color.purchasedText,
  down: color.danger,
  flat: color.muted,
};

const TREND_SYMBOL: Record<StatCardTrendDirection, string> = {
  up: '▲',
  down: '▼',
  flat: '・',
};

/** 分析画面などの数値統計カード。DataStatCard相当（SectionCardを利用） */
export function StatCard({ title, value, caption, trend, tone = 'default', style }: StatCardProps) {
  return (
    <SectionCard style={style}>
      <Text style={styles.title}>{title}</Text>
      <Text style={[styles.value, { color: TONE_COLOR[tone] }]}>{value}</Text>
      {(caption != null || trend != null) && (
        <View style={styles.footer}>
          {caption != null && <Text style={styles.caption}>{caption}</Text>}
          {trend != null && (
            <Text style={[styles.trend, { color: TREND_COLOR[trend.direction] }]}>
              {TREND_SYMBOL[trend.direction]} {trend.label}
            </Text>
          )}
        </View>
      )}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.label,
    color: color.muted,
    marginBottom: spacing.xs,
  },
  value: {
    ...typography.h1,
    fontVariant: ['tabular-nums'],
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  caption: {
    ...typography.caption,
    color: color.faint,
  },
  trend: {
    ...typography.caption,
    fontVariant: ['tabular-nums'],
  },
});
