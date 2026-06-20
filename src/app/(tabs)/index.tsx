import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, InputAccessoryView, Keyboard, Modal, Platform, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CameraPreview } from '@/components/camera/CameraPreview';
import { ThemedText } from '@/components/themed-text';
import {
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
import { formatForeign, formatJpy, formatRate } from '@/utils/format';
import { getTripStatsForDisplay } from '@/utils/trip-stats';

const C = DT.colors;
const MEMO_PREVIEW_COUNT = 3;
const PRICE_PREVIEW_COUNT = 3;
const INPUT_ACCESSORY_ID_AMOUNT = 'camera-input-accessory-amount';
const INPUT_ACCESSORY_ID_MEMO = 'camera-input-accessory-memo';
const NEAR_SAVE_LIMIT = FREE_LIMITS.saves - 5;

/** 撮影前メイン画面の撮影モード。価格OCR（既定）/ 商品写真（補助） */
type CaptureMode = 'ocr' | 'photo';

/** 価格OCRモードの表示フェーズ。scanning は CameraPreview 内部 state のため camera に含める。 */
type Phase = 'camera' | 'scanning' | 'result';

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
  const [pricesExpanded, setPricesExpanded] = useState(false);
  // 候補一覧セクション自体の開閉（タップでは閉じない・手動操作のみ）。OCR成功直後は開いている。
  const [pricesSectionOpen, setPricesSectionOpen] = useState(true);
  const [memoSectionOpen, setMemoSectionOpen] = useState(true);
  const [manualAdjustExpanded, setManualAdjustExpanded] = useState(false);
  const [photoPreviewVisible, setPhotoPreviewVisible] = useState(false);
  const [captureMode, setCaptureMode] = useState<CaptureMode>('ocr');
  const [showManualInput, setShowManualInput] = useState(false);
  const [photoSheetVisible, setPhotoSheetVisible] = useState(false);
  // 再スキャンで得たOCR写真を「保存写真に使う」案内の表示制御（自動上書きせず明示操作のみ）
  const [ocrPhotoSuggestionDismissed, setOcrPhotoSuggestionDismissed] = useState(false);
  // カメラ表示の切替：true=大きいライブカメラ / false=撮影済みOCR写真プレビュー（表示専用）
  const [cameraLive, setCameraLive] = useState(true);
  // 撮影済みOCR写真を拡大表示するモーダル
  const [ocrPhotoZoomVisible, setOcrPhotoZoomVisible] = useState(false);
  // 撮影した値札写真の縦横比（width/height）。読み込み時に確定し、プレビュー高さを実寸に合わせる。
  const [ocrImgAspect, setOcrImgAspect] = useState(0.75);

  const scrollViewRef = useRef<ScrollView>(null);
  const inputCardYRef = useRef(0);
  // 「✎ 金額を修正」展開時のスクロール先（編集パネルのSectionCard内オフセット）
  const manualAdjustYRef = useRef(0);

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

  // 価格候補セクションを畳んだときの見出しサブ情報用（選択済み金額の円換算・表示専用）
  const selectedPriceNum = selectedPrice != null ? Number(selectedPrice) : NaN;
  const selectedPriceJpy = rate > 0 && isFinite(selectedPriceNum) ? convert(selectedPriceNum, rate, 'TO_JPY') : 0;

  // 円ヒーローの外貨額・レート表示用：6桁（10万円）以上は縦を使う2段ではなく1行にまとめる（表示判定のみ）
  const jpyDigits = jpyAmount > 0 ? Math.round(jpyAmount).toString().length : 0;
  const isLargeJpyAmount = jpyDigits >= 6;

  // 価格候補の初期プレビュー（最大PRICE_PREVIEW_COUNT件）。選択済みが4件目以降でも、
  // 最後の1件と入れ替えて必ず含める（選択状態が隠れないようにする・表示専用、並び替えは保存に影響しない）
  const pricePreviewBase = ocrResult != null ? ocrResult.prices.slice(0, PRICE_PREVIEW_COUNT) : [];
  const pricePreview =
    selectedPrice != null && !pricePreviewBase.includes(selectedPrice)
      ? [...pricePreviewBase.slice(0, PRICE_PREVIEW_COUNT - 1), selectedPrice]
      : pricePreviewBase;

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

  // 再スキャンで得たOCR写真を、保存写真にまだ使っていないとき案内を出す（自動上書きはしない）
  const canSuggestUsingOcrPhoto =
    !isWeb &&
    !!ocrPhotoUri &&
    pendingPhotoUri !== ocrPhotoUri &&
    !ocrPhotoSuggestionDismissed;

  // 撮影後に見せる「読み取った値札」プレビュー画像（ヘッダー小サムネ／拡大モーダル用）。
  // 初回スキャンは pendingPhotoUri に、再スキャン以降は ocrPhotoUri に直近の撮影が入る（handlePhotoCapture の既存分岐）。
  const ocrPreviewUri = ocrPhotoUri ?? pendingPhotoUri;
  // 撮影後はライブカメラの代わりに「読み取った値札」プレビュー（ドラッグ/ズーム/拡大）を出す
  const showOcrPhotoPreview =
    !isWeb &&
    captureMode === 'ocr' &&
    !cameraLive &&
    ocrResult != null &&
    ocrPreviewUri != null;
  // 手入力で調整：OCR失敗 or 手入力モードは既定で開く / OCR成功時は折りたたむ
  const manualOpenByDefault = ocrResult == null || ocrResult.prices.length === 0;
  const manualOpen = manualOpenByDefault || manualAdjustExpanded;
  const ocrSuccess = ocrResult != null && ocrResult.prices.length > 0;

  // 表示フェーズ（価格OCRモードのカメラ↔結果確認）。
  // 'scanning' は CameraPreview 内部 state のため index 側からは観測せず 'camera' に含める
  // （カメラ表示中＝フッター非表示なので、読み取るCTAを隠す問題は起きない）。
  // result = ライブカメラを撮影済みプレビューに切替済み（cameraLive=false）かつ OCR結果あり。
  const phase: Phase = !cameraLive && ocrResult != null ? 'result' : 'camera';
  const isPriceOcrMode = captureMode === 'ocr';
  // 固定フッターは「価格OCRモードで結果確認中、かつOCR成功（価格候補あり）」のときだけ。
  // → カメラ表示中・スキャン中・商品写真モード中・OCR失敗時は出さない。
  const showFooter = !isWeb && isPriceOcrMode && phase === 'result' && ocrSuccess;
  // 価格未選択（＝金額未確定）なら保存ボタンだけ disabled。手入力で金額が入れば canSave で有効化される。
  const saveDisabled = !canSave;

  function switchInputMode(mode: ConversionDirection) {
    setInputMode(mode);
    setNativeAmount('');
  }

  function handlePhotoCapture(uri: string) {
    if (pendingPhotoUri == null) {
      setPendingPhotoUri(uri);
    } else {
      setOcrPhotoUri(uri);
      setOcrPhotoSuggestionDismissed(false); // 新しいOCR写真が来たら「使う」案内を再表示
    }
  }

  async function handlePickPhotoFromLibrary() {
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        allowsEditing: false,
      });
      if (!picked.canceled && picked.assets[0]) {
        setPendingPhotoUri(picked.assets[0].uri);
        // 写真選択後は手入力カードを開き、サムネ位置（入力カード）へスクロールして変化を示す
        setShowManualInput(true);
        scrollToInputCard();
      }
    } catch (e) {
      console.warn('[photo library]', e);
    }
  }

  async function handleTakeProductPhoto() {
    try {
      const captured = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        allowsEditing: false,
      });
      if (!captured.canceled && captured.assets[0]) {
        setPendingPhotoUri(captured.assets[0].uri);
        // 撮影後は手入力カードを開き、サムネ位置（入力カード）へスクロールして変化を示す
        setShowManualInput(true);
        scrollToInputCard();
      }
    } catch (e) {
      console.warn('[camera]', e);
    }
  }

  function handleChangePhoto() {
    setPhotoSheetVisible(true);
  }

  function handleAddPhoto() {
    setPhotoSheetVisible(true);
  }

  // iOS では ActionSheet(Modal) が閉じきる前に native picker / Alert を呼ぶと
  // カメラが即終了・固まることがあるため、シートを閉じてから実行する。
  function closeSheetThen(action: () => void) {
    setPhotoSheetVisible(false);
    setTimeout(action, 250);
  }

  function handleUseOcrPhoto() {
    if (!ocrPhotoUri) return;
    setPendingPhotoUri(ocrPhotoUri);
    setOcrPhotoUri(null);
    scrollToInputCard(); // 反映先（入力カードのサムネ）へスクロールして変化を示す
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
    setCameraLive(false); // 読み取り完了→ライブカメラを撮影済みプレビューに切替（表示専用）
    setOcrResult({
      raw,
      prices: extractPriceCandidates(raw, isJpyMode),
      memoLines: extractMemoLines(raw),
    });
    setSelectedPrice(null);
    setAddedMemoLines(new Set());
    setMemoExpanded(false);
    setPricesExpanded(false); // 価格候補も初期は4件まで
    setPricesSectionOpen(true); // 新しいOCR結果では候補セクションを開いた状態に戻す
    setMemoSectionOpen(true);
    setManualAdjustExpanded(false); // 成功時は手入力を畳む
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

  // 「✎ 金額を修正」展開時に編集パネルまでスクロール。
  // manualAdjustYRefはSectionCard内オフセット（resultPanelの padding=spacing.lg 分を加算）。
  function scrollToManualAdjust() {
    setTimeout(() => {
      scrollViewRef.current?.scrollTo({
        y: Math.max(inputCardYRef.current + spacing.lg + manualAdjustYRef.current - 16, 0),
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
    setCameraLive(true); // 入力リセット後は撮影前のライブカメラ表示に戻す
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
    setCameraLive(true); // 再撮影＝大きいライブカメラへ戻す（表示専用）
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
    setCameraLive(true); // 保存後は撮影前のライブカメラ表示に戻す
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
          contentContainerStyle={[styles.scroll, showFooter && styles.scrollWithFooter]}
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

            {/* モード切替セグメント（価格OCR / 商品写真）。選択中＝白背景＋少し強めの影＋tealアイコン */}
            <View style={styles.modeSegment}>
              <TouchableOpacity
                style={[styles.modeSegmentBtn, captureMode === 'ocr' && styles.modeSegmentBtnActive]}
                onPress={() => setCaptureMode('ocr')}
                activeOpacity={0.8}>
                <View style={styles.modeSegmentBtnContent}>
                  <SymbolView
                    name={{ ios: 'viewfinder', android: 'document_scanner', web: 'document_scanner' }}
                    tintColor={captureMode === 'ocr' ? color.primaryDark : color.muted}
                    size={16}
                  />
                  <ThemedText
                    style={[styles.modeSegmentText, captureMode === 'ocr' && styles.modeSegmentTextActive]}>
                    価格OCR
                  </ThemedText>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modeSegmentBtn, captureMode === 'photo' && styles.modeSegmentBtnActive]}
                onPress={() => setCaptureMode('photo')}
                activeOpacity={0.8}>
                <View style={styles.modeSegmentBtnContent}>
                  <SymbolView
                    name={{ ios: 'camera.fill', android: 'photo_camera', web: 'photo_camera' }}
                    tintColor={captureMode === 'photo' ? color.primaryDark : color.muted}
                    size={16}
                  />
                  <ThemedText
                    style={[styles.modeSegmentText, captureMode === 'photo' && styles.modeSegmentTextActive]}>
                    商品写真
                  </ThemedText>
                </View>
              </TouchableOpacity>
            </View>

            {/* 中央：価格OCR=ライブカメラ / 撮影後=読み取った値札プレビュー（実用：元画像と候補を見比べる） / 商品写真=商品パネル */}
            {captureMode === 'ocr' ? (
              showOcrPhotoPreview && ocrPreviewUri != null ? (
                <View style={styles.ocrPhotoPreview}>
                  {/* 見出し（左）＋ 拡大・再読み取り（右上に集約） */}
                  <View style={styles.ocrPhotoPreviewHeader}>
                    <ThemedText style={styles.ocrPhotoPreviewLabel}>読み取った値札</ThemedText>
                    <View style={styles.ocrPhotoPreviewActions}>
                      <TouchableOpacity
                        onPress={() => setOcrPhotoZoomVisible(true)}
                        hitSlop={8}
                        activeOpacity={0.7}>
                        <ThemedText style={styles.ocrPhotoPreviewZoom}>拡大</ThemedText>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={handleRescan} hitSlop={8} activeOpacity={0.7}>
                        <ThemedText style={styles.ocrPhotoPreviewRescan}>再読み取り</ThemedText>
                      </TouchableOpacity>
                    </View>
                  </View>
                  {/* 横長コンパクト。全幅(実寸比)で表示し縦スクロール／iOSピンチで全体確認。枠内クリップ。 */}
                  <View style={styles.ocrPhotoPreviewFrame}>
                    <ScrollView
                      style={StyleSheet.absoluteFill}
                      contentContainerStyle={styles.ocrPhotoPreviewScrollContent}
                      nestedScrollEnabled
                      showsVerticalScrollIndicator
                      minimumZoomScale={1}
                      maximumZoomScale={3}
                      centerContent>
                      <Image
                        source={{ uri: ocrPreviewUri }}
                        style={[styles.ocrPhotoPreviewImg, { aspectRatio: ocrImgAspect }]}
                        contentFit="contain"
                        onLoad={(e) => {
                          const w = e?.source?.width;
                          const h = e?.source?.height;
                          if (w && h) setOcrImgAspect(w / h);
                        }}
                      />
                    </ScrollView>
                  </View>
                </View>
              ) : (
                cameraPreview
              )
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

            {/* OCR結果＋保存を1枚にまとめた結果パネル（v2：1枚で完結） */}
            {showInputCard && (
            <View onLayout={(e) => { inputCardYRef.current = e.nativeEvent.layout.y; }}>
            <SectionCard style={styles.resultPanel}>
              {/* 円換算ヒーロー（確認画面の主役）。「✎ 金額を修正」はヒーロー右上の自然なアクション
                  （手入力パネルの開閉）。読み取りステータスはヒーロー＝成功 / 下の失敗ブロック＝失敗で表現。 */}
              {(jpyAmount > 0 || (ocrResult != null && ocrResult.prices.length > 0)) && (
                <View style={styles.heroBlock}>
                  {ocrSuccess && (
                    <TouchableOpacity
                      style={styles.heroEditLink}
                      onPress={() => {
                        // 開く時だけ編集パネルへスクロール（閉じる時は無理にスクロールしない）
                        const opening = !manualAdjustExpanded;
                        setManualAdjustExpanded(opening);
                        if (opening) scrollToManualAdjust();
                      }}
                      hitSlop={8}
                      activeOpacity={0.7}>
                      <ThemedText style={styles.heroEditLinkText}>
                        {manualOpen ? '閉じる' : '✎ 金額を修正'}
                      </ThemedText>
                    </TouchableOpacity>
                  )}
                  {/* 円換算ヒーロー：円金額は左、外貨額＋レートはヒーロー右端へ逃がす。
                      小さい金額＝右端に2段、大きい金額（6桁以上）＝縦を使わず1行にまとめる。
                      狭い画面・長い文字列は自然に折り返す。保存時のcurrency/rate計算には触れない（表示のみ）。 */}
                  <View style={styles.heroJpy}>
                    <ThemedText style={styles.heroJpyLabel}>日本円で</ThemedText>
                    <View style={styles.heroValueRow}>
                      <ThemedText style={jpyAmount > 0 ? styles.heroJpyValue : styles.heroPlaceholderValue}>
                        {jpyAmount > 0 ? formatJpy(jpyAmount) : '¥—'}
                      </ThemedText>
                      {jpyAmount > 0 && !isJpyMode && rate > 0 && (
                        isLargeJpyAmount ? (
                          <ThemedText style={styles.heroRateSubInline} numberOfLines={1}>
                            {formatForeign(foreignAmount, currencyForDisplay)}{'・'}{formatRate(rate, currencyForDisplay)}
                          </ThemedText>
                        ) : (
                          <View style={styles.heroRateSubWrap}>
                            <ThemedText style={styles.heroRateSub} numberOfLines={1}>
                              {formatForeign(foreignAmount, currencyForDisplay)}
                            </ThemedText>
                            <ThemedText style={styles.heroRateSub} numberOfLines={1}>
                              {formatRate(rate, currencyForDisplay)}
                            </ThemedText>
                          </View>
                        )
                      )}
                    </View>
                    {jpyAmount <= 0 && (
                      <ThemedText style={styles.heroPlaceholderHint}>下の価格候補を選ぶと換算されます</ThemedText>
                    )}
                  </View>
                  {tripBudgetJpy > 0 && (
                    <View style={styles.budgetPill}>
                      <ThemedText style={styles.budgetPillText}>
                        残り {formatJpy(remainingIfSaved != null ? remainingIfSaved : stats.remainingBudget)}
                      </ThemedText>
                    </View>
                  )}
                </View>
              )}

              {/* 読み取り結果セクション（Web非表示）。価格候補をヒーロー直下に置く（独立した「候補を少なく表示」行は撤去） */}
              {!isWeb && ocrResult != null && (
              <View style={styles.ocrSectionWrap}>
                {/* 価格候補（ヒーロー直下）。見出し右に「さらに表示」＋セクション自体の開閉（手動のみ・タップでは閉じない） */}
                <View style={styles.ocrSection}>
                  <View style={styles.ocrSectionHeader}>
                    <View style={styles.ocrSectionLabelGroup}>
                      <ThemedText style={styles.ocrSectionLabel}>価格候補</ThemedText>
                      {!pricesSectionOpen && ocrResult.prices.length > 0 && selectedPrice != null && (
                        <ThemedText style={styles.ocrSectionSubInfo} numberOfLines={1}>
                          選択中 {c.symbol}{selectedPrice}
                          {!isJpyMode && selectedPriceJpy > 0 ? ` / ${formatJpy(selectedPriceJpy)}` : ''}
                        </ThemedText>
                      )}
                    </View>
                    {ocrResult.prices.length > 0 && (
                      <View style={styles.ocrSectionActions}>
                        {pricesSectionOpen && ocrResult.prices.length > PRICE_PREVIEW_COUNT && (
                          <TouchableOpacity
                            onPress={() => setPricesExpanded((v) => !v)}
                            hitSlop={8}
                            activeOpacity={0.6}>
                            <ThemedText style={styles.ocrSectionMore}>
                              {pricesExpanded ? '少なく表示' : `さらに${ocrResult.prices.length - PRICE_PREVIEW_COUNT}件`}
                            </ThemedText>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          onPress={() => setPricesSectionOpen((v) => !v)}
                          hitSlop={8}
                          activeOpacity={0.6}>
                          <ThemedText style={styles.ocrSectionMore}>
                            {pricesSectionOpen ? '閉じる' : '候補を見る'}
                          </ThemedText>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
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
                  ) : pricesSectionOpen ? (
                    <View style={styles.ocrPriceRow}>
                      {(pricesExpanded ? ocrResult.prices : pricePreview).map((p) => {
                        const isSelected = p === selectedPrice;
                        const numP = Number(p);
                        const jpyForP = rate > 0 && isFinite(numP) ? convert(numP, rate, 'TO_JPY') : 0;
                        return (
                          <TouchableOpacity
                            key={p}
                            style={[styles.priceCard, isSelected && styles.priceCardSelected]}
                            onPress={() => handlePickPrice(p)}
                            activeOpacity={0.8}>
                            <ThemedText
                              style={[styles.priceCardForeign, isSelected && styles.priceCardForeignSelected]}>
                              {isSelected ? '✓ ' : ''}{c.symbol}{p}
                            </ThemedText>
                            {!isJpyMode && jpyForP > 0 && (
                              <ThemedText
                                style={[styles.priceCardJpy, isSelected && styles.priceCardJpySelected]}>
                                {formatJpy(jpyForP)}
                              </ThemedText>
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ) : null}
                </View>

                {/* メモ候補（行全体タップで追加。右端は状態表示。見出し右にさらに◯件＋セクション開閉） */}
                {ocrResult.memoLines.length > 0 && (
                  <View style={styles.ocrSection}>
                    <View style={styles.ocrSectionHeader}>
                      <View style={styles.ocrSectionLabelGroup}>
                        <ThemedText style={styles.ocrSectionLabel}>メモ候補（タップで追加）</ThemedText>
                        {!memoSectionOpen && addedMemoLines.size > 0 && (
                          <ThemedText style={styles.ocrSectionSubInfo}>
                            追加済み{addedMemoLines.size}件
                          </ThemedText>
                        )}
                      </View>
                      <View style={styles.ocrSectionActions}>
                        {memoSectionOpen && ocrResult.memoLines.length > MEMO_PREVIEW_COUNT && (
                          <TouchableOpacity
                            onPress={() => setMemoExpanded((v) => !v)}
                            hitSlop={8}
                            activeOpacity={0.6}>
                            <ThemedText style={styles.ocrSectionMore}>
                              {memoExpanded ? '少なく表示' : `さらに${ocrResult.memoLines.length - MEMO_PREVIEW_COUNT}件`}
                            </ThemedText>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          onPress={() => setMemoSectionOpen((v) => !v)}
                          hitSlop={8}
                          activeOpacity={0.6}>
                          <ThemedText style={styles.ocrSectionMore}>
                            {memoSectionOpen ? '閉じる' : '候補を見る'}
                          </ThemedText>
                        </TouchableOpacity>
                      </View>
                    </View>
                    {memoSectionOpen && (memoExpanded
                      ? ocrResult.memoLines
                      : ocrResult.memoLines.slice(0, MEMO_PREVIEW_COUNT)
                    ).map((line) => {
                      const added = addedMemoLines.has(line);
                      return (
                        <TouchableOpacity
                          key={line}
                          style={styles.ocrMemoLineRow}
                          onPress={() => handleAddMemoLine(line)}
                          activeOpacity={0.7}>
                          <ThemedText style={styles.ocrMemoLineText} numberOfLines={1}>
                            {line}
                          </ThemedText>
                          <ThemedText style={[styles.ocrMemoStatus, added && styles.ocrMemoStatusAdded]}>
                            {added ? '✓ 追加済み' : '＋メモ'}
                          </ThemedText>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                {/* 読み取った文字（折りたたみ・全文コピーはここに） */}
                <TouchableOpacity
                  style={styles.ocrRawToggle}
                  onPress={() => setOcrRawExpanded((v) => !v)}
                  activeOpacity={0.7}>
                  <ThemedText style={styles.ocrRawToggleText}>
                    {ocrRawExpanded ? '▾ 読み取った文字（全文）' : '▸ 読み取った文字（全文）'}
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
              </View>
              )}

              {/* 読み取り結果（OCR）と保存確認の区切り */}
              {ocrResult != null && <View style={styles.cardDivider} />}

              {/* ===== 金額の手入力（コンパクト編集パネル） =====
                  OCR成功時はヒーロー右上の「金額を修正」で開閉。失敗・手入力主導時は既定で開く。
                  入力state（nativeAmount）・切替（switchInputMode）・計算ロジックは一切変更しない。 */}
              {manualOpen && (
                <View
                  style={styles.editPanel}
                  onLayout={(e) => { manualAdjustYRef.current = e.nativeEvent.layout.y; }}>
                  <View style={styles.editPanelHead}>
                    <ThemedText style={styles.editPanelTitle}>金額を手入力</ThemedText>
                    {ocrSuccess && (
                      <TouchableOpacity
                        onPress={() => setManualAdjustExpanded(false)}
                        hitSlop={8}
                        activeOpacity={0.7}>
                        <ThemedText style={styles.editPanelClose}>閉じる</ThemedText>
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* 入力モード切替（JPYモードでは非表示）。失敗・手入力主導は2ボタン / OCR成功は逆換算リンク。 */}
                  {!isJpyMode && (
                    manualOpenByDefault ? (
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
                    ) : (
                      <TouchableOpacity
                        style={styles.reverseLink}
                        onPress={() => switchInputMode(isReverse ? 'TO_JPY' : 'FROM_JPY')}
                        hitSlop={8}
                        activeOpacity={0.7}>
                        <ThemedText style={styles.reverseLinkText}>
                          {isReverse ? `${currencyForDisplay}から入力する` : '円から入力する'}
                        </ThemedText>
                      </TouchableOpacity>
                    )
                  )}

                  {/* 金額入力（外貨/円）。記号＋数字で「読み取った値の調整」として見せる。 */}
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
                </View>
              )}

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

              {/* 再スキャンで得たOCR写真を保存写真に使う案内（自動上書きせず明示操作のみ） */}
              {canSuggestUsingOcrPhoto && (
                <View style={styles.ocrPhotoSuggest}>
                  <ThemedText style={styles.ocrPhotoSuggestTitle}>今読み取った値札写真があります</ThemedText>
                  <ThemedText style={styles.ocrPhotoSuggestDesc}>
                    保存写真に使うと、あとで見返しやすくなります。
                  </ThemedText>
                  <View style={styles.ocrPhotoSuggestActions}>
                    <TouchableOpacity
                      style={styles.ocrPhotoSuggestUseBtn}
                      onPress={handleUseOcrPhoto}
                      activeOpacity={0.8}>
                      <ThemedText style={styles.ocrPhotoSuggestUseText}>この写真を使う</ThemedText>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setOcrPhotoSuggestionDismissed(true)}
                      hitSlop={8}>
                      <ThemedText style={styles.ocrPhotoSuggestKeepText}>今の写真を維持</ThemedText>
                    </TouchableOpacity>
                  </View>
                </View>
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

              {/* 保存ボタン（カードの主役アクション）。
                  OCR成功時は固定フッターへ移すため、ここでは非表示（重複回避）。 */}
              {!showFooter && (
                <PrimaryButton
                  title={
                    canSave
                      ? `${formatJpy(Math.round(jpyAmount))} を${saveAsPurchased ? '購入済みで' : '候補に'}保存`
                      : saveAsPurchased
                        ? '購入済みとして保存'
                        : '買い物候補に保存'
                  }
                  onPress={handleSaveCandidate}
                  disabled={saveDisabled}
                />
              )}

              {/* 保存しないで次を撮る（v2 secondary・撮影に戻る）。
                  固定フッター表示時はフッター内に置くため、ここでは非表示。 */}
              {ocrResult != null && !showFooter && (
                <TouchableOpacity
                  style={styles.nextShotBtn}
                  onPress={handleRescan}
                  activeOpacity={0.7}>
                  <ThemedText style={styles.nextShotText}>保存しないで次を撮る →</ThemedText>
                </TouchableOpacity>
              )}

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

            {/* 下部：小さな予算サマリー ＋ 手入力サブ導線（撮影前のみ。結果パネル表示中は隠す） */}
            {activeTrip && !showInputCard && (
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

      {/* 価格OCR・結果確認中のみ表示する画面下固定の保存フッター（縦長緩和）。
          下タブの上に収まる位置。価格未選択でも消さず保存ボタンだけ disabled。保存処理は既存ハンドラを呼ぶだけ。 */}
      {showFooter && (
        <View style={styles.saveFooter}>
          <PrimaryButton
            title={
              canSave
                ? `${formatJpy(Math.round(jpyAmount))} を${saveAsPurchased ? '購入済みで' : '候補に'}保存`
                : saveAsPurchased
                  ? '購入済みとして保存'
                  : '買い物候補に保存'
            }
            onPress={handleSaveCandidate}
            disabled={saveDisabled}
          />
          <TouchableOpacity
            style={styles.footerNextShot}
            onPress={handleRescan}
            activeOpacity={0.7}>
            <ThemedText style={styles.footerNextShotText}>保存しないで次を撮る →</ThemedText>
          </TouchableOpacity>
        </View>
      )}

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

      {/* 読み取った値札の拡大表示（OCR確認用・contain・暗背景）。
          ※ピンチズーム/ドラッグは将来TODO。今回は contain 表示と閉じる導線のみ。 */}
      {ocrPreviewUri != null && Platform.OS !== 'web' && (
        <Modal
          visible={ocrPhotoZoomVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setOcrPhotoZoomVisible(false)}>
          <View style={styles.photoPreviewOverlay}>
            <ScrollView
              key={ocrPhotoZoomVisible ? 'ocr-zoom-open' : 'ocr-zoom-closed'}
              style={styles.photoPreviewScroll}
              contentContainerStyle={styles.photoPreviewScrollContent}
              minimumZoomScale={1}
              maximumZoomScale={3}
              centerContent
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}>
              <Image
                source={{ uri: ocrPreviewUri }}
                style={styles.photoPreviewImage}
                contentFit="contain"
              />
            </ScrollView>
            <TouchableOpacity
              style={styles.photoPreviewCloseBtn}
              onPress={() => setOcrPhotoZoomVisible(false)}
              activeOpacity={0.75}>
              <ThemedText style={styles.photoPreviewCloseBtnText}>閉じる</ThemedText>
            </TouchableOpacity>
          </View>
        </Modal>
      )}

      {/* 保存写真アクションシート（メイン画面・Alert置換）。
          閉じている時は描画しない＝透明Modal/backdropがタップを奪わないようにする。 */}
      {photoSheetVisible && (
      <ActionSheet visible={photoSheetVisible} onClose={() => setPhotoSheetVisible(false)}>
        <View style={styles.photoSheetGrabber} />
        <ThemedText style={styles.photoSheetTitle}>保存する写真</ThemedText>
        <ThemedText style={styles.photoSheetSubtitle}>
          履歴で見返すための商品写真を選べます。
        </ThemedText>
        <View style={styles.photoSheetList}>
          <TouchableOpacity
            style={[styles.photoSheetRow, styles.photoSheetRowPrimary]}
            onPress={() => closeSheetThen(handleTakeProductPhoto)}
            activeOpacity={0.7}>
            <ThemedText style={[styles.photoSheetRowText, styles.photoSheetRowTextPrimary]}>
              商品写真を撮る
            </ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.photoSheetRow}
            onPress={() => closeSheetThen(handlePickPhotoFromLibrary)}
            activeOpacity={0.7}>
            <ThemedText style={styles.photoSheetRowText}>写真ライブラリから選ぶ</ThemedText>
          </TouchableOpacity>
          {ocrPhotoUri != null && (
            <TouchableOpacity
              style={styles.photoSheetRow}
              onPress={() => closeSheetThen(handleUseOcrPhoto)}
              activeOpacity={0.7}>
              <ThemedText style={styles.photoSheetRowText}>OCR写真を使う</ThemedText>
            </TouchableOpacity>
          )}
          {pendingPhotoUri != null && (
            <TouchableOpacity
              style={[styles.photoSheetRow, styles.photoSheetRowDanger]}
              onPress={() => closeSheetThen(handleRemovePhoto)}
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
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.bgScreen, // v2 地色（#F4F6F5）
  },
  safe: { flex: 1 },
  scrollView: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingTop: 10,
    paddingBottom: 64, // 下タブとの距離（安全側。窮屈にならない範囲で圧縮）
    paddingHorizontal: 15, // v2 基準の画面左右余白
  },
  scrollWithFooter: {
    paddingBottom: 150, // 固定フッター（保存CTA＋次を撮る）に隠れないための余白
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
    paddingTop: 8, // v2 ヘッダー上余白
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
  modeSegmentBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  modeSegmentBtnActive: {
    backgroundColor: color.card,
    shadowColor: '#10211F',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
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
  // 撮影後の「読み取った値札」静止プレビュー（OCR確認用・指でドラッグ可・保存写真とは別）
  ocrPhotoPreview: {
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.card,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  ocrPhotoPreviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
  },
  ocrPhotoPreviewLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: color.muted,
  },
  ocrPhotoPreviewActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  ocrPhotoPreviewZoom: {
    fontSize: 13,
    fontWeight: '700',
    color: color.primary,
  },
  ocrPhotoPreviewFrame: {
    height: 110, // 横長コンパクト（従来200→150→110）。拡大で全体確認できるため低めでOK。戻す場合はここを調整。
    borderRadius: radius.chip,
    overflow: 'hidden',
    backgroundColor: '#111',
    position: 'relative',
  },
  ocrPhotoPreviewScrollContent: {
    // 画像が枠より小さいときは中央、大きいときは縦スクロールで全体を確認
    minHeight: '100%',
    justifyContent: 'center',
  },
  ocrPhotoPreviewImg: {
    width: '100%',
    // 高さは aspectRatio（実寸比）で決まる。枠より高ければ縦スクロールで上下を見渡せる。
  },
  ocrPhotoPreviewRescan: {
    fontSize: 13,
    fontWeight: '700',
    color: color.primary,
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
  // OCR結果＋保存を1枚にまとめた結果パネル
  resultPanel: {
    gap: 10,
  },
  // ヒーロー右上の「✎ 金額を修正」（手入力パネルの開閉）
  heroEditLink: {
    position: 'absolute',
    top: 0,
    right: 0,
    zIndex: 2,
    paddingVertical: 2,
    paddingLeft: 8,
  },
  heroEditLinkText: {
    fontSize: 13,
    fontWeight: '700',
    color: color.primary,
  },
  // 円換算ヒーロー（パネル最上部の主役）＋ 残予算pill
  heroBlock: {
    gap: 6,
    position: 'relative',
  },
  heroJpy: {
    alignItems: 'flex-start',
  },
  heroJpyLabel: {
    ...typography.overline,
    color: color.muted,
    marginBottom: spacing.xs,
  },
  // 円価格（主役・左）とレート補足情報（右端）を分ける。alignSelf:'stretch'でヒーロー全幅を確保し、
  // justifyContent:'space-between'で右端へ逃がす（stretchがないとrowが内容幅にしか広がらず右に逃げない）
  heroValueRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
  },
  heroJpyValue: {
    fontSize: 44,
    lineHeight: 46,
    fontWeight: '700',
    letterSpacing: -1.6,
    color: color.text,
    fontVariant: ['tabular-nums'],
  },
  // 小さい金額用：外貨額・レートの2行を右端でまとめる（主役の円価格と窮屈に並べない）
  heroRateSubWrap: {
    alignItems: 'flex-end',
    flexShrink: 1,
    paddingLeft: 12,
    paddingBottom: 2,
  },
  heroRateSub: {
    fontSize: 13,
    fontWeight: '500',
    color: color.muted,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  // 大きい金額用：外貨額＋レートを1行にまとめ、縦を無駄に使わない
  heroRateSubInline: {
    fontSize: 13,
    fontWeight: '500',
    color: color.muted,
    paddingLeft: 12,
    paddingBottom: 2,
    fontVariant: ['tabular-nums'],
  },
  heroPlaceholderValue: {
    fontSize: 44,
    lineHeight: 46,
    fontWeight: '700',
    color: color.faint2,
    letterSpacing: -1.6,
  },
  heroPlaceholderHint: {
    fontSize: 12,
    fontWeight: '500',
    color: color.muted,
    marginTop: 2,
  },
  budgetPill: {
    alignSelf: 'flex-start',
    backgroundColor: color.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  budgetPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: color.primaryDark,
    fontVariant: ['tabular-nums'],
  },
  // 金額の手入力（コンパクト編集パネル）。淡背景の囲みで「フォーム」ではなく「調整パネル」に見せる
  editPanel: {
    backgroundColor: color.bgScreen,
    borderRadius: radius.chip,
    padding: spacing.md,
    gap: spacing.sm,
  },
  editPanelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  editPanelTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: color.muted,
    letterSpacing: 0.4,
  },
  editPanelClose: {
    fontSize: 12.5,
    fontWeight: '700',
    color: color.primary,
  },
  // OCR成功時の逆換算への補助リンク（円から入力する / 外貨から入力する）
  reverseLink: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  reverseLinkText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: color.primary,
  },
  // OCR成功時の画面下固定 保存フッター
  saveFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: color.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
    paddingHorizontal: 15,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 4,
    ...shadow.card,
  },
  footerNextShot: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  footerNextShotText: {
    fontSize: 13,
    fontWeight: '700',
    color: color.body,
  },
  nextShotBtn: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  nextShotText: {
    fontSize: 13,
    fontWeight: '700',
    color: color.body,
  },
  ocrSectionWrap: {
    gap: 10,
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
  ocrSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  // 見出しラベル＋畳んだ時のサブ情報（選択中の金額／追加済み件数）
  ocrSectionLabelGroup: {
    flex: 1,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  ocrSectionSubInfo: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '600',
    color: color.muted,
  },
  // 「さらに◯件」と「閉じる／候補を見る」を並べる
  ocrSectionActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  ocrSectionMore: {
    fontSize: 12,
    fontWeight: '700',
    color: color.primary,
  },
  ocrPriceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  // 価格候補カード（外貨額＋円換算の2段）。未選択＝淡teal地に濃teal文字、選択中＝濃teal地に白文字＋CTAグロー
  priceCard: {
    flexBasis: '31%',
    flexGrow: 0,
    alignItems: 'center',
    backgroundColor: color.primarySoft,
    borderRadius: radius.chip,
    paddingVertical: 10,
    paddingHorizontal: 8,
    gap: 2,
  },
  priceCardSelected: {
    backgroundColor: color.primaryDark,
    ...shadow.cta,
  },
  priceCardForeign: {
    color: color.primaryDark,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  priceCardForeignSelected: {
    color: '#fff',
  },
  priceCardJpy: {
    color: color.body,
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  priceCardJpySelected: {
    color: color.primaryAccent,
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
    paddingVertical: 6, // 行全体タップのため少し広めのタップ領域
  },
  ocrMemoLineText: {
    flex: 1,
    fontSize: 13,
    color: color.text,
    fontWeight: '500',
  },
  // 行右端の状態表示（未追加＝＋ / 追加済み＝✓ 追加済み）。ボタンではなくステータス。
  ocrMemoStatus: {
    borderWidth: 1,
    borderColor: color.primary,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    fontSize: 12,
    fontWeight: '600',
    color: color.primary,
    overflow: 'hidden',
  },
  ocrMemoStatusAdded: {
    borderColor: color.line,
    backgroundColor: color.line2,
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
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '700',
    color: color.text,
  },
  inputAmountField: {
    flex: 1,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: color.text,
    paddingVertical: 0,
  },
  pendingPhotoBlock: {
    gap: 4,
  },
  pendingPhotoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.bgScreen,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
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

  // 再スキャンで得たOCR写真を保存写真に使う案内（淡いティールの控えめカード）
  ocrPhotoSuggest: {
    backgroundColor: color.primarySoft2,
    borderWidth: 1,
    borderColor: color.primaryBorder,
    borderRadius: radius.chip,
    padding: spacing.md,
    gap: 4,
  },
  ocrPhotoSuggestTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: color.primaryDark,
  },
  ocrPhotoSuggestDesc: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 17,
    color: color.body,
  },
  ocrPhotoSuggestActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 6,
  },
  ocrPhotoSuggestUseBtn: {
    backgroundColor: color.primary,
    borderRadius: radius.button,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  ocrPhotoSuggestUseText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  ocrPhotoSuggestKeepText: {
    fontSize: 13,
    fontWeight: '600',
    color: color.muted,
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
    fontSize: 12,
    fontWeight: '700',
    color: color.muted,
    letterSpacing: 0.4,
  },
  saveTargetPills: {
    flexDirection: 'row',
    backgroundColor: color.line2,
    borderRadius: radius.pill,
    padding: 3,
    gap: 3,
  },
  saveTargetPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: 'transparent',
  },
  saveTargetPillCandidateActive: {
    backgroundColor: statusColor.candidate.badgeBg,
    ...shadow.card,
  },
  saveTargetPillPurchasedActive: {
    backgroundColor: statusColor.purchased.badgeBg,
    ...shadow.card,
  },
  saveTargetPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: color.muted,
  },
  saveTargetPillTextCandidateActive: {
    color: statusColor.candidate.text,
    fontWeight: '700',
  },
  saveTargetPillTextPurchasedActive: {
    color: statusColor.purchased.text,
    fontWeight: '700',
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
