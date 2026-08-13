// 手入力換算画面（補助機能）
// カメラで読み取れない場合や、正確な金額を計算したい場合に使う。
// 通貨は常に現在の旅行フォルダの基準通貨に固定する（自由な通貨選択UIは持たない）。
import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRef, useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { CurrencyFlagImage } from '@/components/domain';
import { SaveLimitSheet } from '@/components/domain/SaveLimitSheet';
import { EmptyState, PrimaryButton } from '@/components/ui';
import type { ConversionDirection, CurrencyCode } from '@/constants/currencies';
import { CURRENCIES } from '@/constants/currencies';
import { FREE_LIMITS, canSaveEntry } from '@/config/limits';
import { useHistory } from '@/hooks/use-history';
import { useIsPro } from '@/hooks/use-purchases';
import { useRates } from '@/hooks/use-rates';
import { useTrips } from '@/hooks/use-trips';
import { useSettingsStore } from '@/stores/settings-store';
import { color, radius, shadow, spacing } from '@/theme/tokens';
import { convert } from '@/utils/currency';
import { formatForeign, formatJpy, formatRate } from '@/utils/format';

async function copySelectedImageToPhotos(uri: string): Promise<string | undefined> {
  const docsDir = FileSystem.documentDirectory;
  if (!docsDir) return undefined;
  const photosDir = `${docsDir}photos/`;
  await FileSystem.makeDirectoryAsync(photosDir, { intermediates: true });
  const destUri = `${photosDir}${Date.now()}.jpg`;
  await FileSystem.copyAsync({ from: uri, to: destUri });
  return destUri;
}

export default function ConverterScreen() {
  const [amountText, setAmountText] = useState('');
  const [direction, setDirection] = useState<ConversionDirection>('TO_JPY');
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);
  const [saveAsPurchased, setSaveAsPurchased] = useState(false);
  const [showSaveLimitSheet, setShowSaveLimitSheet] = useState(false);
  const { rates } = useRates();
  const { setPendingCameraAmount } = useSettingsStore();
  const { totalCount, addEntry } = useHistory();
  const { activeTrip } = useTrips();
  const isPro = useIsPro();

  // 以前は「1画面に収まる想定」でscrollEnabledをキーボード表示状態に紐付け、
  // キーボードを閉じると強制的にトップへ戻していたが、端末サイズによっては
  // 画面が収まらず保存ボタンへスクロール到達できなくなる実機不具合があったため、
  // ScrollViewは常時スクロール可能な標準状態に戻す（キーボード監視自体をやめる）。
  const scrollViewRef = useRef<ScrollView>(null);

  // 通貨は常に現在の旅行の基準通貨。ここでは選ばせない。
  const tripCurrency = activeTrip?.base_currency ?? null;
  const isJpyMode = tripCurrency === 'JPY';
  const tripRate = activeTrip?.manual_rate ?? 0;
  const effectiveRate = !activeTrip
    ? 0
    : isJpyMode
      ? 1
      : (tripRate > 0 ? tripRate : (rates[tripCurrency as CurrencyCode] ?? 0));
  const amount = parseFloat(amountText) || 0;
  const isReverse = !!activeTrip && !isJpyMode && direction === 'FROM_JPY';
  const result = !activeTrip ? 0 : isJpyMode ? amount : convert(amount, effectiveRate, direction);
  const hasRate = isJpyMode || effectiveRate > 0;
  const hasResult = !!activeTrip && amount > 0 && hasRate;

  function switchDirection(next: ConversionDirection) {
    setDirection(next);
    setAmountText('');
  }

  async function pickImage() {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: false,
    });
    if (!picked.canceled && picked.assets[0]) {
      setSelectedImageUri(picked.assets[0].uri);
    }
  }

  async function handleSave() {
    if (!hasResult || isReverse || !tripCurrency) return;
    if (!canSaveEntry(isPro, totalCount)) {
      setShowSaveLimitSheet(true);
      return;
    }
    let savedUri: string | undefined;
    if (selectedImageUri && Platform.OS !== 'web') {
      savedUri = await copySelectedImageToPhotos(selectedImageUri);
    }
    // 保存失敗時に何も表示されない箇所があったため try/catch + Alert を追加（P0-08）。
    // 保存ロジック本体（addEntry）は変更しない。
    try {
      const saveOutcome = await addEntry(tripCurrency, amount, result, effectiveRate, undefined, savedUri, saveAsPurchased);
      if (saveOutcome.blocked) {
        setShowSaveLimitSheet(true);
        return; // 入力値を保持したまま終了
      }
    } catch (e) {
      console.warn('[converter save error]', e);
      Alert.alert(
        '保存できませんでした',
        '記録の保存中にエラーが発生しました。もう一度お試しください。',
        [{ text: 'OK' }],
      );
      return; // 入力値を保持したまま終了
    }
    if (Platform.OS !== 'web') {
      try {
        const { notificationAsync, NotificationFeedbackType } = await import('expo-haptics');
        await notificationAsync(NotificationFeedbackType.Success);
      } catch (e) {
        console.warn('Haptics not available:', e);
      }
    }
    setAmountText('');
    setSelectedImageUri(null);
    setSaveAsPurchased(false);
  }

  if (!activeTrip) {
    return (
      <View style={styles.screen}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <View style={styles.emptyWrap}>
            <EmptyState
              tone="neutral"
              title="旅行フォルダがありません"
              body={'設定タブで旅行を作成すると、\nここで手入力の記録ができます'}
              primary={{ title: '設定を開く', onPress: () => router.push('/settings') }}
            />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const currency = tripCurrency as CurrencyCode;
  const currencyInfo = CURRENCIES[currency];

  return (
    <View style={styles.screen}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          contentContainerStyle={styles.scroll}
          bounces={false}
          alwaysBounceVertical={false}
          overScrollMode="never"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">

          {/* タイトル */}
          <View style={styles.titleRow}>
            <ThemedText style={styles.title}>
              {isJpyMode ? '手入力で記録' : '手入力で換算'}
            </ThemedText>
            <ThemedText style={styles.subtitle}>
              {isJpyMode
                ? '国内旅行の買い物を円で記録します'
                : isReverse
                  ? '円からいくらか逆算する'
                  : 'カメラが使えないときの入力用'}
            </ThemedText>
          </View>

          {/* 旅行カード（旅行名・通貨・レートをまとめて表示） */}
          {isJpyMode ? (
            <View style={styles.tripCard}>
              <CurrencyFlagImage currency={currency} size={20} outlined />
              <View style={styles.tripTextWrap}>
                <ThemedText style={styles.tripName} numberOfLines={1}>
                  {activeTrip.name}
                </ThemedText>
                <ThemedText style={styles.tripSub}>JPY・換算なし</ThemedText>
              </View>
            </View>
          ) : (
            <Pressable
              style={({ pressed }) => [styles.tripCard, pressed && styles.pressed]}
              onPress={() => router.push('/rate-setup')}>
              <CurrencyFlagImage currency={currency} size={20} outlined />
              <View style={styles.tripTextWrap}>
                <ThemedText style={styles.tripName} numberOfLines={1}>
                  {activeTrip.name}
                </ThemedText>
                <ThemedText style={styles.tripSub} numberOfLines={1}>
                  {currency}・{hasRate ? formatRate(effectiveRate, currency) : 'レート未設定'}
                </ThemedText>
              </View>
              <ThemedText style={styles.editLink}>
                {hasRate ? '旅行設定 →' : 'レートを設定する →'}
              </ThemedText>
            </Pressable>
          )}

          {/* 換算方向切り替え（JPY国内モードでは非表示） */}
          {!isJpyMode && (
            <View style={styles.segment}>
              <Pressable
                style={[styles.segBtn, !isReverse && styles.segBtnActive]}
                onPress={() => switchDirection('TO_JPY')}>
                <ThemedText style={[styles.segBtnText, !isReverse && styles.segBtnTextActive]}>
                  {currency} → 円
                </ThemedText>
              </Pressable>
              <Pressable
                style={[styles.segBtn, isReverse && styles.segBtnActive]}
                onPress={() => switchDirection('FROM_JPY')}>
                <ThemedText style={[styles.segBtnText, isReverse && styles.segBtnTextActive]}>
                  円 → {currency}
                </ThemedText>
              </Pressable>
            </View>
          )}

          {/* 金額入力 */}
          <ThemedText style={styles.sectionLabel}>
            {isReverse ? '円金額を入力' : '金額を入力'}
          </ThemedText>
          <View style={styles.inputRow}>
            <TextInput
              style={[
                styles.amountInput,
                Platform.OS === 'web' && ({ outlineStyle: 'none' } as object),
              ]}
              value={amountText}
              onChangeText={setAmountText}
              placeholder="0"
              placeholderTextColor={color.faint2}
              keyboardType="decimal-pad"
              inputMode="decimal"
              returnKeyType="done"
              selectTextOnFocus
            />
            <ThemedText style={styles.unit}>
              {isReverse ? '¥ JPY' : `${currencyInfo.symbol} ${currency}`}
            </ThemedText>
          </View>

          {/* 換算結果カード */}
          <View style={styles.resultBox}>
            {hasResult ? (
              isReverse ? (
                <View style={styles.resultReverse}>
                  <ThemedText style={styles.resultLabel}>外貨換算</ThemedText>
                  <ThemedText
                    style={styles.resultAmount}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.5}>
                    {currencyInfo.symbol} {result.toFixed(2)}
                  </ThemedText>
                  <ThemedText style={styles.resultRate} numberOfLines={1}>
                    {formatRate(effectiveRate, currency)}
                  </ThemedText>
                </View>
              ) : (
                // 金額未入力時のプレースホルダーと高さを揃えるため、PriceResultCard（48pxの
                // 大きな共通表示）は使わず、逆算モードと同じ圧縮済みstyle（resultAmount等）で表示する。
                <View style={styles.resultReverse}>
                  <ThemedText style={styles.resultLabel}>
                    {isJpyMode ? 'そのまま保存' : '日本円換算'}
                  </ThemedText>
                  <ThemedText
                    style={styles.resultAmount}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.5}>
                    {formatJpy(result)}
                  </ThemedText>
                  {!isJpyMode && (
                    <ThemedText style={styles.resultRate} numberOfLines={1}>
                      {formatForeign(amount, currency)}
                      {effectiveRate > 0 ? `  ・  ${formatRate(effectiveRate, currency)}` : ''}
                    </ThemedText>
                  )}
                </View>
              )
            ) : (
              <ThemedText style={styles.resultPlaceholder}>
                {!hasRate ? 'レートを設定してください' : '金額を入力してください'}
              </ThemedText>
            )}
          </View>

          {/* この金額をカメラ入力に使う（円→外貨 モードのみ） */}
          {isReverse && hasResult && (
            <Pressable
              style={({ pressed }) => [styles.useToCameraBtn, pressed && styles.pressed]}
              onPress={() => {
                setPendingCameraAmount(result.toFixed(2));
                router.navigate('/');
              }}>
              <ThemedText style={styles.useToCameraBtnText}>
                この金額をカメラ入力に使う →
              </ThemedText>
            </Pressable>
          )}

          {/* 画像追加（外貨→円 モードのみ、Web以外） */}
          {!isReverse && Platform.OS !== 'web' && (
            selectedImageUri ? (
              <View style={styles.imagePreviewRow}>
                <Image
                  source={{ uri: selectedImageUri }}
                  style={styles.converterThumb}
                  contentFit="cover"
                />
                <Pressable onPress={() => setSelectedImageUri(null)} hitSlop={8} style={styles.removeImageBtn}>
                  <ThemedText style={styles.removeImageText}>✕ 画像を外す</ThemedText>
                </Pressable>
              </View>
            ) : (
              <Pressable style={({ pressed }) => [styles.imagePickerBtn, pressed && styles.pressed]} onPress={pickImage}>
                <ThemedText style={styles.imagePickerBtnText}>📷 カメラロールから画像を追加（任意）</ThemedText>
              </Pressable>
            )
          )}

          {/* 保存状態セグメント + 保存ボタン（外貨→円 モードのみ） */}
          {!isReverse && (
            <>
              <ThemedText style={styles.sectionLabel}>保存する状態を選択</ThemedText>
              <View style={styles.segment}>
                <Pressable
                  style={[styles.segBtn, !saveAsPurchased && styles.segBtnCandidate]}
                  onPress={() => setSaveAsPurchased(false)}>
                  <ThemedText style={[styles.segBtnText, !saveAsPurchased && styles.segBtnTextCandidate]}>
                    候補
                  </ThemedText>
                </Pressable>
                <Pressable
                  style={[styles.segBtn, saveAsPurchased && styles.segBtnPurchased]}
                  onPress={() => setSaveAsPurchased(true)}>
                  <ThemedText style={[styles.segBtnText, saveAsPurchased && styles.segBtnTextPurchased]}>
                    購入済み
                  </ThemedText>
                </Pressable>
              </View>
              <ThemedText style={styles.segmentCaption}>
                {saveAsPurchased ? '購入した商品として記録します' : 'まだ検討中の商品として記録します'}
              </ThemedText>
              <PrimaryButton
                title={`💾 ${formatJpy(result)} を${saveAsPurchased ? '購入済み' : '候補'}として保存`}
                onPress={handleSave}
                disabled={!hasResult}
              />
            </>
          )}

        </ScrollView>
      </SafeAreaView>

      <SaveLimitSheet
        visible={showSaveLimitSheet}
        onClose={() => setShowSaveLimitSheet(false)}
        onUpgrade={() => { setShowSaveLimitSheet(false); router.push('/pro'); }}
        saved={totalCount}
        limit={FREE_LIMITS.saves}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgScreen },
  safe: { flex: 1 },
  scrollView: { flex: 1 },
  scroll: {
    padding: 18,
    // 結果カード圧縮後は80だと余分にスクロールできる余地が大きすぎたため、
    // 保存ボタンへ確実に届く程度の余白を残しつつ縮小する（scrollEnabledは
    // 端末サイズ差の安全弁として常時有効のまま変更しない）。
    paddingBottom: 32,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
    gap: 14,
  },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  titleRow: { gap: 3 },
  title: { fontSize: 20, fontWeight: '700', color: color.text },
  subtitle: { fontSize: 13, fontWeight: '500', color: color.muted },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: color.body },
  // 換算方向 / 候補・購入済み 共通セグメント
  segment: {
    flexDirection: 'row',
    borderRadius: radius.chip,
    borderWidth: 1.5,
    borderColor: color.inputBorder,
    overflow: 'hidden',
  },
  segBtn: { flex: 1, paddingVertical: 9, alignItems: 'center' },
  segBtnActive: { backgroundColor: color.primary },
  segBtnCandidate: { backgroundColor: color.candidateSoft },
  segBtnPurchased: { backgroundColor: color.primaryBorder },
  segBtnText: { fontSize: 14, fontWeight: '700', color: color.muted },
  segBtnTextActive: { color: '#fff' },
  segBtnTextCandidate: { color: color.candidateText },
  segBtnTextPurchased: { color: color.purchasedText, fontWeight: '800' },
  tripCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.card,
    ...shadow.card,
  },
  tripTextWrap: { flex: 1, gap: 1 },
  tripName: { fontSize: 14, fontWeight: '700', color: color.text },
  tripSub: { fontSize: 12.5, fontWeight: '500', color: color.muted },
  editLink: { fontSize: 13, fontWeight: '600', color: color.primary },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: radius.chip,
    borderColor: color.inputBorder,
    paddingHorizontal: 16,
    backgroundColor: color.card,
    overflow: 'hidden',
  },
  amountInput: {
    flex: 1,
    fontSize: 32,
    fontWeight: '700',
    paddingVertical: 10,
    color: color.text,
    fontVariant: ['tabular-nums'],
  },
  unit: { fontSize: 14, fontWeight: '600', color: color.muted },
  resultBox: {
    borderRadius: radius.cardLg,
    backgroundColor: color.primarySoft,
    borderWidth: 1,
    borderColor: color.primaryBorder,
    paddingVertical: 16,
    paddingHorizontal: 20,
    minHeight: 108,
    justifyContent: 'center',
    ...shadow.card,
  },
  resultReverse: { alignItems: 'center', gap: 2 },
  resultLabel: { fontSize: 13, fontWeight: '600', color: color.primaryDark },
  resultAmount: {
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 32,
    color: color.primaryDark,
    fontVariant: ['tabular-nums'],
  },
  resultRate: { fontSize: 12, fontWeight: '500', color: color.primaryDark, opacity: 0.7 },
  resultPlaceholder: { fontSize: 13, fontWeight: '500', color: color.muted, textAlign: 'center' },
  useToCameraBtn: {
    height: 48,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: color.primary,
  },
  useToCameraBtnText: { fontSize: 15, fontWeight: '600', color: color.primary },
  imagePickerBtn: {
    borderRadius: radius.chip,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: color.inputBorder,
    backgroundColor: color.bgScreen,
  },
  imagePickerBtnText: { fontSize: 14, fontWeight: '600', color: color.primary },
  imagePreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: radius.chip,
    padding: 10,
    backgroundColor: color.line2,
  },
  converterThumb: {
    width: 64,
    height: 48,
    borderRadius: 8,
    backgroundColor: color.line,
  },
  removeImageBtn: { flex: 1 },
  removeImageText: { fontSize: 14, fontWeight: '500', color: color.danger },
  segmentCaption: { fontSize: 11.5, fontWeight: '500', color: color.muted, marginTop: -3 },
  pressed: { opacity: 0.85 },
});
