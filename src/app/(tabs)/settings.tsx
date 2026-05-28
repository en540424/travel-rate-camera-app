import { router } from 'expo-router';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import type { CurrencyCode } from '@/constants/currencies';
import { CURRENCIES, CURRENCY_CODES } from '@/constants/currencies';
import { Spacing } from '@/constants/theme';
import { useSettingsStore } from '@/stores/settings-store';

export default function SettingsScreen() {
  const { selectedCurrency, setSelectedCurrency, isPro } = useSettingsStore();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ThemedText type="subtitle" style={styles.title}>設定</ThemedText>

        {/* Pro バナー */}
        {!isPro && (
          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="smallBold" style={styles.sectionTitle}>旅レートカメラ Pro</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.proDesc}>
              • 為替レート自動取得{'\n'}
              • 履歴保存無制限{'\n'}
              • 複数旅行管理{'\n'}
              • ライブ円換算ウィジェット
            </ThemedText>
            <TouchableOpacity style={styles.proButton} disabled>
              <ThemedText type="smallBold" style={styles.proButtonText}>
                Pro版にアップグレード（準備中）
              </ThemedText>
            </TouchableOpacity>
          </ThemedView>
        )}

        {/* デフォルト通貨 */}
        <ThemedView type="backgroundElement" style={styles.section}>
          <ThemedText type="smallBold" style={styles.sectionTitle}>デフォルト通貨</ThemedText>
          <View style={styles.currencyGrid}>
            {CURRENCY_CODES.map((code) => {
              const c = CURRENCIES[code as CurrencyCode];
              const selected = selectedCurrency === code;
              return (
                <TouchableOpacity
                  key={code}
                  style={[styles.currencyChip, selected && styles.currencyChipSelected]}
                  onPress={() => setSelectedCurrency(code as CurrencyCode)}>
                  <ThemedText type="default">{c.flag}</ThemedText>
                  <ThemedText
                    type="small"
                    style={selected ? styles.chipTextSelected : undefined}>
                    {code}
                  </ThemedText>
                </TouchableOpacity>
              );
            })}
          </View>
        </ThemedView>

        {/* レート設定リンク */}
        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => router.push('/rate-setup')}>
          <ThemedText type="default">為替レートを設定</ThemedText>
          <ThemedText type="default" themeColor="textSecondary"> →</ThemedText>
        </TouchableOpacity>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three, gap: Spacing.three },
  title: { paddingTop: Spacing.three },
  section: {
    borderRadius: Spacing.two,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  sectionTitle: { marginBottom: Spacing.one },
  proDesc: { lineHeight: 22 },
  proButton: {
    backgroundColor: '#208AEF',
    borderRadius: Spacing.two,
    padding: Spacing.two,
    alignItems: 'center',
    opacity: 0.5,
  },
  proButtonText: { color: '#ffffff' },
  currencyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  currencyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: '#cccccc44',
  },
  currencyChipSelected: {
    borderColor: '#208AEF',
    backgroundColor: '#208AEF22',
  },
  chipTextSelected: { color: '#208AEF', fontWeight: '700' },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.three,
    borderBottomWidth: 1,
    borderBottomColor: '#cccccc44',
  },
});
