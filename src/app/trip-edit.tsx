import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { CurrencyFlagImage } from '@/components/domain';
import type { CurrencyCode } from '@/constants/currencies';
import { CURRENCY_CODES } from '@/constants/currencies';
import { useAllHistory } from '@/hooks/use-all-history';
import { useRates } from '@/hooks/use-rates';
import { useTrips } from '@/hooks/use-trips';
import { color, radius, shadow } from '@/theme/tokens';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function TripEditScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id != null ? parseInt(params.id, 10) : NaN;
  const { tripMap } = useAllHistory();
  const { activeTrip, editTrip, switchTrip, removeTrip, restoreTrip } = useTrips();
  const { saveRate } = useRates();

  const trip = tripMap.get(id);

  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [rate, setRate] = useState('');
  const [budget, setBudget] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
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
      setStartDate(trip.started_at ?? '');
      setEndDate(trip.ended_at ?? '');
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

  async function doSave() {
    const nm = name.trim();
    if (!nm) return;
    const cur = currency;
    const r = cur === 'JPY' ? 0 : parseFloat(rate) || 0;
    if (cur !== 'JPY' && r <= 0) return;
    const bud = parseFloat(budget) || 0;
    const dates = validateDates();
    if (dates == null) return;
    // 保存失敗時に何も表示されない箇所があったため try/catch + Alert を追加（P0-08）。
    // 保存ロジック本体（editTrip/saveRate/switchTrip）は変更しない。
    try {
      await editTrip(id, {
        name: nm,
        budget_jpy: bud,
        base_currency: cur,
        manual_rate: r,
        started_at: dates.started_at,
        ended_at: dates.ended_at,
      });
      if (cur !== 'JPY' && r > 0) await saveRate(cur, r);
      if (makeActive && activeTrip?.id !== id) await switchTrip(id);
      router.back();
    } catch (err) {
      console.warn('[trip-edit save error]', err);
      Alert.alert(
        '保存できませんでした',
        '旅行の更新中にエラーが発生しました。もう一度お試しください。',
        [{ text: 'OK' }],
      );
    }
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
          onPress: async () => {
            try {
              await removeTrip(id);
              router.back();
            } catch (err) {
              console.warn('[trip-edit archive error]', err);
              Alert.alert('旅行をアーカイブできませんでした', 'もう一度お試しください。', [{ text: 'OK' }]);
            }
          },
        },
      ],
    );
  }

  function handleRestore() {
    Alert.alert(
      '旅行を復元しますか？',
      'この旅行をアーカイブから戻します。保存済みの履歴データはそのまま残ります。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '復元する',
          onPress: async () => {
            try {
              await restoreTrip(id);
              router.back();
            } catch (err) {
              console.warn('[trip-edit restore error]', err);
              Alert.alert('復元できませんでした', 'もう一度お試しください。', [{ text: 'OK' }]);
            }
          },
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
                <Pressable key={code} style={[styles.chip, styles.chipRow, selected && styles.chipSelected]} onPress={() => setCurrency(code)}>
                  <CurrencyFlagImage currency={code} size={14} />
                  <ThemedText style={[styles.chipText, selected && styles.chipTextSelected]}>{code}</ThemedText>
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
          <ThemedText style={styles.dateHint}>空欄のままでも保存できます。設定する場合はYYYY-MM-DD形式で入力してください。</ThemedText>
        </View>

        {/* アクティブ切替（アーカイブ済みの旅行はis_active整合性のため対象外） */}
        {trip.archived_at == null && (
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
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          onPress={handleSave}
          disabled={!canSave}
          style={({ pressed }) => [styles.saveBtn, !canSave && styles.saveBtnDisabled, pressed && canSave && styles.pressed]}>
          <ThemedText style={[styles.saveBtnText, !canSave && styles.saveBtnTextDisabled]}>変更を保存</ThemedText>
        </Pressable>
        {trip.archived_at == null ? (
          <Pressable onPress={handleArchive} style={styles.archiveBtn}>
            <ThemedText style={styles.archiveText}>🗄 旅行を終了してアーカイブ</ThemedText>
          </Pressable>
        ) : (
          <Pressable onPress={handleRestore} style={styles.archiveBtn}>
            <ThemedText style={styles.archiveText}>↩ アーカイブを解除して復元</ThemedText>
          </Pressable>
        )}
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
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  chipSelected: { borderColor: color.primary, backgroundColor: color.primarySoft },
  chipText: { fontSize: 13, fontWeight: '600', color: color.body },
  chipTextSelected: { color: color.primaryDark, fontWeight: '700' },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderColor: color.inputBorder, borderRadius: radius.chip, paddingHorizontal: 14, backgroundColor: color.card },
  ratePrefix: { fontSize: 15, fontWeight: '600', color: color.body },
  rateInput: { flex: 1, fontSize: 18, lineHeight: 24, fontWeight: '700', color: color.text, paddingVertical: 12, fontVariant: ['tabular-nums'] },
  rateSuffix: { fontSize: 15, fontWeight: '600', color: color.body },
  warnBanner: { backgroundColor: color.candidateSoft, borderRadius: radius.chip, padding: 12, borderWidth: 1, borderColor: color.candidateBorder },
  warnText: { fontSize: 12.5, fontWeight: '600', color: color.candidateText, lineHeight: 19 },
  budgetRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderColor: color.inputBorder, borderRadius: radius.chip, paddingHorizontal: 14, backgroundColor: color.card },
  budgetPrefix: { fontSize: 18, fontWeight: '700', color: color.body },
  budgetInput: { flex: 1, fontSize: 16, lineHeight: 22, fontWeight: '600', color: color.text, paddingVertical: 13, fontVariant: ['tabular-nums'] },
  dateRow: { flexDirection: 'row', gap: 10 },
  dateInput: { flex: 1, fontSize: 13 },
  clearDateBtn: { alignSelf: 'flex-start', paddingVertical: 4 },
  clearDateText: { fontSize: 12.5, fontWeight: '600', color: color.primaryDark },
  dateHint: { fontSize: 12, fontWeight: '500', color: color.muted },
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
