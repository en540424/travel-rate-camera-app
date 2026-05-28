import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CameraPreview } from '@/components/camera/CameraPreview';
import { ThemedText } from '@/components/themed-text';
import type { CurrencyCode } from '@/constants/currencies';
import { CURRENCIES, CURRENCY_CODES } from '@/constants/currencies';
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
import { formatJpy, formatRate } from '@/utils/format';
import { getTripStatsForDisplay } from '@/utils/trip-stats';

const WEB_DEMO_AMOUNT = 29.99;

export default function CameraScreen() {
  const [nativeAmount, setNativeAmount] = useState('');
  const [scanKey, setScanKey] = useState(0);

  const { rates } = useRates();
  const { selectedCurrency, setSelectedCurrency } = useSettingsStore();
  const { history, totalCount, addEntry, reload } = useHistory();
  const { activeTrip } = useTrips();

  const tripName = activeTrip?.name ?? FALLBACK_TRIP_NAME;
  const tripBudgetJpy = activeTrip?.budget_jpy ?? FALLBACK_BUDGET_JPY;

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const tripRate = activeTrip?.manual_rate ?? 0;
  const globalRate = rates[selectedCurrency] ?? 0;
  const rate = tripRate > 0 ? tripRate : globalRate;
  const saveAmount = Platform.OS === 'web'
    ? WEB_DEMO_AMOUNT
    : (parseFloat(nativeAmount) || 0);
  const jpyAmount = convert(saveAmount, rate);
  const canSave = !!activeTrip && rate > 0 && saveAmount > 0;
  const c = CURRENCIES[selectedCurrency];

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

  function cycleCurrency() {
    const idx = CURRENCY_CODES.indexOf(selectedCurrency);
    setSelectedCurrency(
      CURRENCY_CODES[(idx + 1) % CURRENCY_CODES.length] as CurrencyCode,
    );
  }

  function handleRescan() {
    setNativeAmount('');
    setScanKey((k) => k + 1);
  }

  async function handleSaveCandidate() {
    if (!canSave) return;
    await addEntry(selectedCurrency, saveAmount, jpyAmount, rate);
    setNativeAmount('');
    if (Platform.OS !== 'web') {
      const { default: Haptics } = await import('expo-haptics');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }

  const cameraPreview = (
    <CameraPreview
      key={scanKey}
      currency={selectedCurrency}
      rate={rate}
      remainingIfSaved={remainingIfSaved}
      amountText={isWeb ? undefined : nativeAmount}
      onAmountChange={isWeb ? undefined : setNativeAmount}
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
                <TouchableOpacity
                  style={styles.modeChip}
                  onPress={cycleCurrency}
                  activeOpacity={0.75}>
                  <ThemedText style={styles.modeChipText}>
                    {c.flag} {selectedCurrency} → JPY
                  </ThemedText>
                </TouchableOpacity>
                <ThemedText style={styles.rateInline} numberOfLines={1}>
                  {rate > 0
                    ? formatRate(rate, selectedCurrency)
                    : 'レート未設定'}
                </ThemedText>
              </View>
            </View>

            {/* 中央：カメラ（主役） */}
            <View style={styles.cameraHero}>
              {cameraPreview}
            </View>

            {/* 買い物サマリー（判断の文脈） */}
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

            {/* 判断アクション（補助） */}
            <View style={styles.judgmentSection}>
              <ThemedText style={styles.judgmentLabel}>気になる商品は候補に残す</ThemedText>
              <TouchableOpacity
                style={[styles.candidateBtn, !canSave && styles.candidateBtnDisabled]}
                onPress={handleSaveCandidate}
                disabled={!canSave}
                activeOpacity={0.75}>
                <ThemedText
                  style={[
                    styles.candidateBtnText,
                    !canSave && styles.candidateBtnTextDisabled,
                  ]}>
                  買い物候補に保存
                </ThemedText>
              </TouchableOpacity>

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
  candidateBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: C.brand,
  },
  candidateBtnTextDisabled: {
    color: C.textMuted,
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
