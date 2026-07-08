import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { CurrencyFlagImage } from '@/components/domain';
import type { TripRow } from '@/db/queries/trips';
import { useAllHistory } from '@/hooks/use-all-history';
import { useTrips } from '@/hooks/use-trips';
import { color, radius, shadow } from '@/theme/tokens';
import { formatJpy } from '@/utils/format';

interface TripStat {
  candidateCount: number;
  candidateJpy: number;
  purchasedCount: number;
  purchasedJpy: number;
  used: number;
}

function monthLabel(t: TripRow): string {
  const src = t.started_at ?? t.created_at;
  const m = src?.slice(5, 7);
  return m ? `${parseInt(m, 10)}月` : '';
}

export default function TripListScreen() {
  const { activeTrip, switchTrip } = useTrips();
  const { history, tripMap, reload } = useAllHistory();

  // 旅行切替失敗時に無言で終わらないよう try/catch + Alert を追加（S-08）。切替処理本体は変更しない。
  async function handleSwitchTrip(id: number) {
    try {
      await switchTrip(id);
    } catch (err) {
      console.warn('[trip-list switch error]', err);
      Alert.alert(
        '旅行を切り替えできませんでした',
        'もう一度お試しください。',
        [{ text: 'OK' }],
      );
    }
  }

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const statByTrip = useMemo(() => {
    const m = new Map<number, TripStat>();
    for (const r of history) {
      if (r.trip_id == null) continue;
      const s = m.get(r.trip_id) ?? { candidateCount: 0, candidateJpy: 0, purchasedCount: 0, purchasedJpy: 0, used: 0 };
      const jpy = Math.round(r.jpy_amount);
      if ((r.is_purchased ?? 0) === 1) { s.purchasedCount += 1; s.purchasedJpy += jpy; }
      else { s.candidateCount += 1; s.candidateJpy += jpy; }
      s.used += jpy;
      m.set(r.trip_id, s);
    }
    return m;
  }, [history]);

  const trips = useMemo(() => {
    const all = [...tripMap.values()];
    const live = all.filter((t) => t.archived_at == null).sort((a, b) => b.is_active - a.is_active);
    const archived = all.filter((t) => t.archived_at != null);
    return [...live, ...archived];
  }, [tripMap]);

  const active = trips.find((t) => t.id === activeTrip?.id) ?? null;
  const others = trips.filter((t) => t.id !== active?.id);

  const emptyStat: TripStat = { candidateCount: 0, candidateJpy: 0, purchasedCount: 0, purchasedJpy: 0, used: 0 };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.topRow}>
          <ThemedText style={styles.title}>旅行</ThemedText>
          <Pressable
            onPress={() => router.push('/trip-create')}
            style={({ pressed }) => [styles.newBtn, pressed && styles.pressed]}>
            <ThemedText style={styles.newBtnText}>＋ 新規</ThemedText>
          </Pressable>
        </View>

        {/* アクティブ旅行（大カード） */}
        {active && (() => {
          const s = statByTrip.get(active.id) ?? emptyStat;
          const remaining = Math.max(0, active.budget_jpy - s.used);
          const cur = active.base_currency;
          return (
            <View style={styles.activeCard}>
              <View style={styles.activeTop}>
                <View style={styles.nameWrap}>
                  <ThemedText style={styles.activeName} numberOfLines={1}>{active.name}</ThemedText>
                  <View style={styles.usingBadge}><ThemedText style={styles.usingBadgeText}>使用中</ThemedText></View>
                </View>
                <View style={styles.rateFlagRow}>
                  <CurrencyFlagImage currency={cur} size={14} outlined />
                  <ThemedText style={styles.activeRate}>
                    {cur === 'JPY' ? '国内' : `¥${active.manual_rate}`}
                  </ThemedText>
                </View>
              </View>
              <View style={styles.budgetRow}>
                <View>
                  <ThemedText style={styles.budgetLabel}>残り予算</ThemedText>
                  <ThemedText
                    style={styles.budgetValue}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.6}>
                    {active.budget_jpy > 0 ? formatJpy(remaining) : '予算未設定'}
                  </ThemedText>
                </View>
                <View style={styles.budgetMeta}>
                  <ThemedText style={styles.budgetMetaText}>
                    予算 {active.budget_jpy > 0 ? formatJpy(active.budget_jpy) : '—'}
                  </ThemedText>
                  {monthLabel(active) !== '' && <ThemedText style={styles.budgetMetaText}>{monthLabel(active)}</ThemedText>}
                </View>
              </View>
              <View style={styles.statBoxes}>
                <View style={[styles.statBox, styles.statBoxCandidate]}>
                  <ThemedText style={styles.statBoxLabel}>候補 {s.candidateCount}</ThemedText>
                  <ThemedText style={[styles.statBoxValue, { color: color.candidateText }]}>{formatJpy(s.candidateJpy)}</ThemedText>
                </View>
                <View style={[styles.statBox, styles.statBoxPurchased]}>
                  <ThemedText style={styles.statBoxLabel}>購入済み {s.purchasedCount}</ThemedText>
                  <ThemedText style={[styles.statBoxValue, { color: color.purchasedText }]}>{formatJpy(s.purchasedJpy)}</ThemedText>
                </View>
              </View>
              <View style={styles.activeActions}>
                <Pressable
                  onPress={() => router.push({ pathname: '/trip-edit', params: { id: String(active.id) } })}
                  style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}>
                  <ThemedText style={styles.actionBtnText}>編集</ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => { router.dismissAll(); router.navigate('/history'); }}
                  style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}>
                  <ThemedText style={styles.actionBtnText}>履歴を見る</ThemedText>
                </Pressable>
              </View>
            </View>
          );
        })()}

        {/* ほかの旅行 */}
        {others.length > 0 && (
          <>
            <ThemedText style={styles.sectionLabel}>ほかの旅行</ThemedText>
            {others.map((t) => {
              const s = statByTrip.get(t.id) ?? emptyStat;
              const archived = t.archived_at != null;
              const remaining = Math.max(0, t.budget_jpy - s.used);
              const cur = t.base_currency;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => router.push({ pathname: '/trip-edit', params: { id: String(t.id) } })}
                  style={({ pressed }) => [styles.otherCard, archived && styles.otherCardArchived, pressed && styles.pressed]}>
                  <View style={styles.otherTop}>
                    <View style={styles.nameWrap}>
                      <ThemedText style={styles.otherName} numberOfLines={1}>{t.name}</ThemedText>
                      {archived && <View style={styles.endBadge}><ThemedText style={styles.endBadgeText}>終了</ThemedText></View>}
                    </View>
                    <View style={styles.rateFlagRow}>
                      <CurrencyFlagImage currency={cur} size={13} outlined />
                      {cur !== 'JPY' && (
                        <ThemedText style={styles.otherRate}>¥{t.manual_rate}</ThemedText>
                      )}
                    </View>
                  </View>
                  <ThemedText style={styles.otherBudget}>
                    {archived ? `使用 ${formatJpy(s.used)}` : t.budget_jpy > 0 ? `残り ${formatJpy(remaining)}` : '予算未設定'}
                  </ThemedText>
                  <ThemedText style={styles.otherMeta}>
                    候補{s.candidateCount}・購入{s.purchasedCount}{monthLabel(t) !== '' ? `・${monthLabel(t)}` : ''}
                  </ThemedText>
                  {archived ? (
                    <ThemedText style={styles.archivedHint}>タップして詳細・復元</ThemedText>
                  ) : (
                    <Pressable
                      onPress={() => { void handleSwitchTrip(t.id); }}
                      style={({ pressed }) => [styles.useBtn, pressed && styles.pressed]}>
                      <ThemedText style={styles.useBtnText}>この旅行を使う</ThemedText>
                    </Pressable>
                  )}
                </Pressable>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgScreen },
  scroll: { padding: 18, paddingBottom: 60, gap: 14, maxWidth: 480, width: '100%', alignSelf: 'center' },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 24, fontWeight: '700', color: color.text, letterSpacing: -0.4 },
  newBtn: { backgroundColor: color.primary, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 8, ...shadow.cta },
  newBtnText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },

  activeCard: {
    backgroundColor: color.card,
    borderRadius: radius.cardLg,
    borderWidth: 2,
    borderColor: color.primary,
    padding: 16,
    gap: 14,
    ...shadow.card,
  },
  activeTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  rateFlagRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  nameWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  activeName: { fontSize: 18, fontWeight: '700', color: color.text, flexShrink: 1 },
  usingBadge: { backgroundColor: color.primary, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  usingBadgeText: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' },
  activeRate: { fontSize: 12.5, lineHeight: 17, fontWeight: '700', color: color.muted, fontVariant: ['tabular-nums'] },
  budgetRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  budgetLabel: { fontSize: 12, fontWeight: '700', color: color.primary, marginBottom: 2 },
  budgetValue: { fontSize: 30, lineHeight: 36, fontWeight: '700', color: color.text, letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
  budgetMeta: { alignItems: 'flex-end', gap: 2 },
  budgetMetaText: { fontSize: 12, fontWeight: '500', color: color.muted, fontVariant: ['tabular-nums'] },
  statBoxes: { flexDirection: 'row', gap: 10 },
  statBox: { flex: 1, borderRadius: radius.chip, paddingVertical: 10, paddingHorizontal: 12, gap: 2 },
  statBoxCandidate: { backgroundColor: color.candidateSoft },
  statBoxPurchased: { backgroundColor: color.primarySoft },
  statBoxLabel: { fontSize: 11.5, fontWeight: '700', color: color.body },
  statBoxValue: { fontSize: 15, lineHeight: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  activeActions: { flexDirection: 'row', gap: 10 },
  actionBtn: { flex: 1, borderRadius: radius.button, borderWidth: 1.5, borderColor: color.inputBorder, paddingVertical: 11, alignItems: 'center' },
  actionBtnText: { fontSize: 14, fontWeight: '700', color: color.body },

  sectionLabel: { fontSize: 12, fontWeight: '700', color: color.muted, paddingHorizontal: 4, marginTop: 4 },
  otherCard: { backgroundColor: color.card, borderRadius: radius.card, borderWidth: 1, borderColor: color.line, padding: 14, gap: 6, ...shadow.card },
  otherCardArchived: { opacity: 0.6 },
  otherTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  otherName: { fontSize: 15, fontWeight: '700', color: color.text, flexShrink: 1 },
  endBadge: { backgroundColor: color.line2, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 1 },
  endBadgeText: { fontSize: 10.5, fontWeight: '700', color: color.muted },
  otherRate: { fontSize: 12, lineHeight: 16, fontWeight: '600', color: color.muted, fontVariant: ['tabular-nums'] },
  otherBudget: { fontSize: 16, lineHeight: 21, fontWeight: '700', color: color.text, fontVariant: ['tabular-nums'] },
  otherMeta: { fontSize: 12, fontWeight: '500', color: color.muted },
  archivedHint: { fontSize: 11.5, fontWeight: '600', color: color.muted, marginTop: 2 },
  useBtn: { backgroundColor: color.primary, borderRadius: radius.button, paddingVertical: 11, alignItems: 'center', marginTop: 4 },
  useBtnText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  pressed: { opacity: 0.85 },
});
