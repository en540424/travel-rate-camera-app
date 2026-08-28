import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { CurrencyFlagImage, ProFeatureBadge } from '@/components/domain';
import { aggregateByCategory } from '@/config/categories';
import { SHOW_PRO } from '@/config/feature-flags';
import { DT } from '@/constants/designTokens';
import type { CurrencyCode } from '@/constants/currencies';
import type { HistoryRow } from '@/db/queries/history';
import { useAllHistory } from '@/hooks/use-all-history';
import { useIsPro } from '@/hooks/use-purchases';
import { color } from '@/theme/tokens';
import { formatJpy } from '@/utils/format';
import { registerTabScrollReset } from '@/utils/tab-scroll-reset';

type Period = 'today' | 'month' | 'year';

const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const CHART_H = 140;
// 月表示は31日分を横スクロールで表示する。初期表示でだいたい10日分が見える幅にする
const MONTH_VISIBLE_DAYS = 10;
const DAY_COL_MIN_WIDTH = 30;

function barHeightFor(amount: number, max: number): number {
  return amount > 0 ? Math.max(4, Math.round((amount / max) * (CHART_H - 8))) : 3;
}

function rowToDateKey(row: HistoryRow): string {
  if (row.entry_date) return row.entry_date;
  const iso = row.created_at.includes('T')
    ? row.created_at
    : `${row.created_at.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toDateKeyFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function matchesPeriod(
  dateKey: string,
  period: Period,
  anchorYear: number,
  anchorMonth: number,
  todayKey: string,
): boolean {
  if (period === 'today') return dateKey === todayKey;
  const [ry, rm] = dateKey.split('-').map(Number);
  if (period === 'year') return ry === anchorYear;
  return ry === anchorYear && rm === anchorMonth;
}

export default function AnalyticsScreen() {
  // 下タブでこのタブ（分析）を押した時（＝タブ切替で入ってきた時）だけ先頭へ戻す。
  // (tabs)/_layout.tsxのtabPressからtriggerTabScrollResetで呼ばれる。
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    return registerTabScrollReset('analytics', () => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    });
  }, []);

  const { history, tripMap, reload } = useAllHistory();
  const isPro = useIsPro();
  const { width: windowWidth } = useWindowDimensions();
  const [period, setPeriod] = useState<Period>('year');
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [todayDate] = useState(() => new Date());
  const [selectedBarKey, setSelectedBarKey] = useState<string | null>(null);

  // 月表示の1日あたりの列幅：画面幅から「scroll」「card」の左右paddingを引いた
  // 実際に見える横幅を10等分し、初期表示でだいたい1〜10日が見えるようにする
  const monthChartVisibleWidth = windowWidth - DT.spacing.lg * 4;
  const dayColWidth = Math.max(DAY_COL_MIN_WIDTH, Math.floor(monthChartVisibleWidth / MONTH_VISIBLE_DAYS));

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const anchorYear = anchorDate.getFullYear();
  const anchorMonth = anchorDate.getMonth() + 1;
  const todayKey = toDateKeyFromDate(todayDate);

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

  const periodStats = useMemo(() => {
    let purchasedTotal = 0, candidateTotal = 0, totalCount = 0, purchasedCount = 0;
    for (const row of history) {
      if (!matchesPeriod(rowToDateKey(row), period, anchorYear, anchorMonth, todayKey)) continue;
      totalCount++;
      if (row.is_purchased === 1) { purchasedTotal += row.jpy_amount; purchasedCount++; }
      else { candidateTotal += row.jpy_amount; }
    }
    return { purchasedTotal, candidateTotal, totalCount, purchasedCount };
  }, [history, period, anchorYear, anchorMonth, todayKey]);

  const chartData = useMemo(() => {
    if (period === 'year') {
      return MONTHS.map((m) => {
        let amount = 0;
        for (const row of history) {
          const key = rowToDateKey(row);
          const [ry, rm] = key.split('-').map(Number);
          if (ry === anchorYear && rm === m && row.is_purchased === 1) amount += row.jpy_amount;
        }
        return { key: `m${m}`, label: `${m}`, amount };
      });
    }
    if (period === 'month') {
      const days = daysInMonth(anchorYear, anchorMonth);
      return Array.from({ length: days }, (_, i) => i + 1).map((day) => {
        let amount = 0;
        for (const row of history) {
          const key = rowToDateKey(row);
          const [ry, rm, rd] = key.split('-').map(Number);
          if (ry === anchorYear && rm === anchorMonth && rd === day && row.is_purchased === 1) amount += row.jpy_amount;
        }
        return { key: `d${day}`, label: `${day}`, amount };
      });
    }
    // today: グラフは使わず一覧表示にするため、ここでは空
    return [];
  }, [history, period, anchorYear, anchorMonth]);

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

  /**
   * カテゴリー別集計。**絞り込み条件は上の`tripSummary`と完全に同じ**
   * （`is_purchased === 1` かつ `matchesPeriod(...)`）にする。片方だけ候補を含めると、
   * 同じ画面に並ぶ2枚のカードで合計が食い違って見えるため。
   * 集計そのものは`config/categories.ts`の`aggregateByCategory`
   * （純粋関数・`node --test`で検証済み）に委ねる。
   */
  const categorySummary = useMemo(() => {
    const rows = history
      .filter(
        (row) =>
          row.is_purchased === 1 &&
          matchesPeriod(rowToDateKey(row), period, anchorYear, anchorMonth, todayKey),
      )
      .map((row) => ({ category: row.category, jpyAmount: row.jpy_amount }));
    return aggregateByCategory(rows);
  }, [history, period, anchorYear, anchorMonth, todayKey]);

  const maxAmount = Math.max(...chartData.map((d) => d.amount), 1);
  const hasAnyAmount = chartData.some((d) => d.amount > 0);
  const selectedBar = chartData.find((d) => d.key === selectedBarKey) ?? null;

  // 選択中の棒が何を表すか分かる自然文（例：「6月の購入済み」「6月7日の購入済み」）
  // グラフは年表示・月表示のみなので、今日表示のケースはここでは発生しない
  const selectedAmountLabel = selectedBar
    ? period === 'year'
      ? `${selectedBar.label}月の購入済み`
      : `${anchorMonth}月${selectedBar.label}日の購入済み`
    : '';

  const periodNavLabel =
    period === 'year'
      ? `${anchorYear}年`
      : period === 'month'
        ? `${anchorYear}年${anchorMonth}月`
        : `${todayDate.getFullYear()}年${todayDate.getMonth() + 1}月${todayDate.getDate()}日（${WEEKDAYS_JA[todayDate.getDay()]}）`;

  const summaryTitle =
    period === 'year' ? `${anchorYear}年のまとめ` : period === 'month' ? `${anchorYear}年${anchorMonth}月のまとめ` : '今日のまとめ';

  // グラフを使うのは年表示・月表示のみ（今日表示は購入済み一覧を別途表示する）
  const chartTitle = period === 'year' ? '月別購入済み推移' : '日別購入済み推移';

  const chartEmptyMessage =
    period === 'year' ? 'この年の購入済み記録はまだありません' : 'この月の購入済み記録はまだありません';

  const tripSummaryTitle =
    period === 'year' ? '今年の旅行別購入済み' : period === 'month' ? '今月の旅行別購入済み' : '今日の旅行別購入済み';

  const categorySummaryTitle =
    period === 'year' ? '今年のカテゴリー別' : period === 'month' ? '今月のカテゴリー別' : '今日のカテゴリー別';

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

          {/* 期間切替 */}
          <View style={styles.periodSwitch}>
            {([
              { key: 'today', label: '今日' },
              { key: 'month', label: '月' },
              { key: 'year', label: '年' },
            ] as const).map((opt) => (
              <TouchableOpacity
                key={opt.key}
                style={[styles.periodSwitchBtn, period === opt.key && styles.periodSwitchBtnActive]}
                onPress={() => changePeriod(opt.key)}
                activeOpacity={0.7}>
                <ThemedText
                  style={[styles.periodSwitchText, period === opt.key && styles.periodSwitchTextActive]}>
                  {opt.label}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </View>

          {/* 期間ナビ */}
          <View style={[styles.periodNav, period === 'today' && styles.periodNavCentered]}>
            {period !== 'today' && (
              <TouchableOpacity onPress={goPrev} hitSlop={12} activeOpacity={0.7}>
                <ThemedText style={styles.navArrow}>‹</ThemedText>
              </TouchableOpacity>
            )}
            <ThemedText style={styles.yearLabel}>{periodNavLabel}</ThemedText>
            {period !== 'today' && (
              <TouchableOpacity onPress={goNext} hitSlop={12} activeOpacity={0.7}>
                <ThemedText style={styles.navArrow}>›</ThemedText>
              </TouchableOpacity>
            )}
          </View>

          {/* まとめ */}
          <View style={styles.card}>
            <ThemedText style={styles.cardTitle}>{summaryTitle}</ThemedText>
            <View style={styles.statsGrid}>
              <View style={[styles.statItem, styles.statItemPurchased]}>
                <ThemedText style={styles.statLabel}>購入済み合計</ThemedText>
                <ThemedText style={[styles.statValue, styles.statValuePurchased]}>{formatJpy(periodStats.purchasedTotal)}</ThemedText>
              </View>
              <View style={[styles.statItem, styles.statItemCandidate]}>
                <ThemedText style={styles.statLabel}>候補合計</ThemedText>
                <ThemedText style={[styles.statValue, styles.statValueCandidate]}>{formatJpy(periodStats.candidateTotal)}</ThemedText>
              </View>
              <View style={styles.statItem}>
                <ThemedText style={styles.statLabel}>保存件数</ThemedText>
                <ThemedText style={styles.statValue}>{periodStats.totalCount}件</ThemedText>
              </View>
              <View style={styles.statItem}>
                <ThemedText style={styles.statLabel}>購入済み</ThemedText>
                <ThemedText style={styles.statValue}>{periodStats.purchasedCount}件</ThemedText>
              </View>
            </View>
          </View>

          {/* 今日表示：グラフの代わりに購入済み一覧 */}
          {period === 'today' && (
            <View style={styles.card}>
              <ThemedText style={styles.cardTitle}>今日の購入済み</ThemedText>
              {todayPurchases.length === 0 ? (
                <ThemedText style={styles.emptyText}>今日の購入済みはまだありません</ThemedText>
              ) : (
                <View style={styles.todayList}>
                  {todayPurchases.map((p, i) => (
                    <View key={p.id} style={[styles.todayRow, i > 0 && styles.todayRowBorder]}>
                      <View style={styles.todayRowLeft}>
                        <ThemedText style={styles.todayTime}>{p.time}</ThemedText>
                        {p.tripName && (
                          <ThemedText style={styles.todayTrip} numberOfLines={1}>{p.tripName}</ThemedText>
                        )}
                      </View>
                      <ThemedText style={styles.todayAmount}>{formatJpy(p.amount)}</ThemedText>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* 月表示・年表示：棒グラフ */}
          {period !== 'today' && (
            <View style={styles.card}>
              <ThemedText style={styles.cardTitle}>{chartTitle}</ThemedText>
              {!hasAnyAmount ? (
                <ThemedText style={styles.emptyText}>{chartEmptyMessage}</ThemedText>
              ) : (
                <View style={styles.chartWrap}>
                  {selectedBar && selectedBar.amount > 0 ? (
                    <View style={styles.selectedAmountCard}>
                      <ThemedText style={styles.selectedAmountLabel} numberOfLines={1}>
                        {selectedAmountLabel}
                      </ThemedText>
                      <ThemedText
                        style={styles.selectedAmountValue}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.6}>
                        {formatJpy(selectedBar.amount)}
                      </ThemedText>
                    </View>
                  ) : (
                    <ThemedText style={styles.selectedAmountHint}>
                      棒をタップすると、その金額が表示されます
                    </ThemedText>
                  )}
                  {period === 'month' ? (
                    // 月表示：31日分を1画面に収めず、横スクロールで日付が読める幅で表示する
                    <>
                      <ThemedText style={styles.scrollHint}>
                        横にスワイプして月末まで確認できます →
                      </ThemedText>
                      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.monthScrollContent}>
                        <View>
                          <View style={[styles.barsRow, { height: CHART_H }]}>
                            {chartData.map((d) => {
                              const isSelected = d.key === selectedBarKey;
                              const hasData = d.amount > 0;
                              const barH = barHeightFor(d.amount, maxAmount);
                              return (
                                <Pressable
                                  key={d.key}
                                  style={[styles.barColFixed, { width: dayColWidth }]}
                                  disabled={!hasData}
                                  onPress={() => setSelectedBarKey((prev) => (prev === d.key ? null : d.key))}>
                                  <View
                                    style={[
                                      styles.barRect,
                                      { height: barH },
                                      hasData
                                        ? (isSelected ? styles.barRectSelected : styles.barRectActive)
                                        : styles.barRectEmpty,
                                    ]}
                                  />
                                </Pressable>
                              );
                            })}
                          </View>
                          <View style={styles.monthRow}>
                            {chartData.map((d) => (
                              <ThemedText
                                key={d.key}
                                style={[
                                  styles.barMonthLabelFixed,
                                  { width: dayColWidth },
                                  d.key === selectedBarKey && styles.barMonthLabelActive,
                                ]}>
                                {d.label}
                              </ThemedText>
                            ))}
                          </View>
                        </View>
                      </ScrollView>
                    </>
                  ) : (
                    // 年表示：12ヶ月分は従来通り1画面に収める
                    <>
                      <View style={[styles.barsRow, { height: CHART_H }]}>
                        {chartData.map((d) => {
                          const isSelected = d.key === selectedBarKey;
                          const hasData = d.amount > 0;
                          const barH = barHeightFor(d.amount, maxAmount);
                          return (
                            <Pressable
                              key={d.key}
                              style={styles.barCol}
                              disabled={!hasData}
                              onPress={() => setSelectedBarKey((prev) => (prev === d.key ? null : d.key))}>
                              <View
                                style={[
                                  styles.barRect,
                                  { height: barH },
                                  hasData
                                    ? (isSelected ? styles.barRectSelected : styles.barRectActive)
                                    : styles.barRectEmpty,
                                ]}
                              />
                            </Pressable>
                          );
                        })}
                      </View>
                      <View style={styles.monthRow}>
                        {chartData.map((d) => (
                          <ThemedText
                            key={d.key}
                            style={[styles.barMonthLabel, d.key === selectedBarKey && styles.barMonthLabelActive]}>
                            {d.label}
                          </ThemedText>
                        ))}
                      </View>
                    </>
                  )}
                </View>
              )}
            </View>
          )}

          {/* 旅行別購入済み合計（データあり時のみ表示） */}
          {/* カテゴリー別（Pro機能）。カテゴリーの保存自体は無料版でもできるが、集計はPro。
              無料版でも存在は隠さず、何が得られるのかが分かる導線を出す（過度な煽りは置かない）。 */}
          {SHOW_PRO && (
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <ThemedText style={styles.cardTitle}>{categorySummaryTitle}</ThemedText>
                {!isPro && <ProFeatureBadge />}
              </View>

              {isPro ? (
                categorySummary.length === 0 ? (
                  <ThemedText style={styles.emptyText}>この期間の購入済み記録はまだありません</ThemedText>
                ) : (
                  <View style={styles.tripList}>
                    {categorySummary.map((c, i) => (
                      <View key={c.id ?? 'uncategorized'} style={[styles.tripRow, i > 0 && styles.tripRowBorder]}>
                        <View style={styles.categoryMain}>
                          <ThemedText style={styles.tripName} numberOfLines={1}>{c.label}</ThemedText>
                          <View style={styles.shareTrack}>
                            <View style={[styles.shareFill, { width: `${Math.round(c.share * 100)}%` }]} />
                          </View>
                        </View>
                        <View style={styles.tripRight}>
                          <ThemedText style={styles.tripAmount}>{formatJpy(c.total)}</ThemedText>
                          <ThemedText style={styles.tripCount}>
                            {c.count}件・{Math.round(c.share * 100)}%
                          </ThemedText>
                        </View>
                      </View>
                    ))}
                  </View>
                )
              ) : (
                <>
                  <ThemedText style={styles.lockedNote}>
                    カテゴリー別の合計金額・件数・構成比をProで確認できます。カテゴリーの保存は無料版でも使えます。
                  </ThemedText>
                  {/* ProFeatureBadge自体は購入導線を持たない部品なので、行をPressableで包んで/proへ送る */}
                  <Pressable
                    onPress={() => router.push('/pro')}
                    style={({ pressed }) => [styles.lockedCta, pressed && styles.lockedCtaPressed]}
                    accessibilityRole="button"
                    accessibilityLabel="Proプランを見る">
                    <ThemedText style={styles.lockedCtaText}>Proプランを見る</ThemedText>
                  </Pressable>
                </>
              )}
            </View>
          )}

          {tripSummary.length > 0 && (
            <View style={styles.card}>
              <ThemedText style={styles.cardTitle}>{tripSummaryTitle}</ThemedText>
              <View style={styles.tripList}>
                {tripSummary.map((t, i) => {
                  return (
                    <View key={i} style={[styles.tripRow, i > 0 && styles.tripRowBorder]}>
                      <CurrencyFlagImage currency={t.currency as CurrencyCode} size={16} outlined />
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
  screen: { flex: 1, backgroundColor: DT.colors.background },
  safe: { flex: 1 },
  scroll: {
    paddingHorizontal: DT.spacing.lg,
    paddingTop: DT.spacing.md,
    paddingBottom: 96,
    gap: 14,
  },

  header: { paddingBottom: 2 },
  screenTitle: {
    fontSize: DT.fontSize.lg,
    fontWeight: DT.fontWeight.bold,
    color: DT.colors.textPrimary,
    letterSpacing: -0.3,
  },

  // ── 期間切替 ──
  periodSwitch: {
    flexDirection: 'row',
    backgroundColor: DT.colors.surface,
    borderRadius: DT.radius.pill,
    padding: 3,
    gap: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DT.colors.border,
    ...DT.shadow.card,
  },
  periodSwitchBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: DT.radius.pill,
    alignItems: 'center',
  },
  periodSwitchBtnActive: {
    backgroundColor: DT.colors.primary,
  },
  periodSwitchText: {
    fontSize: DT.fontSize.sm,
    fontWeight: DT.fontWeight.semibold,
    color: DT.colors.textSecondary,
  },
  periodSwitchTextActive: {
    color: '#fff',
    fontWeight: DT.fontWeight.bold,
  },

  // ── 期間ナビ ──
  periodNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: DT.colors.surface,
    borderRadius: DT.radius.lg,
    paddingHorizontal: DT.spacing.xl,
    paddingVertical: DT.spacing.sm + 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DT.colors.border,
    ...DT.shadow.card,
  },
  periodNavCentered: {
    justifyContent: 'center',
  },
  navArrow: {
    fontSize: 26,
    fontWeight: '300',
    color: DT.colors.primary,
    lineHeight: 32,
  },
  yearLabel: {
    fontSize: 17,
    fontWeight: DT.fontWeight.bold,
    color: DT.colors.textPrimary,
    letterSpacing: -0.2,
  },

  // ── カード共通 ──
  card: {
    backgroundColor: DT.colors.surface,
    borderRadius: DT.radius.lg,
    padding: DT.spacing.lg,
    gap: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DT.colors.border,
    ...DT.shadow.card,
  },
  cardTitle: {
    fontSize: DT.fontSize.sm,
    fontWeight: DT.fontWeight.bold,
    color: DT.colors.textPrimary,
  },
  emptyText: {
    fontSize: DT.fontSize.xs,
    color: DT.colors.textMuted,
    textAlign: 'center',
    paddingVertical: 20,
  },

  // ── まとめ ──
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: DT.spacing.sm,
  },
  statItem: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: DT.colors.background,
    borderRadius: DT.radius.sm,
    padding: DT.spacing.md,
    gap: 4,
    alignItems: 'center',
  },
  statItemPurchased: {
    backgroundColor: DT.colors.purchasedBg,
  },
  statItemCandidate: {
    backgroundColor: DT.colors.candidateBg,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: DT.fontWeight.semibold,
    color: DT.colors.textMuted,
    textAlign: 'center',
  },
  statValue: {
    fontSize: DT.fontSize.lg,
    fontWeight: DT.fontWeight.bold,
    color: DT.colors.textPrimary,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  statValuePurchased: {
    color: DT.colors.purchased,
  },
  statValueCandidate: {
    color: DT.colors.candidate,
  },

  // ── 縦棒グラフ ──
  selectedAmountCard: {
    backgroundColor: DT.colors.primarySoft,
    borderRadius: DT.radius.md,
    paddingVertical: DT.spacing.md,
    paddingHorizontal: DT.spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 64,
    marginBottom: DT.spacing.md,
  },
  selectedAmountLabel: {
    fontSize: DT.fontSize.xs,
    lineHeight: 16,
    fontWeight: DT.fontWeight.semibold,
    color: DT.colors.primaryDark,
    textAlign: 'center',
  },
  selectedAmountValue: {
    // 大きい金額（¥1,234,567 等）でも1行で見切れないよう、フォントを少し抑えつつ
    // lineHeightに余裕を持たせ、letterSpacingは負値にしない（幅計算のずれによる見切れを避ける）
    fontSize: 22,
    lineHeight: 28,
    fontWeight: DT.fontWeight.bold,
    color: DT.colors.primaryDark,
    textAlign: 'center',
  },
  selectedAmountHint: {
    fontSize: DT.fontSize.xs,
    color: DT.colors.textMuted,
    textAlign: 'center',
    marginBottom: DT.spacing.md,
  },
  chartWrap: { gap: 0 },
  scrollHint: {
    fontSize: DT.fontSize.xs - 1,
    color: DT.colors.textMuted,
    marginBottom: DT.spacing.sm,
  },
  monthScrollContent: {
    paddingRight: DT.spacing.md,
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  barCol: {
    flex: 1,
    alignItems: 'center',
  },
  barColFixed: {
    // 幅は画面サイズに応じてrenderで計算するため、ここでは指定しない
    alignItems: 'center',
  },
  barRect: {
    width: '80%',
    borderRadius: 4,
  },
  barRectActive: {
    // 未選択・データあり：スレートブルー（旧・黒〜濃灰色から変更。選択中tealとの差は維持）
    backgroundColor: color.chartBar,
  },
  barRectSelected: {
    // 選択中：濃いティールで強調
    backgroundColor: DT.colors.primaryDark,
    width: '95%',
  },
  barRectEmpty: {
    backgroundColor: DT.colors.borderSoft,
  },
  monthRow: {
    flexDirection: 'row',
    marginTop: DT.spacing.sm - 2,
    // barsRowと同じgapにして列位置を揃える（gap不一致だと横スクロール月表示で
    // 棒とラベルが右へ行くほどズレ、選択日付が棒の見た目位置と合わなくなる）
    gap: 2,
  },
  barMonthLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 10,
    fontWeight: DT.fontWeight.medium,
    color: DT.colors.textSecondary,
  },
  barMonthLabelFixed: {
    // 幅は画面サイズに応じてrenderで計算するため、ここでは指定しない
    textAlign: 'center',
    fontSize: 10,
    fontWeight: DT.fontWeight.medium,
    color: DT.colors.textSecondary,
  },
  barMonthLabelActive: {
    fontWeight: DT.fontWeight.bold,
    color: DT.colors.primaryDark,
  },

  // ── 今日の購入済み一覧 ──
  todayList: { gap: 0 },
  todayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: DT.spacing.md - 2,
    gap: DT.spacing.sm,
  },
  todayRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: DT.colors.border,
  },
  todayRowLeft: {
    flex: 1,
    gap: 1,
  },
  todayTime: {
    fontSize: DT.fontSize.sm,
    fontWeight: DT.fontWeight.bold,
    color: DT.colors.textPrimary,
    letterSpacing: -0.2,
  },
  todayTrip: {
    fontSize: DT.fontSize.xs,
    fontWeight: DT.fontWeight.medium,
    color: DT.colors.textMuted,
  },
  todayAmount: {
    fontSize: DT.fontSize.sm + 1,
    fontWeight: DT.fontWeight.bold,
    color: DT.colors.textPrimary,
    letterSpacing: -0.3,
  },

  // ── 旅行別一覧 ──
  tripList: { gap: 0 },
  tripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: DT.spacing.md - 2,
    gap: DT.spacing.sm,
  },
  tripRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: DT.colors.border,
  },
  tripName: {
    flex: 1,
    fontSize: DT.fontSize.sm,
    fontWeight: DT.fontWeight.semibold,
    color: DT.colors.textPrimary,
  },
  tripRight: {
    alignItems: 'flex-end',
    gap: 1,
  },
  tripAmount: {
    fontSize: DT.fontSize.sm + 1,
    fontWeight: DT.fontWeight.bold,
    color: DT.colors.textPrimary,
    letterSpacing: -0.3,
  },
  tripCount: {
    fontSize: DT.fontSize.xs - 1,
    fontWeight: DT.fontWeight.medium,
    color: DT.colors.textMuted,
  },

  // ── カテゴリー別（Pro） ──
  // 行の骨格は既存のtripRow/tripRight/tripAmount/tripCountをそのまま再利用し、
  // 構成比バーとPro導線の分だけを足す（新しいdashboardは作らない）。
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: DT.spacing.sm,
  },
  categoryMain: { flex: 1, gap: 5 },
  shareTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: DT.colors.border,
    overflow: 'hidden',
  },
  shareFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: color.primary,
  },
  lockedNote: {
    fontSize: DT.fontSize.xs,
    color: DT.colors.textMuted,
    lineHeight: 19,
    marginTop: 6,
  },
  lockedCta: {
    marginTop: 12,
    paddingVertical: 11,
    borderRadius: DT.radius.md,
    borderWidth: 1.5,
    borderColor: color.primary,
    alignItems: 'center',
  },
  lockedCtaPressed: { opacity: 0.85 },
  lockedCtaText: {
    fontSize: DT.fontSize.sm,
    fontWeight: DT.fontWeight.bold,
    color: color.primaryDark,
  },
});
