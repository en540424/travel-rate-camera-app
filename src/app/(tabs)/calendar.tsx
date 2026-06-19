import * as FileSystem from 'expo-file-system/legacy';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Image } from 'expo-image';

import { PhotoModal } from '@/components/photo-modal';
import { ThemedText } from '@/components/themed-text';
import { DT } from '@/constants/designTokens';
import type { CurrencyCode } from '@/constants/currencies';
import { CURRENCIES } from '@/constants/currencies';
import type { HistoryRow } from '@/db/queries/history';
import { useAllHistory } from '@/hooks/use-all-history';
import { formatJpy, formatRate } from '@/utils/format';

// ─── 日付ユーティリティ ───────────────────────────────────────────

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function rowToDateKey(row: HistoryRow): string {
  if (row.entry_date) return row.entry_date;
  const iso = row.created_at.includes('T') ? row.created_at : `${row.created_at.replace(' ', 'T')}Z`;
  return toDateKey(new Date(iso));
}

function formatDateLabel(dateKey: string): string {
  const [, m, d] = dateKey.split('-');
  return `${parseInt(m, 10)}月${parseInt(d, 10)}日`;
}

// ─── 通貨フラグ（最大2個 + '+' 表示） ───────────────────────────────

function getDayFlags(rows: HistoryRow[]): string {
  const seen = new Set<CurrencyCode>();
  const codes: CurrencyCode[] = [];
  for (const r of rows) {
    if (!seen.has(r.currency)) {
      seen.add(r.currency);
      codes.push(r.currency);
    }
  }
  const flags = codes.slice(0, 2).map((c) => CURRENCIES[c].flag).join('');
  return codes.length > 2 ? flags + '+' : flags;
}

// ─── カレンダーグリッド生成 ──────────────────────────────────────

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

interface CalCell {
  day: number;
  dateKey: string;
  isCurrentMonth: boolean;
}

function buildCalendar(year: number, month: number): CalCell[] {
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();
  const cells: CalCell[] = [];

  for (let i = firstDow - 1; i >= 0; i--) {
    const d = daysInPrev - i;
    const key = toDateKey(new Date(year, month - 1, d));
    cells.push({ day: d, dateKey: key, isCurrentMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, dateKey: toDateKey(new Date(year, month, d)), isCurrentMonth: true });
  }
  const trailing = 42 - cells.length;
  for (let d = 1; d <= trailing; d++) {
    cells.push({ day: d, dateKey: toDateKey(new Date(year, month + 1, d)), isCurrentMonth: false });
  }
  return cells;
}

// ─── メイン画面 ──────────────────────────────────────────────────

export default function CalendarScreen() {
  const today = new Date();
  const [displayYear, setDisplayYear] = useState(today.getFullYear());
  const [displayMonth, setDisplayMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const { history, tripMap, togglePurchased, removeEntry, reload } = useAllHistory();
  const [photoModalUri, setPhotoModalUri] = useState<string | null>(null);

  function handleDeleteItem(item: HistoryRow) {
    Alert.alert(
      '記録を削除しますか？',
      'この記録を削除します。この操作は取り消せません。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除',
          style: 'destructive',
          onPress: async () => {
            if (item.image_uri && Platform.OS !== 'web') {
              try {
                await FileSystem.deleteAsync(item.image_uri, { idempotent: true });
              } catch {}
            }
            removeEntry(item.id);
          },
        },
      ],
    );
  }

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  // 日付 → 履歴行 のマップ（全旅行）
  const grouped = useMemo(() => {
    const map = new Map<string, HistoryRow[]>();
    for (const row of history) {
      const key = rowToDateKey(row);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return map;
  }, [history]);

  const cells = useMemo(
    () => buildCalendar(displayYear, displayMonth),
    [displayYear, displayMonth],
  );

  const todayKey = toDateKey(today);

  function prevMonth() {
    if (displayMonth === 0) {
      setDisplayYear((y) => y - 1);
      setDisplayMonth(11);
    } else {
      setDisplayMonth((m) => m - 1);
    }
    setSelectedDate(null);
  }

  function nextMonth() {
    if (displayMonth === 11) {
      setDisplayYear((y) => y + 1);
      setDisplayMonth(0);
    } else {
      setDisplayMonth((m) => m + 1);
    }
    setSelectedDate(null);
  }

  function handleDayPress(cell: CalCell) {
    if (!cell.isCurrentMonth) return;
    setSelectedDate((prev) => (prev === cell.dateKey ? null : cell.dateKey));
  }

  const selectedRows = useMemo(
    () => (selectedDate ? (grouped.get(selectedDate) ?? []) : []),
    [selectedDate, grouped],
  );

  // 旅行ごとにグループ化（trip_id → rows）
  const tripGroups = useMemo(() => {
    const groups = new Map<number | null, HistoryRow[]>();
    for (const r of selectedRows) {
      const key = r.trip_id ?? null;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    return groups;
  }, [selectedRows]);

  return (
    <View style={styles.screen}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">

          {/* ヘッダー */}
          <View style={styles.header}>
            <ThemedText style={styles.screenTitle}>買い物カレンダー</ThemedText>
          </View>

          {/* カレンダーカード */}
          <View style={styles.calCard}>
            {/* 月ナビ */}
            <View style={styles.monthNav}>
              <TouchableOpacity onPress={prevMonth} hitSlop={12} activeOpacity={0.7}>
                <ThemedText style={styles.navArrow}>‹</ThemedText>
              </TouchableOpacity>
              <ThemedText style={styles.monthLabel}>
                {displayYear}年{displayMonth + 1}月
              </ThemedText>
              <TouchableOpacity onPress={nextMonth} hitSlop={12} activeOpacity={0.7}>
                <ThemedText style={styles.navArrow}>›</ThemedText>
              </TouchableOpacity>
            </View>

            {/* 曜日ヘッダー */}
            <View style={styles.weekRow}>
              {WEEKDAYS.map((w, i) => (
                <ThemedText
                  key={w}
                  style={[
                    styles.weekLabel,
                    i === 0 && styles.sunday,
                    i === 6 && styles.saturday,
                  ]}>
                  {w}
                </ThemedText>
              ))}
            </View>

            {/* 日付グリッド（6行 × 7列） */}
            {Array.from({ length: 6 }, (_, row) => (
              <View key={row} style={styles.weekRow}>
                {cells.slice(row * 7, row * 7 + 7).map((cell) => {
                  const rows = grouped.get(cell.dateKey) ?? [];
                  const hasEntries = rows.length > 0;
                  const isToday = cell.dateKey === todayKey;
                  const isSelected = cell.dateKey === selectedDate;
                  const flags = hasEntries && cell.isCurrentMonth ? getDayFlags(rows) : '';
                  const hasPurchased = rows.some((r) => r.is_purchased === 1);

                  return (
                    <TouchableOpacity
                      key={cell.dateKey}
                      style={[
                        styles.dayCell,
                        isSelected && styles.dayCellSelected,
                        isToday && !isSelected && styles.dayCellToday,
                      ]}
                      onPress={() => handleDayPress(cell)}
                      activeOpacity={cell.isCurrentMonth ? 0.7 : 1}
                      disabled={!cell.isCurrentMonth}>
                      <ThemedText
                        style={[
                          styles.dayNum,
                          !cell.isCurrentMonth && styles.dayNumOther,
                          isToday && styles.dayNumToday,
                          isSelected && styles.dayNumSelected,
                          cell.isCurrentMonth && !isSelected &&
                            cells.indexOf(cell) % 7 === 0 && styles.sunday,
                          cell.isCurrentMonth && !isSelected &&
                            cells.indexOf(cell) % 7 === 6 && styles.saturday,
                        ]}>
                        {cell.day}
                      </ThemedText>
                      {flags ? (
                        <ThemedText style={styles.dayFlags}>{flags}</ThemedText>
                      ) : hasEntries && cell.isCurrentMonth ? (
                        <View style={[styles.dot, hasPurchased && styles.dotPurchased]} />
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>

          {/* 選択日の詳細パネル */}
          {selectedDate && (
            <View style={styles.detailCard}>
              <ThemedText style={styles.detailTitle}>
                {formatDateLabel(selectedDate)}の記録
              </ThemedText>

              {selectedRows.length === 0 ? (
                <ThemedText style={styles.detailEmpty}>
                  この日の記録はありません
                </ThemedText>
              ) : (
                Array.from(tripGroups.entries()).map(([tripId, rows], groupIndex) => {
                  const trip = tripId !== null ? tripMap.get(tripId) : undefined;
                  const tripName = trip?.name ?? (tripId !== null ? `旅行 #${tripId}` : '未分類');
                  const tripFlag = trip ? (CURRENCIES[trip.base_currency]?.flag ?? '') : '';

                  const purchasedRows = rows.filter((r) => r.is_purchased === 1);
                  const candidateRows = rows.filter((r) => r.is_purchased === 0);
                  const purchasedTotal = purchasedRows.reduce((s, r) => s + r.jpy_amount, 0);
                  const candidateTotal = candidateRows.reduce((s, r) => s + r.jpy_amount, 0);

                  return (
                    <View
                      key={String(tripId)}
                      style={[styles.tripGroup, groupIndex > 0 && styles.tripGroupBorder]}>

                      {/* 旅行ヘッダー */}
                      <View style={styles.tripGroupHeader}>
                        {tripFlag ? (
                          <ThemedText style={styles.tripGroupFlag}>{tripFlag}</ThemedText>
                        ) : null}
                        <ThemedText style={styles.tripGroupName}>{tripName}</ThemedText>
                      </View>

                      {/* サマリー */}
                      <View style={styles.summaryRow}>
                        <View style={styles.summaryItem}>
                          <ThemedText style={styles.summaryItemLabel}>購入済み合計</ThemedText>
                          <ThemedText style={styles.summaryItemValue}>
                            {formatJpy(purchasedTotal)}
                          </ThemedText>
                        </View>
                        <View style={styles.summaryItem}>
                          <ThemedText style={styles.summaryItemLabel}>候補合計</ThemedText>
                          <ThemedText style={styles.summaryItemValue}>
                            {formatJpy(candidateTotal)}
                          </ThemedText>
                        </View>
                        <View style={styles.summaryItem}>
                          <ThemedText style={styles.summaryItemLabel}>候補</ThemedText>
                          <ThemedText style={styles.summaryItemValue}>
                            {candidateRows.length}件
                          </ThemedText>
                        </View>
                        <View style={styles.summaryItem}>
                          <ThemedText style={styles.summaryItemLabel}>購入済み</ThemedText>
                          <ThemedText style={styles.summaryItemValue}>
                            {purchasedRows.length}件
                          </ThemedText>
                        </View>
                      </View>

                      {/* 履歴カード */}
                      <View style={styles.cardList}>
                        {rows.map((item) => {
                          const isPurchased = item.is_purchased === 1;
                          const c = CURRENCIES[item.currency];
                          return (
                            <View key={item.id} style={styles.historyCard}>
                              <View style={item.image_uri ? styles.calCardRow : undefined}>
                                {item.image_uri && (
                                  <TouchableOpacity
                                    onPress={() => setPhotoModalUri(item.image_uri!)}
                                    activeOpacity={0.8}
                                    style={styles.calThumbCol}>
                                    <Image
                                      source={{ uri: item.image_uri }}
                                      style={styles.calThumb}
                                      contentFit="cover"
                                    />
                                  </TouchableOpacity>
                                )}
                                <View style={item.image_uri ? styles.calCardRight : undefined}>
                                  <View style={styles.cardTop}>
                                    <View style={styles.cardLeft}>
                                      <ThemedText style={styles.cardFlag}>{c.flag}</ThemedText>
                                      <View style={styles.cardAmounts}>
                                        {item.currency !== 'JPY' && (
                                          <ThemedText style={styles.cardForeign}>
                                            {c.symbol}{item.foreign_amount.toLocaleString()}
                                          </ThemedText>
                                        )}
                                        <ThemedText
                                          style={[styles.cardJpy, isPurchased && styles.cardJpyDim]}>
                                          {item.currency === 'JPY'
                                            ? formatJpy(item.jpy_amount)
                                            : `約 ${formatJpy(item.jpy_amount)}`}
                                        </ThemedText>
                                      </View>
                                    </View>
                                    <TouchableOpacity
                                      style={[styles.badge, isPurchased && styles.badgePurchased]}
                                      onPress={() =>
                                        togglePurchased(item.id, item.is_purchased ?? 0)
                                      }
                                      hitSlop={8}>
                                      <ThemedText
                                        style={[
                                          styles.badgeText,
                                          isPurchased && styles.badgeTextPurchased,
                                        ]}>
                                        {isPurchased ? '✓ 購入済み' : '候補'}
                                      </ThemedText>
                                    </TouchableOpacity>
                                  </View>

                                  {item.memo ? (
                                    <View style={styles.memoChip}>
                                      <ThemedText style={styles.memoChipText}>{item.memo}</ThemedText>
                                    </View>
                                  ) : null}
                                </View>
                              </View>

                              <View style={styles.cardFooter}>
                                <ThemedText style={styles.cardRate}>
                                  {formatRate(item.rate_used, item.currency)}
                                </ThemedText>
                                <TouchableOpacity
                                  onPress={() => handleDeleteItem(item)}
                                  hitSlop={8}>
                                  <ThemedText style={styles.deleteLink}>削除</ThemedText>
                                </TouchableOpacity>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          )}

        </ScrollView>
      </SafeAreaView>

      {/* 写真フルスクリーンモーダル */}
      <PhotoModal uri={photoModalUri} onClose={() => setPhotoModalUri(null)} />
    </View>
  );
}

// ─── スタイル ────────────────────────────────────────────────────

const { colors: C, radius: R, spacing: S } = DT;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  safe: { flex: 1 },
  scroll: {
    paddingHorizontal: S.lg,
    paddingTop: S.md,
    paddingBottom: 96,
    gap: 14,
  },

  header: { paddingBottom: 2 },
  screenTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: C.textPrimary,
    letterSpacing: -0.3,
  },

  // ── カレンダーカード ──
  calCard: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },

  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: 10,
  },
  navArrow: {
    fontSize: 26,
    fontWeight: '300',
    color: C.primary,
    lineHeight: 32,
  },
  monthLabel: {
    fontSize: 17,
    fontWeight: '700',
    color: C.textPrimary,
    letterSpacing: -0.2,
  },

  weekRow: {
    flexDirection: 'row',
  },
  weekLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    color: C.textMuted,
    paddingVertical: 4,
  },
  sunday:   { color: '#EF4444' },
  saturday: { color: '#3B82F6' },

  dayCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
    borderRadius: R.sm,
    minHeight: 44,
    gap: 2,
  },
  dayCellSelected: {
    backgroundColor: C.primary,
  },
  dayCellToday: {
    backgroundColor: C.primarySoft,
  },
  dayNum: {
    fontSize: 14,
    fontWeight: '500',
    color: C.textPrimary,
    lineHeight: 18,
  },
  dayNumOther:    { color: C.textMuted, fontWeight: '400' },
  dayNumToday:    { color: C.primary, fontWeight: '700' },
  dayNumSelected: { color: '#fff', fontWeight: '700' },

  dayFlags: {
    fontSize: 10,
    lineHeight: 13,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: C.textMuted,
  },
  dotPurchased: {
    backgroundColor: C.primary,
  },

  // ── 詳細パネル ──
  detailCard: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: S.lg,
    gap: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  detailTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: C.textPrimary,
  },
  detailEmpty: {
    fontSize: 14,
    color: C.textMuted,
    textAlign: 'center',
    paddingVertical: 12,
  },

  // ── 旅行グループ ──
  tripGroup: {
    gap: 10,
  },
  tripGroupBorder: {
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
  },
  tripGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tripGroupFlag: {
    fontSize: 18,
    lineHeight: 22,
  },
  tripGroupName: {
    fontSize: 15,
    fontWeight: '700',
    color: C.textPrimary,
  },

  summaryRow: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  summaryItemLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: C.textMuted,
    textAlign: 'center',
  },
  summaryItemValue: {
    fontSize: 13,
    fontWeight: '700',
    color: C.textPrimary,
    textAlign: 'center',
  },

  cardList: { gap: 10 },

  historyCard: {
    backgroundColor: C.background,
    borderRadius: R.md,
    padding: 10,
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  calCardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  calThumbCol: {
    flexShrink: 0,
  },
  calCardRight: {
    flex: 1,
    gap: 4,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  cardFlag: {
    fontSize: 22,
    lineHeight: 28,
  },
  cardAmounts: { gap: 1 },
  cardForeign: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textSecondary,
  },
  cardJpy: {
    fontSize: 20,
    fontWeight: '700',
    color: C.textPrimary,
    letterSpacing: -0.4,
  },
  cardJpyDim: { opacity: 0.45 },

  badge: {
    backgroundColor: C.candidateBg,
    borderRadius: R.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgePurchased: { backgroundColor: C.purchasedBg },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: C.candidate,
    letterSpacing: 0.3,
  },
  badgeTextPurchased: { color: C.purchased },

  memoChip: {
    alignSelf: 'flex-start',
    backgroundColor: C.surface,
    borderRadius: DT.radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  memoChipText: {
    fontSize: 12,
    color: C.textSecondary,
    fontWeight: '500',
  },

  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardRate: {
    fontSize: 11,
    color: C.textMuted,
    fontWeight: '500',
  },
  deleteLink: {
    fontSize: 12,
    color: C.danger,
    fontWeight: '500',
  },

  calThumb: {
    width: 72,
    height: 54,
    borderRadius: R.sm,
    backgroundColor: C.background,
  },
});
