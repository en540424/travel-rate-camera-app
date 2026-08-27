/**
 * `expo-speech-recognition`のiOS18向け「疑似final」回避策への対処。
 *
 * **react-native・nativeモジュール・`@/`エイリアスを一切importしない。**
 * `node --test`から直接importして検証できる状態を保つため
 * （`text-translation-core.ts`と同じ規律。`speech-recognition-service.ts`は
 * react-nativeをimportしており`node --test`から読めないため、ここへ切り出した）。
 *
 * ■ なぜ必要か
 * installed `expo-speech-recognition`（56.0.3）のiOS実装は、Appleのバグ
 * （iOS18で`result.isFinal`が真の意味では発火しないケースがある）を回避するため、
 * `speechRecognitionMetadata.speechDuration > 0`を「final相当」とみなす。
 * この判定用フラグ（`hasSeenFinalResult`）は一度trueになると`stop`/`error`まで
 * リセットされず、`speechDuration`は時間経過で単調増加するため、
 * **一度「疑似final」が発生すると、以後の`result`イベントはほぼ全て`isFinal:true`として
 * 届き続ける**（native側のコメントにも複数回発生しうると明記されている）。
 *
 * `continuous:false`ではこの1回目の疑似finalでnative側が即座にセッションを終了する
 * ため表面化しない。`continuous:true`（本ページの発話途中終了バグの修正）にすると
 * セッションは継続するが、**「直近の文の断片」だけを乗せた`isFinal:true`イベントが
 * 連続して届く**ことになる。native側はセグメントの区切りに先頭スペースを付けるだけで、
 * 全文への統合はJS側の責務として設計されている。
 *
 * ■ この関数がしていること
 * 新しいfinal断片が「直前の断片の続き（延長）」か「新しい区切り」かを、
 * 前後の空白を無視した前方一致で判定する。
 *   - 延長（Appleが累積的にtranscriptionを返す場合）→ 現在の断片を置き換える
 *   - 区切り（Appleが疑似final後に新しい文としてリスタートする場合）→
 *     現在の断片を確定済み一覧へ積み、新しい断片として開始する
 * どちらの挙動でAppleが実装していても、全文を失わずに再構成できる。
 *
 * 既知の限界: 音声認識の「訂正」で文字列が短くなった場合（前方一致が崩れる）は
 * 区切りと誤判定し、直前の数文字が重複しうる。範囲が限定的なため許容する
 * （曖昧一致等の追加ロジックは持たない）。
 */

export type TranscriptAccumulatorState = {
  /** 区切りが確定した断片。区切り以降は書き換わらない */
  committed: readonly string[];
  /** 進行中の断片。延長と判定されている間はここが置き換わり続ける */
  current: string;
};

export const EMPTY_TRANSCRIPT_ACCUMULATOR: TranscriptAccumulatorState = {
  committed: [],
  current: '',
};

/**
 * 新しいfinal断片を積む。
 *
 * 比較は前後の空白を無視する（native側が区切り後の断片へ付ける先頭スペースを
 * 吸収するため）。空文字列の断片は保持しない。
 */
export function accumulateFinalTranscript(
  state: TranscriptAccumulatorState,
  rawText: string,
): TranscriptAccumulatorState {
  const text = rawText.trim();
  if (text === '') return state;

  const current = state.current.trim();
  if (current === '') {
    return { committed: state.committed, current: text };
  }

  // 延長: 新しい断片が現在の断片で始まる（同一含む）→ 同じ区切りの続きとして置き換える
  if (text.startsWith(current)) {
    return { committed: state.committed, current: text };
  }

  // 区切り: 現在の断片を確定させ、新しい断片として開始する
  return { committed: [...state.committed, current], current: text };
}

/** 確定済み断片と進行中の断片を1つの文字列へまとめる */
export function joinTranscript(state: TranscriptAccumulatorState): string {
  return [...state.committed, state.current].filter((segment) => segment !== '').join(' ');
}
