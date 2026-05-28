import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import type { CurrencyCode } from '@/constants/currencies';
import { CURRENCIES, CURRENCY_CODES } from '@/constants/currencies';
import { Spacing } from '@/constants/theme';
import { useRates } from '@/hooks/use-rates';
import { useTrips } from '@/hooks/use-trips';
import { useTheme } from '@/hooks/use-theme';

export default function RateSetupScreen() {
  const { rates, saveRate } = useRates();
  const { activeTrip, editTrip } = useTrips();
  const theme = useTheme();

  // 編集中の値を文字列で保持（各通貨ごと）
  const [inputs, setInputs] = useState<Partial<Record<CurrencyCode, string>>>(
    Object.fromEntries(
      CURRENCY_CODES.map((c) => [c, rates[c] > 0 ? String(rates[c]) : '']),
    ),
  );

  async function handleSave() {
    for (const code of CURRENCY_CODES) {
      const raw = inputs[code];
      if (!raw) continue;
      const n = parseFloat(raw);
      if (isFinite(n) && n > 0) {
        await saveRate(code, n);
        if (activeTrip && code === activeTrip.base_currency) {
          await editTrip(activeTrip.id, { manual_rate: n });
        }
      }
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  }

  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
            各通貨の 1単位あたりのJPYレートを入力してください。
          </ThemedText>

          {CURRENCY_CODES.map((code) => {
            const c = CURRENCIES[code];
            return (
              <ThemedView key={code} type="backgroundElement" style={styles.row}>
                <View style={styles.rowLeft}>
                  <ThemedText style={styles.flag}>{c.flag}</ThemedText>
                  <View>
                    <ThemedText type="smallBold">{c.code}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{c.nameJa}</ThemedText>
                  </View>
                </View>
                <View style={styles.rowRight}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.jpyLabel}>
                    ¥
                  </ThemedText>
                  <TextInput
                    style={[
                      styles.input,
                      { color: theme.text, borderColor: theme.backgroundSelected },
                    ]}
                    value={inputs[code] ?? ''}
                    onChangeText={(v) =>
                      setInputs((prev) => ({ ...prev, [code]: v }))
                    }
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={theme.textSecondary}
                    returnKeyType="done"
                  />
                </View>
              </ThemedView>
            );
          })}

          <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
            <ThemedText type="smallBold" style={styles.saveButtonText}>
              保存して戻る
            </ThemedText>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  scroll: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  hint: { marginBottom: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.three,
    borderRadius: Spacing.two,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  flag: { fontSize: 28 },
  jpyLabel: { fontSize: 16 },
  input: {
    width: 100,
    borderWidth: 1,
    borderRadius: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    fontSize: 16,
    textAlign: 'right',
  },
  saveButton: {
    marginTop: Spacing.three,
    backgroundColor: '#208AEF',
    borderRadius: Spacing.two,
    padding: Spacing.three,
    alignItems: 'center',
  },
  saveButtonText: { color: '#ffffff', fontSize: 16 },
});
