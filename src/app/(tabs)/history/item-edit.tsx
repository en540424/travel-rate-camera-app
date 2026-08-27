import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Keyboard, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';

import { PhotoModal } from '@/components/photo-modal';
import { PhotoChangeSheet } from '@/components/domain/PhotoChangeSheet';
import { ResilientPhoto } from '@/components/resilient-photo';
import { ThemedText } from '@/components/themed-text';
import { CURRENCIES } from '@/constants/currencies';
import type { HistoryRow } from '@/db/queries/history';
import { getHistoryById } from '@/db/queries/history';
import { useHistory } from '@/hooks/use-history';
import { useUnsavedChangesStore } from '@/stores/unsaved-changes-store';
import { color, radius, shadow } from '@/theme/tokens';
import { formatJpy } from '@/utils/format';

export default function ItemEditScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id != null ? parseInt(params.id, 10) : NaN;
  const { history, reload, updateAmount, updateMemo, togglePurchased, updateImageUri, removeEntry } = useHistory();
  const setHasUnsavedChanges = useUnsavedChangesStore((s) => s.setHasUnsavedChanges);
  const setDiscardHandler = useUnsavedChangesStore((s) => s.setDiscardHandler);
  const navigation = useNavigation();
  const db = useSQLiteContext();
  /**
   * activeTrip外の旅行の記録用fallback。`item-detail.tsx`と同じ理由・同じ規律
   * （見つからなかった時だけの単発クエリ、historyの変化に追随して再評価）。
   * カレンダーの記録詳細から「編集する」で来た場合にここが必要になる
   * （詳細側だけfallbackしても編集側が無ければ「表示だけ拾えたが編集が壊れる」半端な修正になるため）。
   */
  const [fallbackItem, setFallbackItem] = useState<HistoryRow | null>(null);
  // 取得済みidを覚えておき、`history`の参照が変わる（reload毎）たびに再クエリしない
  // （見つからなかった場合もnullを結果として記録済み扱いにし、無駄な再取得を防ぐ）。
  const fetchedFallbackIdRef = useRef<number | null>(null);

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
  /**
   * 写真も金額・メモと同じ「保存するまで下書き」に揃える。**画面が表示する写真の正はこれ**で、
   * `item.image_uri`（＝DBの確定値）ではない。DBへ書くのは`handleSave`だけ。
   */
  const [draftPhotoUri, setDraftPhotoUri] = useState<string | null>(null);
  /**
   * 読み込み時点の写真（写真版の未保存判定の基準）。amount等の基準はrefだが、こちらは
   * レンダー中の比較に使うためstateで持つ（refをレンダー中に読むとReactの規約違反になる）。
   */
  const [originalPhotoUri, setOriginalPhotoUri] = useState<string | null>(null);
  /**
   * この編集セッション中に作成した、**まだDBから参照されていない**写真file。
   * 破棄・撮り直し・アンマウント時に削除してよい。保存済みのoriginalは決してここへ入れない
   * （入れると「保存する前に元画像が消える」という今回直した不具合そのものに戻る）。
   * 保存成功時は「未保存」ではなくなるので、削除せず台帳から外すだけにする。
   */
  const createdFilesRef = useRef<string[]>([]);
  /** 保存・記録削除・破棄確定など、こちらが意図した離脱では未保存ガードを通さない */
  const allowLeaveRef = useRef(false);
  // ScrollView自体の表示可能高さとcontentContainerの実測高さを比較し、
  // 本当に収まっている時だけscrollEnabledをfalseにする（item-detailと同じ実測ベースの方式）。
  const [scrollAreaHeight, setScrollAreaHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  // キーボード表示中は実測上「収まっている」判定でも、入力欄を見せるためスクロールを許可する。
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const canScroll = contentHeight > scrollAreaHeight + 1 || keyboardVisible;

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      // 破棄して他タブへ移動した後にこの画面へ戻ってきた場合、画面は生き残っている。
      // ガードの素通し許可を持ち越さない（持ち越すと以後の未保存変更が警告されなくなる）。
      allowLeaveRef.current = false;
      reload();
    }, [reload]),
  );

  useEffect(() => {
    // activeTrip内で見つかる通常経路では取得不要（`??`のショートサーキットでfallbackItemは
    // 使われないため、古い値が残っていても実害はなく、明示的にリセットする必要もない）。
    if (Number.isNaN(id) || history.some((r) => r.id === id)) return;
    // 同じidを既に取得済み（結果がnullだった場合を含む）なら、`history`の参照が
    // reload毎に変わっても再クエリしない。
    if (fetchedFallbackIdRef.current === id) return;
    fetchedFallbackIdRef.current = id;
    let cancelled = false;
    void getHistoryById(db, id).then((row) => {
      if (!cancelled) setFallbackItem(row);
    });
    return () => {
      cancelled = true;
    };
  }, [id, history, db]);

  const item = history.find((r) => r.id === id) ?? fallbackItem ?? undefined;

  useEffect(() => {
    if (item && initedRef.current !== item.id) {
      initedRef.current = item.id;
      const initialAmount = item.currency === 'JPY' ? String(item.jpy_amount) : String(item.foreign_amount);
      const initialMemo = item.memo ?? '';
      const initialIsPurchased = (item.is_purchased ?? 0) === 1;
      const initialPhotoUri = item.image_uri ?? null;
      setAmount(initialAmount);
      setMemo(initialMemo);
      setIsPurchased(initialIsPurchased);
      setDraftPhotoUri(initialPhotoUri);
      originalAmountRef.current = initialAmount;
      originalMemoRef.current = initialMemo;
      originalIsPurchasedRef.current = initialIsPurchased;
      setOriginalPhotoUri(initialPhotoUri);
      createdFilesRef.current = [];
    }
  }, [item]);

  // 金額・メモ・ステータス・写真のいずれかが読み込み時点と異なれば「未保存の変更あり」。
  // 写真も他項目と同じ「初期値との比較」で判定する（専用フラグは持たない）。そのため
  // 元と同じ状態へ戻せば自然にfalseへ戻る。
  // 下タブ移動の確認Alert判定に使うstoreへ同期し、画面を離れる時は必ず解除する。
  const hasUnsavedChanges =
    amount !== originalAmountRef.current ||
    memo !== originalMemoRef.current ||
    isPurchased !== originalIsPurchasedRef.current ||
    draftPhotoUri !== originalPhotoUri;

  useEffect(() => {
    setHasUnsavedChanges(hasUnsavedChanges);
  }, [hasUnsavedChanges, setHasUnsavedChanges]);

  useEffect(() => {
    return () => setHasUnsavedChanges(false);
  }, [setHasUnsavedChanges]);

  /**
   * 未保存の下書きfileだけを削除する。保存済みのoriginalは`createdFilesRef`に入らないため対象外。
   * file削除の失敗はDB整合性に影響しない（孤児fileが残るだけ）ので握りつぶし、
   * ユーザーを画面へ閉じ込めない。
   */
  const cleanupCreatedFiles = useCallback(async () => {
    const files = createdFilesRef.current;
    createdFilesRef.current = [];
    for (const uri of files) {
      try {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      } catch {}
    }
  }, []);

  /**
   * 編集内容を読み込み時点へ戻す。DBには何も書いていないので「戻す」対象はstateと未保存fileだけ。
   * 下タブ移動では画面がアンマウントされないため、明示的に戻さないと破棄したはずの値が残る。
   */
  const discardDraft = useCallback(() => {
    setAmount(originalAmountRef.current);
    setMemo(originalMemoRef.current);
    setIsPurchased(originalIsPurchasedRef.current);
    setDraftPhotoUri(originalPhotoUri);
    void cleanupCreatedFiles();
  }, [cleanupCreatedFiles, originalPhotoUri]);

  // 下タブ側のガード（(tabs)/_layout.tsx）から「破棄して移動」時に呼んでもらう。
  // あちらはStackの外側にいて編集画面のstateを知らないため、処理側をここから預ける。
  useEffect(() => {
    setDiscardHandler(() => {
      allowLeaveRef.current = true;
      discardDraft();
    });
    return () => setDiscardHandler(null);
  }, [setDiscardHandler, discardDraft]);

  /*
   * ヘッダー戻る・iOSスワイプバックのガード。tabPress（下タブ）はタブバー押下でしか発火せず、
   * この経路を一切見ていないため、従来は写真に限らず金額・メモの未保存変更も警告なしで捨てられていた。
   *
   * 二重Alertの防止: 下タブ経由の破棄では上のdiscardHandlerが`allowLeaveRef`を立てるので、
   * その後にスタックが畳まれてbeforeRemoveが走っても素通しする（Alertは1回だけ）。
   */
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (allowLeaveRef.current || !hasUnsavedChanges) return;
      e.preventDefault();
      Alert.alert(
        '変更内容を破棄しますか？',
        '保存していない変更があります。移動すると変更は破棄されます。',
        [
          { text: '編集を続ける', style: 'cancel' },
          {
            text: '破棄して移動',
            style: 'destructive',
            onPress: () => {
              allowLeaveRef.current = true;
              discardDraft();
              setHasUnsavedChanges(false);
              navigation.dispatch(e.data.action);
            },
          },
        ],
      );
    });
    return unsubscribe;
  }, [navigation, hasUnsavedChanges, discardDraft, setHasUnsavedChanges]);

  // native-stackのスワイプバックは、ジェスチャが始まってしまうとJS側からの中断が効かない場合がある。
  // 未保存の間はジェスチャ自体を無効化し、ヘッダー戻る（＝上のAlertが確実に出る経路）へ寄せる。
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !hasUnsavedChanges });
  }, [navigation, hasUnsavedChanges]);

  // 画面が消える時、保存されなかった下書きfileを残さない（案A: 離脱時cleanup）。
  // 保存成功時は台帳を空にしてから離れるので、保存した写真がここで消えることはない。
  useEffect(() => {
    return () => {
      void cleanupCreatedFiles();
    };
  }, [cleanupCreatedFiles]);

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

  /**
   * 撮影・選択した写真を「未保存の下書き」として採用する。
   * ImagePickerが返す一時URIは揮発性なのでapp管理下へcopyするところまでは従来どおりだが、
   * **DBは更新せず、保存済みの元画像fileにも触れない**。
   */
  async function adoptDraftPhoto(uri: string) {
    const docsDir = FileSystem.documentDirectory;
    const photosDir = `${docsDir}photos/`;
    await FileSystem.makeDirectoryAsync(photosDir, { intermediates: true });
    const destUri = `${photosDir}${Date.now()}.jpg`;
    await FileSystem.copyAsync({ from: uri, to: destUri });
    // 同じセッションで撮り直した場合（下書きB→C）、もう参照されないBをここで捨てる。
    // 保存済みoriginalは台帳に無いので消えない。
    await cleanupCreatedFiles();
    createdFilesRef.current = [destUri];
    setDraftPhotoUri(destUri);
  }

  async function pickAndSet() {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (picked.canceled || !picked.assets[0]) return;
    await adoptDraftPhoto(picked.assets[0].uri);
  }

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const picked = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (picked.canceled || !picked.assets[0]) return;
    await adoptDraftPhoto(picked.assets[0].uri);
  }

  /** 削除も下書き上だけ。保存済みfileは「保存する」が成功するまで残す */
  async function deletePhoto() {
    setDraftPhotoUri(null);
    await cleanupCreatedFiles();
  }

  function handlePhoto() {
    if (Platform.OS === 'web' || !item) return;
    setShowPhotoSheet(true);
  }

  async function handleSave() {
    if (!item) return;
    const updates: Promise<void>[] = [];
    // 実際にDBへ書いた値だけを新しい基準にする（不正な金額は従来どおり保存されないため、
    // その場合は基準を進めず「未保存のまま」を維持する）。
    let savedAmount = originalAmountRef.current;
    if (item.currency === 'JPY') {
      const n = parseInt(amount.trim(), 10);
      if (isFinite(n) && n > 0 && n !== item.jpy_amount) {
        updates.push(updateAmount(item.id, n, n));
        savedAmount = amount;
      }
    } else {
      const f = parseFloat(amount.trim());
      if (isFinite(f) && f > 0 && f !== item.foreign_amount) {
        updates.push(updateAmount(item.id, f, Math.round(f * item.rate_used)));
        savedAmount = amount;
      }
    }
    updates.push(updateMemo(item.id, memo.trim() || null));
    if (isPurchased !== ((item.is_purchased ?? 0) === 1)) {
      updates.push(togglePurchased(item.id, item.is_purchased ?? 0));
    }
    // 写真の確定はここだけ。変更が無ければDBへ触らない。
    const previousPhotoUri = originalPhotoUri;
    const photoChanged = draftPhotoUri !== previousPhotoUri;
    if (photoChanged) updates.push(updateImageUri(item.id, draftPhotoUri));
    // 保存失敗時に何も表示されない箇所があったため try/catch + Alert を追加（P0-08）。
    // 保存ロジック本体（updateAmount/updateMemo/togglePurchased）は変更しない。
    try {
      if (updates.length > 0) await Promise.all(updates);
    } catch (err) {
      console.warn('[item-edit save error]', err);
      Alert.alert(
        '保存できませんでした',
        '記録の更新中にエラーが発生しました。もう一度お試しください。',
        [{ text: 'OK' }],
      );
      return;
    }
    // **DB確定に成功した後だけ**、参照されなくなった旧写真を消す。
    // 失敗時にここへ来ないことが重要（DBは旧URIのままなのにfileだけ消える状態を作らない）。
    if (photoChanged && previousPhotoUri) {
      try {
        await FileSystem.deleteAsync(previousPhotoUri, { idempotent: true });
      } catch {}
    }
    // 保存した下書きfileはもう「未保存」ではない。削除せず台帳から外すだけにする
    // （消してしまうと、直後のアンマウントcleanupで保存した写真自体が消える）。
    createdFilesRef.current = [];
    originalAmountRef.current = savedAmount;
    originalMemoRef.current = memo;
    originalIsPurchasedRef.current = isPurchased;
    setOriginalPhotoUri(draftPhotoUri);
    allowLeaveRef.current = true;
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
          // 記録ごと消すので、未保存の下書きfileも保存済みfileも両方片付ける
          allowLeaveRef.current = true;
          if (Platform.OS !== 'web') {
            await cleanupCreatedFiles();
            if (item.image_uri) {
              try { await FileSystem.deleteAsync(item.image_uri, { idempotent: true }); } catch {}
            }
          }
          await removeEntry(item.id);
          setHasUnsavedChanges(false);
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
        overScrollMode={canScroll ? 'auto' : 'never'}
        keyboardShouldPersistTaps="handled">
        {/* 入力項目（写真／金額／メモ／ステータス）。項目同士の間隔はformGroup内のgapで管理する。 */}
        <View style={styles.formGroup}>
          {/* 保存写真 */}
          <View style={styles.photoRow}>
            <Pressable onPress={() => draftPhotoUri && setPhotoOpen(true)} disabled={!draftPhotoUri} style={styles.thumb}>
              {draftPhotoUri ? (
                // 保存済みURIはアプリコンテナ再割当てで無効化しうるため、詳細画面と同じ
                // ResilientPhoto経由で現在のdocumentDirectory基準へ再解決してから表示する。
                <ResilientPhoto uri={draftPhotoUri} style={styles.thumbImage} contentFit="cover" />
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
                <ThemedText style={styles.photoBtnText}>{draftPhotoUri ? '写真を変更' : '写真を追加'}</ThemedText>
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
        </View>

      </ScrollView>

      {/* 固定フッター：保存 + 削除（ScrollView外に出すことでタブバーinsetの影響を受けない） */}
      <View style={styles.footer}>
        <Pressable onPress={handleSave} style={({ pressed }) => [styles.saveBtn, pressed && styles.pressed]}>
          <ThemedText style={styles.saveBtnText}>保存する</ThemedText>
        </Pressable>
        <Pressable onPress={handleDelete} style={styles.deleteLink}>
          <ThemedText style={styles.deleteLinkText}>🗑 この記録を削除</ThemedText>
        </Pressable>
      </View>

      <PhotoModal uri={photoOpen ? draftPhotoUri : null} onClose={() => setPhotoOpen(false)} />

      <PhotoChangeSheet
        visible={showPhotoSheet}
        onClose={() => setShowPhotoSheet(false)}
        hasPhoto={!!draftPhotoUri}
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
  // ScrollView本体にflex:1を与え、screen内の利用可能高さを正しく確定させる。
  scrollView: { flex: 1 },
  scroll: {
    padding: 18,
    paddingBottom: 8,
    maxWidth: 480, width: '100%', alignSelf: 'center',
  },
  // 入力項目同士の間隔（写真／金額／プレビュー／メモ／ステータス）。
  formGroup: { gap: 14 },
  // 保存ボタン＋削除リンクの固定フッター（ScrollView外）。タブバーのbottom inset影響を受けない。
  footer: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line2,
    backgroundColor: color.bgScreen,
  },
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: color.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.line,
    padding: 14,
    ...shadow.card,
  },
  thumb: { width: 72, height: 72, borderRadius: radius.chip, overflow: 'hidden', backgroundColor: color.line2 },
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
  // 候補（クリーム系）との区別を分かりやすくするため、purchasedSoftより少し濃いミント(primaryBorder)を使う。
  toggleBtnPurchased: { backgroundColor: color.primaryBorder },
  toggleText: { fontSize: 14, fontWeight: '700', color: color.muted },
  toggleTextCandidate: { color: color.candidateText },
  toggleTextPurchased: { color: color.purchasedText, fontWeight: '800' },
  saveBtn: {
    height: 52,
    borderRadius: radius.button,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.cta,
  },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  deleteLink: { alignItems: 'center', paddingVertical: 4 },
  deleteLinkText: { fontSize: 14, fontWeight: '600', color: color.danger },
  pressed: { opacity: 0.85 },
});
