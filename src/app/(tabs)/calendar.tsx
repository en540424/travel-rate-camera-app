import * as FileSystem from 'expo-file-system/legacy';
import { useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, View, type ImageStyle, type StyleProp } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PhotoModal } from '@/components/photo-modal';
import { ThemedText } from '@/components/themed-text';
import { CurrencyFlagImage } from '@/components/domain';
import type { CurrencyCode } from '@/constants/currencies';
import { CURRENCIES } from '@/constants/currencies';
import type { HistoryRow } from '@/db/queries/history';
import { useAllHistory } from '@/hooks/use-all-history';
import { useTrips } from '@/hooks/use-trips';
import { color, radius, shadow } from '@/theme/tokens';
import { formatJpy, formatRate } from '@/utils/format';

// ─── 日付ユーティリティ ──────────────────────────────────────────

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

// ─── 国旗PNG画像マップ ────────────────────────────────────────────

const FLAG_IMAGES: Partial<Record<CurrencyCode, number>> = {
  USD: require('@/assets/flags/us.png') as number,
  KRW: require('@/assets/flags/kr.png') as number,
  TWD: require('@/assets/flags/tw.png') as number,
  THB: require('@/assets/flags/th.png') as number,
  EUR: require('@/assets/flags/eu.png') as number,
  GBP: require('@/assets/flags/gb.png') as number,
  JPY: require('@/assets/flags/jp.png') as number,
};

// 表示styleだけの微調整（PNGは一切編集しない）。
// 日本・韓国は標準サイズのまま一切触らない（白背景のため余白を作っても見た目上意味がない）。
// 外枠（flagWrapper）は全通貨で同じ固定サイズのまま変えない。
// 米/英/台/タイ/EURだけ、その同じ外枠の中で画像を少し小さくし、上下左右に余白ができるようにする。
const FLAG_IMAGE_COMPACT_CURRENCIES = new Set<CurrencyCode>(['USD', 'GBP', 'TWD', 'THB', 'EUR']);

function getFlagImageStyle(currency: CurrencyCode | null): StyleProp<ImageStyle> {
  if (currency != null && FLAG_IMAGE_COMPACT_CURRENCIES.has(currency)) {
    return styles.flagImageCompact;
  }
  return styles.flagImage;
}

function getDayCurrency(rows: HistoryRow[]): CurrencyCode | null {
  for (const r of rows) return r.currency as CurrencyCode;
  return null;
}

function getDayFlagCount(rows: HistoryRow[]): number {
  const seen = new Set<CurrencyCode>();
  for (const r of rows) seen.add(r.currency as CurrencyCode);
  return seen.size;
}

// ─── カレンダーグリッド生成 ─────────────────────────────────────

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
    cells.push({ day: d, dateKey: toDateKey(new Date(year, month - 1, d)), isCurrentMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, dateKey: toDateKey(new Date(year, month, d)), isCurrentMonth: true });
  }
  // 最後の行を埋めるだけ（全次月行の余分な最下段は不要）
  const trailing = cells.length % 7 === 0 ? 0 : 7 - (cells.length % 7);
  for (let d = 1; d <= trailing; d++) {
    cells.push({ day: d, dateKey: toDateKey(new Date(year, month + 1, d)), isCurrentMonth: false });
  }
  return cells;
}

// ─── メイン画面 ─────────────────────────────────────────────────

export default function CalendarScreen() {
  const today = new Date();
  const todayKey = toDateKey(today);

  const [displayYear, setDisplayYear] = useState(today.getFullYear());
  const [displayMonth, setDisplayMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const { history, tripMap, togglePurchased, removeEntry, reload } = useAllHistory();
  const { activeTrip } = useTrips();
  const [photoModalUri, setPhotoModalUri] = useState<string | null>(null);

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

  // 表示月の集計
  const monthRows = useMemo(() => {
    const prefix = `${displayYear}-${String(displayMonth + 1).padStart(2, '0')}`;
    return history.filter((r) => rowToDateKey(r).startsWith(prefix));
  }, [history, displayYear, displayMonth]);

  const monthPurchasedTotal = useMemo(
    () => monthRows.filter((r) => r.is_purchased === 1).reduce((s, r) => s + r.jpy_amount, 0),
    [monthRows],
  );
  const monthCandidateTotal = useMemo(
    () => monthRows.filter((r) => r.is_purchased === 0).reduce((s, r) => s + r.jpy_amount, 0),
    [monthRows],
  );

  const cells = useMemo(
    () => buildCalendar(displayYear, displayMonth),
    [displayYear, displayMonth],
  );

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
    setSelectedDate(cell.dateKey);
  }

  const selectedRows = useMemo(
    () => (selectedDate ? (grouped.get(selectedDate) ?? []) : []),
    [selectedDate, grouped],
  );

  const tripGroups = useMemo(() => {
    const groups = new Map<number | null, HistoryRow[]>();
    for (const r of selectedRows) {
      const key = r.trip_id ?? null;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    return groups;
  }, [selectedRows]);

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
              try { await FileSystem.deleteAsync(item.image_uri, { idempotent: true }); } catch {}
            }
            removeEntry(item.id);
          },
        },
      ],
    );
  }

  return (
    <View style={styles.screen}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">

          {/* ── ヘッダー ── */}
          <View style={styles.header}>
            <ThemedText style={styles.screenTitle}>買い物カレンダー</ThemedText>
            {activeTrip && (
              <View style={[styles.tripChip, styles.tripChipRow]}>
                <CurrencyFlagImage currency={activeTrip.base_currency} size={16} outlined />
                <ThemedText style={styles.tripChipText}>{activeTrip.name}</ThemedText>
              </View>
            )}
          </View>

          {/* ── カレンダーカード ── */}
          <View style={styles.calCard}>

            {/* 月ナビ */}
            <View style={styles.monthNav}>
              <Pressable
                onPress={prevMonth}
                hitSlop={12}
                style={({ pressed }) => pressed && styles.pressed}>
                <ThemedText style={styles.navArrow}>‹</ThemedText>
              </Pressable>
              <ThemedText style={styles.monthLabel}>
                {displayYear}年{displayMonth + 1}月
              </ThemedText>
              <Pressable
                onPress={nextMonth}
                hitSlop={12}
                style={({ pressed }) => pressed && styles.pressed}>
                <ThemedText style={styles.navArrow}>›</ThemedText>
              </Pressable>
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

            {/* 日付グリッド（必要週数 × 7列） */}
            <View style={styles.calGrid}>
            {Array.from({ length: cells.length / 7 }, (_, rowIdx) => (
              <View key={rowIdx} style={styles.weekRow}>
                {cells.slice(rowIdx * 7, rowIdx * 7 + 7).map((cell, colIdx) => {
                  const rows = grouped.get(cell.dateKey) ?? [];
                  const hasEntries = rows.length > 0 && cell.isCurrentMonth;
                  const isToday = cell.dateKey === todayKey;
                  const isSelected = cell.dateKey === selectedDate;
                  const flagCurrency = hasEntries ? getDayCurrency(rows) : null;
                  const flagCount = hasEntries ? getDayFlagCount(rows) : 0;
                  const flagImage = flagCurrency != null ? FLAG_IMAGES[flagCurrency] : undefined;
                  const hasPurchased = hasEntries && rows.some((r) => r.is_purchased === 1);
                  const hasCandidate = hasEntries && rows.some((r) => r.is_purchased === 0);

                  return (
                    <Pressable
                      key={cell.dateKey}
                      style={({ pressed }) => [
                        styles.dayCell,
                        cell.isCurrentMonth ? styles.dayCellNormal : styles.dayCellOther,
                        isSelected && styles.dayCellSelected,
                        pressed && cell.isCurrentMonth && !isSelected && styles.dayCellPressed,
                      ]}
                      onPress={() => handleDayPress(cell)}
                      disabled={!cell.isCurrentMonth}>
                      {/* 上部：日付（今日はバブル）+ 状態ドット横並び */}
                      <View style={styles.dayCellTop}>
                        {isToday && !isSelected ? (
                          <View style={styles.todayBubble}>
                            <ThemedText style={[styles.dayNum, styles.dayNumToday]}>
                              {cell.day}
                            </ThemedText>
                          </View>
                        ) : (
                          <ThemedText
                            style={[
                              styles.dayNum,
                              !cell.isCurrentMonth && styles.dayNumOther,
                              isSelected && styles.dayNumSelected,
                              !isSelected && cell.isCurrentMonth && colIdx === 0 && styles.sunday,
                              !isSelected && cell.isCurrentMonth && colIdx === 6 && styles.saturday,
                            ]}>
                            {cell.day}
                          </ThemedText>
                        )}
                        {hasEntries && (
                          <View style={styles.dotsRow}>
                            {hasCandidate && <View style={[styles.dot, styles.dotCandidate]} />}
                            {hasPurchased && <View style={[styles.dot, styles.dotPurchased]} />}
                          </View>
                        )}
                      </View>
                      {/* 中央〜下部：国旗PNG */}
                      {flagCurrency != null ? (
                        <View style={styles.dayCellFlagArea}>
                          {flagImage != null ? (
                            <View style={styles.flagWrapper}>
                              <Image
                                source={flagImage}
                                style={getFlagImageStyle(flagCurrency)}
                                contentFit="cover"
                              />
                            </View>
                          ) : (
                            <ThemedText style={styles.dayFlags}>{CURRENCIES[flagCurrency].flag}</ThemedText>
                          )}
                          {flagCount > 1 && (
                            <ThemedText style={styles.flagExtra}>+{flagCount - 1}</ThemedText>
                          )}
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            ))}
            </View>

            {/* 凡例 */}
            <View style={styles.legend}>
              <View style={styles.legendItem}>
                <View style={styles.legendTodayBox} />
                <ThemedText style={styles.legendText}>今日</ThemedText>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, styles.dotCandidate]} />
                <ThemedText style={styles.legendText}>候補</ThemedText>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, styles.dotPurchased]} />
                <ThemedText style={styles.legendText}>購入済み</ThemedText>
              </View>
            </View>
          </View>

          {/* ── 月集計カード ── */}
          <View style={styles.summaryCard}>
            <ThemedText style={styles.summaryCardTitle}>月合計</ThemedText>
            <View style={styles.summaryTwoCol}>
              <View style={[styles.summaryStatItem, styles.summaryStatPurchased]}>
                <View style={styles.summaryStatHeader}>
                  <View style={[styles.dot, styles.dotPurchased]} />
                  <ThemedText style={styles.summaryStatLabel}>購入済み</ThemedText>
                </View>
                <ThemedText style={[styles.summaryStatValue, styles.purchasedValue]} numberOfLines={1}>
                  {formatJpy(monthPurchasedTotal)}
                </ThemedText>
              </View>
              <View style={[styles.summaryStatItem, styles.summaryStatCandidate]}>
                <View style={styles.summaryStatHeader}>
                  <View style={[styles.dot, styles.dotCandidate]} />
                  <ThemedText style={styles.summaryStatLabel}>候補</ThemedText>
                </View>
                <ThemedText style={[styles.summaryStatValue, styles.candidateValue]} numberOfLines={1}>
                  {formatJpy(monthCandidateTotal)}
                </ThemedText>
              </View>
            </View>
          </View>

          {/* ── 当日詳細パネル（日付選択後のみ表示） ── */}
          {selectedDate !== null && (
          <View style={styles.detailCard}>
            {(
              <>
                <ThemedText style={styles.detailTitle}>
                  選択日：{formatDateLabel(selectedDate)}
                </ThemedText>

                {selectedRows.length === 0 ? (
                  <View style={styles.emptyRow}>
                    <ThemedText style={styles.detailEmpty}>
                      この日の記録はありません
                    </ThemedText>
                    <ThemedText style={styles.detailEmptyHint}>
                      保存した買い物はここに表示されます
                    </ThemedText>
                  </View>
                ) : (
                  Array.from(tripGroups.entries()).map(([tripId, rows], groupIndex) => {
                    const trip = tripId !== null ? tripMap.get(tripId) : undefined;
                    const tripName = trip?.name ?? (tripId !== null ? `旅行 #${tripId}` : '未分類');

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
                          {trip && (
                            <CurrencyFlagImage currency={trip.base_currency} size={16} outlined />
                          )}
                          <ThemedText style={styles.tripGroupName}>{tripName}</ThemedText>
                        </View>

                        {/* 選択日の合計 */}
                        <ThemedText style={styles.sectionLabel}>選択日の合計</ThemedText>
                        <View style={styles.daySummaryRow}>
                          <View style={[styles.daySummaryItem, styles.daySummaryItemPurchased]}>
                            <View style={styles.daySummaryItemHeader}>
                              <View style={[styles.dot, styles.dotPurchased]} />
                              <ThemedText style={styles.daySummaryLabel}>購入済み合計</ThemedText>
                            </View>
                            <ThemedText style={[styles.daySummaryValue, styles.purchasedValue]}>
                              {formatJpy(purchasedTotal)}
                            </ThemedText>
                          </View>
                          <View style={[styles.daySummaryItem, styles.daySummaryItemCandidate]}>
                            <View style={styles.daySummaryItemHeader}>
                              <View style={[styles.dot, styles.dotCandidate]} />
                              <ThemedText style={styles.daySummaryLabel}>候補合計</ThemedText>
                            </View>
                            <ThemedText style={[styles.daySummaryValue, styles.candidateValue]}>
                              {formatJpy(candidateTotal)}
                            </ThemedText>
                          </View>
                        </View>

                        {/* 選択日の記録 */}
                        <ThemedText style={[styles.sectionLabel, styles.sectionLabelRecords]}>選択日の記録</ThemedText>
                        <View style={styles.cardList}>
                          {rows.map((item) => {
                            const isPurchased = item.is_purchased === 1;
                            const c = CURRENCIES[item.currency as CurrencyCode];
                            return (
                              <View key={item.id} style={styles.historyCard}>
                                <View style={item.image_uri ? styles.calCardRow : undefined}>
                                  {item.image_uri && (
                                    <Pressable
                                      onPress={() => setPhotoModalUri(item.image_uri!)}
                                      style={styles.calThumbCol}>
                                      <Image
                                        source={{ uri: item.image_uri }}
                                        style={styles.calThumb}
                                        contentFit="cover"
                                      />
                                    </Pressable>
                                  )}
                                  <View style={item.image_uri ? styles.calCardRight : undefined}>
                                    <View style={styles.cardTop}>
                                      <View style={styles.cardLeft}>
                                        <View style={styles.cardFlagBadge}>
                                          <CurrencyFlagImage
                                            currency={item.currency as CurrencyCode}
                                            size={14}
                                            outlined
                                          />
                                        </View>
                                        <View style={styles.cardAmounts}>
                                          {item.currency !== 'JPY' && (
                                            <ThemedText style={styles.cardForeign}>
                                              {c.symbol}{item.foreign_amount.toLocaleString()}
                                            </ThemedText>
                                          )}
                                          <ThemedText
                                            style={[
                                              styles.cardJpy,
                                              isPurchased && styles.cardJpyPurchased,
                                            ]}>
                                            {item.currency === 'JPY'
                                              ? formatJpy(item.jpy_amount)
                                              : `約 ${formatJpy(item.jpy_amount)}`}
                                          </ThemedText>
                                        </View>
                                      </View>
                                      <Pressable
                                        style={[
                                          styles.badge,
                                          isPurchased && styles.badgePurchased,
                                        ]}
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
                                      </Pressable>
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
                                  <Pressable onPress={() => handleDeleteItem(item)} hitSlop={8}>
                                    <ThemedText style={styles.deleteLink}>削除</ThemedText>
                                  </Pressable>
                                </View>
                              </View>
                            );
                          })}
                        </View>
                      </View>
                    );
                  })
                )}
              </>
            )}
          </View>
          )}

        </ScrollView>
      </SafeAreaView>

      <PhotoModal uri={photoModalUri} onClose={() => setPhotoModalUri(null)} />
    </View>
  );
}

// ─── カレンダー専用カラーセット ──────────────────────────────────────

const CALENDAR_REFINED = {
  // 他タブ（index/converter/settings/history）と同じ画面背景（color.bgScreen）に合わせる。
  // 以前の値（#FCFFFE）は他タブより緑/青がかって見えていた。
  screenBg: color.bgScreen,
  cardBg: '#FFFFFF',
  calendarCardBg: '#FFFFFF',
  // 他ページ（history/analytics等）のカードと同じ、ほぼ見えない薄さの枠線に揃える。
  // 以前の値（#BFCDC9）は他ページより濃く、黒っぽい枠線に見えていた。
  calendarCardBorder: color.line,
  calendarGridBase: '#FFFFFF',
  dayCellBg: '#FFFFFF',
  otherMonthCellBg: '#F3F6F5',
  textMain: '#0E2421',
  textSub: '#516461',
  textMuted: '#6D7E7A',
  textFaint: '#9DA8A5',
  primary: '#14AFA2',
  primaryStrong: '#087D74',
  primarySoft: '#D4ECE8',
  selectedBorder: '#14AFA2',
  todayBg: '#C5EDE7',
  todayText: '#087D74',
  purchased: '#1BB7AA',
  purchasedText: '#087D74',
  purchasedSoft: '#DDF5F0',
  // 分析画面（DT.colors.candidate/candidateBg）の候補黄色に合わせる。
  candidate: '#F59E0B',
  candidateText: '#8A620F',
  candidateSoft: '#FEF3C7',
  sunday: '#E24D4A',
  saturday: '#3F7EEB',
  flagBorder: '#C3D2CE',
  line: '#C7D4D0',
  // 月合計/選択日カード・記録カードの枠線。他ページと同じ薄さ（color.line）に揃える。
  lineStrong: color.line,
  lineSoft: '#DCE5E2',
  detailInnerBg: '#F5F7F6',
  chipBg: '#E9EDEC',
  danger: '#D84A4A',
} as const;

// ─── スタイル ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CALENDAR_REFINED.screenBg },
  safe: { flex: 1 },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 24,
    gap: 12,
  },

  // ── ヘッダー ──
  header: { gap: 6 },
  screenTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: CALENDAR_REFINED.textMain,
    letterSpacing: -0.3,
  },
  tripChip: {
    alignSelf: 'flex-start',
    backgroundColor: CALENDAR_REFINED.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tripChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  tripChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: CALENDAR_REFINED.primaryStrong,
  },

  // ── 月集計カード ──
  summaryCard: {
    backgroundColor: CALENDAR_REFINED.cardBg,
    borderRadius: radius.card,
    padding: 10,
    borderWidth: 1,
    borderColor: CALENDAR_REFINED.lineStrong,
    ...shadow.card,
  },
  summaryCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: CALENDAR_REFINED.primaryStrong,
    marginBottom: 8,
    letterSpacing: 0.2,
  },
  summaryTwoCol: { flexDirection: 'row', gap: 6 },
  summaryStatItem: { flex: 1, borderRadius: radius.chip, padding: 8, gap: 3 },
  summaryStatPurchased: { backgroundColor: CALENDAR_REFINED.purchasedSoft },
  summaryStatCandidate: { backgroundColor: CALENDAR_REFINED.candidateSoft },
  summaryStatHeader: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  summaryStatLabel: { fontSize: 10, fontWeight: '600' as const, color: CALENDAR_REFINED.textSub },
  summaryStatValue: {
    fontSize: 15,
    fontWeight: '700' as const,
    fontVariant: ['tabular-nums'],
  },
  purchasedValue: { color: CALENDAR_REFINED.purchasedText },
  candidateValue: { color: CALENDAR_REFINED.candidateText },

  // ── カレンダーカード ──
  calCard: {
    backgroundColor: CALENDAR_REFINED.calendarCardBg,
    borderRadius: radius.card,
    padding: 12,
    borderWidth: 1,
    borderColor: CALENDAR_REFINED.calendarCardBorder,
    ...shadow.card,
  },

  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: 6,
  },
  navArrow: {
    fontSize: 26,
    fontWeight: '300',
    color: CALENDAR_REFINED.primary,
    lineHeight: 32,
  },
  monthLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: CALENDAR_REFINED.textMain,
    letterSpacing: -0.2,
  },

  calGrid: {
    backgroundColor: CALENDAR_REFINED.calendarGridBase,
    borderRadius: 6,
    padding: 3,
    gap: 3,
  },
  weekRow: { flexDirection: 'row', gap: 3 },
  weekLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    color: CALENDAR_REFINED.textMuted,
    paddingVertical: 4,
  },
  sunday:   { color: CALENDAR_REFINED.sunday },
  saturday: { color: CALENDAR_REFINED.saturday },

  dayCell: {
    flex: 1,
    paddingHorizontal: 3,
    paddingTop: 3,
    paddingBottom: 3,
    borderRadius: 8,
    minHeight: 62,
  },
  dayCellTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
  },
  dayCellFlagArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 2,
    gap: 2,
  },
  dayCellNormal:   { backgroundColor: CALENDAR_REFINED.dayCellBg, borderWidth: 1, borderColor: CALENDAR_REFINED.lineSoft },
  dayCellOther:    { backgroundColor: CALENDAR_REFINED.otherMonthCellBg },
  dayCellSelected: { backgroundColor: CALENDAR_REFINED.dayCellBg, borderWidth: 2, borderColor: CALENDAR_REFINED.selectedBorder },
  dayCellPressed:  { backgroundColor: color.line2 },

  dayNum: {
    fontSize: 13,
    fontWeight: '600',
    color: CALENDAR_REFINED.textMain,
    lineHeight: 15,
  },
  todayBubble: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: CALENDAR_REFINED.todayBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNumOther:    { color: CALENDAR_REFINED.textFaint, fontWeight: '400' },
  dayNumToday:    { color: CALENDAR_REFINED.todayText, fontWeight: '700' },
  dayNumSelected: { color: CALENDAR_REFINED.primaryStrong, fontWeight: '700' },

  dayFlags: { fontSize: 30, lineHeight: 34 },
  flagWrapper: {
    // 外枠は全通貨共通の固定サイズ（通貨によって枠自体が大きくなったり小さくなったりしない）
    width: 32,
    height: 21,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: CALENDAR_REFINED.flagBorder,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  flagImage: { width: 28, height: 18 }, // JPY/KRWの標準サイズ（この2通貨は一切触らない）
  flagImageCompact: { width: 24, height: 16 }, // USD/GBP/TWD/THB/EURのみ。同じ外枠の中で少し小さく収める
  flagExtra: { fontSize: 9, fontWeight: '700' as const, color: CALENDAR_REFINED.textFaint, lineHeight: 11 },

  dotsRow: {
    flexDirection: 'row',
    gap: 2,
    alignItems: 'center',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  dotCandidate: { backgroundColor: CALENDAR_REFINED.candidate },
  dotPurchased: { backgroundColor: CALENDAR_REFINED.purchased },

  // 凡例
  legend: {
    flexDirection: 'row',
    gap: 14,
    justifyContent: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: CALENDAR_REFINED.lineSoft,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendTodayBox: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: CALENDAR_REFINED.primary,
  },
  legendText: {
    fontSize: 11,
    fontWeight: '500',
    color: CALENDAR_REFINED.textSub,
  },

  // ── 詳細パネル ──
  detailCard: {
    backgroundColor: CALENDAR_REFINED.cardBg,
    borderRadius: radius.card,
    padding: 16,
    borderWidth: 1,
    borderColor: CALENDAR_REFINED.lineStrong,
    ...shadow.card,
    gap: 12,
  },
  detailHintRow: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  detailHint: {
    fontSize: 13,
    fontWeight: '500',
    color: CALENDAR_REFINED.textSub,
  },
  detailTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: CALENDAR_REFINED.textMain,
  },
  emptyRow: {
    alignItems: 'center',
    gap: 5,
    paddingVertical: 10,
  },
  detailEmpty: {
    fontSize: 14,
    fontWeight: '500',
    color: CALENDAR_REFINED.textSub,
    textAlign: 'center',
  },
  detailEmptyHint: {
    fontSize: 12,
    fontWeight: '400',
    color: CALENDAR_REFINED.textFaint,
    textAlign: 'center',
  },

  // ── 旅行グループ ──
  tripGroup: { gap: 10 },
  tripGroupBorder: {
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: CALENDAR_REFINED.line,
  },
  tripGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tripGroupName: {
    fontSize: 14,
    fontWeight: '700',
    color: CALENDAR_REFINED.textMain,
  },

  // 選択日の合計・選択日の記録の小見出し
  sectionLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    color: CALENDAR_REFINED.primaryStrong,
    marginBottom: 8,
    letterSpacing: 0.2,
  },
  sectionLabelRecords: { marginTop: 10 },

  // 選択日の合計
  daySummaryRow: {
    flexDirection: 'row',
    gap: 8,
  },
  // 月合計（summaryStatItem）より一回り小さく・淡くして、「月合計の再掲」に
  // 見えないようにする（選択日はその日だけの小さなサマリー、という位置づけ）。
  daySummaryItem: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    gap: 2,
  },
  daySummaryItemPurchased: { backgroundColor: CALENDAR_REFINED.purchasedSoft },
  daySummaryItemCandidate: { backgroundColor: CALENDAR_REFINED.candidateSoft },
  daySummaryItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  daySummaryLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: CALENDAR_REFINED.textSub,
  },
  daySummaryValue: {
    fontSize: 14,
    fontWeight: '700',
    color: CALENDAR_REFINED.textMain,
    fontVariant: ['tabular-nums'],
  },

  cardList: { gap: 8 },

  // 商品カード（他ページと同じく、枠線だけでなく薄い影で浮かせる）
  historyCard: {
    backgroundColor: CALENDAR_REFINED.cardBg,
    borderRadius: radius.chip,
    padding: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: CALENDAR_REFINED.lineStrong,
    ...shadow.card,
  },
  calCardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  calThumbCol: { flexShrink: 0 },
  calCardRight: { flex: 1, gap: 4 },
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
  cardFlagBadge: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: CALENDAR_REFINED.flagBorder,
    borderRadius: 4,
    paddingHorizontal: 3,
    paddingVertical: 2,
  },
  cardAmounts: { gap: 1 },
  cardForeign: {
    fontSize: 12,
    fontWeight: '600',
    color: CALENDAR_REFINED.textSub,
  },
  cardJpy: {
    fontSize: 17,
    fontWeight: '700',
    color: CALENDAR_REFINED.textMain,
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  cardJpyPurchased: { color: color.muted },

  badge: {
    backgroundColor: CALENDAR_REFINED.candidateSoft,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgePurchased: { backgroundColor: CALENDAR_REFINED.primarySoft },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: CALENDAR_REFINED.candidateText,
    letterSpacing: 0.3,
  },
  badgeTextPurchased: { color: CALENDAR_REFINED.primaryStrong },

  memoChip: {
    alignSelf: 'flex-start',
    backgroundColor: CALENDAR_REFINED.chipBg,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  memoChipText: {
    fontSize: 11,
    color: CALENDAR_REFINED.textSub,
    fontWeight: '500',
  },

  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardRate: {
    fontSize: 11,
    color: CALENDAR_REFINED.textMuted,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  deleteLink: {
    fontSize: 12,
    color: CALENDAR_REFINED.danger,
    fontWeight: '500',
  },

  calThumb: {
    width: 72,
    height: 54,
    borderRadius: 8,
    backgroundColor: color.line2,
  },
  pressed: { opacity: 0.8 },
});
