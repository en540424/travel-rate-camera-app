// [検証] Apple Translation Framework 実機PoC画面。
//
// __DEV__ビルドでのみ動作し、release/TestFlight/productionでは案内文だけを表示して何も実行しない。
// 本番のOCR経路・extractMemoLines・メモ候補UI・保存処理・DBへは一切接続しない。
// 固定テキストのみを翻訳し、言語ペアの可否とsession寿命の安全性を確認することが目的。
import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import {
  TabirateTranslationHost,
  cancelAll,
  getAvailability,
  getSupportedLanguages,
  isSupportedOs,
  prepare,
  translateBatch,
} from '../../modules/translation';

/** 検証対象の固定テキスト。実データ・OCR結果は使わない。 */
const TEST_CASES = [
  { id: 'en', label: '英語 → 日本語', language: 'en', text: 'CHEESE' },
  { id: 'ko', label: '韓国語 → 日本語', language: 'ko', text: '떡볶이' },
  { id: 'th', label: 'タイ語 → 日本語', language: 'th', text: 'ราคาปกติ' },
  { id: 'zh-Hant', label: '繁体字中国語 → 日本語', language: 'zh-Hant', text: '會員價' },
  { id: 'zh-Hans', label: '簡体字中国語 → 日本語', language: 'zh-Hans', text: '会员价' },
] as const;

const TARGET_LANGUAGE = 'ja';

type CaseState = {
  availability?: string;
  prepareResult?: string;
  translateResult?: string;
  error?: string;
  elapsedMs?: number;
};

const MONO = Platform.OS === 'ios' ? 'Courier New' : 'monospace';

function errorText(e: unknown): string {
  if (e instanceof Error) {
    const code = (e as Error & { code?: string }).code;
    return (code ? `${code}: ` : '') + e.message;
  }
  return String(e);
}

export default function TranslationPocScreen() {
  const [states, setStates] = useState<Record<string, CaseState>>({});
  const [supportedLanguages, setSupportedLanguages] = useState<string[] | null>(null);
  const [osSupported, setOsSupported] = useState<boolean | null>(null);
  // ホストViewの意図的なアンマウント/再マウント検証用（fatalErrorが起きないことの確認）
  const [hostMounted, setHostMounted] = useState(true);
  const [busy, setBusy] = useState(false);

  if (!__DEV__) {
    return (
      <SafeAreaView style={styles.screen}>
        <Stack.Screen options={{ headerShown: true, title: '翻訳PoC' }} />
        <ThemedText style={styles.disabled}>
          この画面は開発ビルド専用です。
        </ThemedText>
      </SafeAreaView>
    );
  }

  function update(id: string, patch: CaseState) {
    setStates((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function runWithBusy(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckOs() {
    await runWithBusy(async () => {
      setOsSupported(isSupportedOs());
      try {
        setSupportedLanguages(await getSupportedLanguages());
      } catch (e) {
        setSupportedLanguages([`エラー: ${errorText(e)}`]);
      }
    });
  }

  async function handleAvailability(id: string, language: string) {
    await runWithBusy(async () => {
      try {
        const result = await getAvailability(language, TARGET_LANGUAGE);
        update(id, {
          availability: `${result.status}  (${result.sourceLanguage} → ${result.targetLanguage})`,
          error: undefined,
        });
      } catch (e) {
        update(id, { availability: undefined, error: errorText(e) });
      }
    });
  }

  async function handlePrepare(id: string, language: string) {
    await runWithBusy(async () => {
      try {
        const result = await prepare(language, TARGET_LANGUAGE);
        update(id, {
          prepareResult: `prepared=${result.prepared} / ${result.elapsedMs.toFixed(0)}ms`,
          error: undefined,
        });
      } catch (e) {
        update(id, { prepareResult: undefined, error: errorText(e) });
      }
    });
  }

  async function handleTranslate(id: string, language: string, text: string) {
    await runWithBusy(async () => {
      try {
        // 言語ペアごとに個別configurationで実行する（多言語混在バッチは品質低下要因のため使わない）
        const result = await translateBatch([text], language, TARGET_LANGUAGE);
        const first = result.results[0];
        update(id, {
          translateResult: first
            ? `${first.sourceText} → ${first.translatedText}\n(detected: ${first.sourceLanguage} → ${first.targetLanguage})`
            : '(結果0件)',
          elapsedMs: result.elapsedMs,
          error: undefined,
        });
      } catch (e) {
        update(id, { translateResult: undefined, error: errorText(e) });
      }
    });
  }

  async function handleAllAvailability() {
    await runWithBusy(async () => {
      for (const testCase of TEST_CASES) {
        try {
          const result = await getAvailability(testCase.language, TARGET_LANGUAGE);
          update(testCase.id, {
            availability: `${result.status}  (${result.sourceLanguage} → ${result.targetLanguage})`,
            error: undefined,
          });
        } catch (e) {
          update(testCase.id, { availability: undefined, error: errorText(e) });
        }
      }
    });
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: '翻訳PoC（開発用）' }} />

      {/* 透明なホストView。これがマウントされている間だけprepare/translateBatchが使える。 */}
      {hostMounted && <TabirateTranslationHost style={styles.host} />}

      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText style={styles.note}>
          Apple Translation Frameworkの実機検証用。固定テキストのみを翻訳し、本番のOCR結果・メモ候補・保存処理・DBには接続していません。
        </ThemedText>

        <View style={styles.card}>
          <ThemedText style={styles.cardTitle}>0. 環境確認</ThemedText>
          <TouchableOpacity style={styles.button} onPress={handleCheckOs} disabled={busy}>
            <ThemedText style={styles.buttonText}>OS対応・サポート言語を取得</ThemedText>
          </TouchableOpacity>
          <ThemedText selectable style={styles.mono}>
            {'isSupportedOs (iOS 18.0+): ' + (osSupported === null ? '未確認' : String(osSupported))}
          </ThemedText>
          {supportedLanguages && (
            <ThemedText selectable style={styles.mono}>
              {'supportedLanguages (' + supportedLanguages.length + '):\n' + JSON.stringify(supportedLanguages)}
            </ThemedText>
          )}
        </View>

        <View style={styles.card}>
          <ThemedText style={styles.cardTitle}>1. ホストView寿命の検証</ThemedText>
          <ThemedText style={styles.note}>
            ホストViewを外した状態でも、翻訳がクラッシュせずERR_TRANSLATION_HOST_UNAVAILABLEで失敗することを確認します。再度付け直せば復帰します。
          </ThemedText>
          <TouchableOpacity
            style={[styles.button, hostMounted ? styles.buttonDanger : styles.buttonPrimary]}
            onPress={() => setHostMounted((v) => !v)}>
            <ThemedText style={styles.buttonText}>
              {hostMounted ? 'ホストViewをアンマウント' : 'ホストViewを再マウント'}
            </ThemedText>
          </TouchableOpacity>
          <ThemedText style={styles.mono}>{'hostMounted: ' + String(hostMounted)}</ThemedText>
          <TouchableOpacity style={styles.button} onPress={() => cancelAll()}>
            <ThemedText style={styles.buttonText}>未処理リクエストをキャンセル</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={() => router.back()}>
            <ThemedText style={styles.buttonText}>翻訳中に画面を離れる（戻る）</ThemedText>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <ThemedText style={styles.cardTitle}>2. 言語ペア一括確認</ThemedText>
          <TouchableOpacity style={styles.button} onPress={handleAllAvailability} disabled={busy}>
            <ThemedText style={styles.buttonText}>全ケースのavailabilityを取得</ThemedText>
          </TouchableOpacity>
        </View>

        {TEST_CASES.map((testCase) => {
          const state = states[testCase.id] ?? {};
          return (
            <View key={testCase.id} style={styles.card}>
              <ThemedText style={styles.cardTitle}>{testCase.label}</ThemedText>
              <ThemedText selectable style={styles.sample}>
                {testCase.text}
              </ThemedText>

              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[styles.button, styles.buttonSmall]}
                  onPress={() => handleAvailability(testCase.id, testCase.language)}
                  disabled={busy}>
                  <ThemedText style={styles.buttonText}>availability</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, styles.buttonSmall]}
                  onPress={() => handlePrepare(testCase.id, testCase.language)}
                  disabled={busy}>
                  <ThemedText style={styles.buttonText}>prepare</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, styles.buttonSmall, styles.buttonPrimary]}
                  onPress={() => handleTranslate(testCase.id, testCase.language, testCase.text)}
                  disabled={busy}>
                  <ThemedText style={styles.buttonText}>translate</ThemedText>
                </TouchableOpacity>
              </View>

              <ThemedText selectable style={styles.mono}>
                {'availability: ' + (state.availability ?? '未実行')}
              </ThemedText>
              <ThemedText selectable style={styles.mono}>
                {'prepare:      ' + (state.prepareResult ?? '未実行')}
              </ThemedText>
              <ThemedText selectable style={styles.mono}>
                {'translate:    ' + (state.translateResult ?? '未実行')}
              </ThemedText>
              {state.elapsedMs != null && (
                <ThemedText selectable style={styles.mono}>
                  {'elapsedMs:    ' + state.elapsedMs.toFixed(0)}
                </ThemedText>
              )}
              {state.error && (
                <ThemedText selectable style={[styles.mono, styles.error]}>
                  {'error:        ' + state.error}
                </ThemedText>
              )}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0d1117' },
  // 透明・タッチ透過。レイアウトに影響しないよう最小サイズにする。
  host: { width: 1, height: 1, opacity: 0 },
  content: { padding: 12, gap: 10 },
  note: { fontSize: 11, color: '#8b949e', lineHeight: 16 },
  disabled: { fontSize: 13, color: '#8b949e', padding: 24, textAlign: 'center' },
  card: { backgroundColor: '#161b22', borderRadius: 8, padding: 10, gap: 6 },
  cardTitle: { fontSize: 12, color: '#e6edf3', fontWeight: '700' },
  sample: { fontSize: 18, color: '#e6edf3' },
  buttonRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  button: {
    backgroundColor: '#30363d',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  buttonSmall: { flexGrow: 1, paddingHorizontal: 6 },
  buttonPrimary: { backgroundColor: '#0e9488' },
  buttonDanger: { backgroundColor: '#8b3a3a' },
  buttonText: { fontSize: 11, color: '#fff', fontWeight: '600' },
  mono: { fontSize: 10, color: '#e6edf3', fontFamily: MONO, lineHeight: 15 },
  error: { color: '#f28b82' },
});
