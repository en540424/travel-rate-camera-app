/**
 * 専用翻訳ページの翻訳結果読み上げ（TTS）を包む中間層。
 *
 * **`expo-speech`を画面から直接呼ばせず、この層だけが触る。**
 * 読み上げ対象は**target側の訳文のみ**（source側読み上げは提供しない）。
 *
 * 責務: nativeの遅延読み込み・voice一覧の取得・読み上げ開始/停止・エラー正規化。
 * 責務外: UI文字列、React state、voice解決（`@/config/speech-locales`の純粋関数）。
 *
 * ■ 動的import
 * `expo-speech`もnativeを要求するため、載っていないBuildでも画面を壊さないよう
 * 動的importにする（既存の`translation.tsx`の`expo-clipboard`と同じ規律）。
 *
 * ■ STT直後の音量問題への対策(B)
 * `speak`には**必ず`useApplicationAudioSession: false`を渡す**。
 * STTが張ったアプリのAVAudioSession（`playAndRecord` / `measurement`）が万一残っていても、
 * OSが読み上げ専用の別sessionを立てるため音量減衰を受けない。
 * 対策(A)（STT終了時の`releaseAudioSession()`）と二重に効かせる。
 */
import { Platform } from 'react-native';

import type { VoiceLike } from '@/config/speech-locales';

type SpeechNative = typeof import('expo-speech');

let nativeModulePromise: Promise<SpeechNative | null> | undefined;

/** nativeを遅延読み込みする（成否を問わず1回だけ確定させる） */
function loadNative(): Promise<SpeechNative | null> {
  if (nativeModulePromise) return nativeModulePromise;
  nativeModulePromise = import('expo-speech').catch((error: unknown) => {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[SpeechSynthesis] moduleを読み込めませんでした', error);
    }
    return null;
  });
  return nativeModulePromise;
}

/** 画面が扱う読み上げエラー。細かい原因は利用者に区別できないため畳む */
export type SpeechSynthesisErrorCode = 'unsupported_voice' | 'failed';

export type SpeechSynthesisEnvironment = {
  /** この環境で読み上げを提供できるか */
  available: boolean;
  /** 実機が持つvoice（voice解決に必要な最小形へ落としたもの） */
  voices: VoiceLike[];
};

/**
 * 画面初期化に必要な情報を取得する。
 *
 * **iOS以外では常に利用不可として返す。** 専用翻訳ページ自体がiOS専用であり、
 * Android/WebへTTSを広げないため。
 */
export async function getSpeechSynthesisEnvironment(): Promise<SpeechSynthesisEnvironment> {
  if (Platform.OS !== 'ios') return { available: false, voices: [] };

  const native = await loadNative();
  if (!native) return { available: false, voices: [] };

  try {
    const voices = await native.getAvailableVoicesAsync();
    return {
      available: true,
      // identifier / name / language / quality を取り出す（純粋resolverが必要とする最小形）。
      // qualityはEnhanced voice優先選択（selectEnhancedVoiceIdentifier）に使う。
      // nameはvoice選択UIの表示ラベル用（identifierはユーザーへ見せない）。
      voices: voices.map((voice) => ({
        identifier: voice.identifier,
        name: voice.name,
        language: voice.language,
        quality: voice.quality,
      })),
    };
  } catch {
    // voice一覧が取れないとvoice解決ができない＝スピーカーを出せない
    return { available: false, voices: [] };
  }
}

export type SpeakCallbacks = {
  onStart: () => void;
  /** 完了・停止いずれでも呼ばれる。画面はここで読み上げ中表示を解除する */
  onFinish: () => void;
  onError: (code: SpeechSynthesisErrorCode) => void;
};

export type SpeakParams = {
  text: string;
  /** `resolveTtsVoiceLanguage`が実機voice一覧から選んだ言語。推測値を渡さないこと */
  language: string;
  /**
   * `selectEnhancedVoiceIdentifier`が見つけたEnhanced voiceのidentifier。
   * **見つからなかった場合は`undefined`のまま渡すこと。** 存在しない/不正な
   * identifierを渡すとiOSで無音失敗しうるため、`speakText`側は値がある時だけ
   * `voice`キーを指定し、無ければ`language`のみの従来どおりの呼び出しにする。
   */
  voiceIdentifier?: string;
  /**
   * `resolveTtsRate`が翻訳言語コードから決めた読み上げ速度倍率（`1.0`が既定）。
   * 省略時はexpo-speechの既定（`1.0`相当）で読み上げる。
   */
  rate?: number;
};

/**
 * 訳文を読み上げる。
 *
 * 開始前に必ず`stopSpeaking()`を通すため、**二重tapでも二重再生にならない**
 * （`Speech.speak`は読み上げ中に呼ぶとキューへ積まれる仕様のため、明示的に潰す）。
 *
 * 空文字は何もせず`false`を返す（無音のまま「読み上げ中」表示になるのを防ぐ）。
 */
export async function speakText(
  params: SpeakParams,
  callbacks: SpeakCallbacks,
): Promise<boolean> {
  if (params.text.trim() === '') return false;

  const native = await loadNative();
  if (!native) return false;

  // 直前の読み上げが残っていれば潰してから始める（キュー積み上げ防止）
  await stopSpeaking();

  let finished = false;
  /** `onDone` / `onStopped` / `onError`のどれが先に来ても1回だけ通知する */
  const finishOnce = () => {
    if (finished) return;
    finished = true;
    callbacks.onFinish();
  };

  try {
    native.speak(params.text, {
      language: params.language,
      rate: params.rate,
      // STTが張ったsession（measurementで減衰）を引き継がないよう、OSに別sessionを立てさせる
      useApplicationAudioSession: false,
      // Enhanced voiceが見つかった時だけ指定する。見つからない言語では`voice`キー自体を
      // 渡さず、従来どおりlanguageのみでOS既定voiceに任せる（存在しないidentifierを
      // 渡すと無音失敗しうるため、「悪化させない」を条件付きスプレッドで徹底する）。
      ...(params.voiceIdentifier ? { voice: params.voiceIdentifier } : {}),
      onStart: callbacks.onStart,
      onDone: finishOnce,
      onStopped: finishOnce,
      onError: () => {
        if (finished) return;
        finished = true;
        callbacks.onError('failed');
      },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 読み上げを停止する。**冪等**。
 * 再tapによるtoggle停止と、画面離脱時のcleanupの両方から呼ばれる。
 */
export async function stopSpeaking(): Promise<void> {
  const native = await loadNative();
  if (!native) return;
  try {
    await native.stop();
  } catch {
    // 読み上げ中でない場合等。二重停止でも落とさないのがこの層の契約
  }
}
