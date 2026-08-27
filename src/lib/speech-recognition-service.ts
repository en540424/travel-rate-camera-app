/**
 * 専用翻訳ページの音声入力（STT）を包む中間層。
 *
 * **`expo-speech-recognition`を画面から直接呼ばせず、この層だけが触る。**
 * 将来この層の実装を差し替えても（自前wrapper化など）、画面側へ波及させないための境界。
 *
 * 責務: nativeの遅延読み込み・可否判定・権限・セッション開始/停止・
 *       on-device優先とserver fallback・**AVAudioSessionの非活性化**・エラー正規化。
 * 責務外: UI文字列、React state、locale解決（`@/config/speech-locales`の純粋関数）。
 *
 * ■ 最重要の設計契約: **AVAudioSessionの非活性化はアプリ側が責任を持つ**
 * packageは認識開始時に`playAndRecord` / `measurement`でsessionをactiveにするが、
 * `setActive(false)`は自動では呼ばない（実ソース確認済み）。放置すると
 *   - 直後のTTSが`measurement`の減衰を受けて極端に小さくなる
 *   - 画面を離れてもマイクindicatorが残る
 * ため、`end`到達時と画面離脱時の**両方**から`releaseAudioSession()`を必ず呼ぶ。
 *
 * ■ 冪等性
 * `stop` / `abort` / `releaseAudioSession`は`end`イベントと画面cleanupの両方から
 * 呼ばれうる。**二重に呼ばれても例外を投げない**ことをこの層の契約とする。
 *
 * ■ 動的import
 * `expo-speech-recognition`は`requireNativeModule()`をimport時点で同期実行するため、
 * nativeが載っていないBuild（追加前のdev client等）では**import時に例外**になる。
 * 既存の`translation-host.tsx` / `translation-service.ts`と同じ規律で動的importにし、
 * 読めない環境では機能を無効化して画面を壊さない。
 */
import { Platform } from 'react-native';

import {
  accumulateFinalTranscript,
  EMPTY_TRANSCRIPT_ACCUMULATOR,
  joinTranscript,
  type TranscriptAccumulatorState,
} from './speech-transcript-accumulator';

type SpeechRecognitionNative = typeof import('expo-speech-recognition');
type SpeechRecognitionModule = SpeechRecognitionNative['ExpoSpeechRecognitionModule'];

/** `addListener`の戻り値。`EventSubscription`を構造的に受ける（型import経路を増やさないため） */
type Subscription = { remove: () => void };

let nativeModulePromise: Promise<SpeechRecognitionNative | null> | undefined;

/** nativeを遅延読み込みする（成否を問わず1回だけ確定させる。`translation-service.ts`と同じ規律） */
function loadNative(): Promise<SpeechRecognitionNative | null> {
  if (nativeModulePromise) return nativeModulePromise;
  nativeModulePromise = import('expo-speech-recognition').catch((error: unknown) => {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[SpeechRecognition] moduleを読み込めませんでした', error);
    }
    return null;
  });
  return nativeModulePromise;
}

// MARK: - エラー分類

/** 画面が扱うエラー種別。nativeの細かいコードはここへ畳む */
export type SpeechRecognitionErrorCode =
  /** マイク/音声認識の権限が無い。設定アプリへの導線を出す */
  | 'permission_denied'
  /** ネットワーク起因（server認識時にオフライン等） */
  | 'network'
  /** 声を検出できなかった・一致なし */
  | 'no_speech'
  /** マイクを利用できない（他アプリ占有・ハード問題） */
  | 'audio_capture'
  /** この言語で認識できない */
  | 'language_not_supported'
  /** 通話・Siri等による中断 */
  | 'interrupted'
  /** 上記以外 */
  | 'failed';

/**
 * nativeのエラーコードを画面向けへ正規化する。
 * `aborted`は利用者自身の停止操作なので**エラーとして扱わない**（呼び出し側で握りつぶす）。
 */
export function normalizeRecognitionError(nativeCode: string): SpeechRecognitionErrorCode {
  switch (nativeCode) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'permission_denied';
    case 'network':
      return 'network';
    case 'no-speech':
    case 'speech-timeout':
      return 'no_speech';
    case 'audio-capture':
      return 'audio_capture';
    case 'language-not-supported':
      return 'language_not_supported';
    case 'interrupted':
      return 'interrupted';
    default:
      return 'failed';
  }
}

/**
 * on-device認識で失敗したとき、server認識で再試行する価値があるコードか。
 *
 * `supportsOnDeviceRecognition()`はnative実装上**端末既定localeのrecognizer**で判定しており
 * （`SFSpeechRecognizer()`をlocale指定なしで生成している）、いま選んでいるsource localeに
 * on-deviceモデルがある保証はない。そのため「on-deviceで一度試し、モデルが無い類の失敗なら
 * serverへ落とす」という1回限りの再試行で実効的なon-device優先を成立させる。
 *
 * 権限拒否・利用者による中断・無音は再試行しても結果が変わらないため対象外。
 */
function shouldRetryWithServer(nativeCode: string): boolean {
  return (
    nativeCode === 'language-not-supported' ||
    nativeCode === 'bad-grammar' ||
    nativeCode === 'client' ||
    nativeCode === 'unknown'
  );
}

// MARK: - 権限

export type SpeechPermissionResult =
  | { status: 'granted' }
  /** 再度ダイアログを出せる（初回未決定など） */
  | { status: 'denied'; canAskAgain: true }
  /** 二度とダイアログを出せない。設定アプリへ誘導するしかない */
  | { status: 'denied'; canAskAgain: false }
  /** nativeが無い等で判定不能 */
  | { status: 'unavailable' };

/**
 * マイクと音声認識の権限をまとめて要求する。
 *
 * iOSは一度拒否されるとアプリ内から再度ダイアログを出せないため、`canAskAgain: false`は
 * 「設定アプリへ誘導する」以外の手段が無い状態を表す（画面側で意味の無い再試行ボタンを出さないこと）。
 */
export async function requestSpeechPermissions(): Promise<SpeechPermissionResult> {
  const native = await loadNative();
  if (!native) return { status: 'unavailable' };
  try {
    const response = await native.ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (response.granted) return { status: 'granted' };
    return response.canAskAgain
      ? { status: 'denied', canAskAgain: true }
      : { status: 'denied', canAskAgain: false };
  } catch {
    return { status: 'unavailable' };
  }
}

// MARK: - 環境

export type SpeechRecognitionEnvironment = {
  /** この環境でSTTを提供できるか（nativeが読める・認識が利用可能） */
  available: boolean;
  /** 実機が対応する認識locale（地域付き）。非対応環境では空配列 */
  supportedLocales: string[];
  /** 端末既定localeでon-device認識に対応しているか（source locale別ではない点に注意） */
  supportsOnDevice: boolean;
};

/**
 * 画面初期化に必要な情報をまとめて取得する。
 *
 * **iOS以外では常に利用不可として返す。** 専用翻訳ページ自体がiOS（Apple Translation）専用であり、
 * Android/WebへSTTを広げないため（機能を無効化するだけで、追加のfallback UIは持たない）。
 */
export async function getSpeechRecognitionEnvironment(): Promise<SpeechRecognitionEnvironment> {
  const unavailable: SpeechRecognitionEnvironment = {
    available: false,
    supportedLocales: [],
    supportsOnDevice: false,
  };
  if (Platform.OS !== 'ios') return unavailable;

  const native = await loadNative();
  if (!native) return unavailable;

  const speech = native.ExpoSpeechRecognitionModule;
  try {
    if (!speech.isRecognitionAvailable()) return unavailable;
  } catch {
    return unavailable;
  }

  let supportsOnDevice = false;
  try {
    supportsOnDevice = speech.supportsOnDeviceRecognition();
  } catch {
    // 判定できないだけ。server認識で成立するため利用不可にはしない
  }

  try {
    const result = await speech.getSupportedLocales({});
    return { available: true, supportedLocales: result.locales, supportsOnDevice };
  } catch {
    // 一覧が取れないとlocale解決ができない＝マイクを出せない
    return { ...unavailable, supportsOnDevice };
  }
}

// MARK: - セッション

export type RecognitionCallbacks = {
  /** 認識途中の文字列。**入力欄へ書かず補助表示にとどめること**（確定は`onFinal`のみ） */
  onInterim: (text: string) => void;
  /** 確定文字列。呼び出し側で`clampInputLength`を通して入力欄へ反映する */
  onFinal: (text: string) => void;
  /** 正常・異常を問わずセッションが終わった。ここでAVAudioSessionは解放済み */
  onEnd: () => void;
  /** 利用者へ見せるべき失敗。`aborted`（利用者操作）はここへ来ない */
  onError: (code: SpeechRecognitionErrorCode) => void;
};

export type StartRecognitionParams = {
  /** `resolveSpeechLocale`が実機一覧から選んだlocale。推測値を渡さないこと */
  locale: string;
  /** on-deviceを優先するか（`getSpeechRecognitionEnvironment().supportsOnDevice`） */
  preferOnDevice: boolean;
};

type ActiveSession = {
  id: number;
  locale: string;
  callbacks: RecognitionCallbacks;
  /** 現在の試行がon-deviceか */
  onDevice: boolean;
  /** 何らかのresult（interim含む）を受け取ったか（受け取った後はserver再試行しない） */
  receivedResult: boolean;
  /** 確定結果を受け取ったか */
  receivedFinal: boolean;
  /**
   * final断片の累積状態。
   *
   * `continuous:true`でセッションを継続させると、iOS18の疑似final回避策により
   * `isFinal:true`のイベントが複数回・断片で届く（`speech-transcript-accumulator.ts`参照）。
   * ここで全文へ再構成してから`onFinal`へ渡す。
   */
  finalAccumulator: TranscriptAccumulatorState;
  /** 直近のinterim。finalが一度も来ないまま終わった場合の救済に使う */
  lastInterim: string;
  /** `end`到達時にserver認識で再試行するか */
  retryWithServer: boolean;
  /** 停止要求済み（`onEnd`の二重発火を防ぐ） */
  finished: boolean;
};

let sessionCounter = 0;
let activeSession: ActiveSession | null = null;
let subscriptions: Subscription[] = [];

function clearSubscriptions(): void {
  for (const subscription of subscriptions) {
    try {
      subscription.remove();
    } catch {
      // 解除の失敗は回復手段が無い。二重解除でも落とさない
    }
  }
  subscriptions = [];
}

/**
 * AVAudioSessionを非活性化する。**冪等**。
 *
 * `end`イベントと画面のfocus cleanupの両方から呼ばれる前提で、二重に呼ばれても
 * 例外を投げない。iOS以外・native未読み込み・API不在では何もしない。
 */
export async function releaseAudioSession(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const native = await loadNative();
  if (!native) return;
  try {
    native.ExpoSpeechRecognitionModule.setAudioSessionActiveIOS(false, {
      notifyOthersOnDeactivation: true,
    });
  } catch (error) {
    // 既に非活性・他が掴んでいる等でthrowしうる。ここで失敗しても回復手段は無い
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[SpeechRecognition] audio sessionの非活性化に失敗しました', error);
    }
  }
}

/** セッションを終了状態にし、購読解除・session解放・`onEnd`通知までを1回だけ行う */
async function finishSession(session: ActiveSession): Promise<void> {
  if (session.finished) return;
  session.finished = true;
  clearSubscriptions();
  if (activeSession?.id === session.id) activeSession = null;

  /*
   * finalが来ないまま終わったが途中経過はあった場合、最後のinterimを確定として拾う。
   * これをしないと「話した文字が画面に出ていたのに、終了と同時に消えて入力欄も空」に
   * なり、利用者からは何も起きなかったように見える（nomatchや部分認識後の終了で発生する）。
   */
  if (!session.receivedFinal && session.lastInterim.trim() !== '') {
    session.callbacks.onFinal(session.lastInterim);
  }

  // 契約: 認識が終わったら必ずAVAudioSessionを解放する
  await releaseAudioSession();
  session.callbacks.onEnd();
}

/** 実際に`start`を投げる（初回・server再試行の共通経路） */
function invokeStart(speech: SpeechRecognitionModule, session: ActiveSession): void {
  speech.start({
    lang: session.locale,
    // 途中経過を見せるため取得する。入力欄へ書き込むのは`isFinal`のときだけ
    interimResults: true,
    /*
     * continuous:trueにしている理由（Human実機で発話途中に勝手に終了する不具合の原因）:
     *
     * installed expo-speech-recognition（56.0.3）のiOS実装は、Appleのバグ
     * （iOS18で`result.isFinal`が真の意味で発火しないケースがある）の回避策として、
     * `speechRecognitionMetadata.speechDuration > 0`を「final相当」とみなす
     * （ExpoSpeechRecognizer.swift）。native側はこの「疑似final」を検出すると、
     * `continuous:false`のときだけ即座にセッションをreset（終了）する。
     * `speechDuration`は時間経過で単調増加するため、この「疑似final」は
     * 発話開始から数秒以内にほぼ確実に発生し、これが「話している途中で勝手に
     * 終了する」症状の直接原因だった（`!continuous`がreset条件に含まれるため）。
     *
     * continuous:trueにするとこのreset早期発火が起きなくなり、Humanが明示的に
     * stopするまでセッションが継続する。
     *
     * 副作用: 上記の「疑似final」検出以降、native側は`isFinal:true`のイベントを
     * 断片で複数回送るようになる（result のハンドラ側で`speech-transcript-accumulator`
     * により全文へ再構成している）。
     *
     * また、無音での自動終了（旧`continuous:false`時の3秒無音timer）はこの変更で
     * 提供されなくなる。今回は「話している間に勝手に切れない」ことを優先し、
     * 独自の無音timerは追加しない（将来必要なら別工程で設計する）。
     */
    continuous: true,
    requiresOnDeviceRecognition: session.onDevice,
    addsPunctuation: true,
    maxAlternatives: 1,
    // iosCategoryは既定（playAndRecord / measurement）のまま。
    // 独自調整はせず、後片付け（setActive(false)）だけをアプリ側の責務とする
  });
}

/**
 * 音声認識を開始する。
 *
 * 既に動作中のセッションがあれば先に破棄してから開始する（二重startを防ぐ）。
 * 開始できなかった場合は`false`を返し、`onEnd`は呼ばれない。
 */
export async function startRecognition(
  params: StartRecognitionParams,
  callbacks: RecognitionCallbacks,
): Promise<boolean> {
  const native = await loadNative();
  if (!native) return false;
  const speech = native.ExpoSpeechRecognitionModule;

  // 直前のセッションが残っていれば確実に畳む（購読も解除される）
  await abortRecognition();

  sessionCounter += 1;
  const session: ActiveSession = {
    id: sessionCounter,
    locale: params.locale,
    callbacks,
    onDevice: params.preferOnDevice,
    receivedResult: false,
    receivedFinal: false,
    finalAccumulator: EMPTY_TRANSCRIPT_ACCUMULATOR,
    lastInterim: '',
    retryWithServer: false,
    finished: false,
  };
  activeSession = session;

  /** 自分が現行セッションのときだけ処理する（遅れて届くイベントを捨てる） */
  const isCurrent = () => activeSession?.id === session.id && !session.finished;

  subscriptions = [
    speech.addListener('result', (event) => {
      if (!isCurrent()) return;
      const transcript = event.results[0]?.transcript ?? '';
      session.receivedResult = true;
      if (event.isFinal) {
        /*
         * iOS18では疑似final検出以降、この分岐に複数回入りうる。断片を累積して
         * 全文へ再構成した上で、都度`onFinal`を呼ぶ（画面側は置換のままでよい。
         * 渡す文字列自体が最新の累積全文になるため）。
         */
        session.receivedFinal = true;
        session.finalAccumulator = accumulateFinalTranscript(session.finalAccumulator, transcript);
        session.lastInterim = '';
        callbacks.onFinal(joinTranscript(session.finalAccumulator));
      } else {
        // finalが一度も来ないまま終わったときの救済に使うため保持する
        session.lastInterim = transcript;
        callbacks.onInterim(transcript);
      }
    }),

    speech.addListener('error', (event) => {
      if (!isCurrent()) return;

      // on-deviceで始めて「モデルが無い」類で落ちた場合のみ、server認識へ1回だけ落とす。
      // 結果を受け取った後は再試行しない（同じ発話を二重に取り込まないため）
      if (session.onDevice && !session.receivedResult && shouldRetryWithServer(event.error)) {
        session.retryWithServer = true;
        return; // `end`到達時に再start
      }

      // 利用者自身の停止操作はエラーとして見せない
      if (event.error === 'aborted') return;
      callbacks.onError(normalizeRecognitionError(event.error));
    }),

    speech.addListener('end', () => {
      if (!isCurrent()) return;

      if (session.retryWithServer) {
        session.retryWithServer = false;
        session.onDevice = false;
        try {
          invokeStart(speech, session);
          return; // セッションは継続。`onEnd`はまだ通知しない
        } catch {
          callbacks.onError('failed');
        }
      }

      void finishSession(session);
    }),
  ];

  try {
    invokeStart(speech, session);
    return true;
  } catch {
    clearSubscriptions();
    activeSession = null;
    await releaseAudioSession();
    return false;
  }
}

/**
 * 認識を停止し、**その時点までの確定結果を受け取る**。冪等。
 * 動作中でなければ何もしない。
 */
export async function stopRecognition(): Promise<void> {
  const session = activeSession;
  if (!session || session.finished) return;
  const native = await loadNative();
  if (!native) {
    await finishSession(session);
    return;
  }
  try {
    native.ExpoSpeechRecognitionModule.stop();
  } catch {
    /*
     * `stop()`が例外を投げた場合、`end`イベントは期待できない。
     * ここで畳まないとセッションが残り、**画面に留まったままAVAudioSessionが
     * `playAndRecord` / `measurement`のまま活性**になる。
     * その状態で続けて読み上げると音量が減衰する（設計契約(A)の穴になる）。
     * focus cleanupは画面を離れるまで走らないため、この経路で必ず後片付けする。
     */
    await finishSession(session);
  }
}

/**
 * 認識を即座に破棄する（確定結果を待たない）。冪等。
 *
 * 画面離脱時に使う。購読を解除し、AVAudioSessionを解放し、`onEnd`は通知しない
 * （画面が既に離れているため、state更新を走らせない）。
 */
export async function abortRecognition(): Promise<void> {
  const session = activeSession;
  if (!session) {
    // セッションが無くてもsessionが残っている可能性があるため解放だけは行う
    clearSubscriptions();
    return;
  }

  session.finished = true;
  activeSession = null;
  clearSubscriptions();

  const native = await loadNative();
  if (native) {
    try {
      native.ExpoSpeechRecognitionModule.abort();
    } catch {
      // 既に停止済み。冪等性の契約上ここでthrowさせない
    }
  }
  await releaseAudioSession();
}
