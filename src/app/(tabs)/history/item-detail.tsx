import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useCallback } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

import { PhotoModal } from '@/components/photo-modal';
import { ThemedText } from '@/components/themed-text';
import { CURRENCIES } from '@/constants/currencies';
import type { HistoryRow } from '@/db/queries/history';
import { useHistory } from '@/hooks/use-history';
import { useTrips } from '@/hooks/use-trips';
import { color, radius, shadow } from '@/theme/tokens';
import { formatForeign, formatJpy, formatRate } from '@/utils/format';
import { useState } from 'react';

function formatSavedAt(row: HistoryRow): string {
  const iso = row.created_at.includes('T') ? row.created_at : `${row.created_at.replace(' ', 'T')}Z`;
  const created = new Date(iso);
  const time = `${String(created.getHours()).padStart(2, '0')}:${String(created.getMinutes()).padStart(2, '0')}`;
  let basis = created;
  if (row.entry_date) {
    const [y, m, d] = row.entry_date.split('-').map(Number);
    basis = new Date(y, m - 1, d);
  }
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOfDay(new Date()) - startOfDay(basis)) / 86_400_000);
  if (diff === 0) return `今日 ${time}`;
  if (diff === 1) return `昨日 ${time}`;
  return `${basis.getMonth() + 1}月${basis.getDate()}日 ${time}`;
}

export default function ItemDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id != null ? parseInt(params.id, 10) : NaN;
  const { history, reload, removeEntry } = useHistory();
  const { activeTrip } = useTrips();
  const [photoOpen, setPhotoOpen] = useState(false);
  // ScrollView自体の表示可能高さとcontentContainerの実測高さを比較し、
  // 本当に収まっている時だけscrollEnabledをfalseにする（bounces/overScrollModeだけでは
  // 実測の僅かなオーバーフロー分はスクロールできてしまうため、実測ベースで止める）。
  const [scrollAreaHeight, setScrollAreaHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const canScroll = contentHeight > scrollAreaHeight + 1;

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const item = history.find((r) => r.id === id);

  if (!item) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ThemedText style={styles.missingText}>この記録は見つかりません</ThemedText>
        <Pressable onPress={() => router.back()} style={styles.missingBtn}>
          <ThemedText style={styles.missingBtnText}>戻る</ThemedText>
        </Pressable>
      </View>
    );
  }

  const isPurchased = (item.is_purchased ?? 0) === 1;
  const isForeign = item.currency !== 'JPY';
  const statusLabel = isPurchased ? '購入済み' : '候補';
  const statusBg = isPurchased ? color.primarySoft : color.candidateSoft;
  const statusFg = isPurchased ? color.purchasedText : color.candidateText;
  const title = item.memo?.trim() ? item.memo.trim() : '（メモなし）';

  function handleDelete() {
    if (!item) return;
    Alert.alert('この記録を削除しますか？', 'この操作は取り消せません。', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除',
        style: 'destructive',
        onPress: async () => {
          if (item.image_uri && Platform.OS !== 'web') {
            try { await FileSystem.deleteAsync(item.image_uri, { idempotent: true }); } catch {}
          }
          await removeEntry(item.id);
          router.back();
        },
      },
    ]);
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scroll}
        onLayout={(e) => setScrollAreaHeight(e.nativeEvent.layout.height)}
        onContentSizeChange={(_w, h) => setContentHeight(h)}
        scrollEnabled={canScroll}
        bounces={canScroll}
        overScrollMode={canScroll ? 'auto' : 'never'}>
        {/* 大判写真 */}
        <Pressable
          onPress={() => item.image_uri && setPhotoOpen(true)}
          disabled={!item.image_uri}
          style={styles.photo}>
          {item.image_uri ? (
            <Image source={{ uri: item.image_uri }} style={styles.photoImage} contentFit="cover" />
          ) : (
            <View style={styles.photoPlaceholder}>
              <ThemedText style={styles.photoPlaceholderText}>写真なし</ThemedText>
            </View>
          )}
        </Pressable>

        {/* タイトル＋状態 */}
        <View style={styles.titleRow}>
          <ThemedText style={[styles.title, !item.memo?.trim() && styles.titleMuted]} numberOfLines={2}>
            {title}
          </ThemedText>
          <View style={[styles.statusChip, { backgroundColor: statusBg }]}>
            <ThemedText style={[styles.statusChipText, { color: statusFg }]}>{statusLabel}</ThemedText>
          </View>
        </View>

        {/* 円換算ヒーロー */}
        <View style={styles.heroRow}>
          <View style={styles.heroLeft}>
            <ThemedText style={styles.heroLabel}>日本円で</ThemedText>
            <ThemedText style={styles.heroJpy} numberOfLines={1}>{formatJpy(item.jpy_amount)}</ThemedText>
          </View>
          {isForeign && (
            <View style={styles.heroRight}>
              <ThemedText style={styles.heroForeign}>
                {formatForeign(item.foreign_amount, item.currency)}
              </ThemedText>
              <ThemedText style={styles.heroRate}>{formatRate(item.rate_used, item.currency)}</ThemedText>
            </View>
          )}
        </View>

        {/* 情報行 */}
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <ThemedText style={styles.infoLabel}>通貨</ThemedText>
            <ThemedText style={styles.infoValue}>
              {CURRENCIES[item.currency].flag} {item.currency === 'JPY' ? '日本円' : item.currency}
            </ThemedText>
          </View>
          <View style={styles.infoSep} />
          <View style={styles.infoRow}>
            <ThemedText style={styles.infoLabel}>旅行</ThemedText>
            <ThemedText style={styles.infoValue}>{activeTrip?.name ?? '—'}</ThemedText>
          </View>
          <View style={styles.infoSep} />
          <View style={styles.infoRow}>
            <ThemedText style={styles.infoLabel}>保存日時</ThemedText>
            <ThemedText style={styles.infoValue}>{formatSavedAt(item)}</ThemedText>
          </View>
        </View>
      </ScrollView>

      {/* 固定フッター：削除（控えめ）＋ 編集する（主導線） */}
      <View style={styles.footer}>
        <Pressable
          onPress={handleDelete}
          style={({ pressed }) => [styles.deleteBtn, pressed && styles.pressed]}>
          <ThemedText style={styles.deleteIcon}>🗑</ThemedText>
        </Pressable>
        <Pressable
          onPress={() => router.push({ pathname: '/history/item-edit', params: { id: String(item.id) } })}
          style={({ pressed }) => [styles.editBtn, pressed && styles.pressed]}>
          <ThemedText style={styles.editBtnText}>編集する</ThemedText>
        </Pressable>
      </View>

      <PhotoModal uri={photoOpen ? item.image_uri : null} onClose={() => setPhotoOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgScreen },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16 },
  missingText: { fontSize: 15, fontWeight: '600', color: color.muted },
  missingBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: radius.button,
    borderWidth: 1.5,
    borderColor: color.inputBorder,
  },
  missingBtnText: { fontSize: 15, fontWeight: '700', color: color.body },
  // ScrollView本体に明示flex:1を与え、screen内の利用可能高さを正しく確定させる
  // （これが無いとcontentに合わせて自分自身の高さを決めてしまい、実測との比較がずれる）。
  scrollView: { flex: 1 },
  scroll: {
    padding: 18,
    // 固定フッターは兄弟View（下に別途ある）なので、ここでクリア用の大きい余白は不要。
    // 小さい端末で実際に入り切らない時の最低限の余白として小さめに残す。
    paddingBottom: 24,
    gap: 16,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  photo: {
    width: '100%',
    height: 220,
    borderRadius: radius.cardLg,
    overflow: 'hidden',
    backgroundColor: color.line2,
  },
  photoImage: { width: '100%', height: '100%' },
  photoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  photoPlaceholderText: { fontSize: 13, fontWeight: '600', color: color.faint2 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  title: { flex: 1, fontSize: 20, fontWeight: '700', color: color.text, letterSpacing: -0.3 },
  titleMuted: { fontWeight: '600', color: color.faint },
  statusChip: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, marginTop: 2 },
  statusChipText: { fontSize: 12, fontWeight: '700' },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
  },
  heroLeft: { flexShrink: 1 },
  heroLabel: { fontSize: 12, fontWeight: '700', color: color.primary, marginBottom: 2 },
  heroJpy: {
    fontSize: 38,
    lineHeight: 46,
    fontWeight: '700',
    color: color.text,
    letterSpacing: -1.2,
    fontVariant: ['tabular-nums'],
  },
  heroRight: { alignItems: 'flex-end', gap: 2, paddingBottom: 6 },
  heroForeign: {
    fontSize: 16,
    fontWeight: '700',
    color: color.body,
    fontVariant: ['tabular-nums'],
  },
  heroRate: { fontSize: 12, fontWeight: '500', color: color.muted, fontVariant: ['tabular-nums'] },
  infoCard: {
    backgroundColor: color.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.line,
    ...shadow.card,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  infoLabel: { fontSize: 13, fontWeight: '600', color: color.muted },
  infoValue: { fontSize: 14, fontWeight: '600', color: color.text, flexShrink: 1, textAlign: 'right' },
  infoSep: { height: StyleSheet.hairlineWidth, backgroundColor: color.line2, marginLeft: 16 },
  footer: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line2,
    backgroundColor: color.card,
  },
  deleteBtn: {
    width: 56,
    borderRadius: radius.button,
    borderWidth: 1.5,
    borderColor: color.dangerBorder,
    backgroundColor: color.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteIcon: { fontSize: 18 },
  editBtn: {
    flex: 1,
    height: 52,
    borderRadius: radius.button,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.cta,
  },
  editBtnText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  pressed: { opacity: 0.85 },
});
