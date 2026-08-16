/**
 * 専用翻訳ページ（初版）。自由入力テキストを任意のsource→targetで翻訳する。
 *
 * 既存のOCRメモ候補翻訳（`(tabs)/index.tsx` → `translation-service.ts`）とは
 * **完全に独立した並列経路**で、あちらのコードには一切触れていない。
 *
 * ■ TranslationHostの安全規約（最重要）
 * native側の`TabirateTranslationRegistry`は**weak参照を1つだけ**保持し（last-register-wins）、
 * 一度マウントされたホストViewは再registerされない。そのため、カメラ画面のホストが生きたまま
 * この画面のホストが登録を奪い、こちらが先にアンマウントされると、カメラ側のホストが
 * registryから外れたまま（orphan）になり、以後の翻訳がすべて`host_unavailable`で
 * 静かに失敗し続ける。
 * これを避けるため、
 *   - `@/components/translation-host`の`TranslationHost`だけを使う（nativeのホストを直importしない）
 *   - `active`を`useFocusEffect`に厳密に紐づけ、フォーカスが外れたら必ずアンマウントする
 * の2点を守る。カメラ画面（`index.tsx:848`）も同じ規律なので、タブ往復では
 * 常にどちらか一方だけがマウントされた状態になる。
 *
 * ■ 呼んではいけないAPI
 *   - `cancelAll()` / `cancelTranslation()` … nativeの`configuration`がnilのまま残り、
 *     以後の要求がdrainされずPromiseが永久にsettleしなくなる既知の事象がある
 *   - `clearTranslationCaches()` … カメラ画面と共有しているcacheまで消える
 *   - `translateBatch`への独自timeout … 初回のモデルDLは正当に数十秒かかりうる
 * stale結果の遮断は`generationRef`の一致判定のみで行う。
 */
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { TranslationHost, isTranslationPlatformSupported } from '@/components/translation-host';
import { EmptyState, ErrorMessage, GhostButton, PrimaryButton, SectionCard, Toast } from '@/components/ui';
import { getLanguageDisplayName } from '@/config/translation-language-names';
import { getTranslationSourceLanguage } from '@/config/translation-languages';
import { useTrips } from '@/hooks/use-trips';
import {
  MAX_TRANSLATION_INPUT_LENGTH,
  SLOW_TRANSLATION_HINT_MS,
  applyLanguagePick,
  clampInputLength,
  hasTranslatableInput,
  isSameLanguage,
  resolveInitialLanguages,
  swapLanguages,
} from '@/lib/text-translation-core';
import { getTranslationEnvironment, translateFreeText } from '@/lib/text-translation-service';
import type { MemoTranslationErrorCode } from '@/lib/translation-types';
import { color, radius, shadow, spacing } from '@/theme/tokens';

/** `host_unavailable`の自動リトライまでの待ち時間(ms)。ホストViewの登録が間に合わない一瞬の窓を吸収する */
const HOST_RETRY_DELAY_MS = 250;

/** エラー種別ごとのユーザー向け文言 */
const ERROR_MESSAGES: Record<MemoTranslationErrorCode, string> = {
  unsupported_os: 'この端末では翻訳を利用できません。',
  unsupported_language: 'この言語の組み合わせには対応していません。言語を変えてお試しください。',
  host_unavailable: '翻訳を開始できませんでした。もう一度お試しください。',
  cancelled: '',
  translation_failed: '翻訳できませんでした。通信状況を確認してもう一度お試しください。',
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function TranslationScreen() {
  const insets = useSafeAreaInsets();
  const { activeTrip } = useTrips();
  const params = useLocalSearchParams<{ picked?: string; field?: string }>();

  /**
   * ユーザーが明示的に選んだ言語。nullの間は旅行設定由来の初期値が使われる。
   * 「旅行設定は初期値としてのみ使う」を、effectでの後追い上書きではなく
   * 優先順位（override → 初期値）で表現している。
   * 一度overrideが入れば、あとから旅行が読み込まれても上書きされない。
   *
   * source/targetを別々のstateにすると、片方だけ選び直した直後は
   * 「触っていない側」がinitialLanguages側の値へ暗黙に結合されたままになる。
   * この状態でswapすると、その「暗黙に結合されたまま」の値を巻き込んで
   * 入れ替えることになり、意図せず旅行設定側の値が re-adopt されうる。
   * 1つのオブジェクトとして持ち、どちらか一方でも触られた時点で
   * 両方を現在の実効値として同時に確定させることで、この結合を断つ。
   */
  const [languageOverride, setLanguageOverride] = useState<{
    source: string | null;
    target: string | null;
  } | null>(null);

  // 入力・結果
  const [inputText, setInputText] = useState('');
  const [resultText, setResultText] = useState<string | null>(null);
  const [resolvedSourceLanguage, setResolvedSourceLanguage] = useState<string | null>(null);

  // 実行状態
  const [isTranslating, setIsTranslating] = useState(false);
  const [errorCode, setErrorCode] = useState<MemoTranslationErrorCode | null>(null);
  const [showSlowHint, setShowSlowHint] = useState(false);

  // 環境
  const [osSupported, setOsSupported] = useState<boolean | null>(null);
  const [supportedLanguages, setSupportedLanguages] = useState<string[] | null>(null);
  const [isScreenFocused, setIsScreenFocused] = useState(false);

  // UI
  const [toast, setToast] = useState<string | null>(null);

  /**
   * 非同期翻訳の世代。`index.tsx`の`translationGenerationRef`とは別物（画面ごとに独立）。
   * 遅れて届いた結果を捨てる唯一の手段であり、nativeのcancelには依存しない。
   */
  const generationRef = useRef(0);
  const slowHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // MARK: - フォーカス連動（TranslationHostのマウント条件）

  useFocusEffect(
    useCallback(() => {
      if (!isTranslationPlatformSupported) return;
      setIsScreenFocused(true);
      return () => {
        setIsScreenFocused(false);
        // 離脱中に返る結果を破棄する（カメラ画面と同じ規律）
        generationRef.current += 1;
        // 世代を進めた結果、実行中だった要求は破棄される。下タブ画面はアンマウントされないため、
        // ここでローディング状態も畳まないと「CTAがspinnerのまま固定」になり、
        // クリア（＝入力も消える）以外に復帰手段が無くなる。入力は残したままidleへ戻す。
        setIsTranslating(false);
        if (slowHintTimerRef.current) {
          clearTimeout(slowHintTimerRef.current);
          slowHintTimerRef.current = null;
        }
        setShowSlowHint(false);
      };
    }, []),
  );

  // MARK: - 環境の取得（OS可否 → 対応言語）

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const env = await getTranslationEnvironment();
      if (cancelled) return;
      setOsSupported(env.osSupported);
      setSupportedLanguages(env.supportedLanguages);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // MARK: - 初期言語（旅行設定は「初期値」としてのみ使う）

  /**
   * 旅行設定由来の初期言語。通貨hintは実機のsupportedに存在する場合だけ採用される
   * （存在しない値を初期値にすると、言語ピッカーのリストに無い値が選択済みとして表示されてしまう）。
   */
  const initialLanguages = useMemo(() => {
    if (supportedLanguages === null) return null;
    const hint = activeTrip ? getTranslationSourceLanguage(activeTrip.base_currency) : null;
    return resolveInitialLanguages(hint, supportedLanguages);
  }, [supportedLanguages, activeTrip]);

  const source = languageOverride?.source ?? initialLanguages?.source ?? null;
  const target = languageOverride?.target ?? initialLanguages?.target ?? null;

  /**
   * route params消費effectは`params.picked`/`params.field`の変化にのみ反応させたい
   * （現在のsource/targetが変わるたびに再実行されては困る）ため、依存配列に含めずに
   * 「触られなかった側」の直近の実効値をrefで参照する。
   */
  const latestLanguagesRef = useRef({ source, target });
  latestLanguagesRef.current = { source, target };

  // MARK: - 言語選択画面からの戻り値（route params）を消費する

  /*
   * route paramsはナビゲーション側が持つ外部状態であり、画面のstateへ取り込むには
   * effect内でのsetStateが避けられない（レンダー中に消費すると`router.setParams`という
   * 副作用をレンダー中に呼ぶことになる）。同期は選択直後の1回だけで、消費後すぐparamsを
   * クリアするため、このルールが警告する連鎖レンダーは発生しない。
   */
  useEffect(() => {
    const picked = params.picked;
    const field = params.field;
    if (typeof picked !== 'string' || picked === '') return;
    if (field !== 'source' && field !== 'target') return;

    // 触られなかった側も同時に確定させ、initialLanguagesへの暗黙結合を断つ（上のstate宣言のコメント参照）
    setLanguageOverride(applyLanguagePick(field, picked, latestLanguagesRef.current));
    // 言語が変わった時点で既存の訳文は古い条件の結果になるため破棄する
    clearResult();
    // 消費済みparamsを消し、再フォーカス時に同じ選択が再適用されるのを防ぐ
    router.setParams({ picked: undefined, field: undefined });
  }, [params.picked, params.field]);

  // MARK: - 後片付け

  useEffect(() => {
    return () => {
      if (slowHintTimerRef.current) clearTimeout(slowHintTimerRef.current);
    };
  }, []);

  function clearResult() {
    setResultText(null);
    setResolvedSourceLanguage(null);
    setErrorCode(null);
    setShowSlowHint(false);
  }

  function stopSlowHintTimer() {
    if (slowHintTimerRef.current) {
      clearTimeout(slowHintTimerRef.current);
      slowHintTimerRef.current = null;
    }
    setShowSlowHint(false);
  }

  // MARK: - 操作

  function handleChangeInput(next: string) {
    // maxLengthで止まるが、貼り付け経路の取りこぼしに備えて保険をかける
    setInputText(clampInputLength(next));
  }

  function handleSwap() {
    if (source == null || target == null) return;
    // 明示操作なので、以後は旅行設定由来の初期値へ戻さない（両方を同時に確定させる）
    setLanguageOverride(swapLanguages({ source, target }));
    // 入れ替え後の訳文は古い条件の結果なので破棄する
    clearResult();
  }

  function handleClear() {
    generationRef.current += 1; // 実行中の結果が後から入らないようにする
    stopSlowHintTimer();
    setIsTranslating(false);
    setInputText('');
    clearResult();
  }

  function openLanguageSelect(field: 'source' | 'target') {
    const current = field === 'source' ? source : target;
    router.push({
      pathname: '/translation-language-select',
      params: { field, current: current ?? '' },
    });
  }

  async function handleTranslate() {
    if (!canTranslate || source == null || target == null) return;

    const generation = generationRef.current + 1;
    generationRef.current = generation;

    setIsTranslating(true);
    clearResult();

    stopSlowHintTimer();
    slowHintTimerRef.current = setTimeout(() => setShowSlowHint(true), SLOW_TRANSLATION_HINT_MS);

    const request = {
      text: inputText,
      sourceLanguage: source,
      targetLanguage: target,
      generation,
    };

    let result = await translateFreeText(request);

    // ホストViewの登録が間に合わなかっただけの可能性があるため、1回だけ自動リトライする。
    // （タブ画面はアンマウントされないので、復帰直後にCTAを押せる一瞬の窓がある）
    if (result.errorCode === 'host_unavailable' && generationRef.current === generation) {
      await delay(HOST_RETRY_DELAY_MS);
      if (generationRef.current === generation) {
        result = await translateFreeText(request);
      }
    }

    // 世代が進んでいれば、この結果は捨てる（画面離脱・クリア・再実行の後）
    if (result.generation !== generationRef.current) return;

    stopSlowHintTimer();
    setIsTranslating(false);

    if (result.status === 'done') {
      setResultText(result.translatedText ?? '');
      setResolvedSourceLanguage(result.resolvedSourceLanguage ?? null);
      setErrorCode(null);
      return;
    }
    if (result.status === 'cancelled') return; // ユーザーへ見せるエラーではない
    setErrorCode(result.errorCode ?? 'translation_failed');
  }

  async function handleCopy() {
    if (resultText == null || resultText === '') return;
    try {
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(resultText);
      setToast('コピーしました');
    } catch {
      // native module未搭載のBuild等でも画面をクラッシュさせない
    }
  }

  const handleToastHide = useCallback(() => setToast(null), []);

  // MARK: - 派生値

  const sameLanguage = isSameLanguage(source, target);
  const canTranslate =
    osSupported === true &&
    supportedLanguages != null &&
    supportedLanguages.length > 0 &&
    source != null &&
    target != null &&
    !sameLanguage &&
    hasTranslatableInput(inputText) &&
    !isTranslating;

  // MARK: - 非対応環境

  if (osSupported === false) {
    return (
      <View style={styles.screen}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <View style={styles.emptyWrap}>
            <EmptyState
              tone="neutral"
              title="翻訳を利用できません"
              body={'翻訳はiOS 18以降のiPhoneで\nご利用いただけます'}
            />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* 描画物を持たない透明View。フォーカス中だけマウントする（冒頭の安全規約を参照） */}
      <TranslationHost active={isScreenFocused} />

      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          // 複数行入力のため、キーボードでCTAが隠れないようinsetを自動調整する（iOS）
          automaticallyAdjustKeyboardInsets
          keyboardShouldPersistTaps="handled">

          {/* タイトル（下タブ画面はheaderShown:falseのため画面内に描く） */}
          <View style={styles.titleRow}>
            <ThemedText style={styles.title}>翻訳</ThemedText>
            <ThemedText style={styles.subtitle}>入力した文章をその場で翻訳します</ThemedText>
          </View>

          {/* 旅行設定バッジ。国名は推測で作らず、旅行名と通貨コードだけを出す */}
          {activeTrip && (
            <View style={styles.tripBadge}>
              <ThemedText style={styles.tripBadgeText} numberOfLines={1}>
                旅行設定：{activeTrip.name}（{activeTrip.base_currency}）
              </ThemedText>
            </View>
          )}

          {/* 言語選択バー（国旗は使わない） */}
          <View style={styles.langBar}>
            <Pressable
              style={({ pressed }) => [styles.langCard, pressed && styles.pressed]}
              onPress={() => openLanguageSelect('source')}>
              <ThemedText style={styles.langLabel}>翻訳元</ThemedText>
              <ThemedText style={styles.langName} numberOfLines={1}>
                {source ? getLanguageDisplayName(source) : '—'}
              </ThemedText>
              <ThemedText style={styles.langCode}>{source ?? ''}</ThemedText>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.swapBtn, pressed && styles.pressed]}
              onPress={handleSwap}
              accessibilityLabel="翻訳元と翻訳先を入れ替える"
              hitSlop={6}>
              <SymbolView
                name={{ ios: 'arrow.left.arrow.right', android: 'swap_horiz', web: 'swap_horiz' }}
                tintColor="#fff"
                size={18}
              />
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.langCard, pressed && styles.pressed]}
              onPress={() => openLanguageSelect('target')}>
              <ThemedText style={styles.langLabel}>翻訳先</ThemedText>
              <ThemedText style={styles.langName} numberOfLines={1}>
                {target ? getLanguageDisplayName(target) : '—'}
              </ThemedText>
              <ThemedText style={styles.langCode}>{target ?? ''}</ThemedText>
            </Pressable>
          </View>

          {sameLanguage && (
            <ThemedText style={styles.sameLangNote}>
              翻訳元と翻訳先が同じです。どちらかの言語を変更してください。
            </ThemedText>
          )}

          {/* OSは対応しているが対応言語一覧を取得できなかった場合。CTAが無効な理由を示す */}
          {osSupported === true && supportedLanguages != null && supportedLanguages.length === 0 && (
            <ErrorMessage message="この端末で利用できる翻訳言語を取得できませんでした。アプリを再起動してもう一度お試しください。" />
          )}

          {/* 入力カード */}
          <SectionCard padding={0} style={styles.inputCard}>
            <TextInput
              style={[styles.input, Platform.OS === 'web' && ({ outlineStyle: 'none' } as object)]}
              value={inputText}
              onChangeText={handleChangeInput}
              placeholder="テキストを入力または貼り付けてください"
              placeholderTextColor={color.faint2}
              multiline
              textAlignVertical="top"
              maxLength={MAX_TRANSLATION_INPUT_LENGTH}
              scrollEnabled={false}
            />
            <View style={styles.inputFooter}>
              <ThemedText style={styles.counter}>
                {inputText.length} / {MAX_TRANSLATION_INPUT_LENGTH}
              </ThemedText>
            </View>
          </SectionCard>

          {/* アクション（音声入力・カメラ翻訳は初版では置かない） */}
          <View style={styles.actionRow}>
            <GhostButton
              title="クリア"
              onPress={handleClear}
              disabled={inputText === '' && resultText == null}
            />
          </View>

          <PrimaryButton title="翻訳する" onPress={handleTranslate} disabled={!canTranslate} loading={isTranslating} />

          {showSlowHint && isTranslating && (
            <ThemedText style={styles.slowHint}>
              初回は言語モデルの準備に時間がかかる場合があります。そのままお待ちください。
            </ThemedText>
          )}

          {errorCode != null && errorCode !== 'cancelled' && (
            <View style={styles.errorWrap}>
              <ErrorMessage message={ERROR_MESSAGES[errorCode]} />
              {(errorCode === 'host_unavailable' || errorCode === 'translation_failed') && (
                <GhostButton title="もう一度試す" tone="primary" onPress={handleTranslate} />
              )}
            </View>
          )}

          {/* 訳文カード */}
          <View style={styles.resultCard}>
            <View style={styles.resultHeader}>
              <ThemedText style={styles.resultLabel}>訳文</ThemedText>
              {resolvedSourceLanguage != null && (
                <ThemedText style={styles.resolvedLang}>
                  検出：{getLanguageDisplayName(resolvedSourceLanguage)}
                </ThemedText>
              )}
            </View>

            {isTranslating ? (
              <View style={styles.resultLoading}>
                <ActivityIndicator color={color.primaryDark} />
              </View>
            ) : resultText != null && resultText !== '' ? (
              <ThemedText style={styles.resultText} selectable>
                {resultText}
              </ThemedText>
            ) : (
              <ThemedText style={styles.resultPlaceholder}>ここに翻訳結果が表示されます</ThemedText>
            )}

            {resultText != null && resultText !== '' && !isTranslating && (
              <Pressable
                style={({ pressed }) => [styles.copyBtn, pressed && styles.pressed]}
                onPress={handleCopy}>
                <SymbolView
                  name={{ ios: 'doc.on.doc', android: 'content_copy', web: 'content_copy' }}
                  tintColor={color.primaryDark}
                  size={16}
                />
                <ThemedText style={styles.copyBtnText}>コピー</ThemedText>
              </Pressable>
            )}
          </View>

        </ScrollView>
      </SafeAreaView>

      <Toast message={toast} onHide={handleToastHide} style={{ top: insets.top + 8 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgScreen },
  safe: { flex: 1 },
  scrollView: { flex: 1 },
  scroll: {
    padding: 18,
    paddingBottom: 40,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
    gap: 14,
  },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },

  titleRow: { gap: 3 },
  title: { fontSize: 20, fontWeight: '700', color: color.text },
  subtitle: { fontSize: 13, fontWeight: '500', color: color.muted },

  tripBadge: {
    alignSelf: 'flex-start',
    backgroundColor: color.primarySoft,
    borderRadius: radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  tripBadgeText: { fontSize: 12, fontWeight: '600', color: color.primaryDark },

  langBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  langCard: {
    flex: 1,
    gap: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.card,
    ...shadow.card,
  },
  langLabel: { fontSize: 10.5, fontWeight: '600', color: color.faint2 },
  langName: { fontSize: 15, fontWeight: '700', color: color.text },
  langCode: { fontSize: 11.5, fontWeight: '500', color: color.muted },
  swapBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sameLangNote: { fontSize: 12.5, fontWeight: '500', color: color.muted, marginTop: -6 },

  inputCard: { overflow: 'hidden' },
  input: {
    minHeight: 140,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 4,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '500',
    color: color.text,
  },
  inputFooter: { alignItems: 'flex-end', paddingHorizontal: 14, paddingBottom: 10 },
  counter: { fontSize: 12, fontWeight: '500', color: color.faint2, fontVariant: ['tabular-nums'] },

  actionRow: { flexDirection: 'row', justifyContent: 'flex-start', marginTop: -6 },

  slowHint: { fontSize: 12.5, fontWeight: '500', color: color.muted, textAlign: 'center' },
  errorWrap: { gap: 4 },

  resultCard: {
    borderRadius: radius.cardLg,
    backgroundColor: color.primarySoft,
    borderWidth: 1,
    borderColor: color.primaryBorder,
    padding: 16,
    minHeight: 140,
    gap: 10,
    ...shadow.card,
  },
  resultHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  resultLabel: { fontSize: 13, fontWeight: '700', color: color.primaryDark },
  resolvedLang: { fontSize: 11.5, fontWeight: '500', color: color.primaryDark, opacity: 0.7 },
  resultLoading: { paddingVertical: 24, alignItems: 'center' },
  resultText: { fontSize: 17, lineHeight: 26, fontWeight: '500', color: color.text },
  resultPlaceholder: { fontSize: 14, fontWeight: '500', color: color.muted, paddingVertical: 8 },
  copyBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radius.button,
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.primaryBorder,
  },
  copyBtnText: { fontSize: 14, fontWeight: '700', color: color.primaryDark },

  pressed: { opacity: 0.85 },
});
