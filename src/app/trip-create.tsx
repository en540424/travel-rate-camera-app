import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { CurrencyCode } from '@/constants/currencies';
import { CURRENCIES, CURRENCY_CODES } from '@/constants/currencies';
import { useTrips } from '@/hooks/use-trips';
import { useSettingsStore } from '@/stores/settings-store';
import { color, radius, shadow } from '@/theme/tokens';
import { formatJpy } from '@/utils/format';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function TripCreateScreen() {
  const { createTrip, editTrip } = useTrips();
  const selectedCurrency = useSettingsStore((s) => s.selectedCurrency);

  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>(selectedCurrency);
  const [rate, setRate] = useState('');
  const [budget, setBudget] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const isJpy = currency === 'JPY';
  const rateNum = parseFloat(rate);
  const canCreate = name.trim() !== '' && (isJpy || rateNum > 0);

  const previewJpy = !isJpy && rateNum > 0 ? Math.round(10 * rateNum) : null;

  async function handleCreate() {
    const nm = name.trim();
    if (!nm) return;
    const cur = currency;
    const r = cur === 'JPY' ? 0 : parseFloat(rate) || 0;
    if (cur !== 'JPY' && r <= 0) return;
    const bud = parseFloat(budget) || 0;

    // 保存失敗時に何も表示されない箇所があったため try/catch + Alert を追加（P0-08）。
    // 保存ロジック本体（createTrip/editTrip）は変更しない。
    try {
      const trip = await createTrip(nm, bud, cur, r);

      // 開始日 / 終了日 は既存 editTrip で設定（任意・スキーマ変更なし）
      const s = startDate.trim();
      const e = endDate.trim();
      const dateFields: { started_at?: string; ended_at?: string } = {};
      if (DATE_RE.test(s)) dateFields.started_at = s;
      if (DATE_RE.test(e)) dateFields.ended_at = e;
      if (Object.keys(dateFields).length > 0) {
        await editTrip(trip.id, dateFields);
      }

      router.replace('/trip-created');
    } catch (err) {
      console.warn('[trip-create save error]', err);
      Alert.alert(
        '保存できませんでした',
        '旅行の作成中にエラーが発生しました。もう一度お試しください。',
        [{ text: 'OK' }],
      );
    }
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* 旅行名 */}
        <View style={styles.field}>
          <ThemedText style={styles.label}>旅行名</ThemedText>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="旅行名を入力（例：ハワイ旅行）"
            placeholderTextColor={color.faint2}
          />
        </View>

        {/* 通貨 */}
        <View style={styles.field}>
          <ThemedText style={styles.label}>通貨</ThemedText>
          <View style={styles.chips}>
            {CURRENCY_CODES.map((code) => {
              const c = CURRENCIES[code];
              const selected = currency === code;
              return (
                <Pressable
                  key={code}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => setCurrency(code)}>
                  <ThemedText style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {c.flag} {code}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* 為替レート＋換算プレビュー */}
        {!isJpy && (
          <View style={styles.field}>
            <ThemedText style={styles.label}>為替レート（手入力）</ThemedText>
            <View style={styles.rateRow}>
              <ThemedText style={styles.ratePrefix}>1 {currency} =</ThemedText>
              <TextInput
                style={styles.rateInput}
                value={rate}
                onChangeText={setRate}
                placeholder="148.5"
                placeholderTextColor={color.faint2}
                keyboardType="decimal-pad"
              />
              <ThemedText style={styles.rateSuffix}>円</ThemedText>
            </View>
            <View style={styles.preview}>
              <ThemedText style={styles.previewLabel}>換算プレビュー</ThemedText>
              <ThemedText style={styles.previewValue}>
                {previewJpy != null
                  ? `${CURRENCIES[currency].symbol}10 = ${formatJpy(previewJpy)}`
                  : 'レートを入力してください'}
              </ThemedText>
            </View>
          </View>
        )}

        {/* 買い物予算 */}
        <View style={styles.field}>
          <ThemedText style={styles.label}>買い物予算</ThemedText>
          <View style={styles.budgetRow}>
            <ThemedText style={styles.budgetPrefix}>¥</ThemedText>
            <TextInput
              style={styles.budgetInput}
              value={budget}
              onChangeText={setBudget}
              placeholder="60000"
              placeholderTextColor={color.faint2}
              keyboardType="number-pad"
            />
          </View>
          <ThemedText style={styles.hint}>予算は0以上で入力できます（0でも作成できます）</ThemedText>
        </View>

        {/* 期間（任意） */}
        <View style={styles.field}>
          <ThemedText style={styles.label}>期間（任意）</ThemedText>
          <View style={styles.dateRow}>
            <TextInput
              style={[styles.input, styles.dateInput]}
              value={startDate}
              onChangeText={setStartDate}
              placeholder="開始日 2026-06-20"
              placeholderTextColor={color.faint2}
              autoCapitalize="none"
            />
            <TextInput
              style={[styles.input, styles.dateInput]}
              value={endDate}
              onChangeText={setEndDate}
              placeholder="終了日 2026-06-25"
              placeholderTextColor={color.faint2}
              autoCapitalize="none"
            />
          </View>
        </View>
      </ScrollView>

      {/* 固定フッター */}
      <View style={styles.footer}>
        <Pressable
          onPress={handleCreate}
          disabled={!canCreate}
          style={({ pressed }) => [
            styles.createBtn,
            !canCreate && styles.createBtnDisabled,
            pressed && canCreate && styles.pressed,
          ]}>
          <ThemedText style={[styles.createBtnText, !canCreate && styles.createBtnTextDisabled]}>
            旅行を作成
          </ThemedText>
        </Pressable>
        {!canCreate && <ThemedText style={styles.footerHint}>未入力の項目があります</ThemedText>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgScreen },
  scroll: {
    padding: 18,
    paddingBottom: 40,
    gap: 18,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  field: { gap: 8 },
  label: { fontSize: 13, fontWeight: '700', color: color.body },
  input: {
    borderWidth: 1.5,
    borderColor: color.inputBorder,
    borderRadius: radius.chip,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: color.text,
    backgroundColor: color.card,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: color.inputBorder,
    backgroundColor: color.card,
  },
  chipSelected: { borderColor: color.primary, backgroundColor: color.primarySoft },
  chipText: { fontSize: 13, fontWeight: '600', color: color.body },
  chipTextSelected: { color: color.primaryDark, fontWeight: '700' },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: color.inputBorder,
    borderRadius: radius.chip,
    paddingHorizontal: 14,
    backgroundColor: color.card,
  },
  ratePrefix: { fontSize: 15, fontWeight: '600', color: color.body },
  rateInput: { flex: 1, fontSize: 18, fontWeight: '700', color: color.text, paddingVertical: 12, fontVariant: ['tabular-nums'] },
  rateSuffix: { fontSize: 15, fontWeight: '600', color: color.body },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: color.primarySoft,
    borderRadius: radius.chip,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  previewLabel: { fontSize: 12.5, fontWeight: '700', color: color.primaryDark },
  previewValue: { fontSize: 14, lineHeight: 19, fontWeight: '700', color: color.primaryDark, fontVariant: ['tabular-nums'] },
  budgetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: color.inputBorder,
    borderRadius: radius.chip,
    paddingHorizontal: 14,
    backgroundColor: color.card,
  },
  budgetPrefix: { fontSize: 18, fontWeight: '700', color: color.body },
  budgetInput: { flex: 1, fontSize: 16, fontWeight: '600', color: color.text, paddingVertical: 13, fontVariant: ['tabular-nums'] },
  hint: { fontSize: 12, fontWeight: '500', color: color.muted },
  dateRow: { flexDirection: 'row', gap: 10 },
  dateInput: { flex: 1, fontSize: 13 },
  footer: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line2,
    backgroundColor: color.card,
    gap: 6,
  },
  createBtn: {
    height: 52,
    borderRadius: radius.button,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.cta,
  },
  createBtnDisabled: { backgroundColor: '#EEF1F0', shadowOpacity: 0, elevation: 0 },
  createBtnText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  createBtnTextDisabled: { color: '#A6AEAB' },
  footerHint: { fontSize: 12, fontWeight: '500', color: color.muted, textAlign: 'center' },
  pressed: { opacity: 0.85 },
});
