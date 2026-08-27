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
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { TranslationHost, isTranslationPlatformSupported } from '@/components/translation-host';
import { EmptyState, ErrorMessage, GhostButton, PrimaryButton, SectionCard, Toast } from '@/components/ui';
import { VoiceSelectSheet } from '@/components/domain/VoiceSelectSheet';
import {
  resolveSpeechLocale,
  resolveTtsRate,
  resolveTtsVoiceLanguage,
  resolveVoiceSelection,
  type VoiceLike,
} from '@/config/speech-locales';
import { getLanguageDisplayName } from '@/config/translation-language-names';
import { getTranslationSourceLanguage } from '@/config/translation-languages';
import { useTrips } from '@/hooks/use-trips';
import type { SpeechRecognitionErrorCode } from '@/lib/speech-recognition-service';
import {
  abortRecognition,
  getSpeechRecognitionEnvironment,
  requestSpeechPermissions,
  startRecognition,
  stopRecognition,
} from '@/lib/speech-recognition-service';
import {
  getSpeechSynthesisEnvironment,
  speakText,
  stopSpeaking,
} from '@/lib/speech-synthesis-service';
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
import { getVoicePreferences, setVoicePreference, type VoicePreferences } from '@/lib/tts-voice-preferences';
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

/** 音声入力の失敗をユーザー向け文言へ。`aborted`（利用者の停止操作）はここへ来ない */
const SPEECH_ERROR_MESSAGES: Record<SpeechRecognitionErrorCode, string> = {
  permission_denied: 'マイクと音声認識の使用が許可されていません。設定から許可してください。',
  network: '通信できないため音声を認識できませんでした。電波の良い場所でお試しください。',
  no_speech: '音声を認識できませんでした。もう一度お試しください。',
  audio_capture: 'マイクを利用できませんでした。ほかのアプリが使用していないかご確認ください。',
  language_not_supported: 'この言語の音声入力には対応していません。',
  interrupted: '音声入力が中断されました。もう一度お試しください。',
  failed: '音声入力に失敗しました。もう一度お試しください。',
};

/**
 * 画面が扱う音声入力エラー。
 * `permission_blocked`だけは設定アプリへの導線を出す（iOSは一度拒否すると
 * アプリ内から再度ダイアログを出せないため、再試行ボタンを置いても必ず失敗する）。
 */
type SpeechScreenError =
  | { kind: 'permission_blocked' }
  | { kind: 'permission_prompt_denied' }
  | { kind: 'recognition'; code: SpeechRecognitionErrorCode };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function TranslationScreen() {
  const insets = useSafeAreaInsets();
  const { activeTrip } = useTrips();
  const params = useLocalSearchParams<{ picked?: string; field?: string; other?: string }>();

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

  // 音声入力（STT）。翻訳のstate群とは独立して持ち、既存の翻訳フローへ影響させない
  const [speechAvailable, setSpeechAvailable] = useState(false);
  const [supportedSpeechLocales, setSupportedSpeechLocales] = useState<string[]>([]);
  const [supportsOnDevice, setSupportsOnDevice] = useState(false);
  const [isListening, setIsListening] = useState(false);
  /** 認識途中の文字列。**inputTextへは書かない**（確定時のみ反映する） */
  const [interimText, setInterimText] = useState('');
  const [speechError, setSpeechError] = useState<SpeechScreenError | null>(null);

  // 読み上げ（TTS）
  const [voices, setVoices] = useState<VoiceLike[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakFailed, setSpeakFailed] = useState(false);
  /** 言語別のmanual voice設定（`tts-voice-preferences.ts`で永続化）。キーが無い言語は自動 */
  const [voicePrefs, setVoicePrefs] = useState<VoicePreferences>({});
  const [voiceSheetVisible, setVoiceSheetVisible] = useState(false);

  /**
   * 非同期翻訳の世代。`index.tsx`の`translationGenerationRef`とは別物（画面ごとに独立）。
   * 遅れて届いた結果を捨てる唯一の手段であり、nativeのcancelには依存しない。
   *
   * **音声機能はこの世代値を使わない・意味を変えない。** STTの stale 遮断は
   * service層のセッションID（`speech-recognition-service.ts`）が担当する。
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

        // 音声入力・読み上げを確実に畳む。`abortRecognition()`はAVAudioSessionの非活性化まで行う
        // （翻訳→カメラ遷移でマイクindicatorやaudio sessionを残さないための要）。
        // どちらも冪等なので、`end`イベント側の後片付けと二重に走っても問題ない。
        setIsListening(false);
        setInterimText('');
        setIsSpeaking(false);
        void abortRecognition();
        void stopSpeaking();
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

  // MARK: - 音声環境の取得（STT可否・認識locale一覧 / TTS voice一覧）

  /*
   * 翻訳の対応言語とは**別の集合**なので、別々に取得して別々に判定する。
   * 「翻訳はできるが音声認識できない言語」が存在するため、翻訳側のsupportedを流用しない。
   * 取得に失敗しても翻訳機能そのものは成立するので、画面は止めずマイク/スピーカーだけ出さない。
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [speech, synthesis, savedVoicePrefs] = await Promise.all([
        getSpeechRecognitionEnvironment(),
        getSpeechSynthesisEnvironment(),
        getVoicePreferences(),
      ]);
      if (cancelled) return;
      setSpeechAvailable(speech.available);
      setSupportedSpeechLocales(speech.supportedLocales);
      setSupportsOnDevice(speech.supportsOnDevice);
      setVoices(synthesis.voices);
      setVoicePrefs(savedVoicePrefs);
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

  // MARK: - 言語選択画面からの戻り値（route params）を消費する

  /*
   * route paramsはナビゲーション側が持つ外部状態であり、画面のstateへ取り込むには
   * effect内でのsetStateが避けられない（レンダー中に消費すると`router.setParams`という
   * 副作用をレンダー中に呼ぶことになる）。同期は選択直後の1回だけで、消費後すぐparamsを
   * クリアするため、このルールが警告する連鎖レンダーは発生しない。
   *
   * 「触られなかった側」の値は、この画面のstate/refを一切参照せず、`other`として
   * paramsで往復させて取得する（`openLanguageSelect`→`translation-language-select.tsx`
   * →ここ、という一本の経路）。過去にrefで「直近の実効値」を保持する方式にしたところ、
   * 2回目以降の言語選択（例: sourceをth に変えた後、続けてtargetを選び直す）で、
   * 戻ってきたタイミングによってはrefが旅行設定由来の初期値を指したままになり、
   * 触っていないはずのsourceが巻き戻る不具合が実機で再現した。route paramsという
   * ナビゲーション自体が運ぶデータに乗せることで、どのコンポーネントインスタンスが
   * 戻り値を受け取っても値が一致するようにし、この経路依存の不具合を構造的になくす。
   */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const picked = params.picked;
    const field = params.field;
    if (typeof picked !== 'string' || picked === '') return;
    if (field !== 'source' && field !== 'target') return;
    const other = typeof params.other === 'string' && params.other !== '' ? params.other : null;

    setLanguageOverride(
      applyLanguagePick(field, picked, field === 'source' ? { source: null, target: other } : { source: other, target: null }),
    );
    // 言語が変わった時点で既存の訳文は古い条件の結果になるため破棄する
    clearResult();
    // 消費済みparamsを消し、再フォーカス時に同じ選択が再適用されるのを防ぐ
    router.setParams({ picked: undefined, field: undefined, other: undefined });
  }, [params.picked, params.field, params.other]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // MARK: - 後片付け

  useEffect(() => {
    return () => {
      if (slowHintTimerRef.current) clearTimeout(slowHintTimerRef.current);
      // アンマウント経路でも音声とaudio sessionを残さない（focus cleanupと二重でも冪等）
      void abortRecognition();
      void stopSpeaking();
    };
  }, []);

  function clearResult() {
    setResultText(null);
    setResolvedSourceLanguage(null);
    setErrorCode(null);
    setShowSlowHint(false);
    // 読み上げ対象の訳文が消えるので、鳴っていれば止める（冪等）
    setIsSpeaking(false);
    setSpeakFailed(false);
    void stopSpeaking();
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
    // 認識中なら破棄する（入力を消すのに認識だけ走り続けるのを防ぐ）
    setIsListening(false);
    setInterimText('');
    setSpeechError(null);
    void abortRecognition();
  }

  function openLanguageSelect(field: 'source' | 'target') {
    const current = field === 'source' ? source : target;
    // 触っていない側の現在値をotherとして渡す。戻りのroute paramsでそのまま持ち帰ってもらう
    const other = field === 'source' ? target : source;
    router.push({
      pathname: '/translation-language-select',
      params: { field, current: current ?? '', other: other ?? '' },
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

  // MARK: - 音声入力（STT）

  /**
   * マイクtap。録音中なら停止、そうでなければ権限確認のうえ開始する（toggle）。
   * push-to-talkは採用しない（値札を見ながら話す場面で誤リリースしやすいため）。
   */
  async function handleMicPress() {
    if (isListening) {
      // 停止要求。確定結果は`onFinal`で受け取る
      await stopRecognition();
      return;
    }
    if (speechLocale.status === 'unsupported') return;

    setSpeechError(null);

    const permission = await requestSpeechPermissions();
    if (permission.status === 'unavailable') {
      setSpeechError({ kind: 'recognition', code: 'failed' });
      return;
    }
    if (permission.status === 'denied') {
      // 再度ダイアログを出せるかで文言と導線を変える（出せないのに再試行を促さない）
      setSpeechError(
        permission.canAskAgain ? { kind: 'permission_prompt_denied' } : { kind: 'permission_blocked' },
      );
      return;
    }

    setInterimText('');
    setIsListening(true);

    const started = await startRecognition(
      { locale: speechLocale.locale, preferOnDevice: supportsOnDevice },
      {
        // 途中経過は補助表示のみ。inputTextへは書かない
        onInterim: setInterimText,
        onFinal: (text) => {
          setInterimText('');
          // 確定時だけ入力欄を置換する。1000文字は既存の`clampInputLength`へ載せる
          // （STT専用の上限ロジック・専用警告は作らない）
          setInputText(clampInputLength(text));
        },
        onEnd: () => {
          setIsListening(false);
          setInterimText('');
        },
        onError: (code) => {
          // 権限起因は設定アプリ導線へ寄せる（アプリ内で再要求しても必ず失敗するため）
          setSpeechError(
            code === 'permission_denied'
              ? { kind: 'permission_blocked' }
              : { kind: 'recognition', code },
          );
        },
      },
    );

    if (!started) {
      setIsListening(false);
      setSpeechError({ kind: 'recognition', code: 'failed' });
    }
  }

  function handleOpenSettings() {
    void Linking.openSettings();
  }

  // MARK: - 読み上げ（TTS）

  /** スピーカーtap。読み上げ中なら停止（同じアイコンでtoggle。専用stopボタンは増やさない） */
  async function handleSpeakerPress() {
    if (isSpeaking) {
      await stopSpeaking();
      setIsSpeaking(false);
      return;
    }
    if (resultText == null || resultText === '') return;

    // manual設定（保存identifier）を優先し、現在のvoices一覧に無ければ自動選択（Enhanced優先）へ
    // fallbackする。試聴（VoiceSelectSheet）と同じ関数を経由し、解決結果を一致させる。
    const manualIdentifier = target != null ? voicePrefs[target] ?? null : null;
    const selection = resolveVoiceSelection(target, manualIdentifier, voices);
    if (selection == null) return;

    setSpeakFailed(false);
    // 言語別の体感速度差をrateで補正する（Human実機確認ベース。voice選択とは独立）
    const rate = resolveTtsRate(target);
    const started = await speakText(
      { text: resultText, language: selection.language, voiceIdentifier: selection.voiceIdentifier, rate },
      {
        onStart: () => setIsSpeaking(true),
        onFinish: () => setIsSpeaking(false),
        onError: () => {
          setIsSpeaking(false);
          setSpeakFailed(true);
        },
      },
    );
    if (!started) {
      setIsSpeaking(false);
      setSpeakFailed(true);
    }
  }

  /**
   * 「読み上げ設定」button押下。シートを開く前にvoices一覧を再取得する。
   * mount時の1回きりの取得のままだと、iOS設定でユーザーがvoiceを追加/削除しても
   * アプリ再起動までピッカーへ反映されないため（シートを開くたびの再取得に留め、
   * 継続的なポーリングは行わない）。
   */
  async function handleOpenVoiceSettings() {
    const synthesis = await getSpeechSynthesisEnvironment();
    setVoices(synthesis.voices);
    setVoiceSheetVisible(true);
  }

  /** VoiceSelectSheetでの選択（`null`＝自動）。画面stateを即時更新し、永続化は非同期で行う */
  function handleSelectVoice(identifier: string | null) {
    if (target == null) return;
    const lang = target;
    setVoicePrefs((prev) => {
      if (identifier == null) {
        return Object.fromEntries(Object.entries(prev).filter(([key]) => key !== lang));
      }
      return { ...prev, [lang]: identifier };
    });
    void setVoicePreference(lang, identifier);
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

  /**
   * 音声認識locale。**実機の`getSupportedLocales()`との突き合わせで決まる**
   * （`speech-locales.ts`の静的表は候補を作るだけで、対応可否の正本ではない）。
   * 翻訳の対応言語とは別集合なので、翻訳できてもここがunsupportedになることがある。
   * その場合も**言語選択自体は変更せず、マイクだけを無効化する**。
   */
  const speechLocale = useMemo(
    () => resolveSpeechLocale(source, supportedSpeechLocales),
    [source, supportedSpeechLocales],
  );
  const micUnsupported = speechAvailable && speechLocale.status === 'unsupported' && source != null;
  const canUseMic = speechAvailable && speechLocale.status !== 'unsupported' && !isTranslating;

  /** 読み上げvoice。実機のvoice一覧と突き合わせる（別言語のvoiceへは落とさない） */
  const ttsVoice = useMemo(() => resolveTtsVoiceLanguage(target, voices), [target, voices]);
  const hasResult = resultText != null && resultText !== '';
  const canSpeak = hasResult && ttsVoice.status !== 'unsupported' && !isTranslating;

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
              {/*
                音声入力。非対応環境（native未搭載・iOS以外）では描かない。
                認識中は同じボタンが停止になる（push-to-talkではなくtoggle）。
              */}
              {speechAvailable ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.micBtn,
                    isListening && styles.micBtnActive,
                    !canUseMic && !isListening && styles.micBtnDisabled,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => void handleMicPress()}
                  disabled={!canUseMic && !isListening}
                  accessibilityRole="button"
                  accessibilityLabel={isListening ? '音声入力を停止' : '音声入力を開始'}
                  accessibilityState={{ disabled: !canUseMic && !isListening }}>
                  <SymbolView
                    name={{
                      ios: isListening ? 'stop.fill' : 'mic.fill',
                      android: 'mic',
                      web: 'mic',
                    }}
                    tintColor={isListening ? '#fff' : canUseMic ? color.primaryDark : color.faint2}
                    size={15}
                  />
                  <ThemedText
                    style={[
                      styles.micBtnText,
                      isListening && styles.micBtnTextActive,
                      !canUseMic && !isListening && styles.micBtnTextDisabled,
                    ]}>
                    {isListening ? '停止' : '音声入力'}
                  </ThemedText>
                </Pressable>
              ) : (
                <View />
              )}

              <ThemedText style={styles.counter}>
                {inputText.length} / {MAX_TRANSLATION_INPUT_LENGTH}
              </ThemedText>
            </View>
          </SectionCard>

          {/*
            認識中の補助表示。**interimはここにだけ出し、入力欄へは書き込まない**
            （確定時のみ`clampInputLength`を通してinputTextへ反映する）。
          */}
          {isListening && (
            <View style={styles.listeningBox}>
              <View style={styles.listeningHeader}>
                <ActivityIndicator size="small" color={color.primaryDark} />
                <ThemedText style={styles.listeningLabel}>聞き取り中…</ThemedText>
              </View>
              <ThemedText style={styles.interimText} numberOfLines={3}>
                {interimText === '' ? '話しかけてください' : interimText}
              </ThemedText>
            </View>
          )}

          {/* 翻訳はできるが音声認識に対応しない言語。言語選択は変えずマイクだけ無効化する */}
          {micUnsupported && !isListening && (
            <ThemedText style={styles.micNote}>
              {getLanguageDisplayName(source ?? '')}は音声入力に対応していません
            </ThemedText>
          )}

          {speechError != null && (
            <View style={styles.errorWrap}>
              <ErrorMessage
                message={
                  speechError.kind === 'permission_blocked'
                    ? 'マイクと音声認識の使用が許可されていません。設定から許可してください。'
                    : speechError.kind === 'permission_prompt_denied'
                      ? 'マイクと音声認識の使用を許可すると音声入力を利用できます。'
                      : SPEECH_ERROR_MESSAGES[speechError.code]
                }
              />
              {/* 一度拒否されるとアプリ内から再要求できないため、設定アプリへ送るしかない */}
              {speechError.kind === 'permission_blocked' && (
                <GhostButton title="設定を開く" tone="primary" onPress={handleOpenSettings} />
              )}
            </View>
          )}

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

            {hasResult && !isTranslating && (
              <View style={styles.resultActions}>
                {/* 読み上げ。target側の訳文のみ。同じアイコンで再生/停止をtoggleする */}
                {voices.length > 0 && (
                  <Pressable
                    style={({ pressed }) => [
                      styles.copyBtn,
                      isSpeaking && styles.speakBtnActive,
                      !canSpeak && !isSpeaking && styles.copyBtnDisabled,
                      pressed && styles.pressed,
                    ]}
                    onPress={() => void handleSpeakerPress()}
                    disabled={!canSpeak && !isSpeaking}
                    accessibilityRole="button"
                    accessibilityLabel={isSpeaking ? '読み上げを停止' : '訳文を読み上げる'}
                    accessibilityState={{ disabled: !canSpeak && !isSpeaking }}>
                    <SymbolView
                      name={{
                        ios: isSpeaking ? 'stop.fill' : 'speaker.wave.2.fill',
                        android: 'volume_up',
                        web: 'volume_up',
                      }}
                      tintColor={isSpeaking ? '#fff' : canSpeak ? color.primaryDark : color.faint2}
                      size={16}
                    />
                    <ThemedText
                      style={[
                        styles.copyBtnText,
                        isSpeaking && styles.speakBtnTextActive,
                        !canSpeak && !isSpeaking && styles.copyBtnTextDisabled,
                      ]}>
                      {isSpeaking ? '停止' : '読み上げ'}
                    </ThemedText>
                  </Pressable>
                )}

                {/* 言語別voice選択（自動/manual）。voicesが取得できる端末でのみ表示する */}
                {voices.length > 0 && (
                  <Pressable
                    style={({ pressed }) => [styles.voiceSettingsBtn, pressed && styles.pressed]}
                    onPress={() => void handleOpenVoiceSettings()}
                    accessibilityRole="button"
                    accessibilityLabel="読み上げ設定">
                    <SymbolView
                      name={{ ios: 'gearshape', android: 'settings', web: 'settings' }}
                      tintColor={color.primaryDark}
                      size={16}
                    />
                  </Pressable>
                )}

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
              </View>
            )}

            {/* voice非対応は明示する（別言語のvoiceで代読せず、無音で失敗もさせない） */}
            {hasResult && !isTranslating && voices.length > 0 && ttsVoice.status === 'unsupported' && (
              <ThemedText style={styles.ttsNote}>この言語の読み上げには対応していません</ThemedText>
            )}
            {speakFailed && <ThemedText style={styles.ttsNote}>読み上げできませんでした</ThemedText>}
          </View>

        </ScrollView>
      </SafeAreaView>

      <Toast message={toast} onHide={handleToastHide} style={{ top: insets.top + 8 }} />

      <VoiceSelectSheet
        visible={voiceSheetVisible}
        onClose={() => setVoiceSheetVisible(false)}
        languageCode={target}
        languageDisplayName={target ? getLanguageDisplayName(target) : ''}
        voices={voices}
        selectedIdentifier={target != null ? voicePrefs[target] ?? null : null}
        onSelect={handleSelectVoice}
      />
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
  // マイクを左・文字数カウンタを右に置く（カウンタの見た目・位置は従来どおり右端）
  inputFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  counter: { fontSize: 12, fontWeight: '500', color: color.faint2, fontVariant: ['tabular-nums'] },

  micBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.primaryBorder,
    backgroundColor: color.primarySoft,
  },
  micBtnActive: { backgroundColor: color.primary, borderColor: color.primary },
  micBtnDisabled: { backgroundColor: color.card, borderColor: color.line },
  micBtnText: { fontSize: 13, fontWeight: '700', color: color.primaryDark },
  micBtnTextActive: { color: '#fff' },
  micBtnTextDisabled: { color: color.faint2 },

  listeningBox: {
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: color.primaryBorder,
    backgroundColor: color.primarySoft,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 6,
    marginTop: -6,
  },
  listeningHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  listeningLabel: { fontSize: 12.5, fontWeight: '700', color: color.primaryDark },
  /** 認識途中の文字列。確定するまで入力欄には入らない旨が分かるよう控えめに出す */
  interimText: { fontSize: 14, lineHeight: 20, fontWeight: '500', color: color.muted },
  micNote: { fontSize: 12.5, fontWeight: '500', color: color.muted, marginTop: -6 },

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
  copyBtnDisabled: { borderColor: color.line, backgroundColor: color.card },
  copyBtnTextDisabled: { color: color.faint2 },
  // 「読み上げ設定」button。アイコンのみ・正方形（読み上げ/コピーと同じ高さ感）
  voiceSettingsBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.button,
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.primaryBorder,
  },

  // 読み上げ・コピーを横並びにする（専用stopボタンは増やさずアイコンをtoggleする）
  resultActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  speakBtnActive: { backgroundColor: color.primary, borderColor: color.primary },
  speakBtnTextActive: { color: '#fff' },
  ttsNote: { fontSize: 12, fontWeight: '500', color: color.muted },

  pressed: { opacity: 0.85 },
});
