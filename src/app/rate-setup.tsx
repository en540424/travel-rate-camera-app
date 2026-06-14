import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { CURRENCIES } from '@/constants/currencies';
import { useRates } from '@/hooks/use-rates';
import { useTrips } from '@/hooks/use-trips';
import { color, radius, shadow } from '@/theme/tokens';
import { formatJpy } from '@/utils/format';

export default function RateSetupScreen() {
  const { saveRate } = useRates();
  const { activeTrip, editTrip } = useTrips();

  const currency = activeTrip?.base_currency ?? 'USD';
  const isJpy = currency === 'JPY';
  const c = CURRENCIES[currency];

  const [rate, setRate] = useState(
    activeTrip && activeTrip.manual_rate > 0 ? String(activeTrip.manual_rate) : '',
  );

  const rateNum = parseFloat(rate);
  const validRate = isFinite(rateNum) && rateNum > 0;
  const examples = c.decimals > 0 ? [4.99, 24.0] : [1000, 5000];

  async function handleSave() {
    if (!activeTrip || isJpy || !validRate) {
      router.back();
      return;
    }
    await saveRate(currency, rateNum);
    await editTrip(activeTrip.id, { manual_rate: rateNum });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  }

  if (!activeTrip) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ThemedText style={styles.missingText}>旅行が選択されていません</ThemedText>
        <ThemedText style={styles.missingSub}>先に旅行を作成・選択してください。</ThemedText>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* 黒ヒーロー：現在のレート */}
          <View style={styles.hero}>
            <View style={styles.heroTop}>
              <ThemedText style={styles.heroTrip} numberOfLines={1}>{activeTrip.name}</ThemedText>
              <ThemedText style={styles.heroDir}>{isJpy ? '🇯🇵 国内' : `${currency} → JPY`}</ThemedText>
            </View>
            <ThemedText style={styles.heroLabel}>現在のレート</ThemedText>
            <ThemedText style={styles.heroRate}>
              {isJpy ? '円のみ（換算なし）' : activeTrip.manual_rate > 0 ? `1 ${currency} = ¥${activeTrip.manual_rate}` : 'レート未設定'}
            </ThemedText>
          </View>

          {isJpy ? (
            <ThemedText style={styles.jpyNote}>
              この旅行は日本円（国内モード）のため、為替レートの設定は不要です。
            </ThemedText>
          ) : (
            <>
              {/* レート入力 */}
              <View style={styles.field}>
                <ThemedText style={styles.label}>レートを変更</ThemedText>
                <View style={styles.rateRow}>
                  <ThemedText style={styles.ratePrefix}>1 {currency} =</ThemedText>
                  <TextInput
                    style={styles.rateInput}
                    value={rate}
                    onChangeText={setRate}
                    keyboardType="decimal-pad"
                    placeholder="158.00"
                    placeholderTextColor={color.faint2}
                    returnKeyType="done"
                  />
                  <ThemedText style={styles.rateSuffix}>円</ThemedText>
                </View>
              </View>

              {/* 換算プレビュー */}
              <View style={styles.preview}>
                <ThemedText style={styles.previewTitle}>換算プレビュー</ThemedText>
                {examples.map((amt) => (
                  <View key={amt} style={styles.previewRow}>
                    <ThemedText style={styles.previewFrom}>
                      {c.symbol}{c.decimals > 0 ? amt.toFixed(2) : amt.toLocaleString()}
                    </ThemedText>
                    <ThemedText style={styles.previewArrow}>→</ThemedText>
                    <ThemedText style={styles.previewTo}>
                      {validRate ? `約 ${formatJpy(Math.round(amt * rateNum))}` : '—'}
                    </ThemedText>
                  </View>
                ))}
              </View>

              <ThemedText style={styles.note}>ⓘ 保存するとメイン画面・履歴の円換算に反映されます</ThemedText>
            </>
          )}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            onPress={handleSave}
            disabled={!isJpy && !validRate}
            style={({ pressed }) => [
              styles.saveBtn,
              !isJpy && !validRate && styles.saveBtnDisabled,
              pressed && (isJpy || validRate) && styles.pressed,
            ]}>
            <ThemedText style={[styles.saveBtnText, !isJpy && !validRate && styles.saveBtnTextDisabled]}>
              {isJpy ? '戻る' : 'レートを保存'}
            </ThemedText>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgScreen },
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  missingText: { fontSize: 16, fontWeight: '700', color: color.text },
  missingSub: { fontSize: 13, fontWeight: '500', color: color.muted },
  scroll: { padding: 18, paddingBottom: 40, gap: 18, maxWidth: 480, width: '100%', alignSelf: 'center' },
  hero: { backgroundColor: color.dark, borderRadius: radius.cardLg, padding: 18, gap: 6, ...shadow.raised },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4 },
  heroTrip: { fontSize: 15, fontWeight: '700', color: '#FFFFFF', flexShrink: 1 },
  heroDir: { fontSize: 12.5, fontWeight: '700', color: color.primaryAccent },
  heroLabel: { fontSize: 12, fontWeight: '700', color: color.primaryAccent },
  heroRate: { fontSize: 26, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  jpyNote: { fontSize: 13.5, fontWeight: '500', color: color.body, lineHeight: 21, paddingHorizontal: 4 },
  field: { gap: 8 },
  label: { fontSize: 13, fontWeight: '700', color: color.body },
  rateRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1.5, borderColor: color.primary, borderRadius: radius.chip,
    paddingHorizontal: 14, backgroundColor: color.card,
  },
  ratePrefix: { fontSize: 15, fontWeight: '600', color: color.body },
  rateInput: { flex: 1, fontSize: 22, fontWeight: '700', color: color.text, paddingVertical: 12, fontVariant: ['tabular-nums'] },
  rateSuffix: { fontSize: 15, fontWeight: '600', color: color.body },
  preview: {
    backgroundColor: color.card, borderRadius: radius.card, borderWidth: 1, borderColor: color.line,
    padding: 14, gap: 10, ...shadow.card,
  },
  previewTitle: { fontSize: 12, fontWeight: '700', color: color.muted },
  previewRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  previewFrom: { fontSize: 14, fontWeight: '600', color: color.body, fontVariant: ['tabular-nums'] },
  previewArrow: { fontSize: 14, color: color.faint2 },
  previewTo: { fontSize: 15, fontWeight: '700', color: color.text, fontVariant: ['tabular-nums'] },
  note: { fontSize: 12, fontWeight: '500', color: color.primary, paddingHorizontal: 4 },
  footer: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 28, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line2, backgroundColor: color.card },
  saveBtn: { height: 52, borderRadius: radius.button, backgroundColor: color.primary, alignItems: 'center', justifyContent: 'center', ...shadow.cta },
  saveBtnDisabled: { backgroundColor: '#EEF1F0', shadowOpacity: 0, elevation: 0 },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  saveBtnTextDisabled: { color: '#A6AEAB' },
  pressed: { opacity: 0.85 },
});
