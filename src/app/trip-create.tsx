import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { CurrencyFlagImage } from '@/components/domain';
import type { CurrencyCode } from '@/constants/currencies';
import { CURRENCIES, CURRENCY_CODES } from '@/constants/currencies';
import { useTrips } from '@/hooks/use-trips';
import { useSettingsStore } from '@/stores/settings-store';
import { color, radius, shadow } from '@/theme/tokens';
import { formatJpy } from '@/utils/format';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD（ローカル日付。UTC変換によるズレを避けるため手組みする） */
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function TripCreateScreen() {
  const { createTrip, editTrip } = useTrips();
  const selectedCurrency = useSettingsStore((s) => s.selectedCurrency);

  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>(selectedCurrency);
  const [rate, setRate] = useState('');
  const [budget, setBudget] = useState('');
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState('');

  const isJpy = currency === 'JPY';
  const rateNum = parseFloat(rate);
  const canCreate = name.trim() !== '' && (isJpy || rateNum > 0);

  const previewJpy = !isJpy && rateNum > 0 ? Math.round(10 * rateNum) : null;

  /** 期間の入力チェック。問題があればAlertを出してnullを返す（保存はしない） */
  function validateDates(): { started_at: string | null; ended_at: string | null } | null {
    const s = startDate.trim();
    const e = endDate.trim();
    if (s !== '' && !DATE_RE.test(s)) {
      Alert.alert('日付を確認してください', '開始日はYYYY-MM-DD形式で入力してください（例：2026-06-20）。', [{ text: 'OK' }]);
      return null;
    }
    if (e !== '' && !DATE_RE.test(e)) {
      Alert.alert('日付を確認してください', '終了日はYYYY-MM-DD形式で入力してください（例：2026-06-25）。', [{ text: 'OK' }]);
      return null;
    }
    if (e !== '' && s === '') {
      Alert.alert('開始日を確認してください', '終了日を設定する場合は、開始日も入力してください。', [{ text: 'OK' }]);
      return null;
    }
    if (s !== '' && e !== '' && e < s) {
      Alert.alert('終了日を確認してください', '終了日は開始日以降にしてください。', [{ text: 'OK' }]);
      return null;
    }
    return { started_at: s === '' ? null : s, ended_at: e === '' ? null : e };
  }

  async function handleCreate() {
    const nm = name.trim();
    if (!nm) return;
    const cur = currency;
    const r = cur === 'JPY' ? 0 : parseFloat(rate) || 0;
    if (cur !== 'JPY' && r <= 0) return;
    const bud = parseFloat(budget) || 0;

    const dates = validateDates();
    if (dates == null) return;

    // 保存失敗時に何も表示されない箇所があったため try/catch + Alert を追加（P0-08）。
    // 保存ロジック本体（createTrip/editTrip）は変更しない。
    try {
      const trip = await createTrip(nm, bud, cur, r);

      // 開始日 / 終了日 は既存 editTrip で設定（任意・スキーマ変更なし）
      if (dates.started_at != null || dates.ended_at != null) {
        await editTrip(trip.id, { started_at: dates.started_at, ended_at: dates.ended_at });
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
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
              const selected = currency === code;
              return (
                <Pressable
                  key={code}
                  style={[styles.chip, styles.chipRow, selected && styles.chipSelected]}
                  onPress={() => setCurrency(code)}>
                  <CurrencyFlagImage currency={code} size={14} />
                  <ThemedText style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {code}
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
          {endDate.trim() !== '' && (
            <Pressable onPress={() => setEndDate('')} style={styles.clearDateBtn}>
              <ThemedText style={styles.clearDateText}>終了日を設定しない（クリア）</ThemedText>
            </Pressable>
          )}
          <ThemedText style={styles.hint}>終了日は空欄のままでも作成できます。設定する場合はYYYY-MM-DD形式で入力してください。</ThemedText>
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
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgScreen },
  flex: { flex: 1 },
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
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
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
  clearDateBtn: { alignSelf: 'flex-start', paddingVertical: 4 },
  clearDateText: { fontSize: 12.5, fontWeight: '600', color: color.primaryDark },
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
