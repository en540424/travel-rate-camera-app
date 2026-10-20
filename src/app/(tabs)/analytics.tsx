import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { AnalysisSummaryCard, CategorySpendCard, CurrencyFlagImage, SpendBarChart } from '@/components/domain';
import { aggregateByCategory } from '@/config/categories';
import { SHOW_PRO } from '@/config/feature-flags';
import type { CurrencyCode } from '@/constants/currencies';
import { useAllHistory } from '@/hooks/use-all-history';
import { useIsPro } from '@/hooks/use-purchases';
import { color, radius, shadow } from '@/theme/tokens';
import { summarizePeriodSpending, type SpendEntry } from '@/utils/analytics-core';
import { formatJpy } from '@/utils/format';
import {
  dateKeyRangeForPeriod,
  matchesPeriod,
  rowToDateKey,
  toDateKey as toDateKeyFromDate,
  type AnalyticsPeriod,
} from '@/utils/history-date-core';
import { registerTabScrollReset } from '@/utils/tab-scroll-reset';

type Period = AnalyticsPeriod;

const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];

const PERIOD_OPTIONS = [
  { key: 'today', label: '今日', a11y: '今日の分析' },
  { key: 'month', label: '月', a11y: '月ごとの分析' },
  { key: 'year', label: '年', a11y: '年ごとの分析' },
] as const;

/**
 * 分析タブ（2026-10-20再設計）。上から
 *   期間切替 → まとめ（黒ヒーロー：購入済み合計を最初に読ませる）→ 縦棒グラフ（今日表示は購入済み一覧）
 *   → Pro：カテゴリー別 → 旅行別／無料版：旅行別 → カテゴリー別のPro導線（最下部）
 * 期間切替をまとめより上に置くのは、まとめ・グラフ・カテゴリー別の全てがこの期間で決まるため。
 * 無料版でPro導線を最下部に置くのは、無料で使える旅行別をPro導線で押し下げないため
 * （`design/旅レートカメラ_実装引き継ぎ資料.md`の「分析内Pro導線は最下部・控えめ」とも一致）。
 *
 * 無料版とProの違いは**カテゴリー別の集計だけ**（`SHOW_PRO && isPro`）。縦棒グラフ・まとめ・旅行別は
 * 無料版・Proで同じ部品をそのまま使う（Pro用に別の見た目を作らない）。
 */
export default function AnalyticsScreen() {
  // 下タブでこのタブ（分析）を押した時（＝タブ切替で入ってきた時）だけ先頭へ戻す。
  // (tabs)/_layout.tsxのtabPressからtriggerTabScrollResetで呼ばれる。
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    return registerTabScrollReset('analytics', () => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    });
  }, []);

  const isPro = useIsPro();
  const [period, setPeriod] = useState<Period>('year');
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [todayDate] = useState(() => new Date());
  const [selectedBarKey, setSelectedBarKey] = useState<string | null>(null);

  const anchorYear = anchorDate.getFullYear();
  const anchorMonth = anchorDate.getMonth() + 1;
  const todayKey = toDateKeyFromDate(todayDate);

  // 選択中の期間（今日／月／年）に入り得る履歴だけをDBから読む（件数上限なし）。
  // 以前は最新2000件の窓をJS側で集計しており、2001件目以降が合計・グラフから黙って落ちていた。
  // 集計は従来どおり`matchesPeriod(rowToDateKey(row), ...)`で厳密に絞る（SQL側は前後1日広め）。
  const dateRange = useMemo(
    () => dateKeyRangeForPeriod(period, anchorYear, anchorMonth, todayKey),
    [period, anchorYear, anchorMonth, todayKey],
  );
  const { history, tripMap, reload } = useAllHistory({ dateRange });

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  function changePeriod(next: Period) {
    setPeriod(next);
    setSelectedBarKey(null);
  }

  function goPrev() {
    setSelectedBarKey(null);
    if (period === 'year') setAnchorDate((d) => new Date(d.getFullYear() - 1, d.getMonth(), 1));
    else if (period === 'month') setAnchorDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }

  function goNext() {
    setSelectedBarKey(null);
    if (period === 'year') setAnchorDate((d) => new Date(d.getFullYear() + 1, d.getMonth(), 1));
    else if (period === 'month') setAnchorDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  }

  // 日付キーは履歴を読み直した時だけ作る（期間を切り替えるたびに全件の日付を作り直さない）
  const entries = useMemo<SpendEntry[]>(
    () =>
      history.map((row) => ({
        dateKey: rowToDateKey(row),
        isPurchased: row.is_purchased === 1,
        jpyAmount: row.jpy_amount,
        category: row.category,
      })),
    [history],
  );

  /**
   * まとめ・縦棒グラフ・カテゴリー別の入力を1回の走査で作る（`utils/analytics-core.ts`）。
   * 意味は再設計前のuseMemo群と同じ（テストで旧実装と同値であることを固定）。
   * 購入済み合計＝棒の合計＝カテゴリー別の合計が常に成り立つ。
   */
  const summary = useMemo(
    () =>
      summarizePeriodSpending(
        entries,
        (key) => matchesPeriod(key, period, anchorYear, anchorMonth, todayKey),
        period === 'today' ? 'none' : period,
        anchorYear,
        anchorMonth,
      ),
    [entries, period, anchorYear, anchorMonth, todayKey],
  );

  /** カテゴリー別集計（Pro）。集計そのものは`config/categories.ts`の`aggregateByCategory` */
  const categorySummary = useMemo(() => aggregateByCategory(summary.categoryInputs), [summary]);

  // 今日表示専用：購入済みを新しい順で一覧表示するためのデータ
  const todayPurchases = useMemo(() => {
    const rows = history
      .filter((row) => row.is_purchased === 1 && rowToDateKey(row) === todayKey)
      .slice()
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return rows.map((row) => {
      const iso = row.created_at.includes('T') ? row.created_at : `${row.created_at.replace(' ', 'T')}Z`;
      const d = new Date(iso);
      const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      const tripName = row.trip_id !== null ? (tripMap.get(row.trip_id)?.name ?? null) : null;
      return { id: row.id, time, amount: row.jpy_amount, tripName };
    });
  }, [history, tripMap, todayKey]);

  const tripSummary = useMemo(() => {
    const map = new Map<number, { name: string; currency: string; purchased: number; count: number }>();
    for (const row of history) {
      if (row.trip_id === null || row.is_purchased !== 1) continue;
      if (!matchesPeriod(rowToDateKey(row), period, anchorYear, anchorMonth, todayKey)) continue;
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
  }, [history, tripMap, period, anchorYear, anchorMonth, todayKey]);

  const hasChartAmount = summary.buckets.some((b) => b.amount > 0);

  const periodNavLabel =
    period === 'year'
      ? `${anchorYear}年`
      : period === 'month'
        ? `${anchorYear}年${anchorMonth}月`
        : `${todayDate.getFullYear()}年${todayDate.getMonth() + 1}月${todayDate.getDate()}日（${WEEKDAYS_JA[todayDate.getDay()]}）`;

  // 見出しの期間。過去の月・年を表示している時に「今月」「今年」と書かない
  const periodWord = period === 'year' ? `${anchorYear}年` : period === 'month' ? `${anchorMonth}月` : '今日';

  // グラフを使うのは年表示・月表示のみ（今日表示は購入済み一覧を別途表示する）
  const chartTitle = period === 'year' ? '月別の購入済み金額' : '日別の購入済み金額';

  const chartEmptyMessage =
    period === 'year' ? 'この年の購入済み記録はまだありません' : 'この月の購入済み記録はまだありません';

  // カテゴリー別（Pro機能）。カテゴリーの保存自体は無料版でもできるが、集計はPro。
  // 無料版でも存在は隠さず、何が得られるのかが分かる小さな導線だけを出す（実際の集計値は出さない）。
  const categoryCard = SHOW_PRO ? (
    <CategorySpendCard
      title={`${periodWord}のカテゴリー別`}
      rows={categorySummary}
      purchasedTotal={summary.purchasedTotal}
      isPro={isPro}
      onPressPro={() => router.push('/pro')}
    />
  ) : null;

  return (
    <View style={styles.screen}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}>

          <View style={styles.header}>
            <ThemedText style={styles.screenTitle}>分析</ThemedText>
          </View>

          {/* 期間切替（今日／月／年） */}
          <View style={styles.periodSwitch} accessibilityRole="tablist">
            {PERIOD_OPTIONS.map((opt) => {
              const active = period === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  // 見た目の高さ38に、外枠のpadding(4)ぶんのタップ範囲を足して46にする
                  hitSlop={{ top: 4, bottom: 4 }}
                  style={({ pressed }) => [
                    styles.periodSwitchBtn,
                    active && styles.periodSwitchBtnActive,
                    pressed && !active && styles.periodSwitchBtnPressed,
                  ]}
                  onPress={() => changePeriod(opt.key)}
                  accessibilityRole="tab"
                  accessibilityLabel={opt.a11y}
                  accessibilityState={{ selected: active }}>
                  <ThemedText style={[styles.periodSwitchText, active && styles.periodSwitchTextActive]}>
                    {opt.label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>

          {/* まとめ（期間の移動もここ） */}
          <AnalysisSummaryCard
            periodLabel={periodNavLabel}
            canNavigate={period !== 'today'}
            prevLabel={period === 'year' ? '前の年' : '前の月'}
            nextLabel={period === 'year' ? '次の年' : '次の月'}
            onPrev={goPrev}
            onNext={goNext}
            purchasedTotal={summary.purchasedTotal}
            purchasedCount={summary.purchasedCount}
            candidateTotal={summary.candidateTotal}
            totalCount={summary.totalCount}
          />

          {/* 今日表示：グラフの代わりに購入済み一覧 */}
          {period === 'today' && (
            <View style={styles.card}>
              <ThemedText style={styles.cardTitle}>今日の購入済み</ThemedText>
              {todayPurchases.length === 0 ? (
                <ThemedText style={styles.emptyText}>今日の購入済みはまだありません</ThemedText>
              ) : (
                <View style={styles.list}>
                  {todayPurchases.map((p, i) => (
                    <View key={p.id} style={[styles.listRow, i > 0 && styles.listRowBorder]}>
                      <View style={styles.todayRowLeft}>
                        <ThemedText style={styles.todayTime}>{p.time}</ThemedText>
                        {p.tripName && (
                          <ThemedText style={styles.todayTrip} numberOfLines={1}>{p.tripName}</ThemedText>
                        )}
                      </View>
                      <ThemedText style={styles.listAmount}>{formatJpy(p.amount)}</ThemedText>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* 月表示・年表示：縦棒グラフ（無料版・Pro共通） */}
          {period !== 'today' && (
            <View style={styles.card}>
              <ThemedText style={styles.cardTitle}>{chartTitle}</ThemedText>
              {!hasChartAmount ? (
                <View style={styles.chartEmpty}>
                  <ThemedText style={styles.chartEmptyTitle}>{chartEmptyMessage}</ThemedText>
                  <ThemedText style={styles.chartEmptyBody}>
                    購入済みにした記録が、{period === 'year' ? '月' : '日'}ごとの棒グラフで表示されます
                  </ThemedText>
                </View>
              ) : (
                <View style={styles.chartBody}>
                  <SpendBarChart
                    kind={period}
                    buckets={summary.buckets}
                    year={anchorYear}
                    month={anchorMonth}
                    todayKey={todayKey}
                    selectedKey={selectedBarKey}
                    onSelect={setSelectedBarKey}
                  />
                </View>
              )}
            </View>
          )}

          {/* Pro：縦棒グラフのすぐ下にカテゴリー別 */}
          {isPro && categoryCard}

          {/* 旅行別購入済み合計（データあり時のみ表示） */}
          {tripSummary.length > 0 && (
            <View style={styles.card}>
              <ThemedText style={styles.cardTitle}>{periodWord}の旅行別購入済み</ThemedText>
              <View style={styles.list}>
                {tripSummary.map((t, i) => {
                  return (
                    <View key={i} style={[styles.listRow, i > 0 && styles.listRowBorder]}>
                      <CurrencyFlagImage currency={t.currency as CurrencyCode} size={16} outlined />
                      <ThemedText style={styles.tripName} numberOfLines={1}>{t.name}</ThemedText>
                      <View style={styles.tripRight}>
                        <ThemedText style={styles.listAmount}>{formatJpy(t.purchased)}</ThemedText>
                        <ThemedText style={styles.tripCount}>{t.count}件</ThemedText>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* 無料版：カテゴリー別のPro導線は最下部 */}
          {!isPro && categoryCard}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgScreen },
  safe: { flex: 1 },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 96,
    gap: 14,
  },

  header: { paddingBottom: 2 },
  screenTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    color: color.text,
    letterSpacing: -0.3,
  },

  // ── 期間切替 ──
  periodSwitch: {
    flexDirection: 'row',
    backgroundColor: color.card,
    borderRadius: radius.pill,
    padding: 4,
    gap: 4,
    borderWidth: 1,
    borderColor: color.line,
    ...shadow.card,
  },
  periodSwitchBtn: {
    flex: 1,
    minHeight: 38,
    paddingVertical: 8,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  periodSwitchBtnActive: {
    backgroundColor: color.primary,
  },
  periodSwitchBtnPressed: {
    backgroundColor: color.primarySoft,
  },
  periodSwitchText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: color.body,
  },
  periodSwitchTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  // ── カード共通 ──
  card: {
    backgroundColor: color.card,
    borderRadius: radius.cardLg,
    borderWidth: 1,
    borderColor: color.line,
    padding: 16,
    gap: 12,
    ...shadow.card,
  },
  cardTitle: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
    color: color.text,
  },
  emptyText: {
    fontSize: 12,
    lineHeight: 18,
    color: color.muted,
    textAlign: 'center',
    paddingVertical: 20,
  },

  // ── 縦棒グラフ ──
  chartBody: { marginTop: 2 },
  chartEmpty: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: 22,
    paddingHorizontal: 8,
  },
  chartEmptyTitle: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
    color: color.body,
    textAlign: 'center',
  },
  chartEmptyBody: {
    fontSize: 12,
    lineHeight: 18,
    color: color.muted,
    textAlign: 'center',
  },

  // ── 一覧（今日の購入済み・旅行別） ──
  list: { gap: 0 },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 8,
  },
  listRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line2,
  },
  listAmount: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
    color: color.text,
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  todayRowLeft: {
    flex: 1,
    gap: 1,
  },
  todayTime: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    color: color.text,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  todayTrip: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
    color: color.muted,
  },
  tripName: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: color.text,
  },
  tripRight: {
    alignItems: 'flex-end',
    gap: 1,
  },
  tripCount: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '500',
    color: color.muted,
  },
});
