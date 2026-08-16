/**
 * 専用翻訳ページの純粋ロジック。**react-native・nativeモジュール・`@/`エイリアスを一切importしない。**
 *
 * この制約は意図的で、`node --test`から`await import('./text-translation-core.ts')`で
 * 直接検証できる状態を保つためにある（既存の`src/utils/extract-prices.test.mjs`と同じ方式。
 * Nodeの型ストリップで動くため、追加のテスト基盤・トランスパイルを必要としない）。
 * 通貨→source言語の解決（`getTranslationSourceLanguage`）もここでは呼ばず、
 * 解決済みのhintを引数で受け取る。
 *
 * 既存のOCRメモ候補翻訳（`translation-service.ts` / `memo-candidate-display.ts`）とは
 * 完全に独立。あちらは`MemoCandidate`と重複原文の排除を前提にしており、自由入力には使えない。
 */

/** 翻訳先の既定。専用翻訳ページでもユーザーが変更できるため「固定」ではなく「初期値」 */
export const DEFAULT_TARGET_LANGUAGE = 'ja';

/** 通貨hintが使えない場合のsource既定 */
export const DEFAULT_SOURCE_LANGUAGE = 'en';

/**
 * 入力できる最大文字数。`TextInput`の`maxLength`として**実際に強制する**
 * （警告だけ出して超過入力を許すと、失敗の原因がユーザーから見えないため）。
 *
 * 初版は安全側の1000。nativeには文字数・件数の上限チェックが一切存在せず
 * （Swift側にガードなし）、実運用で実証済みなのはOCRメモ候補の「最大8行の短い文字列」だけである。
 * 長文を1リクエストで通す方式は本ページが初めてなので、まず1000で実機検証し、
 * 問題がなければこの定数だけを引き上げる。UIモックの5000は未検証の値のため採用しない。
 */
export const MAX_TRANSLATION_INPUT_LENGTH = 1000;

/**
 * 「時間がかかっています」の補助文言を出すまでの待ち時間(ms)。
 * これは**表示だけ**のタイマーで、翻訳処理そのものは絶対に打ち切らない
 * （初回の言語モデルDLはApple側の管理下で正当に数十秒かかりうるため）。
 */
export const SLOW_TRANSLATION_HINT_MS = 5000;

/**
 * 初期のsource/target言語を決める。
 *
 * `sourceHint`は通貨由来の推測（`getTranslationSourceLanguage()`の戻り値）。
 * **実機の`supported`に存在しない場合は採用しない** — 採用すると「自分のリストに無い値」で
 * 言語ピッカーが開いてしまうため（例: 端末によって`zh-Hant`が解決されないケース）。
 *
 * `supported`が空（iOS18未満・取得失敗）でも例外を投げず既定値を返す。
 * その状況では画面側がピッカー自体を描かないため、ここでの値は使われない。
 */
export function resolveInitialLanguages(
  sourceHint: string | null | undefined,
  supported: readonly string[],
): { source: string; target: string } {
  const list = supported ?? [];
  const has = (code: string) => list.includes(code);

  // target: 既定はja。実機がjaを持たない想定外ケースでも壊さない
  const target = has(DEFAULT_TARGET_LANGUAGE)
    ? DEFAULT_TARGET_LANGUAGE
    : (list[0] ?? DEFAULT_TARGET_LANGUAGE);

  // source: 通貨hint → en → targetと異なる任意の対応言語 → en の順で降りる
  let source: string;
  if (sourceHint != null && sourceHint !== target && has(sourceHint)) {
    source = sourceHint;
  } else if (DEFAULT_SOURCE_LANGUAGE !== target && has(DEFAULT_SOURCE_LANGUAGE)) {
    source = DEFAULT_SOURCE_LANGUAGE;
  } else {
    source = list.find((code) => code !== target) ?? DEFAULT_SOURCE_LANGUAGE;
  }

  return { source, target };
}

/** 明示的に選ばれたsource/target言語（片方でも選ばれたら両方nullではなくなる） */
export type LanguageOverride = { source: string | null; target: string | null };

/**
 * 言語選択画面でsource/targetの片方だけを選び直した結果を、既存のoverrideへ合成する。
 *
 * `current`には「触られなかった側」の現在値を渡す（呼び出し側の責任）。これを
 * `current`からそのままoverrideへ書き写すことで、「片方だけが明示state、もう片方は
 * 初期値へ暗黙に結合されたまま」という状態を作らない。これを怠ると、後続の
 * `swapLanguages`が暗黙結合側の値を巻き込み、意図せず初期値（旅行設定由来）を
 * re-adoptしてしまう。
 */
export function applyLanguagePick(
  field: 'source' | 'target',
  picked: string,
  current: LanguageOverride,
): LanguageOverride {
  return field === 'source'
    ? { source: picked, target: current.target }
    : { source: current.source, target: picked };
}

/** source/targetを入れ替える。両方が明示stateとして確定した状態を維持する */
export function swapLanguages(current: LanguageOverride): LanguageOverride {
  return { source: current.target, target: current.source };
}

/** 翻訳元と翻訳先が同じか。エラーではなく「実行できない状態」として扱う */
export function isSameLanguage(source: string | null, target: string | null): boolean {
  return source != null && target != null && source === target;
}

/** 翻訳を実行できる入力か（空白のみは対象外） */
export function hasTranslatableInput(text: string): boolean {
  return text.trim().length > 0;
}

/** 入力を上限で切り詰める。`maxLength`と併用する保険（貼り付け経路の取りこぼし対策） */
export function clampInputLength(text: string): string {
  return text.length <= MAX_TRANSLATION_INPUT_LENGTH
    ? text
    : text.slice(0, MAX_TRANSLATION_INPUT_LENGTH);
}

// MARK: - 行分割フォールバック（初版の実行経路では未使用）

/*
 * 初版の主案は「入力全文を1つのRequestとして送る」（文脈と改行構造を保てるため）。
 * 以下は、実機検証で改行が潰れる・長文で品質が落ちることが判明した場合に
 * 切り替えるための第2案。**主案が成立する限り実行経路では使わない。**
 * 切り替えコストをゼロにするため、初版から純粋関数として置きテストも通しておく。
 */

/** 改行で分割する。空行も位置を保持するため捨てない */
export function splitTextForTranslation(text: string): string[] {
  return text.split('\n');
}

/** 翻訳対象になる行（空白のみの行を除く）を、元のindex付きで集める */
export function collectTranslatableLines(
  lines: readonly string[],
): { index: number; text: string }[] {
  const result: { index: number; text: string }[] = [];
  lines.forEach((line, index) => {
    if (line.trim().length > 0) result.push({ index, text: line });
  });
  return result;
}

/**
 * 訳文を元の行構造へ戻す。訳が無い行（空行・失敗行）は原文のまま残す。
 * 空行の位置・連続改行・末尾改行はすべて保持される。
 */
export function rejoinTranslatedLines(
  lines: readonly string[],
  translationsByIndex: ReadonlyMap<number, string>,
): string {
  return lines.map((line, index) => translationsByIndex.get(index) ?? line).join('\n');
}
