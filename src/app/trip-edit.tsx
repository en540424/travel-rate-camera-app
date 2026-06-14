import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { CurrencyCode } from '@/constants/currencies';
import { CURRENCIES, CURRENCY_CODES } from '@/constants/currencies';
import { useAllHistory } from '@/hooks/use-all-history';
import { useRates } from '@/hooks/use-rates';
import { useTrips } from '@/hooks/use-trips';
import { color, radius, shadow } from '@/theme/tokens';

export default function TripEditScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id != null ? parseInt(params.id, 10) : NaN;
  const { tripMap } = useAllHistory();
  const { activeTrip, editTrip, switchTrip, removeTrip } = useTrips();
  const { saveRate } = useRates();

  const trip = tripMap.get(id);

  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [rate, setRate] = useState('');
  const [budget, setBudget] = useState('');
  const [makeActive, setMakeActive] = useState(false);
  const initedRef = useRef<number | null>(null);
  const origCurrencyRef = useRef<CurrencyCode>('USD');

  useEffect(() => {
    if (trip && initedRef.current !== trip.id) {
      initedRef.current = trip.id;
      setName(trip.name);
      setCurrency(trip.base_currency);
      origCurrencyRef.current = trip.base_currency;
      setRate(trip.manual_rate > 0 ? String(trip.manual_rate) : '');
      setBudget(trip.budget_jpy > 0 ? String(trip.budget_jpy) : '');
      setMakeActive(trip.is_active === 1);
    }
  }, [trip]);

  if (!trip) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ThemedText style={styles.missingText}>旅行が見つかりません</ThemedText>
        <Pressable onPress={() => router.back()} style={styles.missingBtn}>
          <ThemedText style={styles.missingBtnText}>戻る</ThemedText>
        </Pressable>
      </View>
    );
  }

  const isJpy = currency === 'JPY';
  const canSave = name.trim() !== '' && (isJpy || parseFloat(rate) > 0);
  const isAlreadyActive = activeTrip?.id === trip.id;

  async function doSave() {
    const nm = name.trim();
    if (!nm) return;
    const cur = currency;
    const r = cur === 'JPY' ? 0 : parseFloat(rate) || 0;
    if (cur !== 'JPY' && r <= 0) return;
    const bud = parseFloat(budget) || 0;
    await editTrip(id, { name: nm, budget_jpy: bud, base_currency: cur, manual_rate: r });
    if (cur !== 'JPY' && r > 0) await saveRate(cur, r);
    if (makeActive && activeTrip?.id !== id) await switchTrip(id);
    router.back();
  }

  function handleSave() {
    if (!canSave) return;
    if (currency !== origCurrencyRef.current) {
      Alert.alert(
        '通貨を変更しますか？',
        '保存済みの記録は保存時のレートを維持します。以後の保存に新しい通貨・レートが使われます。',
        [
          { text: 'キャンセル', style: 'cancel' },
          { text: '変更する', onPress: () => { void doSave(); } },
        ],
      );
    } else {
      void doSave();
    }
  }

  function handleArchive() {
    Alert.alert(
      '旅行を終了しますか？',
      `「${trip!.name}」をアーカイブします。履歴データは削除されません。`,
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '終了する',
          style: 'destructive',
          onPress: async () => { await removeTrip(id); router.back(); },
        },
      ],
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.field}>
          <ThemedText style={styles.label}>旅行名</ThemedText>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="旅行名" placeholderTextColor={color.faint2} />
        </View>

        <View style={styles.field}>
          <ThemedText style={styles.label}>通貨</ThemedText>
          <View style={styles.chips}>
            {CURRENCY_CODES.map((code) => {
              const selected = currency === code;
              return (
                <Pressable key={code} style={[styles.chip, selected && styles.chipSelected]} onPress={() => setCurrency(code)}>
                  <ThemedText style={[styles.chipText, selected && styles.chipTextSelected]}>{CURRENCIES[code].flag} {code}</ThemedText>
                </Pressable>
              );
            })}
          </View>
        </View>

        {!isJpy && (
          <View style={styles.field}>
            <ThemedText style={styles.label}>為替レート（手入力）</ThemedText>
            <View style={styles.rateRow}>
              <ThemedText style={styles.ratePrefix}>1 {currency} =</ThemedText>
              <TextInput style={styles.rateInput} value={rate} onChangeText={setRate} placeholder="148.5" placeholderTextColor={color.faint2} keyboardType="decimal-pad" />
              <ThemedText style={styles.rateSuffix}>円</ThemedText>
            </View>
            <View style={styles.warnBanner}>
              <ThemedText style={styles.warnText}>
                ⚠ レートを変えると保存済みの記録に影響します。保存済みは保存時のレートを維持します。
              </ThemedText>
            </View>
          </View>
        )}

        <View style={styles.field}>
          <ThemedText style={styles.label}>買い物予算</ThemedText>
          <View style={styles.budgetRow}>
            <ThemedText style={styles.budgetPrefix}>¥</ThemedText>
            <TextInput style={styles.budgetInput} value={budget} onChangeText={setBudget} placeholder="60000" placeholderTextColor={color.faint2} keyboardType="number-pad" />
          </View>
        </View>

        {/* アクティブ切替 */}
        <Pressable
          onPress={() => !isAlreadyActive && setMakeActive((v) => !v)}
          style={styles.activeToggle}>
          <View style={styles.activeToggleText}>
            <ThemedText style={styles.activeToggleTitle}>アクティブな旅行にする</ThemedText>
            <ThemedText style={styles.activeToggleSub}>カメラ・履歴がこの旅行になります</ThemedText>
          </View>
          <View style={[styles.switch, (makeActive || isAlreadyActive) && styles.switchOn]}>
            <View style={[styles.knob, (makeActive || isAlreadyActive) && styles.knobOn]} />
          </View>
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          onPress={handleSave}
          disabled={!canSave}
          style={({ pressed }) => [styles.saveBtn, !canSave && styles.saveBtnDisabled, pressed && canSave && styles.pressed]}>
          <ThemedText style={[styles.saveBtnText, !canSave && styles.saveBtnTextDisabled]}>変更を保存</ThemedText>
        </Pressable>
        <Pressable onPress={handleArchive} style={styles.archiveBtn}>
          <ThemedText style={styles.archiveText}>🗄 旅行を終了してアーカイブ</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgScreen },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16 },
  missingText: { fontSize: 15, fontWeight: '600', color: color.muted },
  missingBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: radius.button, borderWidth: 1.5, borderColor: color.inputBorder },
  missingBtnText: { fontSize: 15, fontWeight: '700', color: color.body },
  scroll: { padding: 18, paddingBottom: 40, gap: 18, maxWidth: 480, width: '100%', alignSelf: 'center' },
  field: { gap: 8 },
  label: { fontSize: 13, fontWeight: '700', color: color.body },
  input: { borderWidth: 1.5, borderColor: color.inputBorder, borderRadius: radius.chip, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, color: color.text, backgroundColor: color.card },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.inputBorder, backgroundColor: color.card },
  chipSelected: { borderColor: color.primary, backgroundColor: color.primarySoft },
  chipText: { fontSize: 13, fontWeight: '600', color: color.body },
  chipTextSelected: { color: color.primaryDark, fontWeight: '700' },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderColor: color.inputBorder, borderRadius: radius.chip, paddingHorizontal: 14, backgroundColor: color.card },
  ratePrefix: { fontSize: 15, fontWeight: '600', color: color.body },
  rateInput: { flex: 1, fontSize: 18, fontWeight: '700', color: color.text, paddingVertical: 12, fontVariant: ['tabular-nums'] },
  rateSuffix: { fontSize: 15, fontWeight: '600', color: color.body },
  warnBanner: { backgroundColor: color.candidateSoft, borderRadius: radius.chip, padding: 12, borderWidth: 1, borderColor: color.candidateBorder },
  warnText: { fontSize: 12.5, fontWeight: '600', color: color.candidateText, lineHeight: 19 },
  budgetRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderColor: color.inputBorder, borderRadius: radius.chip, paddingHorizontal: 14, backgroundColor: color.card },
  budgetPrefix: { fontSize: 18, fontWeight: '700', color: color.body },
  budgetInput: { flex: 1, fontSize: 16, fontWeight: '600', color: color.text, paddingVertical: 13, fontVariant: ['tabular-nums'] },
  activeToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    backgroundColor: color.primarySoft2, borderRadius: radius.card, borderWidth: 1, borderColor: color.primaryBorder, padding: 14,
  },
  activeToggleText: { flex: 1, gap: 2 },
  activeToggleTitle: { fontSize: 14, fontWeight: '700', color: color.primaryDark },
  activeToggleSub: { fontSize: 12, fontWeight: '500', color: color.body },
  switch: { width: 48, height: 28, borderRadius: 14, backgroundColor: color.inputBorder, padding: 3, justifyContent: 'center' },
  switchOn: { backgroundColor: color.primary },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFFFFF', alignSelf: 'flex-start' },
  knobOn: { alignSelf: 'flex-end' },
  footer: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 28, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line2, backgroundColor: color.card, gap: 8 },
  saveBtn: { height: 52, borderRadius: radius.button, backgroundColor: color.primary, alignItems: 'center', justifyContent: 'center', ...shadow.cta },
  saveBtnDisabled: { backgroundColor: '#EEF1F0', shadowOpacity: 0, elevation: 0 },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  saveBtnTextDisabled: { color: '#A6AEAB' },
  archiveBtn: { alignItems: 'center', paddingVertical: 6 },
  archiveText: { fontSize: 13.5, fontWeight: '600', color: color.muted },
  pressed: { opacity: 0.85 },
});
