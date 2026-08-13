import TabirateTranslationModule from './src/TabirateTranslationModule';
import type {
  TranslationAvailability,
  TranslationBatchResponse,
  TranslationPrepareResponse,
} from './src/TabirateTranslation.types';

export type {
  TranslationAvailability,
  TranslationAvailabilityStatus,
  TranslationBatchResponse,
  TranslationErrorCode,
  TranslationPrepareResponse,
  TranslationResult,
} from './src/TabirateTranslation.types';

export { TabirateTranslationHost } from './src/TabirateTranslationHost';

/**
 * Apple Translation Framework（`TranslationSession` / `LanguageAvailability`）へのラッパー。
 *
 * **実機PoC専用。本番のOCR経路・メモ候補・保存処理・DBへは接続しない。**
 *
 * `getAvailability` / `getSupportedLanguages` はホストView不要。
 * `prepare` / `translateBatch` は `TabirateTranslationHost` がマウントされている必要がある
 * （モデルDL要求可能なsessionがSwiftUIの`translationTask`経由でしか取得できないため）。
 */

/** iOS 18.0以降か。falseなら翻訳APIは一切使えない（呼び出し側は原文表示へフォールバックする）。 */
export function isSupportedOs(): boolean {
  return TabirateTranslationModule.isSupportedOs();
}

/** 実機がサポートする翻訳言語の一覧（BCP-47 minimal form）。 */
export async function getSupportedLanguages(): Promise<string[]> {
  return TabirateTranslationModule.getSupportedLanguages();
}

/** 言語ペアの状態を取得する。ホストView不要。 */
export async function getAvailability(
  source: string,
  target: string = 'ja',
): Promise<TranslationAvailability> {
  return TabirateTranslationModule.getAvailability(source, target);
}

/** 言語モデルの事前ダウンロード。未導入ならシステムの許可UI・進捗UIが出る。ホストView必須。 */
export async function prepare(
  source: string,
  target: string = 'ja',
): Promise<TranslationPrepareResponse> {
  return TabirateTranslationModule.prepare(source, target);
}

/** まとめて翻訳する。1バッチ内は同一source言語であることが前提（Apple公式指針）。ホストView必須。 */
export async function translateBatch(
  texts: string[],
  source: string,
  target: string = 'ja',
): Promise<TranslationBatchResponse> {
  return TabirateTranslationModule.translateBatch(texts, source, target);
}

/** 未処理リクエストを破棄する。 */
export async function cancelAll(): Promise<void> {
  return TabirateTranslationModule.cancelAll();
}
