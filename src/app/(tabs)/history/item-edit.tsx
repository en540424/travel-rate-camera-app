import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';

import { PhotoModal } from '@/components/photo-modal';
import { PhotoChangeSheet } from '@/components/domain/PhotoChangeSheet';
import { ThemedText } from '@/components/themed-text';
import { CURRENCIES } from '@/constants/currencies';
import { useHistory } from '@/hooks/use-history';
import { useUnsavedChangesStore } from '@/stores/unsaved-changes-store';
import { color, radius, shadow } from '@/theme/tokens';
import { formatJpy } from '@/utils/format';

export default function ItemEditScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id != null ? parseInt(params.id, 10) : NaN;
  const { history, reload, updateAmount, updateMemo, togglePurchased, updateImageUri, removeEntry } = useHistory();
  const setHasUnsavedChanges = useUnsavedChangesStore((s) => s.setHasUnsavedChanges);

  // React Compiler のメモ化で古いクロージャにならないよう ref 経由で参照
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [isPurchased, setIsPurchased] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [showPhotoSheet, setShowPhotoSheet] = useState(false);
  const initedRef = useRef<number | null>(null);
  // 読み込み時点の値（未保存変更の判定基準）。amount/memo/isPurchasedの初期化と同時に確定する。
  const originalAmountRef = useRef('');
  const originalMemoRef = useRef('');
  const originalIsPurchasedRef = useRef(false);
  // 写真の変更・削除は即時DB反映だが、未保存変更の警告対象としては別フラグで持つ。
  const [photoChanged, setPhotoChanged] = useState(false);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const item = history.find((r) => r.id === id);

  useEffect(() => {
    if (item && initedRef.current !== item.id) {
      initedRef.current = item.id;
      const initialAmount = item.currency === 'JPY' ? String(item.jpy_amount) : String(item.foreign_amount);
      const initialMemo = item.memo ?? '';
      const initialIsPurchased = (item.is_purchased ?? 0) === 1;
      setAmount(initialAmount);
      setMemo(initialMemo);
      setIsPurchased(initialIsPurchased);
      originalAmountRef.current = initialAmount;
      originalMemoRef.current = initialMemo;
      originalIsPurchasedRef.current = initialIsPurchased;
      setPhotoChanged(false);
    }
  }, [item]);

  // 金額・メモ・ステータス・写真のいずれかが読み込み時点と異なれば「未保存の変更あり」。
  // 下タブ移動の確認Alert判定に使うstoreへ同期し、画面を離れる時は必ず解除する。
  const hasUnsavedChanges =
    amount !== originalAmountRef.current ||
    memo !== originalMemoRef.current ||
    isPurchased !== originalIsPurchasedRef.current ||
    photoChanged;

  useEffect(() => {
    setHasUnsavedChanges(hasUnsavedChanges);
  }, [hasUnsavedChanges, setHasUnsavedChanges]);

  useEffect(() => {
    return () => setHasUnsavedChanges(false);
  }, [setHasUnsavedChanges]);

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

  const isForeign = item.currency !== 'JPY';
  const previewJpy = (() => {
    if (isForeign) {
      const f = parseFloat(amount);
      return isFinite(f) && f > 0 ? Math.round(f * item.rate_used) : null;
    }
    const n = parseInt(amount, 10);
    return isFinite(n) && n > 0 ? n : null;
  })();

  async function persistPhoto(uri: string) {
    if (!item) return;
    const docsDir = FileSystem.documentDirectory;
    const photosDir = `${docsDir}photos/`;
    await FileSystem.makeDirectoryAsync(photosDir, { intermediates: true });
    const destUri = `${photosDir}${Date.now()}.jpg`;
    await FileSystem.copyAsync({ from: uri, to: destUri });
    if (item.image_uri) {
      try { await FileSystem.deleteAsync(item.image_uri, { idempotent: true }); } catch {}
    }
    await updateImageUri(item.id, destUri);
    setPhotoChanged(true);
  }

  async function pickAndSet() {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (picked.canceled || !picked.assets[0]) return;
    await persistPhoto(picked.assets[0].uri);
  }

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const picked = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (picked.canceled || !picked.assets[0]) return;
    await persistPhoto(picked.assets[0].uri);
  }

  async function deletePhoto() {
    if (!item?.image_uri) return;
    try { await FileSystem.deleteAsync(item.image_uri, { idempotent: true }); } catch {}
    await updateImageUri(item.id, null);
    setPhotoChanged(true);
  }

  function handlePhoto() {
    if (Platform.OS === 'web' || !item) return;
    setShowPhotoSheet(true);
  }

  async function handleSave() {
    if (!item) return;
    const updates: Promise<void>[] = [];
    if (item.currency === 'JPY') {
      const n = parseInt(amount.trim(), 10);
      if (isFinite(n) && n > 0 && n !== item.jpy_amount) updates.push(updateAmount(item.id, n, n));
    } else {
      const f = parseFloat(amount.trim());
      if (isFinite(f) && f > 0 && f !== item.foreign_amount) {
        updates.push(updateAmount(item.id, f, Math.round(f * item.rate_used)));
      }
    }
    updates.push(updateMemo(item.id, memo.trim() || null));
    if (isPurchased !== ((item.is_purchased ?? 0) === 1)) {
      updates.push(togglePurchased(item.id, item.is_purchased ?? 0));
    }
    if (updates.length > 0) await Promise.all(updates);
    setPhotoChanged(false);
    setHasUnsavedChanges(false);
    router.back();
  }

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
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* 保存写真 */}
        <View style={styles.photoRow}>
          <Pressable onPress={() => item.image_uri && setPhotoOpen(true)} disabled={!item.image_uri} style={styles.thumb}>
            {item.image_uri ? (
              <Image source={{ uri: item.image_uri }} style={styles.thumbImage} contentFit="cover" />
            ) : (
              <View style={styles.thumbPlaceholder}>
                <ThemedText style={styles.thumbPlaceholderText}>なし</ThemedText>
              </View>
            )}
          </Pressable>
          <View style={styles.photoTextWrap}>
            <ThemedText style={styles.photoTitle}>保存写真</ThemedText>
            <ThemedText style={styles.photoSub}>履歴一覧で表示されます</ThemedText>
          </View>
          {Platform.OS !== 'web' && (
            <Pressable onPress={handlePhoto} style={({ pressed }) => [styles.photoBtn, pressed && styles.pressed]}>
              <ThemedText style={styles.photoBtnText}>{item.image_uri ? '写真を変更' : '写真を追加'}</ThemedText>
            </Pressable>
          )}
        </View>

        {/* 金額 */}
        <View style={styles.field}>
          <ThemedText style={styles.label}>{isForeign ? '金額（外貨）' : '金額'}</ThemedText>
          <View style={styles.amountRow}>
            <TextInput
              style={styles.amountInput}
              value={amount}
              onChangeText={setAmount}
              keyboardType={isForeign ? 'decimal-pad' : 'number-pad'}
              returnKeyType="done"
              selectTextOnFocus
            />
            <ThemedText style={styles.amountSuffix}>
              {isForeign ? `${CURRENCIES[item.currency].symbol} ${item.currency}` : '円'}
            </ThemedText>
          </View>
        </View>

        {/* 円換算プレビュー */}
        <View style={styles.preview}>
          <ThemedText style={styles.previewLabel}>日本円で 約</ThemedText>
          <ThemedText style={styles.previewValue}>{previewJpy != null ? formatJpy(previewJpy) : '—'}</ThemedText>
        </View>
        {isForeign && (
          <ThemedText style={styles.rateHint}>
            {item.rate_used > 0 ? `1 ${item.currency} = ¥${item.rate_used}（保存時のレートを維持）` : 'レート未設定'}
          </ThemedText>
        )}

        {/* メモ */}
        <View style={styles.field}>
          <ThemedText style={styles.label}>メモ</ThemedText>
          <TextInput
            style={styles.memoInput}
            value={memo}
            onChangeText={setMemo}
            placeholder="メモを入力（省略可）"
            placeholderTextColor={color.faint2}
            maxLength={100}
            returnKeyType="done"
          />
        </View>

        {/* ステータス */}
        <View style={styles.field}>
          <ThemedText style={styles.label}>ステータス</ThemedText>
          <View style={styles.toggle}>
            <Pressable
              style={[styles.toggleBtn, !isPurchased && styles.toggleBtnCandidate]}
              onPress={() => setIsPurchased(false)}>
              <ThemedText style={[styles.toggleText, !isPurchased && styles.toggleTextCandidate]}>候補</ThemedText>
            </Pressable>
            <Pressable
              style={[styles.toggleBtn, isPurchased && styles.toggleBtnPurchased]}
              onPress={() => setIsPurchased(true)}>
              <ThemedText style={[styles.toggleText, isPurchased && styles.toggleTextPurchased]}>購入済み</ThemedText>
            </Pressable>
          </View>
        </View>

        {/* 保存 */}
        <Pressable onPress={handleSave} style={({ pressed }) => [styles.saveBtn, pressed && styles.pressed]}>
          <ThemedText style={styles.saveBtnText}>保存する</ThemedText>
        </Pressable>

        {/* 削除（控えめ） */}
        <Pressable onPress={handleDelete} style={styles.deleteLink}>
          <ThemedText style={styles.deleteLinkText}>🗑 この記録を削除</ThemedText>
        </Pressable>
      </ScrollView>

      <PhotoModal uri={photoOpen ? item.image_uri : null} onClose={() => setPhotoOpen(false)} />

      <PhotoChangeSheet
        visible={showPhotoSheet}
        onClose={() => setShowPhotoSheet(false)}
        hasPhoto={!!item.image_uri}
        onTakePhoto={() => { void takePhoto(); }}
        onPickLibrary={() => { void pickAndSet(); }}
        onDelete={() => { void deletePhoto(); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgScreen },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16 },
  missingText: { fontSize: 15, fontWeight: '600', color: color.muted },
  missingBtn: {
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: radius.button,
    borderWidth: 1.5, borderColor: color.inputBorder,
  },
  missingBtnText: { fontSize: 15, fontWeight: '700', color: color.body },
  scroll: {
    padding: 18, paddingBottom: 60, gap: 16,
    maxWidth: 480, width: '100%', alignSelf: 'center',
  },
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: color.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.line,
    padding: 12,
    ...shadow.card,
  },
  thumb: { width: 54, height: 54, borderRadius: radius.chip, overflow: 'hidden', backgroundColor: color.line2 },
  thumbImage: { width: '100%', height: '100%' },
  thumbPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  thumbPlaceholderText: { fontSize: 11, fontWeight: '600', color: color.faint2 },
  photoTextWrap: { flex: 1, gap: 2 },
  photoTitle: { fontSize: 14, fontWeight: '700', color: color.text },
  photoSub: { fontSize: 11.5, fontWeight: '500', color: color.muted },
  photoBtn: {
    borderRadius: radius.chip,
    borderWidth: 1.5,
    borderColor: color.inputBorder,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  photoBtnText: { fontSize: 12.5, fontWeight: '700', color: color.body },
  field: { gap: 8 },
  label: { fontSize: 13, fontWeight: '600', color: color.body },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.card,
    borderRadius: radius.chip,
    borderWidth: 1.5,
    borderColor: color.inputBorder,
    paddingHorizontal: 16,
  },
  amountInput: {
    flex: 1,
    fontSize: 24,
    fontWeight: '700',
    color: color.text,
    paddingVertical: 12,
    fontVariant: ['tabular-nums'],
  },
  amountSuffix: { fontSize: 14, fontWeight: '600', color: color.muted },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: color.primarySoft,
    borderRadius: radius.chip,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  previewLabel: { fontSize: 13, fontWeight: '600', color: color.primaryDark },
  previewValue: {
    fontSize: 20,
    fontWeight: '700',
    color: color.primaryDark,
    fontVariant: ['tabular-nums'],
  },
  rateHint: { fontSize: 12, fontWeight: '500', color: color.muted, marginTop: -8 },
  memoInput: {
    backgroundColor: color.card,
    borderRadius: radius.chip,
    borderWidth: 1.5,
    borderColor: color.inputBorder,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: color.text,
  },
  toggle: {
    flexDirection: 'row',
    borderRadius: radius.chip,
    borderWidth: 1.5,
    borderColor: color.inputBorder,
    overflow: 'hidden',
  },
  toggleBtn: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  toggleBtnCandidate: { backgroundColor: color.candidateSoft },
  toggleBtnPurchased: { backgroundColor: color.primarySoft },
  toggleText: { fontSize: 14, fontWeight: '700', color: color.muted },
  toggleTextCandidate: { color: color.candidateText },
  toggleTextPurchased: { color: color.purchasedText },
  saveBtn: {
    height: 52,
    borderRadius: radius.button,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    ...shadow.cta,
  },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  deleteLink: { alignItems: 'center', paddingVertical: 6 },
  deleteLinkText: { fontSize: 14, fontWeight: '600', color: color.danger },
  pressed: { opacity: 0.85 },
});
