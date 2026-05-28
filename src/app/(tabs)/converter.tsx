// 手入力換算画面（補助機能）
// カメラで読み取れない場合や、正確な金額を計算したい場合に使う。
import { router } from 'expo-router';
import { Platform, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import type { CurrencyCode } from '@/constants/currencies';
import { CURRENCIES, CURRENCY_CODES } from '@/constants/currencies';
import { Spacing } from '@/constants/theme';
import { useHistory } from '@/hooks/use-history';
import { useRates } from '@/hooks/use-rates';
import { useTrips } from '@/hooks/use-trips';
import { useSettingsStore } from '@/stores/settings-store';
import { useTheme } from '@/hooks/use-theme';
import { convert } from '@/utils/currency';
import { formatJpy, formatRate } from '@/utils/format';

const CARD_MAX_WIDTH = 430;

export default function ConverterScreen() {
  const [amountText, setAmountText] = useState('');
  const { rates } = useRates();
  const theme = useTheme();
  const { selectedCurrency, setSelectedCurrency } = useSettingsStore();
  const { addEntry } = useHistory();
  const { activeTrip } = useTrips();

  const rate = rates[selectedCurrency] ?? 0;
  const amount = parseFloat(amountText) || 0;
  const jpyAmount = convert(amount, rate);
  const hasRate = rate > 0;
  const hasResult = !!activeTrip && hasRate && amount > 0;

  async function handleSave() {
    if (!hasResult) return;
    await addEntry(selectedCurrency, amount, jpyAmount, rate);
    if (Platform.OS !== 'web') {
      const { default: Haptics } = await import('expo-haptics');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setAmountText('');
  }

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled">
          <View style={styles.card}>

            {/* タイトル */}
            <View style={styles.titleRow}>
              <ThemedText style={styles.title}>手入力で換算</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                カメラが使えない場合など
              </ThemedText>
            </View>

            {/* 通貨セレクター */}
            <ThemedText type="small" themeColor="textSecondary">通貨を選択</ThemedText>
            <View style={styles.chips}>
              {CURRENCY_CODES.map((code) => {
                const c = CURRENCIES[code as CurrencyCode];
                const selected = selectedCurrency === code;
                return (
                  <TouchableOpacity
                    key={code}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => setSelectedCurrency(code as CurrencyCode)}>
                    <ThemedText
                      type="small"
                      style={selected ? styles.chipTextSelected : undefined}>
                      {c.flag} {code}
                    </ThemedText>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* レート行 */}
            <TouchableOpacity
              style={[styles.rateRow, { borderColor: theme.backgroundElement }]}
              onPress={() => router.push('/rate-setup')}>
              <ThemedText type="small">
                {hasRate
                  ? formatRate(rate, selectedCurrency)
                  : `${selectedCurrency} のレートが未設定`}
              </ThemedText>
              <ThemedText type="small" style={styles.editLink}>
                {hasRate ? '変更 →' : '設定する →'}
              </ThemedText>
            </TouchableOpacity>

            {/* 金額入力 */}
            <ThemedText type="small" themeColor="textSecondary">金額を入力</ThemedText>
            <View style={[styles.inputRow, { borderColor: theme.backgroundSelected }]}>
              <TextInput
                style={[
                  styles.amountInput,
                  { color: theme.text },
                  Platform.OS === 'web' && ({ outlineStyle: 'none' } as object),
                ]}
                value={amountText}
                onChangeText={setAmountText}
                placeholder="0"
                placeholderTextColor={theme.textSecondary}
                keyboardType="decimal-pad"
                inputMode="decimal"
                returnKeyType="done"
                selectTextOnFocus
              />
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.unit}>
                {CURRENCIES[selectedCurrency].symbol} {selectedCurrency}
              </ThemedText>
            </View>

            {/* 換算結果 */}
            <ThemedView type="backgroundElement" style={styles.resultBox}>
              {hasResult ? (
                <>
                  <ThemedText type="small" themeColor="textSecondary">
                    日本円換算
                  </ThemedText>
                  <ThemedText style={styles.jpyAmount}>
                    {formatJpy(jpyAmount)}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {formatRate(rate, selectedCurrency)}
                  </ThemedText>
                </>
              ) : (
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  style={styles.resultPlaceholder}>
                  {!hasRate ? 'レートを設定してください' : '金額を入力してください'}
                </ThemedText>
              )}
            </ThemedView>

            {/* 保存ボタン */}
            <TouchableOpacity
              style={[styles.saveBtn, !hasResult && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={!hasResult}>
              <ThemedText style={styles.saveBtnText}>💾 履歴に保存する</ThemedText>
            </TouchableOpacity>

          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safe: { flex: 1 },
  scroll: {
    flexGrow: 1,
    alignItems: 'center',
    paddingVertical: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.six,
  },
  card: { width: '100%', maxWidth: CARD_MAX_WIDTH, gap: Spacing.two },
  titleRow: { gap: 2, marginBottom: Spacing.one },
  title: { fontSize: 20, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  chip: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#cccccc55',
  },
  chipSelected: { borderColor: '#208AEF', backgroundColor: '#208AEF22' },
  chipTextSelected: { color: '#208AEF', fontWeight: '700' },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: 8,
    borderWidth: 1,
  },
  editLink: { color: '#208AEF' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    overflow: 'hidden',
  },
  amountInput: {
    flex: 1,
    fontSize: 36,
    fontWeight: '600',
    paddingVertical: Spacing.three,
  },
  unit: { fontSize: 15, paddingLeft: Spacing.one },
  resultBox: {
    borderRadius: Spacing.three,
    paddingVertical: Spacing.four,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    minHeight: 110,
    justifyContent: 'center',
    gap: Spacing.one,
  },
  jpyAmount: { fontSize: 48, fontWeight: '700', lineHeight: 56 },
  resultPlaceholder: { textAlign: 'center' },
  saveBtn: {
    backgroundColor: '#208AEF',
    borderRadius: Spacing.two,
    padding: Spacing.three,
    alignItems: 'center',
    marginTop: Spacing.one,
  },
  saveBtnDisabled: { opacity: 0.35 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
