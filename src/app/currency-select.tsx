import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { CurrencyFlagImage } from '@/components/domain';
import type { CurrencyCode } from '@/constants/currencies';
import { CURRENCIES, CURRENCY_CODES } from '@/constants/currencies';
import { useSettingsStore } from '@/stores/settings-store';
import { color, radius } from '@/theme/tokens';

export default function CurrencySelectScreen() {
  const selected = useSettingsStore((s) => s.selectedCurrency);
  const setSelected = useSettingsStore((s) => s.setSelectedCurrency);
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return CURRENCY_CODES;
    return CURRENCY_CODES.filter((code) => {
      const c = CURRENCIES[code];
      return (
        code.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.nameJa.includes(query.trim())
      );
    });
  }, [query]);

  function pick(code: CurrencyCode) {
    setSelected(code);
    router.back();
  }

  return (
    <View style={styles.screen}>
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="🔍  通貨名・コードで検索"
          placeholderTextColor={color.faint2}
          autoCapitalize="characters"
          autoCorrect={false}
        />
      </View>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <ThemedText style={styles.sectionLabel}>{query.trim() === '' ? 'よく使う通貨' : '検索結果'}</ThemedText>
        <View style={styles.card}>
          {results.map((code, i) => {
            const c = CURRENCIES[code];
            const isSel = selected === code;
            return (
              <View key={code}>
                {i > 0 && <View style={styles.sep} />}
                <Pressable onPress={() => pick(code)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                  <View style={styles.flagBox}>
                    <CurrencyFlagImage currency={code} size={22} outlined />
                  </View>
                  <View style={styles.rowText}>
                    <ThemedText style={styles.code}>{code}</ThemedText>
                    <ThemedText style={styles.nameJa}>{c.nameJa}</ThemedText>
                  </View>
                  <ThemedText style={styles.symbol}>{c.symbol}</ThemedText>
                  {isSel && <ThemedText style={styles.check}>✓</ThemedText>}
                </Pressable>
              </View>
            );
          })}
          {results.length === 0 && (
            <ThemedText style={styles.noResult}>該当する通貨がありません</ThemedText>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgScreen },
  searchWrap: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 8 },
  search: {
    backgroundColor: color.card,
    borderRadius: radius.chip,
    borderWidth: 1.5,
    borderColor: color.inputBorder,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: color.text,
  },
  scroll: { paddingHorizontal: 18, paddingBottom: 60, gap: 8, maxWidth: 480, width: '100%', alignSelf: 'center' },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: color.muted, paddingHorizontal: 4 },
  card: {
    backgroundColor: color.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.line,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14 },
  pressed: { backgroundColor: color.line3 },
  flagBox: { width: 36, height: 36, borderRadius: radius.chip, backgroundColor: color.bg, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  code: { fontSize: 15, fontWeight: '700', color: color.text },
  nameJa: { fontSize: 12, fontWeight: '500', color: color.muted },
  symbol: { fontSize: 15, fontWeight: '600', color: color.faint2 },
  check: { fontSize: 18, fontWeight: '800', color: color.primary, marginLeft: 4 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: color.line2, marginLeft: 62 },
  noResult: { fontSize: 13, fontWeight: '500', color: color.muted, textAlign: 'center', paddingVertical: 20 },
});
