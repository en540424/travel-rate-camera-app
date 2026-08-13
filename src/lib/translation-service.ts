/**
 * メモ候補のオンデバイス翻訳（Apple Translation Framework）を包む中間層。
 *
 * **Phase 1: 本番のOCR経路・メモ候補UI・保存処理・DBへは接続していない。**
 * `modules/translation`（native）を本番コードから直接呼ばせず、この層だけが触る。
 *
 * 責務: OS/言語可否の判定・`translateBatch`のラップ・`MemoCandidate[]`生成・
 * エラー正規化・原文フォールバック・セッション内メモリcache・キャンセル・世代値のpassthrough。
 *
 * 責務外（意図的に持たない）:
 * - UI文字列（「翻訳中」「翻訳できません」等）→ 画面側の責務
 * - React state管理・世代の一致判定 → 呼び出し側の責務
 * - `TabirateTranslationHost`のマウント → React側の責務
 * - 永続化・DB → Phase 4/5で人間判断
 *
 * 正本: Vault `旅レートカメラ_多言語OCR・翻訳・テキスト入力_中核構想設計書_v1.md` §31
 */
import type {
  MemoCandidate,
  MemoTranslationErrorCode,
  MemoTranslationStatus,
  TranslateMemoLinesParams,
  TranslateMemoLinesResult,
} from './translation-types';
import type {
  TranslationAvailabilityStatus,
  TranslationResult,
} from '../../modules/translation';

/** 翻訳先は`ja`固定。候補ごとに持たせる要件はない（正本§31） */
export const MEMO_TRANSLATION_TARGET_LANGUAGE = 'ja';

/**
 * `getAvailability`のハングガード。
 * availabilityはローカルのメタデータ参照で通常は数十ms、この値はUXの目標値ではなく
 * 「解決も拒否もしないまま止まる」事象（PoCで一度だけ発生・原因未確定）から抜け出すための上限。
 *
 * `translateBatch`にはtimeoutを設けない。モデルDLはApple側の管理下で正当に数十秒かかりうるため、
 * 打ち切るとDL中のユーザーを誤って失敗扱いにしてしまう（正本§31 エラー設計）。
 */
const AVAILABILITY_TIMEOUT_MS = 5000;

/** メモリcacheの上限。超えたら挿入順に古いものから捨てる（セッション内の想定件数に対して十分広い） */
const TRANSLATION_CACHE_LIMIT = 200;

type TranslationNative = typeof import('../../modules/translation');

/** 翻訳が成功した1件分。cacheの値であり、結果マージの中間表現でもある */
export type CachedTranslation = {
  translatedText: string;
  resolvedSourceLanguage: string;
};

/** 成功した翻訳のみを保持するセッション内メモリcache。永続化しない（正本§31） */
const translationCache = new Map<string, CachedTranslation>();
/** 成功したavailability取得のみを保持する。失敗・timeoutは保存しない（1度の不調で言語ペアを塞がないため） */
const availabilityCache = new Map<string, TranslationAvailabilityStatus>();

let nativeModulePromise: Promise<TranslationNative | null> | undefined;

/**
 * nativeモジュールを遅延読み込みする（読み込み結果は成否を問わず1回だけ確定させる）。
 *
 * 静的importにしないのは、Androidには`TabirateTranslationModule`の実体がなく
 * `requireNativeModule`がimport時点で例外を投げるため。読めない環境ではnullを返し、
 * 呼び出し側は原文フォールバックへ進む。
 */
function loadTranslationNative(): Promise<TranslationNative | null> {
  if (nativeModulePromise) return nativeModulePromise;
  nativeModulePromise = import('../../modules/translation').catch((error: unknown) => {
    // iOSでの本物の退行と「この環境では翻訳非対応」を区別できるようにする（開発ビルドのみ）
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[TranslationService] translation moduleを読み込めませんでした', error);
    }
    return null;
  });
  return nativeModulePromise;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`TIMEOUT: ${label} did not settle within ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// MARK: - 純粋関数（テスト対象）

/**
 * cacheキー。区切り文字の衝突を避けるためJSON配列としてエンコードする。
 *
 * `resolvedSourceLanguage`は翻訳前には分からないためキーに使わない。
 * `originalText`は完全一致で扱う（`extractMemoLines`側の`toUpperCase`重複排除に合わせない。
 * 大文字小文字は訳文に影響するうえ、identityの正本は原文そのものであるため）。
 */
export function buildTranslationCacheKey(
  sourceLanguage: string,
  targetLanguage: string,
  originalText: string,
): string {
  return JSON.stringify([sourceLanguage, targetLanguage, originalText]);
}

/**
 * 翻訳開始前の候補を作る。OCR完了直後に原文のまま即表示するための入口。
 * 空行・空白のみの行は翻訳対象にしないため`idle`のままにする（件数・順序は維持する）。
 */
export function createPendingCandidates(
  lines: string[],
  requestedSourceLanguage: string,
): MemoCandidate[] {
  return lines.map((line) => ({
    originalText: line,
    requestedSourceLanguage,
    translationStatus: line.trim().length === 0 ? 'idle' : 'pending',
  }));
}

/** 未翻訳（pending）の候補だけを指定の状態にする。訳文が入った候補は上書きしない */
function markUntranslated(
  candidates: MemoCandidate[],
  status: MemoTranslationStatus,
  errorCode?: MemoTranslationErrorCode,
): MemoCandidate[] {
  return candidates.map((candidate) =>
    candidate.translationStatus === 'pending'
      ? { ...candidate, translationStatus: status, errorCode }
      : candidate,
  );
}

/**
 * cacheを適用し、nativeへ送るテキストを決める。
 * 送るのは「未翻訳かつ空でない原文」を完全一致で重複排除したもの。
 * 同じ原文が複数行あっても1回だけ送り、結果は全行へ反映する。
 */
export function planTranslationBatch(
  candidates: MemoCandidate[],
  cache: Map<string, CachedTranslation>,
  sourceLanguage: string,
  targetLanguage: string,
): { candidates: MemoCandidate[]; texts: string[] } {
  const texts: string[] = [];
  const queued = new Set<string>();

  const planned = candidates.map((candidate) => {
    if (candidate.translationStatus !== 'pending') return candidate;

    const cached = cache.get(
      buildTranslationCacheKey(sourceLanguage, targetLanguage, candidate.originalText),
    );
    if (cached) {
      return {
        ...candidate,
        translatedText: cached.translatedText,
        resolvedSourceLanguage: cached.resolvedSourceLanguage,
        translationStatus: 'translated' as const,
        errorCode: undefined,
      };
    }

    if (!queued.has(candidate.originalText)) {
      queued.add(candidate.originalText);
      texts.push(candidate.originalText);
    }
    return candidate;
  });

  return { candidates: planned, texts };
}

/**
 * nativeの結果を原文へ突き合わせる。
 *
 * `clientIdentifier`はnative側で「送信順indexの文字列」だが、Swiftの`response.clientIdentifier ?? ""`
 * により空文字になりうる（その場合`Number('')`は0になり先頭行へ誤爆する）。
 * そのため「有効な範囲内の整数のときだけ採用し、そうでなければ並び順」で解決したうえで、
 * `sourceText`が一致しない場合は`sourceText`の完全一致で引き直す。
 *
 * indexの空間は呼び出し側の`lines`ではなく、**重複排除後に送信した`requestedTexts`**である点に注意。
 */
export function resolveTranslationsByOriginalText(
  requestedTexts: string[],
  results: TranslationResult[],
): Map<string, CachedTranslation> {
  const resolved = new Map<string, CachedTranslation>();

  results.forEach((result, position) => {
    const identifier = Number(result.clientIdentifier);
    const byIdentifier =
      result.clientIdentifier !== '' &&
      Number.isInteger(identifier) &&
      identifier >= 0 &&
      identifier < requestedTexts.length
        ? identifier
        : position;

    let originalText: string | undefined =
      byIdentifier < requestedTexts.length ? requestedTexts[byIdentifier] : undefined;

    // 対応がずれている場合は原文そのもので引き直す（重複排除済みなので一意に決まる）
    if (originalText !== result.sourceText) {
      originalText = requestedTexts.find((text) => text === result.sourceText);
    }
    if (originalText === undefined) return;

    resolved.set(originalText, {
      translatedText: result.translatedText,
      resolvedSourceLanguage: result.sourceLanguage,
    });
  });

  return resolved;
}

/**
 * 翻訳結果を候補へ反映する。
 * 送ったのに結果が返らなかった原文は`failed`（原文は保持する）。
 * cache由来で既に`translated`の候補・空行の`idle`候補には触れない。
 */
export function applyTranslationResults(
  candidates: MemoCandidate[],
  resolved: Map<string, CachedTranslation>,
): MemoCandidate[] {
  return candidates.map((candidate) => {
    if (candidate.translationStatus !== 'pending') return candidate;

    const translation = resolved.get(candidate.originalText);
    if (!translation) {
      return {
        ...candidate,
        translationStatus: 'failed' as const,
        errorCode: 'translation_failed' as const,
      };
    }
    return {
      ...candidate,
      translatedText: translation.translatedText,
      resolvedSourceLanguage: translation.resolvedSourceLanguage,
      translationStatus: 'translated' as const,
      errorCode: undefined,
    };
  });
}

/**
 * nativeのエラーを本番側の分類へ正規化する。
 *
 * `ERR_TRANSLATION_CANCELLED`が実際には`ERR_TRANSLATION_FAILED`として表面化する可能性は未確認のため、
 * nativeコードだけを絶対視しない。stale結果の遮断は世代値（`generation`）の一致判定が正であり、
 * この分類はあくまで表示・診断用の補助情報として扱う。
 */
export function normalizeTranslationError(error: unknown): {
  status: MemoTranslationStatus;
  errorCode: MemoTranslationErrorCode;
} {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;

  switch (code) {
    case 'ERR_TRANSLATION_UNSUPPORTED_OS':
      return { status: 'unavailable', errorCode: 'unsupported_os' };
    case 'ERR_TRANSLATION_HOST_UNAVAILABLE':
    case 'ERR_TRANSLATION_HOST_UNMOUNTED':
      return { status: 'failed', errorCode: 'host_unavailable' };
    case 'ERR_TRANSLATION_CANCELLED':
      // キャンセルはユーザーへ見せるエラーではない。新しい世代の結果で置き換わる前提でidleへ戻す
      return { status: 'idle', errorCode: 'cancelled' };
    default:
      return { status: 'failed', errorCode: 'translation_failed' };
  }
}

// MARK: - cache操作

function rememberTranslations(
  resolved: Map<string, CachedTranslation>,
  sourceLanguage: string,
  targetLanguage: string,
): void {
  for (const [originalText, translation] of resolved) {
    const key = buildTranslationCacheKey(sourceLanguage, targetLanguage, originalText);
    translationCache.delete(key);
    translationCache.set(key, translation);
  }
  while (translationCache.size > TRANSLATION_CACHE_LIMIT) {
    const oldest = translationCache.keys().next();
    if (oldest.done) break;
    translationCache.delete(oldest.value);
  }
}

/** 画面のセッションを跨いで持ち越したくない場合・検証時に使う */
export function clearTranslationCaches(): void {
  translationCache.clear();
  availabilityCache.clear();
}

// MARK: - native呼び出し

async function resolveAvailabilityStatus(
  native: TranslationNative,
  sourceLanguage: string,
  targetLanguage: string,
): Promise<TranslationAvailabilityStatus> {
  // 言語ペアだけをキーにする（原文は関係しないため空文字。translationCacheとは別Mapなので衝突しない）
  const key = buildTranslationCacheKey(sourceLanguage, targetLanguage, '');
  const cached = availabilityCache.get(key);
  if (cached) return cached;

  try {
    const availability = await withTimeout(
      native.getAvailability(sourceLanguage, targetLanguage),
      AVAILABILITY_TIMEOUT_MS,
      `getAvailability(${sourceLanguage}→${targetLanguage})`,
    );
    availabilityCache.set(key, availability.status);
    return availability.status;
  } catch {
    // 失敗・timeoutはcacheしない。availabilityは参考情報であり、
    // 取得できなくても`translateBatch`の成否を正として先へ進む（正本§31）
    return 'unknown';
  }
}

/**
 * メモ候補行をまとめて翻訳する。
 *
 * **rejectしない。** 翻訳の失敗でOCR成功を無効化しないため、どの経路でも
 * `lines`と同じ順序・同じ件数の`MemoCandidate[]`を返し、原文は必ず保持する。
 *
 * `prepare`は呼ばない。モデル未導入の場合はApple標準のDL許可UIが`translateBatch`時に出る
 * （PoCで実機確認済み）。`availability`が`installed`でもDL UIが出る場合があるため、
 * availabilityは参考情報としてのみ使い、最終判断はtranslateの成否に委ねる。
 *
 * 呼び出し規約:
 * - `translateBatch`は`TabirateTranslationHost`がマウントされている間しか成功しない（未マウントなら`host_unavailable`）
 * - 新しい世代の翻訳を始める前に`cancelTranslation()`を呼び、古い要求をnative側で破棄する
 * - 返ってきた`generation`が現在の世代と一致するかは呼び出し側で判定し、一致しなければ結果を捨てる
 */
export async function translateMemoLines({
  lines,
  sourceLanguage,
  targetLanguage = MEMO_TRANSLATION_TARGET_LANGUAGE,
  generation,
}: TranslateMemoLinesParams): Promise<TranslateMemoLinesResult> {
  // `extractMemoLines`は最大8行。1回の`translateBatch`で足りるため行ごとにsessionを作らない
  const initial = createPendingCandidates(lines, sourceLanguage);
  if (initial.length === 0) return { generation, candidates: initial };

  const native = await loadTranslationNative();
  if (!native || !isTranslationOsSupported(native)) {
    return { generation, candidates: markUntranslated(initial, 'unavailable', 'unsupported_os') };
  }

  const availability = await resolveAvailabilityStatus(native, sourceLanguage, targetLanguage);
  if (availability === 'unsupported') {
    return {
      generation,
      candidates: markUntranslated(initial, 'unavailable', 'unsupported_language'),
    };
  }

  const plan = planTranslationBatch(initial, translationCache, sourceLanguage, targetLanguage);
  if (plan.texts.length === 0) return { generation, candidates: plan.candidates };

  try {
    const response = await native.translateBatch(plan.texts, sourceLanguage, targetLanguage);
    const resolved = resolveTranslationsByOriginalText(plan.texts, response.results);
    rememberTranslations(resolved, sourceLanguage, targetLanguage);
    return { generation, candidates: applyTranslationResults(plan.candidates, resolved) };
  } catch (error) {
    const { status, errorCode } = normalizeTranslationError(error);
    return { generation, candidates: markUntranslated(plan.candidates, status, errorCode) };
  }
}

/** iOS 18.0以降か。nativeが何らかの理由で応答しない場合も非対応として扱う */
function isTranslationOsSupported(native: TranslationNative): boolean {
  try {
    return native.isSupportedOs();
  } catch {
    return false;
  }
}

/**
 * native側の未処理リクエストを破棄する。
 * 再読み取り・画面離脱・新しいOCR結果の確定時に呼ぶ想定（Phase 1では未接続）。
 * 破棄済みの要求が返す結果はキャンセル扱いになるが、stale結果の遮断は世代値の一致判定が正。
 */
export async function cancelTranslation(): Promise<void> {
  const native = await loadTranslationNative();
  if (!native) return;
  try {
    await native.cancelAll();
  } catch {
    // キャンセルの失敗は呼び出し側で回復できることがない。世代値による遮断が効くため握りつぶす
  }
}
