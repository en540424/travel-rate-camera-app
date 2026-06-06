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
const WHEEL_VISIBLE = 5;

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
    backgroundColor: C.brandSoft,
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
    color: C.text,
  },
  itemTextSelected: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
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

  // メモ編集
  const [editingMemoId, setEditingMemoId] = useState<number | null>(null);
  const [editingMemoText, setEditingMemoText] = useState('');
  const editingMemoIdRef = useRef(editingMemoId);
  const editingMemoTextRef = useRef(editingMemoText);
  editingMemoIdRef.current = editingMemoId;
  editingMemoTextRef.current = editingMemoText;

  // 価格編集
  const [editingPriceId, setEditingPriceId] = useState<number | null>(null);
  const [editingPriceText, setEditingPriceText] = useState('');
  const editingPriceIdRef = useRef(editingPriceId);
  const editingPriceTextRef = useRef(editingPriceText);
  editingPriceIdRef.current = editingPriceId;
  editingPriceTextRef.current = editingPriceText;

  // 日付編集
  const [editingDateId, setEditingDateId] = useState<number | null>(null);
  const [pickerYear,  setPickerYear]  = useState(0);
  const [pickerMonth, setPickerMonth] = useState(1);
  const [pickerDay,   setPickerDay]   = useState(1);
  const editingDateIdRef = useRef(editingDateId);
  const pickerYearRef  = useRef(pickerYear);
  const pickerMonthRef = useRef(pickerMonth);
  const pickerDayRef   = useRef(pickerDay);
  editingDateIdRef.current = editingDateId;
  pickerYearRef.current  = pickerYear;
  pickerMonthRef.current = pickerMonth;
  pickerDayRef.current   = pickerDay;

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

  function startEditPrice(id: number, currentAmount: number) {
    setEditingPriceId(id);
    setEditingPriceText(String(currentAmount));
    setEditingMemoId(null);
    setEditingMemoText('');
  }

  async function saveEditPrice() {
    const id = editingPriceIdRef.current;
    const text = editingPriceTextRef.current;
    if (id === null) return;
    const amount = parseInt(text.trim(), 10);
    if (!isFinite(amount) || amount <= 0) return;
    await updateAmountRef.current(id, amount);
    setEditingPriceId(null);
    setEditingPriceText('');
  }

  function cancelEditPrice() {
    setEditingPriceId(null);
    setEditingPriceText('');
  }

  function startEditMemo(id: number, currentMemo: string | null) {
    setEditingMemoId(id);
    setEditingMemoText(currentMemo ?? '');
    setEditingPriceId(null);
    setEditingPriceText('');
  }

  async function saveEditMemo() {
    const id = editingMemoIdRef.current;
    const text = editingMemoTextRef.current;
    if (id === null) return;
    await updateMemoRef.current(id, text.trim() || null);
    setEditingMemoId(null);
    setEditingMemoText('');
  }

  function cancelEditMemo() {
    setEditingMemoId(null);
    setEditingMemoText('');
  }

  function startEditDate(item: HistoryRow) {
    setEditingPriceId(null);
    setEditingMemoId(null);
    const dateKey = getInitialDateKey(item);
    const [y, m, d] = dateKey.split('-').map(Number);
    setPickerYear(y);
    setPickerMonth(m);
    setPickerDay(Math.min(d, new Date(y, m, 0).getDate()));
    setEditingDateId(item.id);
  }

  async function saveDateEdit() {
    const id = editingDateIdRef.current;
    if (id === null) return;
    const y = pickerYearRef.current;
    const m = pickerMonthRef.current;
    const d = pickerDayRef.current;
    const dateKey = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    await updateEntryDateRef.current(id, dateKey);
    setEditingDateId(null);
  }

  function cancelDateEdit() {
    setEditingDateId(null);
  }

  function handleYearChange(y: number) {
    setPickerYear(y);
    const maxDay = new Date(y, pickerMonth, 0).getDate();
    setPickerDay((prev) => Math.min(prev, maxDay));
  }

  function handleMonthChange(m: number) {
    setPickerMonth(m);
    const maxDay = new Date(pickerYear, m, 0).getDate();
    setPickerDay((prev) => Math.min(prev, maxDay));
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

        {editingPriceId === item.id ? (
          <View style={styles.priceEditBlock}>
            <View style={styles.priceEditRow}>
              <ThemedText style={styles.priceEditSymbol}>¥</ThemedText>
              <TextInput
                style={styles.priceEditInput}
                value={editingPriceText}
                onChangeText={setEditingPriceText}
                keyboardType="number-pad"
                returnKeyType="done"
                onSubmitEditing={saveEditPrice}
                autoFocus
                selectTextOnFocus
              />
            </View>
            <View style={styles.priceEditActions}>
              <TouchableOpacity
                style={styles.priceSaveBtn}
                onPress={saveEditPrice}
                activeOpacity={0.75}>
                <ThemedText style={styles.priceSaveBtnText}>保存</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity onPress={cancelEditPrice} hitSlop={8}>
                <ThemedText style={styles.priceCancelText}>キャンセル</ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <>
            {item.currency !== 'JPY' && (
              <ThemedText style={styles.foreignPrice}>
                {formatForeign(item.foreign_amount, item.currency)}
              </ThemedText>
            )}
            <ThemedText style={[styles.jpyPrice, isPurchased && styles.jpyPricePurchased]}>
              {item.currency === 'JPY' ? formatJpy(item.jpy_amount) : `約 ${formatJpy(item.jpy_amount)}`}
            </ThemedText>
          </>
        )}

        {/* 商品写真サムネイル */}
        {editingPriceId !== item.id && item.image_uri && (
          <TouchableOpacity
            onPress={() => setPhotoModalUri(item.image_uri!)}
            activeOpacity={0.8}>
            <Image
              source={{ uri: item.image_uri }}
              style={styles.thumbnail}
              contentFit="cover"
            />
          </TouchableOpacity>
        )}

        {/* メモ表示 / インライン編集 */}
        {editingMemoId === item.id ? (
          <View style={styles.memoEditBlock}>
            <TextInput
              style={styles.memoEditInput}
              value={editingMemoText}
              onChangeText={setEditingMemoText}
              placeholder="商品メモを入力"
              placeholderTextColor={C.textMuted}
              returnKeyType="done"
              onSubmitEditing={saveEditMemo}
              autoFocus
              maxLength={100}
            />
            <View style={styles.memoEditActions}>
              <TouchableOpacity
                style={styles.memoSaveBtn}
                onPress={saveEditMemo}
                activeOpacity={0.75}>
                <ThemedText style={styles.memoSaveBtnText}>保存</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity onPress={cancelEditMemo} hitSlop={8}>
                <ThemedText style={styles.memoCancelText}>キャンセル</ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          item.memo ? (
            <View style={styles.memoChip}>
              <ThemedText style={styles.memoChipText}>{item.memo}</ThemedText>
            </View>
          ) : null
        )}

        <View style={styles.cardMeta}>
          <ThemedText style={styles.rateText}>
            {formatRate(item.rate_used, item.currency)}
          </ThemedText>
          <View style={styles.metaRight}>
            <ThemedText style={[styles.dateText, !!item.entry_date && styles.dateTextModified]}>
              {displayDate}
            </ThemedText>
            {editingPriceId !== item.id && editingMemoId !== item.id && (
              <>
                {item.currency === 'JPY' && (
                  <TouchableOpacity
                    onPress={() => startEditPrice(item.id, item.jpy_amount)}
                    hitSlop={8}>
                    <ThemedText style={styles.priceEditLink}>価格編集</ThemedText>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={() => startEditMemo(item.id, item.memo)}
                  hitSlop={8}>
                  <ThemedText style={styles.memoEditLink}>
                    {item.memo ? 'メモ編集' : 'メモ追加'}
                  </ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => startEditDate(item)}
                  hitSlop={8}>
                  <ThemedText style={styles.dateEditLink}>日付変更</ThemedText>
                </TouchableOpacity>
                {Platform.OS !== 'web' && (
                  item.image_uri ? (
                    <>
                      <TouchableOpacity onPress={() => handleChangeImage(item)} hitSlop={8}>
                        <ThemedText style={styles.imageEditLink}>画像変更</ThemedText>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => handleDeleteImage(item)} hitSlop={8}>
                        <ThemedText style={styles.imageDeleteLink}>画像削除</ThemedText>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <TouchableOpacity onPress={() => handleAddImage(item)} hitSlop={8}>
                      <ThemedText style={styles.imageEditLink}>画像追加</ThemedText>
                    </TouchableOpacity>
                  )
                )}
              </>
            )}
            <TouchableOpacity onPress={() => handleDeleteItem(item)} hitSlop={8}>
              <ThemedText style={styles.deleteLink}>削除</ThemedText>
            </TouchableOpacity>
          </View>
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

      {/* 日付ピッカーモーダル */}
      {editingDateId != null && (
        <Modal
          visible
          animationType="slide"
          transparent
          onRequestClose={cancelDateEdit}>
          <View style={styles.dateModalBg}>
            {/* 背景タップで閉じる — カードより先に描画されるため z 順が下 */}
            <Pressable style={StyleSheet.absoluteFill} onPress={cancelDateEdit} />
            <View style={styles.dateModalCard}>
              <ThemedText style={styles.dateModalTitle}>買い物日を変更</ThemedText>

              <View style={styles.wheelHeaders}>
                <ThemedText style={styles.wheelHeader}>年</ThemedText>
                <ThemedText style={styles.wheelHeader}>月</ThemedText>
                <ThemedText style={styles.wheelHeader}>日</ThemedText>
              </View>

              <View style={styles.wheelsRow}>
                <WheelCol
                  items={YEARS}
                  selected={pickerYear}
                  onSelect={handleYearChange}
                />
                <WheelCol
                  items={MONTHS}
                  selected={pickerMonth}
                  onSelect={handleMonthChange}
                  formatItem={(v) => `${v}月`}
                />
                <WheelCol
                  key={`day-${pickerYear}-${pickerMonth}`}
                  items={getDays(pickerYear, pickerMonth)}
                  selected={pickerDay}
                  onSelect={setPickerDay}
                  formatItem={(v) => `${v}日`}
                />
              </View>

              <View style={styles.dateModalActions}>
                <TouchableOpacity
                  style={styles.dateModalCancelBtn}
                  onPress={cancelDateEdit}
                  activeOpacity={0.75}>
                  <ThemedText style={styles.dateModalCancelText}>キャンセル</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.dateModalSaveBtn}
                  onPress={saveDateEdit}
                  activeOpacity={0.75}>
                  <ThemedText style={styles.dateModalSaveText}>決定</ThemedText>
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
  memoChip: {
    alignSelf: 'flex-start',
    backgroundColor: C.bg,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 4,
  },
  memoChipText: {
    fontSize: 13,
    color: C.textSecondary,
    fontWeight: '500',
  },
  memoEditBlock: {
    gap: 8,
    marginTop: 4,
  },
  memoEditInput: {
    backgroundColor: C.bg,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    color: C.text,
  },
  memoEditActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  memoSaveBtn: {
    backgroundColor: C.brand,
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 7,
  },
  memoSaveBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  memoCancelText: {
    fontSize: 13,
    color: C.textMuted,
    fontWeight: '600',
  },
  memoEditLink: {
    fontSize: 13,
    color: C.brand,
    fontWeight: '500',
  },
  priceEditLink: {
    fontSize: 13,
    color: C.brand,
    fontWeight: '500',
  },
  dateEditLink: {
    fontSize: 13,
    color: C.brand,
    fontWeight: '500',
  },
  priceEditBlock: {
    gap: 8,
    marginTop: 2,
  },
  priceEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  priceEditSymbol: {
    fontSize: 22,
    fontWeight: '700',
    color: C.text,
  },
  priceEditInput: {
    flex: 1,
    backgroundColor: C.bg,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 22,
    fontWeight: '700',
    color: C.text,
  },
  priceEditActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  priceSaveBtn: {
    backgroundColor: C.brand,
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 7,
  },
  priceSaveBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  priceCancelText: {
    fontSize: 13,
    color: C.textMuted,
    fontWeight: '600',
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
    flexWrap: 'wrap',
    gap: 6,
  },
  rateText: {
    fontSize: 13,
    color: C.textMuted,
    fontWeight: '500',
  },
  metaRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  dateText: {
    fontSize: 13,
    color: C.textMuted,
    fontWeight: '500',
  },
  dateTextModified: {
    color: C.brand,
    fontWeight: '600',
  },
  deleteLink: {
    fontSize: 13,
    color: '#FF3B30',
    fontWeight: '500',
  },
  imageEditLink: {
    fontSize: 13,
    color: C.brand,
    fontWeight: '500',
  },
  imageDeleteLink: {
    fontSize: 13,
    color: '#FF3B30',
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

  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 2,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: C.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  filterChipActive: {
    backgroundColor: C.brand,
    borderColor: C.brand,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textSecondary,
  },
  filterChipTextActive: {
    color: '#fff',
  },

  sortRow: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    overflow: 'hidden',
    backgroundColor: C.surface,
  },
  sortBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
  },
  sortBtnActive: {
    backgroundColor: C.bg,
  },
  sortBtnText: {
    fontSize: 12,
    fontWeight: '500',
    color: C.textMuted,
  },
  sortBtnTextActive: {
    fontSize: 12,
    fontWeight: '700',
    color: C.text,
  },

  thumbnail: {
    width: 80,
    height: 60,
    borderRadius: 8,
    backgroundColor: C.bg,
    marginTop: 4,
  },

  // ── 日付ピッカーモーダル ──
  dateModalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  dateModalCard: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 36,
    gap: 16,
  },
  dateModalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: C.text,
    textAlign: 'center',
  },
  wheelHeaders: {
    flexDirection: 'row',
  },
  wheelHeader: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    color: C.textMuted,
    paddingBottom: 4,
  },
  wheelsRow: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    overflow: 'hidden',
  },
  dateModalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  dateModalCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: C.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  dateModalCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: C.textSecondary,
  },
  dateModalSaveBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: C.brand,
  },
  dateModalSaveText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});
