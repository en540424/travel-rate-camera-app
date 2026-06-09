import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CameraPreview } from '@/components/camera/CameraPreview';
import { ThemedText } from '@/components/themed-text';
import type { ConversionDirection, CurrencyCode } from '@/constants/currencies';
import { CURRENCIES, FOREIGN_CURRENCY_CODES } from '@/constants/currencies';
import {
  CAMERA_UI as C,
  FALLBACK_BUDGET_JPY,
  FALLBACK_TRIP_NAME,
} from '@/constants/camera-screen';
import { useHistory } from '@/hooks/use-history';
import { useRates } from '@/hooks/use-rates';
import { useTrips } from '@/hooks/use-trips';
import { useSettingsStore } from '@/stores/settings-store';
import { convert } from '@/utils/currency';
import { extractMemoLines, extractPriceCandidates } from '@/utils/extract-prices';
import { formatForeign, formatJpy, formatRate } from '@/utils/format';
import { getTripStatsForDisplay } from '@/utils/trip-stats';

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
  const [saveAsPurchased, setSaveAsPurchased] = useState(false);

  const { rates } = useRates();
  const { selectedCurrency, setSelectedCurrency } = useSettingsStore();
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
  const tripRate = activeTrip?.manual_rate ?? 0;
  const globalRate = rates[selectedCurrency] ?? 0;
  const rate = isJpyMode ? 1 : (tripRate > 0 ? tripRate : globalRate);
  const isReverse = !isJpyMode && inputMode === 'FROM_JPY';
  const inputNum = parseFloat(nativeAmount) || 0;
  const foreignAmount = isJpyMode ? inputNum : (isReverse ? convert(inputNum, rate, 'FROM_JPY') : inputNum);
  const jpyAmount = isJpyMode ? inputNum : (isReverse ? inputNum : convert(inputNum, rate, 'TO_JPY'));
  const canSave = isJpyMode
    ? !!activeTrip && inputNum > 0
    : !!activeTrip && rate > 0 && foreignAmount > 0 && jpyAmount > 0;
  const c = CURRENCIES[isJpyMode ? 'JPY' : selectedCurrency];

  const stats = useMemo(
    () => getTripStatsForDisplay(history, tripBudgetJpy, activeTrip?.id),
    [history, totalCount, tripBudgetJpy, activeTrip?.id],
  );

  const remainingIfSaved = canSave
    ? Math.max(0, stats.remainingBudget - Math.round(jpyAmount))
    : null;
  const budgetUsedRatio = tripBudgetJpy > 0
    ? Math.min(1, stats.purchasedTotalJpy / tripBudgetJpy)
    : 0;

  const isWeb = Platform.OS === 'web';

  function switchInputMode(mode: ConversionDirection) {
    setInputMode(mode);
    setNativeAmount('');
  }

  function handlePhotoCapture(uri: string) {
    setPendingPhotoUri(uri);
  }

  function handleOcrResult(raw: string) {
    if (isWeb) return;
    setOcrResult({
      raw,
      prices: extractPriceCandidates(raw, isJpyMode),
      memoLines: extractMemoLines(raw),
    });
  }

  function handlePickPrice(price: string) {
    setNativeAmount(price);
    setInputMode('TO_JPY');
    // OCRカードは閉じない（全文を見ながらメモを書けるようにする）
  }

  function handleAddMemoLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;
    setMemo((prev) => {
      const current = prev.trim();
      if (!current) return trimmed.slice(0, 100);
      return `${current} ${trimmed}`.slice(0, 100);
    });
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

  function handleRescan() {
    setNativeAmount('');
    setScanKey((k) => k + 1);
    setPendingPhotoUri(null);
  }

  async function handleSaveCandidate() {
    if (!canSave) return;
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
    const currencyToSave: CurrencyCode = isJpyMode ? 'JPY' : selectedCurrency;
    try {
      await addEntry(currencyToSave, foreignAmount, jpyAmount, rate, memo.trim() || undefined, savedPhotoUri, saveAsPurchased);
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
    setOcrRawExpanded(false);
    setPendingPhotoUri(null);
    setSaveAsPurchased(false);
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
      currency={selectedCurrency}
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
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">

          <View style={styles.container}>

            {/* 上部：ブランド＋旅行コンテキスト */}
            <View style={styles.topSection}>
              <ThemedText style={styles.appTitle}>旅レートカメラ</ThemedText>
              <ThemedText style={styles.tripName}>{tripName}</ThemedText>

              <View style={styles.contextRow}>
                {isJpyMode ? (
                  <View style={styles.modeChip}>
                    <ThemedText style={styles.modeChipText}>
                      🇯🇵 JPY 国内モード
                    </ThemedText>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.modeChip}
                    onPress={cycleCurrency}
                    activeOpacity={0.75}>
                    <ThemedText style={styles.modeChipText}>
                      {c.flag} {selectedCurrency} → JPY
                    </ThemedText>
                  </TouchableOpacity>
                )}
                <ThemedText style={styles.rateInline} numberOfLines={1}>
                  {isJpyMode ? '変換なし' : (rate > 0 ? formatRate(rate, selectedCurrency) : 'レート未設定')}
                </ThemedText>
              </View>
            </View>

            {/* 中央：カメラ（主役） */}
            <View style={styles.cameraHero}>
              {cameraPreview}
            </View>

            {/* OCR結果カード（Web では表示しない） */}
            {!isWeb && ocrResult != null && (
              <View style={styles.ocrCard}>
                {/* ヘッダー */}
                <View style={styles.ocrCardHeader}>
                  <ThemedText style={styles.ocrCardTitle}>読み取り結果</ThemedText>
                  <TouchableOpacity
                    onPress={() => { setOcrResult(null); setOcrRawExpanded(false); }}
                    hitSlop={8}>
                    <ThemedText style={styles.ocrCardClose}>✕</ThemedText>
                  </TouchableOpacity>
                </View>

                {/* 価格候補 */}
                <View style={styles.ocrSection}>
                  <ThemedText style={styles.ocrSectionLabel}>価格候補</ThemedText>
                  {ocrResult.prices.length === 0 ? (
                    <ThemedText style={styles.ocrNoneText}>認識できませんでした</ThemedText>
                  ) : (
                    <View style={styles.ocrPriceRow}>
                      {ocrResult.prices.map((p) => (
                        <TouchableOpacity
                          key={p}
                          style={styles.ocrPriceBtn}
                          onPress={() => handlePickPrice(p)}
                          activeOpacity={0.75}>
                          <ThemedText style={styles.ocrPriceBtnText}>
                            {c.symbol}{p}
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
                    {ocrResult.memoLines.map((line) => (
                      <View key={line} style={styles.ocrMemoLineRow}>
                        <ThemedText style={styles.ocrMemoLineText} numberOfLines={1}>
                          {line}
                        </ThemedText>
                        <TouchableOpacity
                          style={styles.ocrAddMemoBtn}
                          onPress={() => handleAddMemoLine(line)}
                          activeOpacity={0.75}>
                          <ThemedText style={styles.ocrAddMemoBtnText}>＋メモ</ThemedText>
                        </TouchableOpacity>
                      </View>
                    ))}
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
              </View>
            )}

            {/* 金額入力カード（カメラ下）*/}
            <View style={styles.inputCard}>
              {/* 入力モード切り替え（JPY モードでは非表示） */}
              {!isJpyMode && (
                <View style={styles.inputModeRow}>
                  <TouchableOpacity
                    style={[styles.inputModeBtn, !isReverse && styles.inputModeBtnActive]}
                    onPress={() => switchInputMode('TO_JPY')}
                    activeOpacity={0.75}>
                    <ThemedText style={[styles.inputModeBtnText, !isReverse && styles.inputModeBtnTextActive]}>
                      {selectedCurrency} → JPY
                    </ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.inputModeBtn, isReverse && styles.inputModeBtnActive]}
                    onPress={() => switchInputMode('FROM_JPY')}
                    activeOpacity={0.75}>
                    <ThemedText style={[styles.inputModeBtnText, isReverse && styles.inputModeBtnTextActive]}>
                      JPY → {selectedCurrency}
                    </ThemedText>
                  </TouchableOpacity>
                </View>
              )}

              <View style={styles.inputAmountRow}>
                <ThemedText style={styles.inputCurrencySymbol}>
                  {isReverse ? '¥' : c.symbol}
                </ThemedText>
                <TextInput
                  style={styles.inputAmountField}
                  value={nativeAmount}
                  onChangeText={setNativeAmount}
                  placeholder="0"
                  placeholderTextColor={C.textMuted}
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                  selectTextOnFocus
                />
                {isJpyMode
                  ? null
                  : isReverse
                    ? (foreignAmount > 0 && (
                        <ThemedText style={styles.inputJpy}>
                          ≈ {formatForeign(foreignAmount, selectedCurrency)}
                        </ThemedText>
                      ))
                    : (jpyAmount > 0 && (
                        <ThemedText style={styles.inputJpy}>≈ {formatJpy(jpyAmount)}</ThemedText>
                      ))
                }
              </View>
              <View style={styles.memoRow}>
                <ThemedText style={styles.memoLabel}>メモ</ThemedText>
                <TextInput
                  style={styles.memoInput}
                  value={memo}
                  onChangeText={setMemo}
                  placeholder="モッツァレラ / Tシャツ / お土産"
                  placeholderTextColor={C.textMuted}
                  returnKeyType="done"
                  maxLength={100}
                />
              </View>

              {pendingPhotoUri != null && Platform.OS !== 'web' && (
                <View style={styles.pendingPhotoRow}>
                  <Image
                    source={{ uri: pendingPhotoUri }}
                    style={styles.pendingPhotoThumb}
                    contentFit="cover"
                  />
                  <ThemedText style={styles.pendingPhotoLabel}>写真が保存されます</ThemedText>
                </View>
              )}

              <View style={styles.inputModeRow}>
                <TouchableOpacity
                  style={[styles.inputModeBtn, !saveAsPurchased && styles.inputModeBtnActive]}
                  onPress={() => setSaveAsPurchased(false)}
                  activeOpacity={0.75}>
                  <ThemedText style={[styles.inputModeBtnText, !saveAsPurchased && styles.inputModeBtnTextActive]}>
                    候補
                  </ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.inputModeBtn, saveAsPurchased && styles.inputModeBtnActive]}
                  onPress={() => setSaveAsPurchased(true)}
                  activeOpacity={0.75}>
                  <ThemedText style={[styles.inputModeBtnText, saveAsPurchased && styles.inputModeBtnTextActive]}>
                    購入済み
                  </ThemedText>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[
                  styles.candidateBtn,
                  !canSave && styles.candidateBtnDisabled,
                  saveAsPurchased && styles.candidateBtnPurchased,
                ]}
                onPress={handleSaveCandidate}
                disabled={!canSave}
                activeOpacity={0.75}>
                <ThemedText
                  style={[
                    styles.candidateBtnText,
                    !canSave && styles.candidateBtnTextDisabled,
                    saveAsPurchased && styles.candidateBtnTextPurchased,
                  ]}>
                  {saveAsPurchased ? '購入済みとして保存' : '買い物候補に保存'}
                </ThemedText>
              </TouchableOpacity>
            </View>

            {/* 買い物サマリー（判断の文脈） */}
            {activeTrip ? (
              <View style={styles.summaryCard}>
                <ThemedText style={styles.summaryTitle}>買い物サマリー</ThemedText>

                <View style={styles.summaryRow}>
                  <ThemedText style={styles.summaryLabel}>買い物候補</ThemedText>
                  <ThemedText style={styles.summaryValue}>{stats.candidateCount}件</ThemedText>
                </View>
                <View style={styles.summaryRow}>
                  <ThemedText style={styles.summaryLabel}>候補合計</ThemedText>
                  <ThemedText style={styles.summaryValueAccent}>
                    {formatJpy(stats.candidateTotalJpy)}
                  </ThemedText>
                </View>
                <View style={styles.summaryRow}>
                  <ThemedText style={styles.summaryLabel}>購入済み</ThemedText>
                  <ThemedText style={styles.summaryValue}>
                    {formatJpy(stats.purchasedTotalJpy)}
                  </ThemedText>
                </View>
                <View style={styles.summaryRow}>
                  <ThemedText style={styles.summaryLabel}>残り予算</ThemedText>
                  <ThemedText style={styles.summaryRemaining}>
                    {tripBudgetJpy > 0 ? formatJpy(stats.remainingBudget) : '未設定'}
                  </ThemedText>
                </View>

                <View style={styles.budgetBarTrack}>
                  <View
                    style={[
                      styles.budgetBarFill,
                      { width: `${budgetUsedRatio * 100}%` },
                    ]}
                  />
                </View>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.noTripBanner}
                onPress={() => router.push('/settings')}
                activeOpacity={0.75}>
                <ThemedText style={styles.noTripBannerText}>
                  旅行フォルダがありません
                </ThemedText>
                <ThemedText style={styles.noTripBannerLink}>
                  設定で旅行を作成する →
                </ThemedText>
              </TouchableOpacity>
            )}

            {/* 再スキャン */}
            <View style={styles.judgmentSection}>
              <TouchableOpacity
                style={styles.rescanBtn}
                onPress={handleRescan}
                activeOpacity={0.75}>
                <ThemedText style={styles.rescanBtnText}>もう一度読み取る</ThemedText>
              </TouchableOpacity>
            </View>

            {/* 補助導線 */}
            <View style={styles.auxLinks}>
              <TouchableOpacity
                onPress={() => router.push('/converter')}
                hitSlop={8}>
                <ThemedText style={styles.auxLink}>手入力で換算</ThemedText>
              </TouchableOpacity>
              <ThemedText style={styles.auxDot}>·</ThemedText>
              <TouchableOpacity
                onPress={() => router.push('/rate-setup')}
                hitSlop={8}>
                <ThemedText style={styles.auxLink}>レート変更</ThemedText>
              </TouchableOpacity>
            </View>

          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.bg,
  },
  safe: { flex: 1 },
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

  topSection: {
    gap: 6,
    paddingTop: 6,
    marginBottom: 2,
  },
  appTitle: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.4,
    color: C.text,
    lineHeight: 32,
  },
  tripName: {
    fontSize: 20,
    fontWeight: '700',
    color: C.text,
    letterSpacing: -0.3,
    marginTop: 2,
  },
  contextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 8,
  },
  modeChip: {
    backgroundColor: C.surface,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  modeChipText: {
    fontSize: 15,
    fontWeight: '700',
    color: C.text,
  },
  rateInline: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: C.textSecondary,
    textAlign: 'right',
  },

  cameraHero: {
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },

  ocrCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    gap: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  ocrCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ocrCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: C.text,
  },
  ocrCardClose: {
    fontSize: 16,
    color: C.textMuted,
  },
  ocrSection: {
    gap: 8,
  },
  ocrSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: C.textMuted,
    letterSpacing: 0.5,
  },
  ocrPriceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  ocrPriceBtn: {
    backgroundColor: C.brand,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  ocrPriceBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  ocrNoneText: {
    fontSize: 13,
    color: C.textMuted,
  },
  ocrMemoLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 3,
  },
  ocrMemoLineText: {
    flex: 1,
    fontSize: 13,
    color: C.text,
    fontWeight: '500',
  },
  ocrAddMemoBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: C.brand,
    borderRadius: 6,
  },
  ocrAddMemoBtnText: {
    fontSize: 12,
    color: C.brand,
    fontWeight: '600',
  },
  ocrRawToggle: {
    paddingVertical: 4,
  },
  ocrRawToggleText: {
    fontSize: 12,
    color: C.textMuted,
    fontWeight: '600',
  },
  ocrRawText: {
    fontSize: 12,
    color: C.textSecondary,
    lineHeight: 18,
  },
  ocrCopyBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: C.brand,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 4,
  },
  ocrCopyBtnText: {
    fontSize: 12,
    color: C.brand,
    fontWeight: '600',
  },

  inputCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  inputModeRow: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
  },
  inputModeBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
  },
  inputModeBtnActive: {
    backgroundColor: C.brand,
  },
  inputModeBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textSecondary,
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
    fontWeight: '700',
    color: C.text,
  },
  inputAmountField: {
    flex: 1,
    fontSize: 36,
    fontWeight: '800',
    color: C.text,
    paddingVertical: 0,
  },
  inputJpy: {
    fontSize: 15,
    fontWeight: '600',
    color: C.textSecondary,
    flexShrink: 1,
  },
  pendingPhotoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pendingPhotoThumb: {
    width: 56,
    height: 42,
    borderRadius: 8,
    backgroundColor: C.bg,
  },
  pendingPhotoLabel: {
    fontSize: 12,
    color: C.textSecondary,
    fontWeight: '500',
    flex: 1,
  },
  memoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.bg,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 2,
    gap: 8,
  },
  memoLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: C.textMuted,
    letterSpacing: 0.4,
    minWidth: 28,
  },
  memoInput: {
    flex: 1,
    fontSize: 14,
    color: C.text,
    paddingVertical: 10,
  },

  summaryCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  summaryTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: C.textMuted,
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  summaryValueAccent: {
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
  budgetBarTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: C.budgetBarTrack,
    marginTop: 6,
    overflow: 'hidden',
  },
  budgetBarFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: C.budgetBar,
    minWidth: 0,
  },

  noTripBanner: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: C.brand,
    borderStyle: 'dashed',
  },
  noTripBannerText: {
    fontSize: 15,
    fontWeight: '600',
    color: C.textSecondary,
  },
  noTripBannerLink: {
    fontSize: 14,
    fontWeight: '700',
    color: C.brand,
  },

  judgmentSection: {
    gap: 10,
    alignItems: 'stretch',
  },
  judgmentLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: C.textMuted,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  candidateBtn: {
    backgroundColor: C.surface,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: C.brand,
  },
  candidateBtnDisabled: {
    borderColor: C.border,
    opacity: 0.55,
  },
  candidateBtnPurchased: {
    backgroundColor: C.brand,
    borderColor: C.brand,
  },
  candidateBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: C.brand,
  },
  candidateBtnTextDisabled: {
    color: C.textMuted,
  },
  candidateBtnTextPurchased: {
    color: '#fff',
  },
  rescanBtn: {
    backgroundColor: C.surface,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  rescanBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
  },

  auxLinks: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    paddingTop: 4,
    paddingBottom: 8,
  },
  auxLink: {
    fontSize: 14,
    fontWeight: '600',
    color: C.brand,
  },
  auxDot: {
    fontSize: 14,
    color: C.textMuted,
  },
});
