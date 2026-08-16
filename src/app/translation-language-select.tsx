/**
 * 専用翻訳ページの言語選択画面。
 *
 * 一覧の正本は**実機の`getSupportedLanguages()`**（静的な対応言語リストをアプリ側に持たない）。
 * 表示名は`translation-language-names.ts`で引き、未知コードはコードのまま表示して壊れないようにする。
 *
 * **国旗は表示しない。** 1言語=1国ではないため（英語=米国旗のような誤った1対1対応を構造的に避ける）。
 * 表示は「言語名（大） / BCP-47コード（小）」の2段構成。
 *
 * 選択結果は**route params**で翻訳画面へ返す（新規storeやmodule-levelの隠れ状態を作らない）。
 * 画面構成・行UI・検索は既存の`currency-select.tsx`のパターンに合わせている。
 *
 * `other`（触っていない側の言語）は、入る時に受け取った値をそのまま持ち帰りの
 * paramsへ載せて返す。翻訳画面側のコンポーネントインスタンスの状態を一切参照せず、
 * ナビゲーションの往復だけで運ぶことで、戻り先が「本当にユーザーが出発した時と同じ
 * 実効値」を確実に持てるようにしている（詳細は`translation.tsx`のコメント参照）。
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { getLanguageDisplayName, matchesLanguageQuery } from '@/config/translation-language-names';
import { getTranslationEnvironment } from '@/lib/text-translation-service';
import { color, radius } from '@/theme/tokens';

/** 翻訳画面のどちら側を選んでいるか */
type LanguageField = 'source' | 'target';

function isLanguageField(value: unknown): value is LanguageField {
  return value === 'source' || value === 'target';
}

export default function TranslationLanguageSelectScreen() {
  const params = useLocalSearchParams<{ field?: string; current?: string; other?: string }>();
  const field: LanguageField = isLanguageField(params.field) ? params.field : 'source';
  const current = typeof params.current === 'string' ? params.current : null;
  // 触っていない側の言語。翻訳画面へそのまま持ち帰るだけで、この画面では使わない
  const other = typeof params.other === 'string' ? params.other : '';

  const [languages, setLanguages] = useState<string[] | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const env = await getTranslationEnvironment();
      if (cancelled) return;
      setLanguages(env.supportedLanguages);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const results = useMemo(() => {
    const list = languages ?? [];
    // 日本語表示名の五十音ではなくコード順の安定した並びにし、既知言語を先に出す
    const sorted = [...list].sort((a, b) => getLanguageDisplayName(a).localeCompare(getLanguageDisplayName(b), 'ja'));
    return sorted.filter((code) => matchesLanguageQuery(code, query));
  }, [languages, query]);

  function pick(code: string) {
    // 選択値はroute paramsで翻訳画面へ返す。翻訳画面側で消費後にクリアする。
    // otherは入る時に受け取った値をそのまま持ち帰る（上部コメント参照）
    router.navigate({ pathname: '/translation', params: { picked: code, field, other } });
  }

  return (
    <View style={styles.screen}>
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="🔍  言語名・コードで検索"
          placeholderTextColor={color.faint2}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <ThemedText style={styles.sectionLabel}>
          {field === 'source' ? '翻訳元の言語' : '翻訳先の言語'}
        </ThemedText>

        {languages === null ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={color.primary} />
            <ThemedText style={styles.loadingText}>対応言語を読み込んでいます…</ThemedText>
          </View>
        ) : (
          <View style={styles.card}>
            {results.map((code, i) => {
              const isSel = current === code;
              return (
                <View key={code}>
                  {i > 0 && <View style={styles.sep} />}
                  <Pressable
                    onPress={() => pick(code)}
                    style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                    <View style={styles.rowText}>
                      <ThemedText style={styles.name}>{getLanguageDisplayName(code)}</ThemedText>
                      <ThemedText style={styles.code}>{code}</ThemedText>
                    </View>
                    {isSel && <ThemedText style={styles.check}>✓</ThemedText>}
                  </Pressable>
                </View>
              );
            })}
            {results.length === 0 && (
              <ThemedText style={styles.noResult}>
                {languages.length === 0
                  ? 'この端末では対応言語を取得できませんでした'
                  : '該当する言語がありません'}
              </ThemedText>
            )}
          </View>
        )}
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
  scroll: {
    paddingHorizontal: 18,
    paddingBottom: 60,
    gap: 8,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: color.muted, paddingHorizontal: 4 },
  loadingWrap: { alignItems: 'center', gap: 10, paddingVertical: 32 },
  loadingText: { fontSize: 13, fontWeight: '500', color: color.muted },
  card: {
    backgroundColor: color.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.line,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14 },
  pressed: { backgroundColor: color.line3 },
  rowText: { flex: 1, gap: 1 },
  name: { fontSize: 15, fontWeight: '700', color: color.text },
  code: { fontSize: 12, fontWeight: '500', color: color.muted },
  check: { fontSize: 18, fontWeight: '800', color: color.primary, marginLeft: 4 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: color.line2, marginLeft: 14 },
  noResult: { fontSize: 13, fontWeight: '500', color: color.muted, textAlign: 'center', paddingVertical: 20 },
});
