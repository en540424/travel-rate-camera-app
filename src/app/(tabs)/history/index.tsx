import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { CurrencyFlagImage } from '@/components/domain';
import { EmptyState } from '@/components/ui';
import { ResilientPhoto } from '@/components/resilient-photo';
import { FALLBACK_BUDGET_JPY } from '@/constants/camera-screen';
import { SHOW_PRO } from '@/config/feature-flags';
import { FREE_HISTORY_LIMIT } from '@/db/queries/history';
import type { HistoryRow } from '@/db/queries/history';
import { useHistory } from '@/hooks/use-history';
import { useIsPro } from '@/hooks/use-purchases';
import { useTrips } from '@/hooks/use-trips';
import { color, radius, shadow, statusColor } from '@/theme/tokens';
import { formatForeign, formatJpy, formatRate } from '@/utils/format';
import { registerTabScrollReset } from '@/utils/tab-scroll-reset';
import { getTripStatsForDisplay } from '@/utils/trip-stats';

// 履歴メイン画面 v4（design 濃いタブ「履歴」/ history-v4-main）。
// 上のすべて/候補/購入済みで絞り込み、残り予算を主役に、購入済み（ティール）・
// 候補（アンバー）を点で色分け。カードタップで商品詳細画面へ遷移。
type FilterMode = 'all' | 'candidate' | 'purchased';

const SEGMENTS: { mode: FilterMode; label: string }[] = [
  { mode: 'all', label: 'すべて' },
  { mode: 'candidate', label: '候補' },
  { mode: 'purchased', label: '購入済み' },
];

/** カード副題用の日付。「今日 12:09」「昨日 15:08」「6月12日」 */
function formatCardDate(row: HistoryRow): string {
  const iso = row.created_at.includes('T') ? row.created_at : `${row.created_at.replace(' ', 'T')}Z`;
  const created = new Date(iso);
  const time = `${String(created.getHours()).padStart(2, '0')}:${String(created.getMinutes()).padStart(2, '0')}`;
  let basis = created;
  if (row.entry_date) {
    const [y, m, d] = row.entry_date.split('-').map(Number);
    basis = new Date(y, m - 1, d);
  }
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(basis)) / 86_400_000);
  if (diffDays === 0) return `今日 ${time}`;
  if (diffDays === 1) return `昨日 ${time}`;
  return `${basis.getMonth() + 1}月${basis.getDate()}日`;
}

function openDetail(id: number) {
  router.push({ pathname: '/history/item-detail', params: { id: String(id) } });
}

export default function HistoryScreen() {
  // 下タブでこのタブ（履歴）を押した時（＝タブ切替で入ってきた時）だけ先頭へ戻す。
  // (tabs)/_layout.tsxのtabPress（Tabsナビゲーター側）からtriggerTabScrollResetで呼ばれる。
  // 履歴タブは内部にStack（history/_layout.tsx）を持つが、ルート名ベースのこの仕組みなら
  // Stackを意識せず登録できる。詳細/編集画面から戻る操作ではtabPressは発火しないため、
  // スクロール位置の維持は壊れない。
  const listRef = useRef<FlatList<HistoryRow>>(null);
  useEffect(() => {
    return registerTabScrollReset('history', () => {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    });
  }, []);

  const { history, totalCount, reload } = useHistory();
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const isPro = useIsPro();
  const isLimited = !isPro && totalCount >= FREE_HISTORY_LIMIT;
  const { activeTrip } = useTrips();

  const tripBudgetJpy = activeTrip?.budget_jpy ?? FALLBACK_BUDGET_JPY;

  const stats = useMemo(
    () => getTripStatsForDisplay(history, tripBudgetJpy, activeTrip?.id),
    [history, totalCount, tripBudgetJpy, activeTrip?.id],
  );

  const counts = useMemo(() => {
    let candidate = 0;
    let purchased = 0;
    for (const r of history) {
      if ((r.is_purchased ?? 0) === 1) purchased += 1;
      else candidate += 1;
    }
    return { all: history.length, candidate, purchased };
  }, [history]);

  const displayHistory = useMemo(() => {
    if (filterMode === 'candidate') return history.filter((r) => (r.is_purchased ?? 0) === 0);
    if (filterMode === 'purchased') return history.filter((r) => (r.is_purchased ?? 0) === 1);
    return history;
  }, [history, filterMode]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  function renderItem({ item }: { item: HistoryRow }) {
    const isPurchased = (item.is_purchased ?? 0) === 1;
    const isForeign = item.currency !== 'JPY';
    const tone = isPurchased ? statusColor.purchased : statusColor.candidate;
    const hasMemo = !!item.memo?.trim();
    const titleText = hasMemo ? item.memo!.trim() : '（メモなし）';

    const subParts: string[] = [];
    if (isForeign) subParts.push(formatForeign(item.foreign_amount, item.currency));
    subParts.push(formatCardDate(item));
    const subtitle = subParts.join(' ・ ');

    return (
      <Pressable
        style={[styles.card, { borderLeftColor: tone.dot }]}
        onPress={() => openDetail(item.id)}
        android_ripple={{ color: color.line2 }}>
        <View style={styles.thumb}>
          {item.image_uri ? (
            <ResilientPhoto uri={item.image_uri} style={styles.thumbImage} contentFit="cover" />
          ) : (
            <View style={styles.thumbPlaceholder}>
              <ThemedText style={styles.thumbPlaceholderText}>写真なし</ThemedText>
            </View>
          )}
        </View>

        <View style={styles.cardMid}>
          <View style={styles.cardTitleRow}>
            <ThemedText style={[styles.cardTitle, !hasMemo && styles.cardTitleMuted]} numberOfLines={1}>
              {titleText}
            </ThemedText>
            <View style={[styles.chip, { backgroundColor: tone.badgeBg }]}>
              <ThemedText style={[styles.chipText, { color: tone.text }]}>{tone.label}</ThemedText>
            </View>
          </View>
          <ThemedText style={styles.cardSub} numberOfLines={1}>
            {subtitle}
          </ThemedText>
        </View>

        <View style={styles.cardRight}>
          <ThemedText style={styles.cardJpy} numberOfLines={1}>
            {formatJpy(item.jpy_amount)}
          </ThemedText>
          <ThemedText style={styles.cardJpyLabel}>日本円</ThemedText>
        </View>
      </Pressable>
    );
  }

  const tripRate = activeTrip?.manual_rate ?? 0;

  const listHeader = activeTrip && (
    <View style={styles.headerBlock}>
      <View style={styles.titleRow}>
        <ThemedText style={styles.title} numberOfLines={1}>
          {activeTrip.name}
        </ThemedText>
        <View style={[styles.rateChip, styles.rateChipRow]}>
          <CurrencyFlagImage currency={activeTrip.base_currency} size={14} outlined />
          <ThemedText style={styles.rateChipText} numberOfLines={1}>
            {formatRate(tripRate, activeTrip.base_currency)}
          </ThemedText>
        </View>
      </View>

      {/* 残り予算・購入済み・候補を1枚の白カードにまとめ、背景と同化しないようにする。
          購入済み/候補は全面色ではなく、薄い背景の小さなチップで軽くアクセントを付ける程度に留める。 */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <View style={styles.budgetCol}>
            <ThemedText style={styles.budgetLabel}>残り予算</ThemedText>
            <ThemedText style={styles.budgetValue} numberOfLines={1}>
              {tripBudgetJpy > 0 ? formatJpy(stats.remainingBudget) : '未設定'}
            </ThemedText>
          </View>
          <View style={styles.statusTotals}>
            <View style={[styles.statusLine, { backgroundColor: color.purchasedSoft }]}>
              <View style={[styles.statusDot, { backgroundColor: color.purchased }]} />
              <ThemedText style={styles.statusLineLabel}>購入済み</ThemedText>
              <ThemedText style={styles.statusLineValue}>{formatJpy(stats.purchasedTotalJpy)}</ThemedText>
            </View>
            <View style={[styles.statusLine, { backgroundColor: color.candidateSoft }]}>
              <View style={[styles.statusDot, { backgroundColor: color.candidate }]} />
              <ThemedText style={styles.statusLineLabel}>候補</ThemedText>
              <ThemedText style={styles.statusLineValue}>{formatJpy(stats.candidateTotalJpy)}</ThemedText>
            </View>
          </View>
        </View>
      </View>

      {/* 初回MVPはPro未実装・保存上限も表示しないためSHOW_PROで非表示（P0-01/P0-03） */}
      {SHOW_PRO && isLimited && (
        <TouchableOpacity style={styles.proBanner} onPress={() => router.push('/pro')}>
          <ThemedText style={styles.proBannerText}>
            Pro版で無制限に保存（現在 {FREE_HISTORY_LIMIT} 件まで）→
          </ThemedText>
        </TouchableOpacity>
      )}

      {history.length > 0 && (
        <View style={styles.segment}>
          {SEGMENTS.map(({ mode, label }) => {
            const active = filterMode === mode;
            return (
              <TouchableOpacity
                key={mode}
                style={[styles.segmentBtn, active && styles.segmentBtnActive]}
                onPress={() => setFilterMode(mode)}
                activeOpacity={0.8}>
                <ThemedText style={[styles.segmentText, active && styles.segmentTextActive]}>
                  {label}
                  <ThemedText style={[styles.segmentCount, active && styles.segmentCountActive]}>
                    {counts[mode]}
                  </ThemedText>
                </ThemedText>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );

  // 旅行未選択状態（引き継ぎ資料 §6-B）
  if (!activeTrip) {
    return (
      <View style={styles.screen}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <View style={styles.noTripTitleRow}>
            <ThemedText style={styles.title}>履歴</ThemedText>
          </View>
          <View style={styles.noTripWrap}>
            <EmptyState
              tone="neutral"
              title="旅行が選択されていません"
              body="旅行を作成すると、その旅行ごとに保存した記録がここに表示されます。"
              primary={{ title: '設定で旅行を作成・選択', onPress: () => router.push('/settings') }}
            />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <FlatList
          ref={listRef}
          data={displayHistory}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.cardGap} />}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={
            <View style={styles.empty}>
              {history.length === 0 ? (
                <EmptyState
                  title="まだ保存した商品がありません"
                  body={`カメラで価格を読み取ると、候補／購入済み${'\n'}としてここに残せます。`}
                  primary={{ title: 'カメラを開く', onPress: () => router.push('/') }}
                />
              ) : (
                <EmptyState
                  tone="neutral"
                  title="該当する記録がありません"
                  body="フィルターを「すべて」に戻すと、全件表示されます。"
                  primary={{ title: 'すべて表示', onPress: () => setFilterMode('all') }}
                />
              )}
            </View>
          }
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgScreen },
  safe: { flex: 1 },
  listContent: {
    paddingHorizontal: 15,
    paddingBottom: 96,
    maxWidth: 430,
    width: '100%',
    alignSelf: 'center',
  },

  headerBlock: {
    paddingTop: 8,
    paddingBottom: 14,
    gap: 16,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  title: {
    flex: 1,
    fontSize: 23,
    fontWeight: '700',
    color: color.text,
    letterSpacing: -0.5,
    lineHeight: 29,
  },
  rateChip: {
    maxWidth: '58%',
    backgroundColor: color.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  rateChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  rateChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: color.primaryDark,
  },

  // 残り予算・購入済み・候補をまとめる白カード。背景から分離させるための
  // 薄い枠線＋薄い影のみ（他画面のカードと同じ強さ）。
  summaryCard: {
    backgroundColor: color.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.line,
    padding: 14,
    ...shadow.card,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
  },
  budgetCol: { flexShrink: 1 },
  budgetLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: color.primary,
    letterSpacing: 0.2,
    marginBottom: 2,
  },
  budgetValue: {
    fontSize: 33,
    fontWeight: '700',
    color: color.text,
    letterSpacing: -1.0,
    lineHeight: 39,
    fontVariant: ['tabular-nums'],
  },
  statusTotals: {
    alignItems: 'flex-end',
    gap: 6,
  },
  // 購入済み/候補を、全面色ではなく薄い背景の小さなチップとして見せる
  // （backgroundColorは描画時にpurchasedSoft/candidateSoftを指定）。
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: radius.chip,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLineLabel: { fontSize: 12, fontWeight: '600', color: color.body },
  statusLineValue: {
    fontSize: 13,
    fontWeight: '700',
    color: color.text,
    fontVariant: ['tabular-nums'],
    minWidth: 56,
    textAlign: 'right',
  },

  proBanner: {
    backgroundColor: color.primarySoft,
    borderRadius: radius.chip,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: color.primaryBorder,
  },
  proBannerText: {
    color: color.primaryDark,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
  },

  segment: {
    flexDirection: 'row',
    backgroundColor: color.line2,
    borderRadius: radius.chip,
    padding: 3,
    gap: 3,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  segmentBtnActive: {
    backgroundColor: color.card,
    ...shadow.card,
  },
  segmentText: { fontSize: 12.5, fontWeight: '600', color: color.muted },
  segmentTextActive: { color: color.text, fontWeight: '700' },
  segmentCount: { fontSize: 12.5, fontWeight: '600', color: color.faint2 },
  segmentCountActive: { color: color.muted },

  cardGap: { height: 10 },
  // カレンダー画面の商品カードと同じ思想（白カード＋左端の購入済み/候補アクセント）。
  // borderLeftColorは描画時にtone.dot（購入済み=緑/候補=黄色）で上書きする。
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: color.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.line,
    borderLeftWidth: 3,
    paddingVertical: 9,
    paddingHorizontal: 9,
    ...shadow.card,
  },
  thumb: {
    width: 58,
    height: 58,
    borderRadius: radius.chip,
    overflow: 'hidden',
    flexShrink: 0,
  },
  thumbImage: { width: '100%', height: '100%', backgroundColor: color.line2 },
  thumbPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.line2,
  },
  thumbPlaceholderText: { fontSize: 10, fontWeight: '600', color: color.faint2 },
  cardMid: { flex: 1, minWidth: 0, gap: 3 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '600',
    color: color.text,
    letterSpacing: -0.2,
  },
  cardTitleMuted: { fontWeight: '600', color: color.faint },
  chip: {
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
    flexShrink: 0,
  },
  chipText: { fontSize: 9, fontWeight: '700' },
  cardSub: {
    fontSize: 11,
    fontWeight: '500',
    color: color.muted,
    fontVariant: ['tabular-nums'],
  },
  cardRight: { alignItems: 'flex-end', flexShrink: 0 },
  cardJpy: {
    fontSize: 17,
    fontWeight: '700',
    color: color.text,
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  cardJpyLabel: { fontSize: 10, fontWeight: '500', color: color.faint2, marginTop: 1 },

  empty: { paddingTop: 40 },
  noTripTitleRow: {
    paddingHorizontal: 15,
    paddingTop: 8,
    maxWidth: 430,
    width: '100%',
    alignSelf: 'center',
  },
  noTripWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingBottom: 60,
  },
});
