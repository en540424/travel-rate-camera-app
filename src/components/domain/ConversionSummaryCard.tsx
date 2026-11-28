import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { SectionCard } from '@/components/ui';
import type { CurrencyCode } from '@/constants/currencies';
import { color, spacing, typography } from '@/theme/tokens';
import { formatForeign, formatJpy } from '@/utils/format';
import { isDomestic } from '@/utils/money-core';

import { RateInfoRow } from './RateInfoRow';

export interface ConversionSummaryCardProps {
  foreignAmount: number;
  currency: CurrencyCode;
  /** 基準通貨（旅行の `target_currency`）。現地通貨と同じならレートの行を出さない */
  homeCurrency: CurrencyCode;
  jpyAmount: number;
  /** 指定するとレート確認行（RateInfoRow）を表示 */
  rate?: number;
  style?: StyleProp<ViewStyle>;
}

/** 外貨→円の換算結果をまとめて表示する小カード。SectionCardを利用 */
export function ConversionSummaryCard({ foreignAmount, currency, homeCurrency, jpyAmount, rate, style }: ConversionSummaryCardProps) {
  return (
    <SectionCard style={style}>
      <View style={styles.row}>
        <Text style={styles.foreign}>{formatForeign(foreignAmount, currency)}</Text>
        <Text style={styles.arrow}>→</Text>
        <Text style={styles.jpy}>{formatJpy(jpyAmount)}</Text>
      </View>
      {rate != null && rate > 0 && !isDomestic(currency, homeCurrency) && (
        <RateInfoRow currency={currency} rate={rate} style={styles.rateRow} />
      )}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  foreign: {
    ...typography.h2,
    color: color.body,
    fontVariant: ['tabular-nums'],
  },
  arrow: {
    ...typography.body,
    color: color.faint,
  },
  jpy: {
    ...typography.h1,
    color: color.text,
    fontVariant: ['tabular-nums'],
  },
  rateRow: {
    marginTop: spacing.sm,
  },
});
