import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PhotoModal } from '@/components/photo-modal';

import { ThemedText } from '@/components/themed-text';
import {
  FALLBACK_BUDGET_JPY,
  FALLBACK_TRIP_NAME,
} from '@/constants/camera-screen';
import { DT } from '@/constants/designTokens';
import { CURRENCIES } from '@/constants/currencies';
import { FREE_HISTORY_LIMIT } from '@/db/queries/history';
import type { HistoryRow } from '@/db/queries/history';
import { useHistory } from '@/hooks/use-history';
import { useTrips } from '@/hooks/use-trips';
import { useSettingsStore } from '@/stores/settings-store';
import { formatForeign, formatJpy, formatRate } from '@/utils/format';
import { getTripStatsForDisplay } from '@/utils/trip-stats';

type FilterMode = 'all' | 'candidate' | 'purchased' | 'has-memo' | 'has-photo';
type SortMode   = 'newest' | 'price-desc' | 'price-asc';

const FILTER_LABELS: Record<FilterMode, string> = {
  all: 'すべて',
  candidate: '候補',
  purchased: '購入済み',
  'has-memo': 'メモあり',
  'has-photo': '写真あり',
};
const SORT_LABELS: Record<SortMode, string> = {
  newest: '新しい順',
  'price-desc': '高い順',
  'price-asc': '安い順',
};

const FILTER_MODES = Object.keys(FILTER_LABELS) as FilterMode[];
const SORT_MODES   = Object.keys(SORT_LABELS)   as SortMode[];

// ─── 日付ピッカー定数 ─────────────────────────────────────────────

const _refYear = new Date().getFullYear();
const YEARS = Array.from({ length: 7 }, (_, i) => _refYear - 3 + i);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

function getDays(year: number, month: number): number[] {
  return Array.from({ length: new Date(year, month, 0).getDate() }, (_, i) => i + 1);
}

// ─── 日付ユーティリティ ──────────────────────────────────────────

function formatSavedAt(createdAt: string): string {
  const iso = createdAt.includes('T') ? createdAt : `${createdAt.replace(' ', 'T')}Z`;
  return new Date(iso).toLocaleDateString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function resolveDisplayDate(row: HistoryRow): string {
  if (row.entry_date) {
    const [, m, d] = row.entry_date.split('-');
    return `${parseInt(m, 10)}月${parseInt(d, 10)}日`;
  }
  return formatSavedAt(row.created_at);
}

function getInitialDateKey(row: HistoryRow): string {
  if (row.entry_date) return row.entry_date;
  const iso = row.created_at.includes('T')
    ? row.created_at
    : `${row.created_at.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── WheelCol ─────────────────────────────────────────────────────

const WHEEL_ITEM_H = 44;
const WHEEL_VISIBLE = 3;

function WheelCol({
  items,
  selected,
  onSelect,
  formatItem,
}: {
  items: number[];
  selected: number;
  onSelect: (v: number) => void;
  formatItem?: (v: number) => string;
}) {
  const listRef = useRef<FlatList<number>>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    const idx = items.indexOf(selected);
    if (idx < 0) return;
    const t = setTimeout(() => {
      listRef.current?.scrollToIndex({ index: idx, animated: false });
    }, 60);
    return () => clearTimeout(t);
  }, []); // mount only — parent remounts via key when items list changes

  return (
    <View style={wheelStyles.col}>
      {/* 中央固定ハイライト — FlatList より前に描画 = 背面に固定 */}
      <View pointerEvents="none" style={wheelStyles.highlight} />
      <FlatList
        ref={listRef}
        data={items}
        extraData={selected}
        keyExtractor={(v) => String(v)}
        snapToInterval={WHEEL_ITEM_H}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        getItemLayout={(_, i) => ({ length: WHEEL_ITEM_H, offset: WHEEL_ITEM_H * i, index: i })}
        contentContainerStyle={{ paddingVertical: WHEEL_ITEM_H * Math.floor(WHEEL_VISIBLE / 2) }}
        onScrollToIndexFailed={() => {}}
        onMomentumScrollEnd={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.y / WHEEL_ITEM_H);
          const clamped = Math.max(0, Math.min(itemsRef.current.length - 1, idx));
          onSelectRef.current(itemsRef.current[clamped]);
        }}
        renderItem={({ item }) => (
          <View style={wheelStyles.item}>
            <ThemedText
              style={[wheelStyles.itemText, item === selected && wheelStyles.itemTextSelected]}>
              {formatItem ? formatItem(item) : String(item)}
            </ThemedText>
          </View>
        )}
      />
    </View>
  );
}

const wheelStyles = StyleSheet.create({
  col: {
    flex: 1,
    height: WHEEL_ITEM_H * WHEEL_VISIBLE,
    overflow: 'hidden',
    position: 'relative',
  },
  highlight: {
    position: 'absolute',
    top: WHEEL_ITEM_H * Math.floor(WHEEL_VISIBLE / 2),
    left: 4,
    right: 4,
    height: WHEEL_ITEM_H,
    backgroundColor: DT.colors.primarySoft,
    borderRadius: 8,
  },
  item: {
    height: WHEEL_ITEM_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemText: {
    fontSize: 17,
    fontWeight: '400',
    color: DT.colors.textPrimary,
  },
  itemTextSelected: {
    fontSize: 18,
    fontWeight: '700',
    color: DT.colors.textPrimary,
  },
});

// ─── HistoryScreen ────────────────────────────────────────────────

export default function HistoryScreen() {
  const { history, totalCount, clearAll, reload, togglePurchased, removeEntry, updateAmount, updateMemo, updateEntryDate, updateImageUri } = useHistory();

  const removeEntryRef = useRef(removeEntry);
  const togglePurchasedRef = useRef(togglePurchased);
  const updateAmountRef = useRef(updateAmount);
  const updateMemoRef = useRef(updateMemo);
  const updateEntryDateRef = useRef(updateEntryDate);
  const updateImageUriRef = useRef(updateImageUri);
  removeEntryRef.current = removeEntry;
  togglePurchasedRef.current = togglePurchased;
  updateAmountRef.current = updateAmount;
  updateMemoRef.current = updateMemo;
  updateEntryDateRef.current = updateEntryDate;
  updateImageUriRef.current = updateImageUri;

  // 編集シート
  const [editingItem, setEditingItem] = useState<HistoryRow | null>(null);
  const [sheetAmount, setSheetAmount] = useState('');
  const [sheetMemo, setSheetMemo] = useState('');
  const [sheetYear, setSheetYear] = useState(0);
  const [sheetMonth, setSheetMonth] = useState(1);
  const [sheetDay, setSheetDay] = useState(1);
  const [sheetIsPurchased, setSheetIsPurchased] = useState(false);
  const [sheetOriginalDateKey, setSheetOriginalDateKey] = useState('');

  const [photoModalUri, setPhotoModalUri] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [sortMode,   setSortMode]   = useState<SortMode>('newest');
  const isPro = useSettingsStore((s) => s.isPro);
  const isLimited = !isPro && totalCount >= FREE_HISTORY_LIMIT;
  const { activeTrip } = useTrips();

  const tripName = activeTrip?.name ?? FALLBACK_TRIP_NAME;
  const tripBudgetJpy = activeTrip?.budget_jpy ?? FALLBACK_BUDGET_JPY;

  const stats = useMemo(
    () => getTripStatsForDisplay(history, tripBudgetJpy, activeTrip?.id),
    [history, totalCount, tripBudgetJpy, activeTrip?.id],
  );

  const displayHistory = useMemo(() => {
    let result = history;
    if (filterMode === 'candidate')  result = result.filter((r) => r.is_purchased === 0);
    if (filterMode === 'purchased')  result = result.filter((r) => r.is_purchased === 1);
    if (filterMode === 'has-memo')   result = result.filter((r) => !!r.memo);
    if (filterMode === 'has-photo')  result = result.filter((r) => !!r.image_uri);
    if (sortMode === 'price-desc')   result = [...result].sort((a, b) => b.jpy_amount - a.jpy_amount);
    if (sortMode === 'price-asc')    result = [...result].sort((a, b) => a.jpy_amount - b.jpy_amount);
    return result;
  }, [history, filterMode, sortMode]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  function handleDeleteItem(item: HistoryRow) {
    Alert.alert(
      '買い物候補を削除しますか？',
      'この候補を履歴から削除します。この操作は取り消せません。',
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
            removeEntryRef.current(item.id);
          },
        },
      ],
    );
  }

  function handleClearAll() {
    const isFiltered = filterMode !== 'all';
    const message = isFiltered
      ? 'この操作は取り消せません。表示中だけでなく全履歴が削除されます。'
      : 'この操作は取り消せません。';
    Alert.alert('すべての履歴を削除しますか？', message, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: 'すべて削除',
        style: 'destructive',
        onPress: async () => {
          if (Platform.OS !== 'web') {
            try {
              const docsDir = FileSystem.documentDirectory;
              if (docsDir) {
                await FileSystem.deleteAsync(`${docsDir}photos/`, { idempotent: true });
              }
            } catch {}
          }
          clearAll();
        },
      },
    ]);
  }

  async function handleAddImage(item: HistoryRow) {
    if (Platform.OS === 'web') return;
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: false,
    });
    if (picked.canceled || !picked.assets[0]) return;
    const docsDir = FileSystem.documentDirectory;
    const photosDir = `${docsDir}photos/`;
    await FileSystem.makeDirectoryAsync(photosDir, { intermediates: true });
    const destUri = `${photosDir}${Date.now()}.jpg`;
    await FileSystem.copyAsync({ from: picked.assets[0].uri, to: destUri });
    await updateImageUriRef.current(item.id, destUri);
  }

  async function handleChangeImage(item: HistoryRow) {
    if (Platform.OS === 'web') return;
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: false,
    });
    if (picked.canceled || !picked.assets[0]) return;
    if (item.image_uri) {
      try { await FileSystem.deleteAsync(item.image_uri, { idempotent: true }); } catch {}
    }
    const docsDir = FileSystem.documentDirectory;
    const photosDir = `${docsDir}photos/`;
    await FileSystem.makeDirectoryAsync(photosDir, { intermediates: true });
    const destUri = `${photosDir}${Date.now()}.jpg`;
    await FileSystem.copyAsync({ from: picked.assets[0].uri, to: destUri });
    await updateImageUriRef.current(item.id, destUri);
  }

  function handleDeleteImage(item: HistoryRow) {
    Alert.alert(
      '画像を削除しますか？',
      'この記録から画像を削除します。この操作は取り消せません。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除',
          style: 'destructive',
          onPress: async () => {
            if (item.image_uri && Platform.OS !== 'web') {
              try { await FileSystem.deleteAsync(item.image_uri, { idempotent: true }); } catch {}
            }
            updateImageUriRef.current(item.id, null);
          },
        },
      ],
    );
  }

  function openEditSheet(item: HistoryRow) {
    const dateKey = getInitialDateKey(item);
    const [y, m, d] = dateKey.split('-').map(Number);
    setEditingItem(item);
    setSheetAmount(item.currency === 'JPY' ? String(item.jpy_amount) : String(item.foreign_amount));
    setSheetMemo(item.memo ?? '');
    setSheetYear(y);
    setSheetMonth(m);
    setSheetDay(Math.min(d, new Date(y, m, 0).getDate()));
    setSheetIsPurchased((item.is_purchased ?? 0) === 1);
    setSheetOriginalDateKey(dateKey);
  }

  function closeEditSheet() {
    setEditingItem(null);
  }

  function handleSheetYearChange(y: number) {
    setSheetYear(y);
    const maxDay = new Date(y, sheetMonth, 0).getDate();
    setSheetDay((prev) => Math.min(prev, maxDay));
  }

  function handleSheetMonthChange(m: number) {
    setSheetMonth(m);
    const maxDay = new Date(sheetYear, m, 0).getDate();
    setSheetDay((prev) => Math.min(prev, maxDay));
  }

  async function handleSaveSheet() {
    if (!editingItem) return;
    const id = editingItem.id;
    const updates: Promise<void>[] = [];

    if (editingItem.currency === 'JPY') {
      const amount = parseInt(sheetAmount.trim(), 10);
      if (isFinite(amount) && amount > 0 && amount !== editingItem.jpy_amount) {
        updates.push(updateAmountRef.current(id, amount, amount));
      }
    } else {
      const foreign = parseFloat(sheetAmount.trim());
      if (isFinite(foreign) && foreign > 0 && foreign !== editingItem.foreign_amount) {
        const jpy = Math.round(foreign * editingItem.rate_used);
        updates.push(updateAmountRef.current(id, foreign, jpy));
      }
    }

    updates.push(updateMemoRef.current(id, sheetMemo.trim() || null));

    const newDateKey = `${sheetYear}-${String(sheetMonth).padStart(2, '0')}-${String(sheetDay).padStart(2, '0')}`;
    if (newDateKey !== sheetOriginalDateKey) {
      updates.push(updateEntryDateRef.current(id, newDateKey));
    }

    const wasPurchased = (editingItem.is_purchased ?? 0) === 1;
    if (sheetIsPurchased !== wasPurchased) {
      updates.push(togglePurchasedRef.current(id, editingItem.is_purchased ?? 0));
    }

    if (updates.length > 0) await Promise.all(updates);
    setEditingItem(null);
  }

  function handleImageButton(item: HistoryRow) {
    if (Platform.OS === 'web') return;
    if (item.image_uri) {
      Alert.alert('画像', '', [
        { text: 'キャンセル', style: 'cancel' },
        { text: '変更', onPress: () => handleChangeImage(item) },
        { text: '削除', style: 'destructive', onPress: () => handleDeleteImage(item) },
      ]);
    } else {
      handleAddImage(item);
    }
  }

  function renderItem({ item }: { item: HistoryRow }) {
    const displayDate = resolveDisplayDate(item);
    const isPurchased = (item.is_purchased ?? 0) === 1;

    return (
      <View style={styles.candidateCard}>
        <View style={styles.cardTop}>
          <ThemedText style={styles.tripLabel}>{tripName}</ThemedText>
          <TouchableOpacity
            style={[styles.badge, isPurchased && styles.badgePurchased]}
            onPress={() => togglePurchasedRef.current(item.id, item.is_purchased ?? 0)}
            hitSlop={8}>
            <ThemedText style={[styles.badgeText, isPurchased && styles.badgeTextPurchased]}>
              {isPurchased ? '✓ 購入済み' : '候補'}
            </ThemedText>
          </TouchableOpacity>
        </View>

        <View style={item.image_uri ? styles.cardRow : undefined}>
          {item.image_uri && (
            <TouchableOpacity
              onPress={() => setPhotoModalUri(item.image_uri!)}
              activeOpacity={0.8}
              style={styles.thumbCol}>
              <Image
                source={{ uri: item.image_uri! }}
                style={styles.thumbnail}
                contentFit="cover"
              />
            </TouchableOpacity>
          )}

          <View style={item.image_uri ? styles.cardRight : undefined}>
            {item.currency !== 'JPY' && (
              <ThemedText style={styles.foreignPrice}>
                {formatForeign(item.foreign_amount, item.currency)}
              </ThemedText>
            )}
            <ThemedText style={[styles.jpyPrice, isPurchased && styles.jpyPricePurchased]}>
              {item.currency === 'JPY' ? formatJpy(item.jpy_amount) : `約 ${formatJpy(item.jpy_amount)}`}
            </ThemedText>
            {item.memo && (
              <View style={styles.memoChip}>
                <ThemedText style={styles.memoChipText}>{item.memo}</ThemedText>
              </View>
            )}
          </View>
        </View>

        <View style={styles.cardMeta}>
          <ThemedText style={styles.rateText}>
            {formatRate(item.rate_used, item.currency)}
          </ThemedText>
          <ThemedText style={[styles.dateText, !!item.entry_date && styles.dateTextModified]}>
            {displayDate}
          </ThemedText>
        </View>

        <View style={styles.cardActions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => openEditSheet(item)}
            activeOpacity={0.75}>
            <ThemedText style={styles.actionBtnText}>編集</ThemedText>
          </TouchableOpacity>
          {Platform.OS !== 'web' && (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => handleImageButton(item)}
              activeOpacity={0.75}>
              <ThemedText style={styles.actionBtnText}>画像</ThemedText>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnDelete]}
            onPress={() => handleDeleteItem(item)}
            activeOpacity={0.75}>
            <ThemedText style={styles.actionBtnTextDelete}>削除</ThemedText>
          </TouchableOpacity>
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
          <TouchableOpacity onPress={handleClearAll} hitSlop={8}>
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

      {/* フィルター */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
        keyboardShouldPersistTaps="handled">
        {FILTER_MODES.map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, filterMode === f && styles.filterChipActive]}
            onPress={() => setFilterMode(f)}
            activeOpacity={0.75}>
            <ThemedText style={[styles.filterChipText, filterMode === f && styles.filterChipTextActive]}>
              {FILTER_LABELS[f]}
            </ThemedText>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* 並び替え */}
      <View style={styles.sortRow}>
        {SORT_MODES.map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.sortBtn, sortMode === s && styles.sortBtnActive]}
            onPress={() => setSortMode(s)}
            activeOpacity={0.75}>
            <ThemedText style={[styles.sortBtnText, sortMode === s && styles.sortBtnTextActive]}>
              {SORT_LABELS[s]}
            </ThemedText>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  return (
    <View style={styles.screen}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <FlatList
          data={displayHistory}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.cardGap} />}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={
            <View style={styles.empty}>
              <ThemedText style={styles.emptyTitle}>
                {history.length === 0
                  ? 'まだ買い物候補はありません'
                  : 'フィルターに一致する候補がありません'}
              </ThemedText>
              <ThemedText style={styles.emptyBody}>
                {history.length === 0
                  ? `カメラで値札を読み取って、${'\n'}気になる商品を保存できます`
                  : '「すべて」を選ぶと全件表示されます'}
              </ThemedText>
            </View>
          }
        />
      </SafeAreaView>

      {/* 写真フルスクリーンモーダル */}
      <PhotoModal uri={photoModalUri} onClose={() => setPhotoModalUri(null)} />

      {/* 編集シート */}
      {editingItem && (
        <Modal
          visible
          animationType="slide"
          transparent
          onRequestClose={closeEditSheet}>
          <View style={styles.sheetBg}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closeEditSheet} />
            <View style={styles.sheetCard}>
              <ThemedText style={styles.sheetTitle}>記録を編集</ThemedText>

              {/* 金額 */}
              <View style={styles.sheetField}>
                <ThemedText style={styles.sheetLabel}>
                  {editingItem.currency === 'JPY' ? '金額' : '外貨金額'}
                </ThemedText>
                <View style={styles.sheetPriceRow}>
                  <ThemedText style={styles.sheetPriceSymbol}>
                    {editingItem.currency === 'JPY' ? '¥' : CURRENCIES[editingItem.currency].symbol}
                  </ThemedText>
                  <TextInput
                    style={styles.sheetPriceInput}
                    value={sheetAmount}
                    onChangeText={setSheetAmount}
                    keyboardType={editingItem.currency === 'JPY' ? 'number-pad' : 'decimal-pad'}
                    returnKeyType="done"
                    selectTextOnFocus
                  />
                </View>
                {editingItem.currency !== 'JPY' && (
                  <ThemedText style={styles.sheetRateHint}>
                    {(() => {
                      const f = parseFloat(sheetAmount);
                      const jpy = isFinite(f) && f > 0 ? Math.round(f * editingItem.rate_used) : null;
                      return `${jpy != null ? `約 ${formatJpy(jpy)}` : '—'}　（${formatRate(editingItem.rate_used, editingItem.currency)}）`;
                    })()}
                  </ThemedText>
                )}
              </View>

              {/* メモ */}
              <View style={styles.sheetField}>
                <ThemedText style={styles.sheetLabel}>メモ</ThemedText>
                <TextInput
                  style={styles.sheetMemoInput}
                  value={sheetMemo}
                  onChangeText={setSheetMemo}
                  placeholder="メモを入力（省略可）"
                  placeholderTextColor={DT.colors.textMuted}
                  maxLength={100}
                  returnKeyType="done"
                />
              </View>

              {/* 日付 */}
              <View style={styles.sheetField}>
                <ThemedText style={styles.sheetLabel}>買い物日</ThemedText>
                <View style={styles.wheelHeaders}>
                  <ThemedText style={styles.wheelHeader}>年</ThemedText>
                  <ThemedText style={styles.wheelHeader}>月</ThemedText>
                  <ThemedText style={styles.wheelHeader}>日</ThemedText>
                </View>
                <View style={styles.wheelsRow}>
                  <WheelCol
                    items={YEARS}
                    selected={sheetYear}
                    onSelect={handleSheetYearChange}
                  />
                  <WheelCol
                    items={MONTHS}
                    selected={sheetMonth}
                    onSelect={handleSheetMonthChange}
                    formatItem={(v) => `${v}月`}
                  />
                  <WheelCol
                    key={`sheet-day-${sheetYear}-${sheetMonth}`}
                    items={getDays(sheetYear, sheetMonth)}
                    selected={sheetDay}
                    onSelect={setSheetDay}
                    formatItem={(v) => `${v}日`}
                  />
                </View>
              </View>

              {/* 状態 */}
              <View style={styles.sheetField}>
                <ThemedText style={styles.sheetLabel}>状態</ThemedText>
                <View style={styles.sheetToggle}>
                  <TouchableOpacity
                    style={[styles.sheetToggleBtn, !sheetIsPurchased && styles.sheetToggleBtnActive]}
                    onPress={() => setSheetIsPurchased(false)}
                    activeOpacity={0.75}>
                    <ThemedText style={[styles.sheetToggleBtnText, !sheetIsPurchased && styles.sheetToggleBtnTextActive]}>
                      候補
                    </ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.sheetToggleBtn, sheetIsPurchased && styles.sheetToggleBtnActive]}
                    onPress={() => setSheetIsPurchased(true)}
                    activeOpacity={0.75}>
                    <ThemedText style={[styles.sheetToggleBtnText, sheetIsPurchased && styles.sheetToggleBtnTextActive]}>
                      購入済み
                    </ThemedText>
                  </TouchableOpacity>
                </View>
              </View>

              {/* アクション */}
              <View style={styles.sheetActions}>
                <TouchableOpacity
                  style={styles.sheetCancelBtn}
                  onPress={closeEditSheet}
                  activeOpacity={0.75}>
                  <ThemedText style={styles.sheetCancelText}>キャンセル</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.sheetSaveBtn}
                  onPress={handleSaveSheet}
                  activeOpacity={0.75}>
                  <ThemedText style={styles.sheetSaveText}>保存</ThemedText>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: DT.colors.background,
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
    color: DT.colors.textPrimary,
    letterSpacing: -0.4,
    lineHeight: 34,
  },
  subtitle: {
    fontSize: 14,
    color: DT.colors.textSecondary,
    marginTop: 4,
    fontWeight: '500',
  },
  clearAll: {
    fontSize: 15,
    fontWeight: '600',
    color: DT.colors.primary,
    paddingTop: 6,
  },

  summaryCard: {
    backgroundColor: DT.colors.surface,
    borderRadius: DT.radius.lg,
    padding: DT.spacing.lg,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DT.colors.border,
    ...DT.shadow.card,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryRowLast: {
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: DT.colors.border,
    marginTop: 2,
  },
  summaryLabel: {
    fontSize: 14,
    color: DT.colors.textSecondary,
    fontWeight: '500',
  },
  summaryValue: {
    fontSize: 15,
    fontWeight: '600',
    color: DT.colors.textPrimary,
  },
  summaryAccent: {
    fontSize: 16,
    fontWeight: '700',
    color: DT.colors.candidate,
    letterSpacing: -0.3,
  },
  summaryRemaining: {
    fontSize: 18,
    fontWeight: '700',
    color: DT.colors.primary,
    letterSpacing: -0.4,
  },

  proBanner: {
    backgroundColor: DT.colors.primarySoft,
    borderRadius: DT.radius.md,
    padding: DT.spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${DT.colors.primary}33`,
  },
  proBannerText: {
    color: DT.colors.primary,
    textAlign: 'center',
    fontSize: DT.fontSize.xs,
    fontWeight: DT.fontWeight.semibold,
  },

  cardGap: { height: 12 },
  candidateCard: {
    backgroundColor: DT.colors.surface,
    borderRadius: DT.radius.lg,
    padding: 14,
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DT.colors.border,
    ...DT.shadow.card,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  thumbCol: {
    flexShrink: 0,
  },
  cardRight: {
    flex: 1,
    gap: 4,
  },
  tripLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: DT.colors.textMuted,
    letterSpacing: 0.1,
  },
  badge: {
    backgroundColor: DT.colors.candidateBg,
    borderRadius: DT.radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgePurchased: {
    backgroundColor: DT.colors.purchasedBg,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: DT.colors.candidate,
    letterSpacing: 0.3,
  },
  badgeTextPurchased: {
    color: DT.colors.purchased,
  },
  jpyPricePurchased: {
    opacity: 0.45,
  },
  foreignPrice: {
    fontSize: 22,
    fontWeight: '700',
    color: DT.colors.textPrimary,
    letterSpacing: -0.4,
  },
  jpyPrice: {
    fontSize: 28,
    fontWeight: '700',
    color: DT.colors.textPrimary,
    letterSpacing: -0.6,
    lineHeight: 34,
  },
  memoChip: {
    alignSelf: 'flex-start',
    backgroundColor: DT.colors.background,
    borderRadius: DT.radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  memoChipText: {
    fontSize: 13,
    color: DT.colors.textSecondary,
    fontWeight: '500',
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: DT.colors.border,
  },
  rateText: {
    fontSize: 13,
    color: DT.colors.textMuted,
    fontWeight: '500',
  },
  dateText: {
    fontSize: 13,
    color: DT.colors.textMuted,
    fontWeight: '500',
  },
  dateTextModified: {
    color: DT.colors.primary,
    fontWeight: '600',
  },
  cardActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: DT.radius.sm,
    backgroundColor: DT.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DT.colors.border,
  },
  actionBtnDelete: {
    borderColor: '#E35D5B22',
    backgroundColor: '#E35D5B08',
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: DT.colors.primary,
  },
  actionBtnTextDelete: {
    fontSize: 13,
    fontWeight: '600',
    color: DT.colors.danger,
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
    color: DT.colors.textSecondary,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 14,
    color: DT.colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },

  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 2,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: DT.radius.pill,
    backgroundColor: DT.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DT.colors.border,
  },
  filterChipActive: {
    backgroundColor: DT.colors.primary,
    borderColor: DT.colors.primary,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: DT.colors.textSecondary,
  },
  filterChipTextActive: {
    color: '#fff',
  },

  sortRow: {
    flexDirection: 'row',
    borderRadius: DT.radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DT.colors.border,
    overflow: 'hidden',
    backgroundColor: DT.colors.surface,
  },
  sortBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
  },
  sortBtnActive: {
    backgroundColor: DT.colors.background,
  },
  sortBtnText: {
    fontSize: 12,
    fontWeight: '500',
    color: DT.colors.textMuted,
  },
  sortBtnTextActive: {
    fontSize: 12,
    fontWeight: '700',
    color: DT.colors.textPrimary,
  },

  thumbnail: {
    width: 80,
    height: 60,
    borderRadius: DT.radius.sm,
    backgroundColor: DT.colors.background,
  },

  // ── ホイールピッカー（編集シート内で使用） ──
  wheelHeaders: {
    flexDirection: 'row',
  },
  wheelHeader: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    color: DT.colors.textMuted,
    paddingBottom: 4,
  },
  wheelsRow: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: DT.colors.border,
    overflow: 'hidden',
  },

  // ── 編集シート ──
  sheetBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheetCard: {
    backgroundColor: DT.colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 36,
    gap: 20,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: DT.colors.textPrimary,
    textAlign: 'center',
  },
  sheetField: {
    gap: 8,
  },
  sheetLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: DT.colors.textSecondary,
  },
  sheetPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: DT.colors.background,
    borderRadius: DT.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  sheetPriceSymbol: {
    fontSize: 22,
    fontWeight: '700',
    color: DT.colors.textPrimary,
  },
  sheetPriceInput: {
    flex: 1,
    fontSize: 22,
    fontWeight: '700',
    color: DT.colors.textPrimary,
    paddingVertical: 10,
  },
  sheetRateHint: {
    fontSize: 13,
    color: DT.colors.textSecondary,
    fontWeight: '500',
  },
  sheetMemoInput: {
    backgroundColor: DT.colors.background,
    borderRadius: DT.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: DT.colors.textPrimary,
  },
  sheetToggle: {
    flexDirection: 'row',
    borderRadius: DT.radius.sm,
    borderWidth: 1,
    borderColor: DT.colors.border,
    overflow: 'hidden',
  },
  sheetToggleBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
  },
  sheetToggleBtnActive: {
    backgroundColor: DT.colors.primary,
  },
  sheetToggleBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: DT.colors.textMuted,
  },
  sheetToggleBtnTextActive: {
    color: '#fff',
  },
  sheetActions: {
    flexDirection: 'row',
    gap: 12,
  },
  sheetCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: DT.radius.md,
    alignItems: 'center',
    backgroundColor: DT.colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DT.colors.border,
  },
  sheetCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: DT.colors.textSecondary,
  },
  sheetSaveBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: DT.radius.md,
    alignItems: 'center',
    backgroundColor: DT.colors.primary,
  },
  sheetSaveText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});
