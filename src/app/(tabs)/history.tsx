import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { FlatList, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import {
  CAMERA_UI as C,
  FALLBACK_BUDGET_JPY,
  FALLBACK_TRIP_NAME,
} from '@/constants/camera-screen';
import { FREE_HISTORY_LIMIT } from '@/db/queries/history';
import type { HistoryRow } from '@/db/queries/history';
import { useHistory } from '@/hooks/use-history';
import { useTrips } from '@/hooks/use-trips';
import { useSettingsStore } from '@/stores/settings-store';
import { formatForeign, formatJpy, formatRate } from '@/utils/format';
import { getTripStatsForDisplay } from '@/utils/trip-stats';

function formatSavedAt(createdAt: string): string {
  const isoUtc = createdAt.includes('T')
    ? createdAt
    : `${createdAt.replace(' ', 'T')}Z`;
  return new Date(isoUtc).toLocaleDateString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function HistoryScreen() {
  const { history, totalCount, clearAll, reload, togglePurchased } = useHistory();
  const isPro = useSettingsStore((s) => s.isPro);
  const isLimited = !isPro && totalCount >= FREE_HISTORY_LIMIT;
  const { activeTrip } = useTrips();

  const tripName = activeTrip?.name ?? FALLBACK_TRIP_NAME;
  const tripBudgetJpy = activeTrip?.budget_jpy ?? FALLBACK_BUDGET_JPY;

  const stats = useMemo(
    () => getTripStatsForDisplay(history, tripBudgetJpy, activeTrip?.id),
    [history, totalCount, tripBudgetJpy, activeTrip?.id],
  );

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  function renderItem({ item }: { item: HistoryRow }) {
    const dateStr = formatSavedAt(item.created_at);
    const isPurchased = (item.is_purchased ?? 0) === 1;

    return (
      <View style={styles.candidateCard}>
        <View style={styles.cardTop}>
          <ThemedText style={styles.tripLabel}>{tripName}</ThemedText>
          <TouchableOpacity
            style={[styles.badge, isPurchased && styles.badgePurchased]}
            onPress={() => togglePurchased(item.id, item.is_purchased ?? 0)}
            hitSlop={8}>
            <ThemedText style={[styles.badgeText, isPurchased && styles.badgeTextPurchased]}>
              {isPurchased ? '✓ 購入済み' : '候補'}
            </ThemedText>
          </TouchableOpacity>
        </View>

        <ThemedText style={styles.foreignPrice}>
          {formatForeign(item.foreign_amount, item.currency)}
        </ThemedText>
        <ThemedText style={[styles.jpyPrice, isPurchased && styles.jpyPricePurchased]}>
          約 {formatJpy(item.jpy_amount)}
        </ThemedText>

        <View style={styles.cardMeta}>
          <ThemedText style={styles.rateText}>
            {formatRate(item.rate_used, item.currency)}
          </ThemedText>
          <ThemedText style={styles.dateText}>{dateStr}</ThemedText>
        </View>
      </View>
    );
  }

  const listHeader = (
    <View style={styles.headerBlock}>
      <View style={styles.titleRow}>
        <View>
          <ThemedText style={styles.title}>履歴</ThemedText>
          <ThemedText style={styles.subtitle}>保存した買い物候補</ThemedText>
        </View>
        {history.length > 0 && (
          <TouchableOpacity onPress={clearAll} hitSlop={8}>
            <ThemedText style={styles.clearAll}>全削除</ThemedText>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <ThemedText style={styles.summaryLabel}>買い物候補</ThemedText>
          <ThemedText style={styles.summaryValue}>{stats.candidateCount}件</ThemedText>
        </View>
        <View style={styles.summaryRow}>
          <ThemedText style={styles.summaryLabel}>候補合計</ThemedText>
          <ThemedText style={styles.summaryAccent}>
            {formatJpy(stats.candidateTotalJpy)}
          </ThemedText>
        </View>
        <View style={styles.summaryRow}>
          <ThemedText style={styles.summaryLabel}>購入済み</ThemedText>
          <ThemedText style={styles.summaryValue}>
            {formatJpy(stats.purchasedTotalJpy)}
          </ThemedText>
        </View>
        <View style={[styles.summaryRow, styles.summaryRowLast]}>
          <ThemedText style={styles.summaryLabel}>残り予算</ThemedText>
          <ThemedText style={styles.summaryRemaining}>
            {tripBudgetJpy > 0 ? formatJpy(stats.remainingBudget) : '未設定'}
          </ThemedText>
        </View>
      </View>

      {isLimited && (
        <TouchableOpacity
          style={styles.proBanner}
          onPress={() => router.push('/settings')}>
          <ThemedText style={styles.proBannerText}>
            Pro版で無制限に保存（現在 {FREE_HISTORY_LIMIT} 件まで）→
          </ThemedText>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <View style={styles.screen}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <FlatList
          data={history}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.cardGap} />}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={
            <View style={styles.empty}>
              <ThemedText style={styles.emptyTitle}>
                まだ買い物候補はありません
              </ThemedText>
              <ThemedText style={styles.emptyBody}>
                カメラで値札を読み取って、{'\n'}気になる商品を保存できます
              </ThemedText>
            </View>
          }
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.bg,
  },
  safe: { flex: 1 },
  listContent: {
    paddingHorizontal: 18,
    paddingBottom: 96,
    maxWidth: 430,
    width: '100%',
    alignSelf: 'center',
  },

  headerBlock: {
    paddingTop: 10,
    paddingBottom: 16,
    gap: 14,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: C.text,
    letterSpacing: -0.4,
    lineHeight: 34,
  },
  subtitle: {
    fontSize: 14,
    color: C.textSecondary,
    marginTop: 4,
    fontWeight: '500',
  },
  clearAll: {
    fontSize: 15,
    fontWeight: '600',
    color: C.brand,
    paddingTop: 6,
  },

  summaryCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryRowLast: {
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
    marginTop: 2,
  },
  summaryLabel: {
    fontSize: 14,
    color: C.textSecondary,
    fontWeight: '500',
  },
  summaryValue: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
  },
  summaryAccent: {
    fontSize: 16,
    fontWeight: '700',
    color: C.brand,
    letterSpacing: -0.3,
  },
  summaryRemaining: {
    fontSize: 18,
    fontWeight: '700',
    color: C.brand,
    letterSpacing: -0.4,
  },

  proBanner: {
    backgroundColor: C.brandSoft,
    borderRadius: 12,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${C.brand}33`,
  },
  proBannerText: {
    color: C.brand,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
  },

  cardGap: { height: 12 },
  candidateCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 18,
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  tripLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: C.textSecondary,
    letterSpacing: 0.1,
  },
  badge: {
    backgroundColor: C.brandSoft,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgePurchased: {
    backgroundColor: '#E6F9EE',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: C.brand,
    letterSpacing: 0.3,
  },
  badgeTextPurchased: {
    color: '#22A45D',
  },
  jpyPricePurchased: {
    opacity: 0.45,
  },
  foreignPrice: {
    fontSize: 22,
    fontWeight: '700',
    color: C.text,
    letterSpacing: -0.4,
  },
  jpyPrice: {
    fontSize: 28,
    fontWeight: '700',
    color: C.text,
    letterSpacing: -0.6,
    lineHeight: 34,
    marginTop: 2,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
  },
  rateText: {
    fontSize: 13,
    color: C.textMuted,
    fontWeight: '500',
  },
  dateText: {
    fontSize: 13,
    color: C.textMuted,
    fontWeight: '500',
  },

  empty: {
    alignItems: 'center',
    paddingTop: 32,
    paddingHorizontal: 24,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: C.textSecondary,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 14,
    color: C.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
});
