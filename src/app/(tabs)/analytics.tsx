import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { CAMERA_UI as C } from '@/constants/camera-screen';
import { CURRENCIES } from '@/constants/currencies';
import type { HistoryRow } from '@/db/queries/history';
import { useAllHistory } from '@/hooks/use-all-history';
import { formatJpy } from '@/utils/format';

function rowToDateKey(row: HistoryRow): string {
  if (row.entry_date) return row.entry_date;
  const iso = row.created_at.includes('T')
    ? row.created_at
    : `${row.created_at.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function compactJpy(amount: number): string {
  if (amount >= 10000) return `¥${(amount / 10000).toFixed(1)}万`;
  return `¥${amount.toLocaleString()}`;
}

const CHART_H = 140;
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export default function AnalyticsScreen() {
  const { history, tripMap, reload } = useAllHistory();
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const yearStats = useMemo(() => {
    let purchasedTotal = 0, candidateTotal = 0, totalCount = 0, purchasedCount = 0;
    for (const row of history) {
      const ry = Number(rowToDateKey(row).split('-')[0]);
      if (ry !== selectedYear) continue;
      totalCount++;
      if (row.is_purchased === 1) { purchasedTotal += row.jpy_amount; purchasedCount++; }
      else { candidateTotal += row.jpy_amount; }
    }
    return { purchasedTotal, candidateTotal, totalCount, purchasedCount };
  }, [history, selectedYear]);

  const monthlyData = useMemo(() => {
    return MONTHS.map((month) => {
      let purchased = 0;
      for (const row of history) {
        const key = rowToDateKey(row);
        const [ry, rm] = key.split('-').map(Number);
        if (ry === selectedYear && rm === month && row.is_purchased === 1) {
          purchased += row.jpy_amount;
        }
      }
      return { month, purchased };
    });
  }, [history, selectedYear]);

  const tripSummary = useMemo(() => {
    const map = new Map<number, { name: string; currency: string; purchased: number; count: number }>();
    for (const row of history) {
      if (row.trip_id === null || row.is_purchased !== 1) continue;
      const ry = Number(rowToDateKey(row).split('-')[0]);
      if (ry !== selectedYear) continue;
      const trip = tripMap.get(row.trip_id);
      if (!trip) continue;
      if (!map.has(row.trip_id)) {
        map.set(row.trip_id, { name: trip.name, currency: trip.base_currency, purchased: 0, count: 0 });
      }
      const entry = map.get(row.trip_id)!;
      entry.purchased += row.jpy_amount;
      entry.count++;
    }
    return Array.from(map.values()).sort((a, b) => b.purchased - a.purchased);
  }, [history, tripMap, selectedYear]);

  const maxPurchased = Math.max(...monthlyData.map((d) => d.purchased), 1);
  const hasAnyPurchased = monthlyData.some((d) => d.purchased > 0);

  return (
    <View style={styles.screen}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}>

          <View style={styles.header}>
            <ThemedText style={styles.screenTitle}>分析</ThemedText>
          </View>

          {/* 年ナビ */}
          <View style={styles.yearNav}>
            <TouchableOpacity
              onPress={() => setSelectedYear((y) => y - 1)}
              hitSlop={12}
              activeOpacity={0.7}>
              <ThemedText style={styles.navArrow}>‹</ThemedText>
            </TouchableOpacity>
            <ThemedText style={styles.yearLabel}>{selectedYear}年</ThemedText>
            <TouchableOpacity
              onPress={() => setSelectedYear((y) => y + 1)}
              hitSlop={12}
              activeOpacity={0.7}>
              <ThemedText style={styles.navArrow}>›</ThemedText>
            </TouchableOpacity>
          </View>

          {/* 年間まとめ */}
          <View style={styles.card}>
            <ThemedText style={styles.cardTitle}>{selectedYear}年のまとめ</ThemedText>
            <View style={styles.statsGrid}>
              <View style={styles.statItem}>
                <ThemedText style={styles.statLabel}>購入済み合計</ThemedText>
                <ThemedText style={styles.statValue}>{formatJpy(yearStats.purchasedTotal)}</ThemedText>
              </View>
              <View style={styles.statItem}>
                <ThemedText style={styles.statLabel}>候補合計</ThemedText>
                <ThemedText style={styles.statValue}>{formatJpy(yearStats.candidateTotal)}</ThemedText>
              </View>
              <View style={styles.statItem}>
                <ThemedText style={styles.statLabel}>保存</ThemedText>
                <ThemedText style={styles.statValue}>{yearStats.totalCount}件</ThemedText>
              </View>
              <View style={styles.statItem}>
                <ThemedText style={styles.statLabel}>購入済み</ThemedText>
                <ThemedText style={styles.statValue}>{yearStats.purchasedCount}件</ThemedText>
              </View>
            </View>
          </View>

          {/* 月別購入済み推移 */}
          <View style={styles.card}>
            <ThemedText style={styles.cardTitle}>月別購入済み推移</ThemedText>
            {!hasAnyPurchased ? (
              <ThemedText style={styles.emptyText}>
                この年の購入済み記録はまだありません
              </ThemedText>
            ) : (
              <View style={styles.chartWrap}>
                <View style={[styles.barsRow, { height: CHART_H }]}>
                  {monthlyData.map(({ month, purchased }) => {
                    const barH = purchased > 0
                      ? Math.max(4, Math.round((purchased / maxPurchased) * (CHART_H - 20)))
                      : 0;
                    return (
                      <View key={month} style={styles.barCol}>
                        {purchased > 0 && barH >= 24 && (
                          <ThemedText style={styles.amountLabel} numberOfLines={1}>
                            {compactJpy(purchased)}
                          </ThemedText>
                        )}
                        {barH > 0 && (
                          <View style={[styles.barRect, { height: barH }]} />
                        )}
                      </View>
                    );
                  })}
                </View>
                <View style={styles.monthRow}>
                  {MONTHS.map((m) => (
                    <ThemedText key={m} style={styles.barMonthLabel}>{m}</ThemedText>
                  ))}
                </View>
              </View>
            )}
          </View>

          {/* 旅行別購入済み合計（データあり時のみ表示） */}
          {tripSummary.length > 0 && (
            <View style={styles.card}>
              <ThemedText style={styles.cardTitle}>旅行別購入済み合計</ThemedText>
              <View style={styles.tripList}>
                {tripSummary.map((t, i) => {
                  const flag = CURRENCIES[t.currency as keyof typeof CURRENCIES]?.flag ?? '🌍';
                  return (
                    <View key={i} style={[styles.tripRow, i > 0 && styles.tripRowBorder]}>
                      <ThemedText style={styles.tripFlag}>{flag}</ThemedText>
                      <ThemedText style={styles.tripName} numberOfLines={1}>{t.name}</ThemedText>
                      <View style={styles.tripRight}>
                        <ThemedText style={styles.tripAmount}>{formatJpy(t.purchased)}</ThemedText>
                        <ThemedText style={styles.tripCount}>{t.count}件</ThemedText>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  safe: { flex: 1 },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 96,
    gap: 14,
  },

  header: { paddingBottom: 2 },
  screenTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: C.text,
    letterSpacing: -0.3,
  },

  // ── 年ナビ ──
  yearNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.surface,
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  navArrow: {
    fontSize: 26,
    fontWeight: '300',
    color: C.brand,
    lineHeight: 32,
  },
  yearLabel: {
    fontSize: 17,
    fontWeight: '700',
    color: C.text,
    letterSpacing: -0.2,
  },

  // ── カード共通 ──
  card: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    gap: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: C.text,
  },
  emptyText: {
    fontSize: 13,
    color: C.textMuted,
    textAlign: 'center',
    paddingVertical: 20,
  },

  // ── 年間まとめ ──
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statItem: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: C.bg,
    borderRadius: 10,
    padding: 10,
    gap: 3,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: C.textMuted,
    textAlign: 'center',
  },
  statValue: {
    fontSize: 15,
    fontWeight: '700',
    color: C.text,
    textAlign: 'center',
  },

  // ── 縦棒グラフ ──
  chartWrap: { gap: 0 },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  barCol: {
    flex: 1,
    alignItems: 'center',
  },
  amountLabel: {
    fontSize: 8,
    fontWeight: '600',
    color: C.textMuted,
    textAlign: 'center',
    marginBottom: 2,
  },
  barRect: {
    width: '80%',
    backgroundColor: C.brand,
    borderRadius: 2,
  },
  monthRow: {
    flexDirection: 'row',
    marginTop: 6,
  },
  barMonthLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '500',
    color: C.textSecondary,
  },

  // ── 旅行別一覧 ──
  tripList: { gap: 0 },
  tripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 8,
  },
  tripRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
  },
  tripFlag: {
    fontSize: 20,
    lineHeight: 24,
  },
  tripName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
  tripRight: {
    alignItems: 'flex-end',
    gap: 1,
  },
  tripAmount: {
    fontSize: 15,
    fontWeight: '700',
    color: C.text,
    letterSpacing: -0.3,
  },
  tripCount: {
    fontSize: 11,
    fontWeight: '500',
    color: C.textMuted,
  },
});
