import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useRef, useState } from 'react';
import { Alert, FlatList, Platform, Pressable, StyleSheet, View } from 'react-native';

import { CurrencyFlagImage } from '@/components/domain';
import { PhotoModal } from '@/components/photo-modal';
import { ResilientPhoto } from '@/components/resilient-photo';
import { ThemedText } from '@/components/themed-text';
import { PrimaryButton, SecondaryButton } from '@/components/ui';
import type { HistoryRow } from '@/db/queries/history';
import {
  deleteHistory,
  getBudgetTotalsForTrip,
  getHistoryCountForTrip,
  getHistoryForTrip,
  markPurchased,
} from '@/db/queries/history';
import type { TripRow } from '@/db/queries/trips';
import { getTripById } from '@/db/queries/trips';
import { useTrips } from '@/hooks/use-trips';
import { color, radius, shadow, statusColor } from '@/theme/tokens';
import { EMPTY_BUDGET_TOTALS, type BudgetTotals } from '@/utils/budget-core';
import { formatForeign, formatJpy } from '@/utils/format';
import { deleteStoredPhotoFile } from '@/utils/resolve-image-uri';

/** 表示する記録の上限（履歴タブと同じ500件。合計はSQL集計で全件から出す） */
const RECORDS_LIMIT = 500;

/** 記録の日付（「6月12日」）。保存日の指定があればそれを使う（履歴タブのカード副題と同じ基準） */
function formatRecordDate(row: HistoryRow): string {
  if (row.entry_date) {
    const [, m, d] = row.entry_date.split('-').map(Number);
    return `${m}月${d}日`;
  }
  const iso = row.created_at.includes('T') ? row.created_at : `${row.created_at.replace(' ', 'T')}Z`;
  const created = new Date(iso);
  return `${created.getMonth() + 1}月${created.getDate()}日`;
}

function formatPeriod(trip: TripRow): string | null {
  const fmt = (s: string) => {
    const [, m, d] = s.split('-');
    return m && d ? `${parseInt(m, 10)}/${parseInt(d, 10)}` : s;
  };
  if (trip.started_at && trip.ended_at) return `${fmt(trip.started_at)} – ${fmt(trip.ended_at)}`;
  if (trip.started_at) return `${fmt(trip.started_at)} –`;
  return null;
}

/**
 * 旅行の記録一覧（終了済みの旅行・無料版で閲覧のみの旅行を見るための画面）。
 *
 * 履歴タブは使用中の旅行に固定され、終了済みの旅行は使用中にできないため、ここで旅行ごとに見せる。
 * 無料版で閲覧のみの旅行に許す操作は、閲覧・記録の削除・候補/購入済みの切替だけ（2026-10-20 Human確定）。
 * 金額・メモ・写真・日付の編集や新しい記録の追加はここに置かない。Proは「旅行の編集・再開」から従来の編集画面へ進める。
 * 履歴タブ内の詳細画面（別のStack）へは遷移せず、写真の拡大・切替・削除をこの画面で完結させる。
 */
export default function TripRecordsScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id != null ? parseInt(params.id, 10) : NaN;
  const db = useSQLiteContext();
  const { isReadOnlyTrip } = useTrips();

  /** undefined＝読み込み中、null＝見つからない */
  const [trip, setTrip] = useState<TripRow | null | undefined>(undefined);
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totals, setTotals] = useState<BudgetTotals>(EMPTY_BUDGET_TOTALS);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  // 切替・削除の連打で同じ記録へ並行して書き込まない
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    if (Number.isNaN(id)) {
      setTrip(null);
      return;
    }
    const [t, list, count, sums] = await Promise.all([
      getTripById(db, id),
      getHistoryForTrip(db, id, RECORDS_LIMIT),
      getHistoryCountForTrip(db, id),
      getBudgetTotalsForTrip(db, id),
    ]);
    setTrip(t);
    setRows(list);
    setTotalCount(count);
    setTotals(sums);
  }, [db, id]);

  useFocusEffect(
    useCallback(() => {
      load().catch((e) => console.warn('[trip-records load]', e));
    }, [load]),
  );

  async function handleToggle(item: HistoryRow) {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await markPurchased(db, item.id, (item.is_purchased ?? 0) === 0);
    } catch (err) {
      console.warn('[trip-records toggle error]', err);
      Alert.alert('切り替えできませんでした', 'もう一度お試しください。', [{ text: 'OK' }]);
      return;
    } finally {
      busyRef.current = false;
    }
    try { await load(); } catch (e) { console.warn('[trip-records reload]', e); }
  }

  function handleDelete(item: HistoryRow) {
    Alert.alert('この記録を削除しますか？', 'この操作は取り消せません。', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除',
        style: 'destructive',
        onPress: async () => {
          if (busyRef.current) return;
          busyRef.current = true;
          // DB削除が成功してから写真fileを消す（逆順だとDB削除失敗時に記録だけ残り写真が消える）
          try {
            await deleteHistory(db, item.id);
          } catch (err) {
            console.warn('[trip-records delete error]', err);
            Alert.alert('削除できませんでした', '記録の削除中にエラーが発生しました。もう一度お試しください。', [{ text: 'OK' }]);
            return;
          } finally {
            busyRef.current = false;
          }
          if (item.image_uri && Platform.OS !== 'web') {
            try { await deleteStoredPhotoFile(item.image_uri); } catch {}
          }
          try { await load(); } catch (e) { console.warn('[trip-records reload]', e); }
        },
      },
    ]);
  }

  if (trip === undefined) {
    return <View style={styles.screen} />;
  }

  if (trip === null) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ThemedText style={styles.missingText}>旅行が見つかりません</ThemedText>
        <Pressable onPress={() => router.back()} style={styles.missingBtn}>
          <ThemedText style={styles.missingBtnText}>戻る</ThemedText>
        </Pressable>
      </View>
    );
  }

  const archived = trip.archived_at != null;
  const readOnly = isReadOnlyTrip(trip.id);
  const period = formatPeriod(trip);

  function renderItem({ item }: { item: HistoryRow }) {
    const isPurchased = (item.is_purchased ?? 0) === 1;
    const tone = isPurchased ? statusColor.purchased : statusColor.candidate;
    const hasMemo = !!item.memo?.trim();
    const sub = [
      item.currency !== 'JPY' ? formatForeign(item.foreign_amount, item.currency) : null,
      formatRecordDate(item),
    ].filter(Boolean).join(' ・ ');

    return (
      <View style={[styles.card, { borderLeftColor: tone.dot }]}>
        <Pressable
          style={styles.thumb}
          disabled={!item.image_uri}
          onPress={() => item.image_uri && setPhotoUri(item.image_uri)}>
          {item.image_uri ? (
            <ResilientPhoto uri={item.image_uri} style={styles.thumbImage} contentFit="cover" />
          ) : (
            <View style={styles.thumbPlaceholder}>
              <ThemedText style={styles.thumbPlaceholderText}>写真なし</ThemedText>
            </View>
          )}
        </Pressable>

        <View style={styles.cardMid}>
          <ThemedText style={[styles.cardTitle, !hasMemo && styles.cardTitleMuted]} numberOfLines={1}>
            {hasMemo ? item.memo!.trim() : '（メモなし）'}
          </ThemedText>
          <ThemedText style={styles.cardSub} numberOfLines={1}>{sub}</ThemedText>
          <View style={styles.cardActions}>
            <Pressable
              onPress={() => { void handleToggle(item); }}
              hitSlop={6}
              style={[styles.statusBtn, { backgroundColor: tone.badgeBg }]}>
              <ThemedText style={[styles.statusBtnText, { color: tone.text }]}>
                {isPurchased ? '✓ 購入済み' : '候補'}
              </ThemedText>
            </Pressable>
            <Pressable onPress={() => handleDelete(item)} hitSlop={8}>
              <ThemedText style={styles.deleteLink}>削除</ThemedText>
            </Pressable>
          </View>
        </View>

        <View style={styles.cardRight}>
          <ThemedText style={styles.cardJpy} numberOfLines={1}>{formatJpy(item.jpy_amount)}</ThemedText>
          <ThemedText style={styles.cardJpyLabel}>日本円</ThemedText>
        </View>
      </View>
    );
  }

  const header = (
    <View style={styles.headerWrap}>
      <View style={styles.summary}>
        <View style={styles.summaryTop}>
          <ThemedText style={styles.tripName} numberOfLines={1}>{trip.name}</ThemedText>
          <View style={[styles.badge, !archived && !readOnly && styles.badgeLive]}>
            <ThemedText style={[styles.badgeText, !archived && !readOnly && styles.badgeTextLive]}>
              {archived ? '終了' : readOnly ? '閲覧のみ' : '記録中'}
            </ThemedText>
          </View>
        </View>
        <View style={styles.summaryMeta}>
          <CurrencyFlagImage currency={trip.base_currency} size={13} outlined />
          <ThemedText style={styles.summaryMetaText}>
            {trip.base_currency === 'JPY' ? '国内' : trip.base_currency}
            {period != null ? `・${period}` : ''}
          </ThemedText>
        </View>
        <View style={styles.statBoxes}>
          <View style={[styles.statBox, { backgroundColor: color.candidateSoft }]}>
            <ThemedText style={styles.statBoxLabel}>候補 {totals.candidateCount}</ThemedText>
            <ThemedText style={[styles.statBoxValue, { color: color.candidateText }]}>{formatJpy(totals.candidateTotalJpy)}</ThemedText>
          </View>
          <View style={[styles.statBox, { backgroundColor: color.primarySoft }]}>
            <ThemedText style={styles.statBoxLabel}>購入済み {totals.purchasedCount}</ThemedText>
            <ThemedText style={[styles.statBoxValue, { color: color.purchasedText }]}>{formatJpy(totals.purchasedTotalJpy)}</ThemedText>
          </View>
        </View>
      </View>
      {readOnly && (
        <ThemedText style={styles.note}>
          Freeプランでは、この旅行に記録を追加・編集できません。記録の閲覧・削除と、候補／購入済みの切り替えはできます。
        </ThemedText>
      )}
      {totalCount > rows.length && (
        <ThemedText style={styles.note}>新しい順に{rows.length}件を表示しています（全{totalCount}件）。</ThemedText>
      )}
    </View>
  );

  return (
    <View style={styles.screen}>
      <FlatList
        data={rows}
        keyExtractor={(r) => String(r.id)}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={<ThemedText style={styles.empty}>この旅行の記録はありません</ThemedText>}
        ItemSeparatorComponent={() => <View style={styles.cardGap} />}
        contentContainerStyle={styles.list}
      />

      <View style={styles.footer}>
        {readOnly ? (
          <SecondaryButton title="★ Proで複数の旅行を管理" onPress={() => router.push('/pro')} />
        ) : (
          <PrimaryButton
            title={archived ? '旅行の編集・再開' : '旅行を編集'}
            onPress={() => router.push({ pathname: '/trip-edit', params: { id: String(trip.id) } })}
          />
        )}
      </View>

      <PhotoModal uri={photoUri} onClose={() => setPhotoUri(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgScreen },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16 },
  missingText: { fontSize: 15, fontWeight: '600', color: color.muted },
  missingBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: radius.button, borderWidth: 1.5, borderColor: color.inputBorder },
  missingBtnText: { fontSize: 15, fontWeight: '700', color: color.body },
  list: { padding: 18, paddingBottom: 32, maxWidth: 480, width: '100%', alignSelf: 'center' },
  headerWrap: { gap: 10, marginBottom: 14 },
  summary: { backgroundColor: color.card, borderRadius: radius.card, borderWidth: 1, borderColor: color.line, padding: 14, gap: 10, ...shadow.card },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tripName: { fontSize: 17, fontWeight: '700', color: color.text, flexShrink: 1 },
  badge: { backgroundColor: color.line2, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  badgeLive: { backgroundColor: color.primarySoft },
  badgeText: { fontSize: 11, fontWeight: '700', color: color.muted },
  badgeTextLive: { color: color.primaryDark },
  summaryMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  summaryMetaText: { fontSize: 12.5, fontWeight: '500', color: color.muted, fontVariant: ['tabular-nums'] },
  statBoxes: { flexDirection: 'row', gap: 10 },
  statBox: { flex: 1, borderRadius: radius.chip, paddingVertical: 10, paddingHorizontal: 12, gap: 2 },
  statBoxLabel: { fontSize: 11.5, fontWeight: '700', color: color.body },
  statBoxValue: { fontSize: 15, lineHeight: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  note: { fontSize: 12, fontWeight: '500', color: color.muted, lineHeight: 18, paddingHorizontal: 4 },
  empty: { fontSize: 13, fontWeight: '600', color: color.muted, textAlign: 'center', paddingTop: 32 },
  cardGap: { height: 10 },
  // 履歴タブのカードと同じ見た目（白カード＋左端の購入済み/候補アクセント）
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
  thumb: { width: 58, height: 58, borderRadius: radius.chip, overflow: 'hidden', flexShrink: 0 },
  thumbImage: { width: '100%', height: '100%', backgroundColor: color.line2 },
  thumbPlaceholder: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: color.line2 },
  thumbPlaceholderText: { fontSize: 10, fontWeight: '600', color: color.faint2 },
  cardMid: { flex: 1, minWidth: 0, gap: 3 },
  cardTitle: { fontSize: 13, fontWeight: '600', color: color.text, letterSpacing: -0.2 },
  cardTitleMuted: { color: color.faint },
  cardSub: { fontSize: 11, fontWeight: '500', color: color.muted, fontVariant: ['tabular-nums'] },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 3 },
  statusBtn: { borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3 },
  statusBtnText: { fontSize: 11, fontWeight: '700' },
  deleteLink: { fontSize: 12, fontWeight: '600', color: color.danger },
  cardRight: { alignItems: 'flex-end', flexShrink: 0 },
  cardJpy: { fontSize: 17, fontWeight: '700', color: color.text, letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
  cardJpyLabel: { fontSize: 10, fontWeight: '500', color: color.faint2, marginTop: 1 },
  footer: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 28, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line2, backgroundColor: color.card },
});
