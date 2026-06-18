import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, InputAccessoryView, Keyboard, Modal, Platform, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CameraPreview } from '@/components/camera/CameraPreview';
import { ThemedText } from '@/components/themed-text';
import {
  PriceResultCard,
  SaveLimitBanner,
} from '@/components/domain';
import { ActionSheet, EmptyState, SectionCard, SecondaryButton, PrimaryButton } from '@/components/ui';
import type { ConversionDirection, CurrencyCode } from '@/constants/currencies';
import { CURRENCIES, FOREIGN_CURRENCY_CODES } from '@/constants/currencies';
import {
  FALLBACK_BUDGET_JPY,
  FALLBACK_TRIP_NAME,
} from '@/constants/camera-screen';
import { DT } from '@/constants/designTokens';
import { FREE_LIMITS } from '@/config/limits';
import { useHistory } from '@/hooks/use-history';
import { useRates } from '@/hooks/use-rates';
import { useTrips } from '@/hooks/use-trips';
import { useSettingsStore } from '@/stores/settings-store';
import { color, radius, shadow, spacing, statusColor, typography } from '@/theme/tokens';
import { convert } from '@/utils/currency';
import { extractMemoLines, extractPriceCandidates } from '@/utils/extract-prices';
import { formatJpy, formatRate } from '@/utils/format';
import { getTripStatsForDisplay } from '@/utils/trip-stats';

const C = DT.colors;
const MEMO_PREVIEW_COUNT = 3;
const INPUT_ACCESSORY_ID_AMOUNT = 'camera-input-accessory-amount';
const INPUT_ACCESSORY_ID_MEMO = 'camera-input-accessory-memo';
const NEAR_SAVE_LIMIT = FREE_LIMITS.saves - 5;

/** 撮影前メイン画面の撮影モード。価格OCR（既定）/ 商品写真（補助） */
type CaptureMode = 'ocr' | 'photo';

// iOS専用: キーボード上に「キーボードを閉じる」ボタンを表示するツールバー。
// 同じ inputAccessoryViewID を複数のTextInputで共有すると、
// 2つ目以降の入力欄で表示されないことがあるため、入力欄ごとに用意する。
function KeyboardDoneBar({ nativeID }: { nativeID: string }) {
  return (
    <InputAccessoryView nativeID={nativeID}>
      <View style={styles.accessoryContainer}>
        <TouchableOpacity
          onPress={() => Keyboard.dismiss()}
          hitSlop={8}
          style={styles.accessoryButton}
          activeOpacity={0.7}>
          <ThemedText style={styles.accessoryButtonText}>⌄ キーボードを閉じる</ThemedText>
        </TouchableOpacity>
      </View>
    </InputAccessoryView>
  );
}

export default function CameraScreen() {
  const [nativeAmount, setNativeAmount] = useState('');
  const [scanKey, setScanKey] = useState(0);
  const [inputMode, setInputMode] = useState<ConversionDirection>('TO_JPY');
  const [memo, setMemo] = useState('');
  const [ocrResult, setOcrResult] = useState<{
    raw: string;
    prices: string[];
    memoLines: string[];
  } | null>(null);
  const [ocrRawExpanded, setOcrRawExpanded] = useState(false);
  const [pendingPhotoUri, setPendingPhotoUri] = useState<string | null>(null);
  const [ocrPhotoUri, setOcrPhotoUri] = useState<string | null>(null);
  const [saveAsPurchased, setSaveAsPurchased] = useState(false);
  const [selectedPrice, setSelectedPrice] = useState<string | null>(null);
  const [addedMemoLines, setAddedMemoLines] = useState<Set<string>>(new Set());
  const [memoExpanded, setMemoExpanded] = useState(false);
  const [photoPreviewVisible, setPhotoPreviewVisible] = useState(false);
  const [captureMode, setCaptureMode] = useState<CaptureMode>('ocr');
  const [showManualInput, setShowManualInput] = useState(false);
  const [photoSheetVisible, setPhotoSheetVisible] = useState(false);
  // OCR候補カードを一時的に閉じる表示制御（ocrResult 自体は破棄しない）
  const [ocrResultCollapsed, setOcrResultCollapsed] = useState(false);

  const scrollViewRef = useRef<ScrollView>(null);
  const inputCardYRef = useRef(0);

  const { rates } = useRates();
  const { selectedCurrency, setSelectedCurrency, isPro } = useSettingsStore();
  const { history, totalCount, addEntry, reload } = useHistory();
  const { activeTrip } = useTrips();

  const tripName = activeTrip?.name ?? FALLBACK_TRIP_NAME;
  const tripBudgetJpy = activeTrip?.budget_jpy ?? FALLBACK_BUDGET_JPY;

  useFocusEffect(
    useCallback(() => {
      reload();
      const { pendingCameraAmount, setPendingCameraAmount } = useSettingsStore.getState();
      if (pendingCameraAmount) {
        setNativeAmount(pendingCameraAmount);
        setPendingCameraAmount(null);
        setInputMode('TO_JPY');
      }
    }, [reload]),
  );

  const isJpyMode = activeTrip?.base_currency === 'JPY';
  const currencyForDisplay = activeTrip?.base_currency ?? selectedCurrency;
  const tripRate = activeTrip?.manual_rate ?? 0;
  const globalRate = rates[currencyForDisplay] ?? 0;
  const rate = activeTrip ? (isJpyMode ? 1 : tripRate) : globalRate;
  const isReverse = !isJpyMode && inputMode === 'FROM_JPY';
  const inputNum = parseFloat(nativeAmount) || 0;
  const foreignAmount = isJpyMode ? inputNum : (isReverse ? convert(inputNum, rate, 'FROM_JPY') : inputNum);
  const jpyAmount = isJpyMode ? inputNum : (isReverse ? inputNum : convert(inputNum, rate, 'TO_JPY'));
  const canSave = isJpyMode
    ? !!activeTrip && inputNum > 0
    : !!activeTrip && rate > 0 && foreignAmount > 0 && jpyAmount > 0;
  const c = CURRENCIES[currencyForDisplay];

  // 「入力をリセット」は入力欄だけを消す操作なので、入力系の有無だけで判定する
  // （OCR結果・保存写真だけが残っている状態ではボタンを出さない）
  const hasInputToReset = !!(
    nativeAmount ||
    memo ||
    selectedPrice ||
    addedMemoLines.size > 0
  );

  const stats = useMemo(
    () => getTripStatsForDisplay(history, tripBudgetJpy, activeTrip?.id),
    [history, totalCount, tripBudgetJpy, activeTrip?.id],
  );

  const remainingIfSaved = canSave
    ? Math.max(0, stats.remainingBudget - Math.round(jpyAmount))
    : null;

  // 下部サマリー「今日」用。既存の history を読むだけ（新規クエリなし）
  const todayCount = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDate();
    return history.filter((row) => {
      if (row.entry_date) {
        const [ry, rm, rd] = row.entry_date.split('-').map((v) => parseInt(v, 10));
        return ry === y && rm === m + 1 && rd === d;
      }
      const iso = row.created_at.includes('T')
        ? row.created_at
        : `${row.created_at.replace(' ', 'T')}Z`;
      const dt = new Date(iso);
      return dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d;
    }).length;
  }, [history]);

  // 入力カードは「OCR後」または「手入力で記録を開いたとき」だけ前面に出す（撮影前は主役＝カメラ）
  const showInputCard = ocrResult != null || showManualInput;

  const isWeb = Platform.OS === 'web';

  function switchInputMode(mode: ConversionDirection) {
    setInputMode(mode);
    setNativeAmount('');
  }

  function handlePhotoCapture(uri: string) {
    if (pendingPhotoUri == null) {
      setPendingPhotoUri(uri);
    } else {
      setOcrPhotoUri(uri);
    }
  }

  async function handlePickPhotoFromLibrary() {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: false,
    });
    if (!picked.canceled && picked.assets[0]) {
      setPendingPhotoUri(picked.assets[0].uri);
      // 写真選択後は手入力カードを開き、金額入力→保存へそのまま進めるようにする
      setShowManualInput(true);
    }
  }

  async function handleTakeProductPhoto() {
    const captured = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: false,
    });
    if (!captured.canceled && captured.assets[0]) {
      setPendingPhotoUri(captured.assets[0].uri);
      // 撮影後は手入力カードを開き、金額入力→保存へそのまま進めるようにする
      setShowManualInput(true);
    }
  }

  function handleChangePhoto() {
    setPhotoSheetVisible(true);
  }

  function handleAddPhoto() {
    setPhotoSheetVisible(true);
  }

  function handleUseOcrPhoto() {
    if (!ocrPhotoUri) return;
    setPendingPhotoUri(ocrPhotoUri);
    setOcrPhotoUri(null);
  }

  function handleRemovePhoto() {
    Alert.alert(
      '写真を削除しますか？',
      '保存する写真だけを削除します。金額やメモは残ります。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除',
          style: 'destructive',
          onPress: () => {
            setPendingPhotoUri(null);
            setPhotoPreviewVisible(false);
          },
        },
      ],
    );
  }

  function handleOcrResult(raw: string) {
    if (isWeb) return;
    setOcrResult({
      raw,
      prices: extractPriceCandidates(raw, isJpyMode),
      memoLines: extractMemoLines(raw),
    });
    setOcrResultCollapsed(false); // 新しい読み取り結果は必ず展開して見せる
    setSelectedPrice(null);
    setAddedMemoLines(new Set());
    setMemoExpanded(false);
  }

  function scrollToInputCard() {
    // レイアウト確定後にスクロールするため、少し長めのタイマーで待つ
    setTimeout(() => {
      scrollViewRef.current?.scrollTo({
        y: Math.max(inputCardYRef.current - 16, 0),
        animated: true,
      });
    }, 250);
  }

  // 上部のカメラ位置へ戻す（「もう一度読み取る」で撮り直し先を示す）
  function scrollToCamera() {
    scrollViewRef.current?.scrollTo({ y: 0, animated: true });
  }

  function handlePickPrice(price: string) {
    setNativeAmount(price);
    setInputMode('TO_JPY');
    // OCRカードは閉じない（全文を見ながらメモを書けるようにする）
    setSelectedPrice(price);
    scrollToInputCard();
  }

  function handleAddMemoLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;
    setMemo((prev) => {
      const current = prev.trim();
      if (!current) return trimmed.slice(0, 100);
      return `${current} ${trimmed}`.slice(0, 100);
    });
    setAddedMemoLines((prev) => new Set(prev).add(line));
    scrollToInputCard();
  }

  // 入力をリセット（軽量）：入力欄だけを消す。
  // OCR結果・候補カード・保存写真・入力カードは残す（完全クリアではない）。
  function handleResetInput() {
    setNativeAmount('');
    setSelectedPrice(null);
    setMemo('');
    setAddedMemoLines(new Set());
    setSaveAsPurchased(false);
  }

  function openManualInput() {
    setShowManualInput(true);
    scrollToInputCard();
  }

  function handleCopyRawToMemo() {
    if (!ocrResult) return;
    const cleaned = ocrResult.raw.replace(/\s+/g, ' ').trim().slice(0, 100);
    setMemo(cleaned);
  }

  function cycleCurrency() {
    const idx = FOREIGN_CURRENCY_CODES.indexOf(selectedCurrency);
    setSelectedCurrency(
      FOREIGN_CURRENCY_CODES[(idx + 1) % FOREIGN_CURRENCY_CODES.length] as CurrencyCode,
    );
  }

  // もう一度読み取る：価格OCRだけ撮り直す。
  // 保存写真(pendingPhotoUri)・入力中の金額/メモ・入力カードは残す。
  // 次に撮った値札写真は handlePhotoCapture の既存分岐で ocrPhotoUri（スワップ候補）に入る。
  function handleRescan() {
    setScanKey((k) => k + 1);
    setOcrResultCollapsed(false);
    setOcrPhotoUri(null);
    setPhotoPreviewVisible(false);
    scrollToCamera(); // 上のカメラで撮り直すことを示す
  }

  async function handleSaveCandidate() {
    if (!canSave || !activeTrip) return;
    let savedPhotoUri: string | undefined;
    if (pendingPhotoUri && Platform.OS !== 'web') {
      try {
        const FileSystem = await import('expo-file-system/legacy');
        const docsDir = FileSystem.documentDirectory;
        if (docsDir) {
          const photosDir = `${docsDir}photos/`;
          await FileSystem.makeDirectoryAsync(photosDir, { intermediates: true });
          const destUri = `${photosDir}${Date.now()}.jpg`;
          await FileSystem.copyAsync({ from: pendingPhotoUri, to: destUri });
          savedPhotoUri = destUri;
        }
      } catch (e) {
        console.warn('[photo save]', e);
      }
    }
    const currencyToSave = activeTrip.base_currency;
    const rateToSave = currencyToSave === 'JPY' ? 1 : activeTrip.manual_rate;
    const foreignAmountToSave = currencyToSave === 'JPY' ? jpyAmount : foreignAmount;
    try {
      await addEntry(
        currencyToSave,
        foreignAmountToSave,
        jpyAmount,
        rateToSave,
        memo.trim() || undefined,
        savedPhotoUri,
        saveAsPurchased,
      );
    } catch (e) {
      console.warn('[save error]', e);
      Alert.alert(
        '保存できませんでした',
        '記録の保存中にエラーが発生しました。もう一度お試しください。',
        [{ text: 'OK' }],
      );
      return; // 入力値を保持したまま終了
    }
    // 保存成功時のみリセット
    setNativeAmount('');
    setMemo('');
    setOcrResult(null);
    setOcrResultCollapsed(false);
    setOcrRawExpanded(false);
    setPendingPhotoUri(null);
    setOcrPhotoUri(null);
    setPhotoPreviewVisible(false);
    setSaveAsPurchased(false);
    setShowManualInput(false);
    if (Platform.OS !== 'web') {
      try {
        const { notificationAsync, NotificationFeedbackType } = await import('expo-haptics');
        await notificationAsync(NotificationFeedbackType.Success);
      } catch (e) {
        console.warn('Haptics not available:', e);
      }
    }
  }

  const cameraPreview = (
    <CameraPreview
      key={scanKey}
      currency={currencyForDisplay}
      rate={rate}
      remainingIfSaved={remainingIfSaved}
      onOcrResult={Platform.OS !== 'web' ? handleOcrResult : undefined}
      onPhotoCapture={Platform.OS !== 'web' ? handlePhotoCapture : undefined}
    />
  );

  return (
    <View style={styles.screen}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}>

          <View style={styles.container}>

            {/* 上部：旅行名 ＋ 小さいレートチップ（v4撮影前ヘッダー） */}
            {activeTrip ? (
              <View style={styles.header}>
                <ThemedText style={styles.headerTripName} numberOfLines={1}>
                  {tripName}
                </ThemedText>
                {isJpyMode ? (
                  <View style={styles.rateChip}>
                    <ThemedText style={styles.rateChipText}>🇯🇵 JPY 国内</ThemedText>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.rateChip}
                    onPress={cycleCurrency}
                    activeOpacity={0.75}>
                    <ThemedText style={styles.rateChipText} numberOfLines={1}>
                      {c.flag} {rate > 0 ? formatRate(rate, currencyForDisplay) : 'レート未設定'}
                    </ThemedText>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <EmptyState
                tone="neutral"
                title="旅行が選択されていません"
                body="設定で旅行を作成するか、既存の旅行を選択すると、レートや予算に合わせて記録できます。"
                primary={{ title: '設定で旅行を作成・選択', onPress: () => router.push('/settings') }}
              />
            )}

            {/* モード切替セグメント（価格OCR / 商品写真） */}
            <View style={styles.modeSegment}>
              <TouchableOpacity
                style={[styles.modeSegmentBtn, captureMode === 'ocr' && styles.modeSegmentBtnActive]}
                onPress={() => setCaptureMode('ocr')}
                activeOpacity={0.8}>
                <ThemedText
                  style={[styles.modeSegmentText, captureMode === 'ocr' && styles.modeSegmentTextActive]}>
                  価格OCR
                </ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modeSegmentBtn, captureMode === 'photo' && styles.modeSegmentBtnActive]}
                onPress={() => setCaptureMode('photo')}
                activeOpacity={0.8}>
                <ThemedText
                  style={[styles.modeSegmentText, captureMode === 'photo' && styles.modeSegmentTextActive]}>
                  商品写真
                </ThemedText>
              </TouchableOpacity>
            </View>

            {/* 中央：価格OCR=カメラ（主役） / 商品写真=商品パネル（OCR導線と二重表示しない） */}
            {captureMode === 'ocr' ? (
              <View style={styles.cameraHero}>
                {cameraPreview}
              </View>
            ) : (
              <View style={styles.productPanel}>
                <View style={styles.productPurposeBanner}>
                  <ThemedText style={styles.productPurposeText}>
                    商品写真を撮ったあと、金額を入力して保存できます。金額の読み取りはしません。
                  </ThemedText>
                </View>
                {Platform.OS !== 'web' && (
                  <TouchableOpacity
                    style={styles.productShutterBtn}
                    onPress={handleTakeProductPhoto}
                    activeOpacity={0.85}>
                    <ThemedText style={styles.productShutterText}>商品を撮る</ThemedText>
                  </TouchableOpacity>
                )}
                <SecondaryButton
                  title="🖼  写真ライブラリから選ぶ"
                  onPress={handlePickPhotoFromLibrary}
                />
              </View>
            )}

            {/* OCR結果カード（Web では表示しない。閉じても ocrResult は残す） */}
            {!isWeb && ocrResult != null && !ocrResultCollapsed && (
              <SectionCard style={styles.ocrCard}>
                {/* ヘッダー */}
                <View style={styles.ocrCardHeader}>
                  <ThemedText style={styles.ocrCardTitle}>読み取り結果</ThemedText>
                  <TouchableOpacity
                    onPress={() => setOcrResultCollapsed(true)}
                    hitSlop={8}>
                    <ThemedText style={styles.ocrCardClose}>候補を閉じる</ThemedText>
                  </TouchableOpacity>
                </View>

                {/* 価格候補 */}
                <View style={styles.ocrSection}>
                  <ThemedText style={styles.ocrSectionLabel}>価格候補</ThemedText>
                  {ocrResult.prices.length === 0 ? (
                    <View style={styles.ocrFailBlock}>
                      <View style={styles.ocrFailIconWrap}>
                        <ThemedText style={styles.ocrFailIcon}>🔍</ThemedText>
                      </View>
                      <ThemedText style={styles.ocrFailTitle}>金額を読み取れませんでした</ThemedText>
                      <ThemedText style={styles.ocrFailDesc}>
                        明るい場所で撮り直すか、下の欄に金額を手で入力できます。読み取った文字はメモに使えます。
                      </ThemedText>
                      <PrimaryButton
                        title="✎ 手入力で金額を入れる"
                        onPress={() => {
                          setShowManualInput(true);
                          scrollToInputCard();
                        }}
                        style={styles.ocrFailPrimary}
                      />
                      <View style={styles.ocrFailSubRow}>
                        <SecondaryButton
                          title="値札をもう一度読み取る"
                          onPress={handleRescan}
                          style={styles.ocrFailSubBtn}
                        />
                        <SecondaryButton
                          title="商品写真を保存"
                          onPress={handleAddPhoto}
                          style={styles.ocrFailSubBtn}
                        />
                      </View>
                    </View>
                  ) : ocrResult.prices.length === 1 ? (
                    <TouchableOpacity
                      style={[
                        styles.ocrPriceBtnSingle,
                        ocrResult.prices[0] === selectedPrice && styles.ocrPriceBtnSelected,
                      ]}
                      onPress={() => handlePickPrice(ocrResult.prices[0])}
                      activeOpacity={0.75}>
                      <ThemedText
                        style={[
                          styles.ocrPriceBtnSingleText,
                          ocrResult.prices[0] === selectedPrice && styles.ocrPriceBtnTextSelected,
                        ]}>
                        {ocrResult.prices[0] === selectedPrice ? '✓ ' : ''}{c.symbol}{ocrResult.prices[0]}
                      </ThemedText>
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.ocrPriceRow}>
                      {ocrResult.prices.map((p) => (
                        <TouchableOpacity
                          key={p}
                          style={[styles.ocrPriceBtn, p === selectedPrice && styles.ocrPriceBtnSelected]}
                          onPress={() => handlePickPrice(p)}
                          activeOpacity={0.75}>
                          <ThemedText
                            style={[styles.ocrPriceBtnText, p === selectedPrice && styles.ocrPriceBtnTextSelected]}>
                            {p === selectedPrice ? '✓ ' : ''}{c.symbol}{p}
                          </ThemedText>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>

                {/* メモ候補 */}
                {ocrResult.memoLines.length > 0 && (
                  <View style={styles.ocrSection}>
                    <ThemedText style={styles.ocrSectionLabel}>
                      メモ候補（タップで追加）
                    </ThemedText>
                    {(memoExpanded
                      ? ocrResult.memoLines
                      : ocrResult.memoLines.slice(0, MEMO_PREVIEW_COUNT)
                    ).map((line) => {
                      const added = addedMemoLines.has(line);
                      return (
                      <View key={line} style={styles.ocrMemoLineRow}>
                        <ThemedText style={styles.ocrMemoLineText} numberOfLines={1}>
                          {line}
                        </ThemedText>
                        <TouchableOpacity
                          style={[styles.ocrAddMemoBtn, added && styles.ocrAddMemoBtnAdded]}
                          onPress={() => handleAddMemoLine(line)}
                          activeOpacity={0.75}>
                          <ThemedText style={[styles.ocrAddMemoBtnText, added && styles.ocrAddMemoBtnTextAdded]}>
                            {added ? '✓ 追加済み' : '＋メモ'}
                          </ThemedText>
                        </TouchableOpacity>
                      </View>
                      );
                    })}
                    {ocrResult.memoLines.length > MEMO_PREVIEW_COUNT && (
                      <TouchableOpacity
                        style={styles.ocrMemoMoreBtn}
                        onPress={() => setMemoExpanded((v) => !v)}
                        hitSlop={8}
                        activeOpacity={0.6}>
                        <ThemedText style={styles.ocrMemoMoreBtnText}>
                          {memoExpanded
                            ? '閉じる'
                            : `さらに${ocrResult.memoLines.length - MEMO_PREVIEW_COUNT}件表示`}
                        </ThemedText>
                      </TouchableOpacity>
                    )}
                  </View>
                )}

                {/* 読み取った文字（折りたたみ・全文コピーはここに） */}
                <TouchableOpacity
                  style={styles.ocrRawToggle}
                  onPress={() => setOcrRawExpanded((v) => !v)}
                  activeOpacity={0.7}>
                  <ThemedText style={styles.ocrRawToggleText}>
                    {ocrRawExpanded ? '▼ 読み取った文字（全文）' : '▶ 読み取った文字（全文）'}
                  </ThemedText>
                </TouchableOpacity>
                {ocrRawExpanded && (
                  <View style={styles.ocrSection}>
                    <ThemedText style={styles.ocrRawText} selectable>
                      {ocrResult.raw || 'テキストなし'}
                    </ThemedText>
                    <TouchableOpacity
                      style={styles.ocrCopyBtn}
                      onPress={handleCopyRawToMemo}
                      activeOpacity={0.75}>
                      <ThemedText style={styles.ocrCopyBtnText}>
                        全文をメモにコピー
                      </ThemedText>
                    </TouchableOpacity>
                  </View>
                )}
              </SectionCard>
            )}

            {/* 読み取り候補を再表示（候補カードを閉じている間だけ。撮り直し不要で復元） */}
            {!isWeb && ocrResult != null && ocrResultCollapsed && (
              <SecondaryButton
                title="読み取り候補を再表示"
                onPress={() => setOcrResultCollapsed(false)}
              />
            )}

            {/* 金額入力カード（保存確認カード）: 撮影前は非表示。OCR後 or 手入力で記録のときだけ表示 */}
            {showInputCard && (
            <View onLayout={(e) => { inputCardYRef.current = e.nativeEvent.layout.y; }}>
            <SectionCard style={styles.inputCard}>

              {/* 価格反映フィードバック */}
              {selectedPrice != null && nativeAmount === selectedPrice && (
                <View style={styles.reflectedBanner}>
                  <ThemedText style={styles.reflectedBannerText}>
                    ✓ {isReverse ? '¥' : c.symbol}{selectedPrice} を入力しました
                  </ThemedText>
                </View>
              )}

              {/* 入力モード切り替え（JPY モードでは非表示） */}
              {!isJpyMode && (
                <View style={styles.inputModeRow}>
                  <TouchableOpacity
                    style={[styles.inputModeBtn, !isReverse && styles.inputModeBtnActive]}
                    onPress={() => switchInputMode('TO_JPY')}
                    activeOpacity={0.75}>
                    <ThemedText style={[styles.inputModeBtnText, !isReverse && styles.inputModeBtnTextActive]}>
                      {currencyForDisplay} → JPY
                    </ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.inputModeBtn, isReverse && styles.inputModeBtnActive]}
                    onPress={() => switchInputMode('FROM_JPY')}
                    activeOpacity={0.75}>
                    <ThemedText style={[styles.inputModeBtnText, isReverse && styles.inputModeBtnTextActive]}>
                      JPY → {currencyForDisplay}
                    </ThemedText>
                  </TouchableOpacity>
                </View>
              )}

              {/* 金額（カードの主役） */}
              <View style={styles.inputAmountRow}>
                <ThemedText style={styles.inputCurrencySymbol}>
                  {isReverse ? '¥' : c.symbol}
                </ThemedText>
                <TextInput
                  style={styles.inputAmountField}
                  value={nativeAmount}
                  onChangeText={setNativeAmount}
                  placeholder="0"
                  placeholderTextColor={DT.colors.textMuted}
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                  selectTextOnFocus
                  inputAccessoryViewID={Platform.OS === 'ios' ? INPUT_ACCESSORY_ID_AMOUNT : undefined}
                />
              </View>

              {/* 円換算結果（v4: 大きな表示） */}
              {!isJpyMode && jpyAmount > 0 && (
                <PriceResultCard
                  jpyAmount={jpyAmount}
                  foreignAmount={foreignAmount}
                  currency={currencyForDisplay}
                  rate={rate}
                />
              )}

              <View style={styles.cardDivider} />

              {/* メモ（補助情報） */}
              <View style={styles.memoRow}>
                <ThemedText style={styles.memoLabel}>メモ</ThemedText>
                <TextInput
                  style={styles.memoInput}
                  value={memo}
                  onChangeText={setMemo}
                  placeholder="モッツァレラ / Tシャツ / お土産"
                  placeholderTextColor={DT.colors.textMuted}
                  returnKeyType="done"
                  maxLength={100}
                  inputAccessoryViewID={Platform.OS === 'ios' ? INPUT_ACCESSORY_ID_MEMO : undefined}
                />
              </View>
              {addedMemoLines.size > 0 && (
                <ThemedText style={styles.memoAddedHint}>
                  ✓ メモを追加しました
                </ThemedText>
              )}

              {Platform.OS !== 'web' && (
                pendingPhotoUri != null ? (
                  <View style={styles.pendingPhotoBlock}>
                    <View style={styles.pendingPhotoRow}>
                      <TouchableOpacity onPress={() => setPhotoPreviewVisible(true)} activeOpacity={0.8}>
                        <Image
                          source={{ uri: pendingPhotoUri }}
                          style={styles.pendingPhotoThumb}
                          contentFit="cover"
                        />
                      </TouchableOpacity>
                      <ThemedText style={styles.pendingPhotoLabel}>保存する写真</ThemedText>
                      <View style={styles.pendingPhotoActions}>
                        <TouchableOpacity onPress={handleChangePhoto} hitSlop={8}>
                          <ThemedText style={styles.pendingPhotoActionText}>変更</ThemedText>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={handleRemovePhoto} hitSlop={8}>
                          <ThemedText style={styles.pendingPhotoActionTextMuted}>削除</ThemedText>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                ) : (
                  <View style={styles.pendingPhotoRow}>
                    <ThemedText style={styles.pendingPhotoLabel}>写真なし</ThemedText>
                    <TouchableOpacity onPress={handleAddPhoto} hitSlop={8}>
                      <ThemedText style={styles.pendingPhotoActionText}>＋ 商品写真を追加</ThemedText>
                    </TouchableOpacity>
                  </View>
                )
              )}

              {/* 保存先（候補 / 購入済み） */}
              <View style={styles.saveTargetRow}>
                <ThemedText style={styles.saveTargetLabel}>保存先</ThemedText>
                <View style={styles.saveTargetPills}>
                  <TouchableOpacity
                    style={[styles.saveTargetPill, !saveAsPurchased && styles.saveTargetPillCandidateActive]}
                    onPress={() => setSaveAsPurchased(false)}
                    activeOpacity={0.75}>
                    <ThemedText
                      style={[
                        styles.saveTargetPillText,
                        !saveAsPurchased && styles.saveTargetPillTextCandidateActive,
                      ]}>
                      候補
                    </ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.saveTargetPill, saveAsPurchased && styles.saveTargetPillPurchasedActive]}
                    onPress={() => setSaveAsPurchased(true)}
                    activeOpacity={0.75}>
                    <ThemedText
                      style={[
                        styles.saveTargetPillText,
                        saveAsPurchased && styles.saveTargetPillTextPurchasedActive,
                      ]}>
                      購入済み
                    </ThemedText>
                  </TouchableOpacity>
                </View>
              </View>

              {/* 保存上限（無料版） */}
              {!isPro && totalCount >= NEAR_SAVE_LIMIT && (
                <SaveLimitBanner currentCount={totalCount} isPro={isPro} />
              )}

              {/* 保存ボタン（カードの主役アクション） */}
              <PrimaryButton
                title={
                  canSave
                    ? `${formatJpy(Math.round(jpyAmount))} を${saveAsPurchased ? '購入済みで' : '候補に'}保存`
                    : saveAsPurchased
                      ? '購入済みとして保存'
                      : '買い物候補に保存'
                }
                onPress={handleSaveCandidate}
                disabled={!canSave}
              />

              {/* 入力をリセット（控えめなサブボタン） */}
              {hasInputToReset && (
                <TouchableOpacity
                  style={styles.resetInputBtn}
                  onPress={handleResetInput}
                  activeOpacity={0.7}>
                  <ThemedText style={styles.resetInputBtnText}>↺ 入力をリセット</ThemedText>
                </TouchableOpacity>
              )}
            </SectionCard>
            </View>
            )}

            {/* 再スキャン（成功時のみ。失敗時は失敗ブロック内に置くため重複させない） */}
            {ocrResult != null && ocrResult.prices.length > 0 && (
              <View style={styles.judgmentSection}>
                <SecondaryButton title="値札をもう一度読み取る" onPress={handleRescan} />
              </View>
            )}

            {/* 下部：小さな予算サマリー ＋ 手入力サブ導線（撮影を邪魔しない） */}
            {activeTrip && (
              <View style={styles.bottomSummary}>
                <View style={styles.bottomSummaryItem}>
                  <ThemedText style={styles.bottomSummaryLabel}>残り</ThemedText>
                  <ThemedText style={styles.bottomSummaryValue} numberOfLines={1}>
                    {tripBudgetJpy > 0 ? formatJpy(stats.remainingBudget) : '—'}
                  </ThemedText>
                </View>
                <View style={styles.bottomSummaryDivider} />
                <View style={styles.bottomSummaryItem}>
                  <ThemedText style={styles.bottomSummaryLabel}>今日</ThemedText>
                  <ThemedText style={styles.bottomSummaryValue}>{todayCount}件</ThemedText>
                </View>
                <View style={styles.bottomSummaryDivider} />
                <TouchableOpacity
                  style={styles.bottomSummaryItem}
                  onPress={openManualInput}
                  activeOpacity={0.7}>
                  <ThemedText style={styles.bottomSummaryAction}>✎ 手入力で記録</ThemedText>
                </TouchableOpacity>
              </View>
            )}

          </View>
        </ScrollView>
      </SafeAreaView>

      {/* キーボード上の「完了」ボタン（iOSのみ、入力欄ごとに用意） */}
      {Platform.OS === 'ios' && (
        <>
          <KeyboardDoneBar nativeID={INPUT_ACCESSORY_ID_AMOUNT} />
          <KeyboardDoneBar nativeID={INPUT_ACCESSORY_ID_MEMO} />
        </>
      )}

      {/* 保存写真プレビュー */}
      {pendingPhotoUri != null && Platform.OS !== 'web' && (
        <Modal
          visible={photoPreviewVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setPhotoPreviewVisible(false)}>
          <View style={styles.photoPreviewOverlay}>
            <ScrollView
              key={photoPreviewVisible ? 'preview-open' : 'preview-closed'}
              style={styles.photoPreviewScroll}
              contentContainerStyle={styles.photoPreviewScrollContent}
              minimumZoomScale={1}
              maximumZoomScale={3}
              centerContent
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}>
              <Image
                source={{ uri: pendingPhotoUri }}
                style={styles.photoPreviewImage}
                contentFit="contain"
              />
            </ScrollView>
            <TouchableOpacity
              style={styles.photoPreviewCloseBtn}
              onPress={() => setPhotoPreviewVisible(false)}
              activeOpacity={0.75}>
              <ThemedText style={styles.photoPreviewCloseBtnText}>閉じる</ThemedText>
            </TouchableOpacity>
          </View>
        </Modal>
      )}

      {/* 保存写真アクションシート（メイン画面・Alert置換） */}
      <ActionSheet visible={photoSheetVisible} onClose={() => setPhotoSheetVisible(false)}>
        <View style={styles.photoSheetGrabber} />
        <ThemedText style={styles.photoSheetTitle}>保存する写真</ThemedText>
        <ThemedText style={styles.photoSheetSubtitle}>
          履歴で見返すための商品写真を選べます。
        </ThemedText>
        <View style={styles.photoSheetList}>
          <TouchableOpacity
            style={[styles.photoSheetRow, styles.photoSheetRowPrimary]}
            onPress={() => { setPhotoSheetVisible(false); handleTakeProductPhoto(); }}
            activeOpacity={0.7}>
            <ThemedText style={[styles.photoSheetRowText, styles.photoSheetRowTextPrimary]}>
              商品写真を撮る
            </ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.photoSheetRow}
            onPress={() => { setPhotoSheetVisible(false); handlePickPhotoFromLibrary(); }}
            activeOpacity={0.7}>
            <ThemedText style={styles.photoSheetRowText}>写真ライブラリから選ぶ</ThemedText>
          </TouchableOpacity>
          {ocrPhotoUri != null && (
            <TouchableOpacity
              style={styles.photoSheetRow}
              onPress={() => { setPhotoSheetVisible(false); handleUseOcrPhoto(); }}
              activeOpacity={0.7}>
              <ThemedText style={styles.photoSheetRowText}>OCR写真を使う</ThemedText>
            </TouchableOpacity>
          )}
          {pendingPhotoUri != null && (
            <TouchableOpacity
              style={[styles.photoSheetRow, styles.photoSheetRowDanger]}
              onPress={() => { setPhotoSheetVisible(false); handleRemovePhoto(); }}
              activeOpacity={0.7}>
              <ThemedText style={[styles.photoSheetRowText, styles.photoSheetRowTextDanger]}>
                写真を削除
              </ThemedText>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.photoSheetRow, styles.photoSheetRowCancel]}
            onPress={() => setPhotoSheetVisible(false)}
            activeOpacity={0.7}>
            <ThemedText style={[styles.photoSheetRowText, styles.photoSheetRowTextCancel]}>
              キャンセル
            </ThemedText>
          </TouchableOpacity>
        </View>
      </ActionSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.background,
  },
  safe: { flex: 1 },
  scrollView: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingTop: 10,
    paddingBottom: 96,
    paddingHorizontal: 18,
  },
  container: {
    width: '100%',
    maxWidth: 430,
    alignSelf: 'center',
    gap: 14,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingTop: 4,
  },
  headerTripName: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: color.text,
    letterSpacing: -0.3,
  },
  rateChip: {
    maxWidth: '60%',
    backgroundColor: color.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  rateChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: color.primaryDark,
    fontVariant: ['tabular-nums'],
  },
  modeSegment: {
    flexDirection: 'row',
    backgroundColor: color.line2,
    borderRadius: radius.chip,
    padding: 3,
    gap: 3,
  },
  modeSegmentBtn: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: DT.radius.sm,
  },
  modeSegmentBtnActive: {
    backgroundColor: color.card,
    ...shadow.card,
  },
  modeSegmentText: {
    fontSize: 14,
    fontWeight: '600',
    color: color.muted,
  },
  modeSegmentTextActive: {
    color: color.text,
    fontWeight: '700',
  },
  cameraHero: {
    borderRadius: DT.radius.lg,
    overflow: 'hidden',
    ...DT.shadow.card,
  },

  // 商品写真モード（captureMode==='photo'）のパネル
  productPanel: {
    gap: spacing.md,
  },
  productPurposeBanner: {
    flexDirection: 'row',
    backgroundColor: color.candidateSoft2,
    borderWidth: 1,
    borderColor: color.candidateBorder,
    borderRadius: radius.chip,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  productPurposeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
    color: color.candidateText,
  },
  productShutterBtn: {
    height: 52,
    borderRadius: radius.button,
    backgroundColor: color.productShutter, // チャコール（teal CTAと区別・純黒不可）
    alignItems: 'center',
    justifyContent: 'center',
    // 弱い影（CTAグローは使わない）
    shadowColor: '#10211F',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 3,
  },
  productShutterText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },

  ocrCard: {
    gap: spacing.md,
  },
  ocrCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ocrCardTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: color.muted,
    letterSpacing: 0.6,
  },
  ocrCardClose: {
    fontSize: 12.5,
    fontWeight: '600',
    color: color.muted,
  },
  ocrSection: {
    gap: 6,
  },
  ocrSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: color.muted,
    letterSpacing: 0.5,
  },
  ocrPriceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  ocrPriceBtn: {
    backgroundColor: color.primary,
    borderRadius: radius.pill,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  ocrPriceBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  ocrPriceBtnSingle: {
    backgroundColor: color.primary,
    borderRadius: radius.card,
    paddingVertical: 16,
    alignItems: 'center',
  },
  ocrPriceBtnSingleText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  ocrPriceBtnSelected: {
    backgroundColor: color.primaryDark,
  },
  ocrPriceBtnTextSelected: {
    color: '#fff',
  },
  ocrFailBlock: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
  },
  ocrFailIconWrap: {
    width: 56,
    height: 56,
    borderRadius: radius.card,
    backgroundColor: color.candidateSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ocrFailIcon: {
    fontSize: 24,
  },
  ocrFailTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: color.text,
    textAlign: 'center',
  },
  ocrFailDesc: {
    fontSize: 12.5,
    lineHeight: 19,
    fontWeight: '500',
    color: color.muted,
    textAlign: 'center',
  },
  ocrFailPrimary: {
    alignSelf: 'stretch',
    marginTop: spacing.xs,
  },
  ocrFailSubRow: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    gap: spacing.sm,
  },
  ocrFailSubBtn: {
    flex: 1,
  },
  ocrMemoLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  ocrMemoLineText: {
    flex: 1,
    fontSize: 13,
    color: color.text,
    fontWeight: '500',
  },
  ocrAddMemoBtn: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: color.primary,
    borderRadius: 8,
  },
  ocrMemoMoreBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  ocrMemoMoreBtnText: {
    fontSize: 12,
    color: color.primary,
    fontWeight: '600',
  },
  ocrAddMemoBtnText: {
    fontSize: 12,
    color: color.primary,
    fontWeight: '600',
  },
  ocrAddMemoBtnAdded: {
    borderColor: color.line,
    backgroundColor: color.line2,
  },
  ocrAddMemoBtnTextAdded: {
    color: color.muted,
  },
  ocrRawToggle: {
    paddingVertical: 4,
  },
  ocrRawToggleText: {
    fontSize: 12,
    color: color.muted,
    fontWeight: '600',
  },
  ocrRawText: {
    fontSize: 12,
    color: color.body,
    lineHeight: 18,
  },
  ocrCopyBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: color.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 4,
  },
  ocrCopyBtnText: {
    fontSize: 12,
    color: color.primary,
    fontWeight: '600',
  },

  inputCard: {
    gap: 10,
  },
  reflectedBanner: {
    backgroundColor: color.primarySoft,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  reflectedBannerText: {
    fontSize: 13,
    fontWeight: '700',
    color: color.primaryDark,
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.line2,
  },
  inputModeRow: {
    flexDirection: 'row',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: color.line,
    overflow: 'hidden',
  },
  inputModeBtn: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
  },
  inputModeBtnActive: {
    backgroundColor: color.primary,
  },
  inputModeBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: color.body,
  },
  inputModeBtnTextActive: {
    color: '#fff',
  },
  inputAmountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inputCurrencySymbol: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '700',
    color: color.text,
  },
  inputAmountField: {
    flex: 1,
    fontSize: 36,
    lineHeight: 44,
    fontWeight: '800',
    color: color.text,
    paddingVertical: 0,
  },
  pendingPhotoBlock: {
    gap: 6,
  },
  pendingPhotoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pendingPhotoThumb: {
    width: 40,
    height: 30,
    borderRadius: 8,
    backgroundColor: color.bgScreen,
  },
  pendingPhotoLabel: {
    fontSize: 11,
    color: color.muted,
    fontWeight: '500',
    flex: 1,
  },
  pendingPhotoActions: {
    flexDirection: 'row',
    gap: 12,
  },
  pendingPhotoActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: color.primary,
  },
  pendingPhotoActionTextMuted: {
    fontSize: 12,
    fontWeight: '600',
    color: color.muted,
  },
  memoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.bgScreen,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 2,
    gap: 8,
  },
  memoLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: color.muted,
    letterSpacing: 0.4,
    minWidth: 28,
  },
  memoInput: {
    flex: 1,
    fontSize: 14,
    color: color.text,
    paddingVertical: 10,
  },
  memoAddedHint: {
    fontSize: 12,
    fontWeight: '600',
    color: color.primaryDark,
    paddingLeft: 4,
  },

  bottomSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.card,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: color.line,
    paddingVertical: 10,
    marginTop: 2,
  },
  bottomSummaryItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  bottomSummaryDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: color.line,
  },
  bottomSummaryLabel: {
    ...typography.caption,
    color: color.muted,
  },
  bottomSummaryValue: {
    fontSize: 15,
    fontWeight: '700',
    color: color.text,
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  bottomSummaryAction: {
    fontSize: 13,
    fontWeight: '700',
    color: color.primary,
  },

  judgmentSection: {
    gap: 10,
    alignItems: 'stretch',
  },
  saveTargetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  saveTargetLabel: {
    fontSize: DT.fontSize.xs,
    fontWeight: DT.fontWeight.medium,
    color: C.textMuted,
    letterSpacing: 0.4,
  },
  saveTargetPills: {
    flexDirection: 'row',
    gap: 6,
  },
  saveTargetPill: {
    paddingHorizontal: DT.spacing.sm,
    paddingVertical: 5,
    borderRadius: DT.radius.pill,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  saveTargetPillCandidateActive: {
    backgroundColor: statusColor.candidate.badgeBg,
    borderColor: statusColor.candidate.border,
  },
  saveTargetPillPurchasedActive: {
    backgroundColor: statusColor.purchased.badgeBg,
    borderColor: statusColor.purchased.border,
  },
  saveTargetPillText: {
    fontSize: DT.fontSize.sm,
    fontWeight: DT.fontWeight.semibold,
    color: C.textSecondary,
  },
  saveTargetPillTextCandidateActive: {
    color: statusColor.candidate.text,
  },
  saveTargetPillTextPurchasedActive: {
    color: statusColor.purchased.text,
  },
  resetInputBtn: {
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  resetInputBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: C.primary,
  },

  // 保存写真アクションシート
  photoSheetGrabber: {
    alignSelf: 'center',
    width: 38,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: color.line2,
    marginBottom: spacing.xs,
  },
  photoSheetTitle: {
    ...typography.title,
    color: color.text,
    textAlign: 'center',
  },
  photoSheetSubtitle: {
    ...typography.body,
    color: color.muted,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: spacing.md,
  },
  photoSheetList: {
    gap: spacing.sm,
  },
  photoSheetRow: {
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: color.line,
    backgroundColor: color.card,
    paddingVertical: 15,
    alignItems: 'center',
  },
  photoSheetRowPrimary: {
    backgroundColor: color.primarySoft,
    borderColor: color.primaryBorder,
  },
  photoSheetRowDanger: {
    backgroundColor: color.dangerSoft,
    borderColor: color.dangerBorder,
  },
  photoSheetRowCancel: {
    borderColor: color.inputBorder,
    marginTop: 2,
  },
  photoSheetRowText: {
    fontSize: 15,
    fontWeight: '700',
    color: color.text,
  },
  photoSheetRowTextPrimary: {
    color: color.primaryDark,
  },
  photoSheetRowTextDanger: {
    color: color.danger,
  },
  photoSheetRowTextCancel: {
    color: color.body,
  },

  photoPreviewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: DT.spacing.xl,
  },
  photoPreviewScroll: {
    width: '100%',
    height: '75%',
  },
  photoPreviewScrollContent: {
    flexGrow: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPreviewImage: {
    width: '100%',
    height: '100%',
  },
  photoPreviewCloseBtn: {
    marginTop: DT.spacing.xl,
    paddingHorizontal: DT.spacing.xl,
    paddingVertical: DT.spacing.sm,
    borderRadius: DT.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  photoPreviewCloseBtnText: {
    fontSize: DT.fontSize.md,
    fontWeight: DT.fontWeight.semibold,
    color: '#fff',
  },

  accessoryContainer: {
    width: '100%',
    height: 38,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 16,
    backgroundColor: C.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
  },
  accessoryButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  accessoryButtonText: {
    fontSize: 13,
    fontWeight: DT.fontWeight.bold,
    color: C.textPrimary,
  },
});
