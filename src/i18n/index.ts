/**
 * 多言語の入口（GX-01・2026-11-28）。画面は `useT()`、画面の外（Alert の組み立て等）は `getT()` を使う。
 *
 * ■ 表示言語の決め方（H-GX02 の仮決定：iOS のアプリ別言語を基準にする）
 *   - 端末の言語の一覧から `resolveAppLanguage` で決める。iOS ではアプリ別の言語を変えるとアプリが再起動されるので、
 *     起動時に1回読めば足りる（Expo v56 localization の文書）
 *   - 端末の言語の取得は GX-02 で `expo-localization` に替える。それまでは `Intl` の既定のロケールを使う
 *   - アプリ内の切り替え（`setLanguage`）は Web と開発画面のためのもの。iOS では権限ダイアログ・StoreKit・通知が
 *     iOS 側の言語に従うので、本番はアプリ内で言語を変えない
 *   - `SHOW_MULTILINGUAL_UI` が false の間は常に日本語（`DEV_MULTILINGUAL_PREVIEW` の時だけ端末の言語・切り替え）
 */
import { create } from 'zustand';

import { DEV_MULTILINGUAL_PREVIEW, SHOW_MULTILINGUAL_UI } from '@/config/feature-flags';

import { DICTIONARIES, type MessageKey } from './dict/index';
import {
  type AppLanguage,
  collectPreferredTags,
  createTranslator,
  decideInitialLanguage,
  formatLocaleOf,
  type Params,
  resolveAppLanguage,
  SOURCE_LANGUAGE,
} from './i18n-core';

export type { AppLanguage, MessageKey, Params };
export { APP_LANGUAGES, formatLocaleOf, isAppLanguage } from './i18n-core';

const MULTILINGUAL = SHOW_MULTILINGUAL_UI || DEV_MULTILINGUAL_PREVIEW;

function intlLocale(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return undefined; // Intl が無い環境では端末の言語を使わない
  }
}

type Globals = { navigator?: { languages?: readonly string[]; language?: string }; window?: unknown; document?: unknown };

function deviceTags(): string[] {
  return collectPreferredTags((globalThis as Globals).navigator, intlLocale());
}

function initialLanguage(): AppLanguage {
  const g = globalThis as Globals;
  // React Native は window を定義するが document は無い。window が無い（Web の静的出力）か document がある（ブラウザ）なら Web
  const isWeb = typeof g.window === 'undefined' || typeof g.document !== 'undefined';
  return decideInitialLanguage({ multilingual: MULTILINGUAL, isWeb, preferredTags: deviceTags() });
}

interface I18nStore {
  language: AppLanguage;
  /** Web と開発画面のための切り替え（本番の iOS は iOS の設定に従う） */
  setLanguage: (language: AppLanguage) => void;
}

export const useI18nStore = create<I18nStore>((set) => ({
  language: initialLanguage(),
  setLanguage: (language) => set({ language: MULTILINGUAL ? language : SOURCE_LANGUAGE }),
}));

/**
 * 端末（ブラウザ）の言語へ切り替える。Web はルートのレイアウトのマウントの後に1回呼ぶ（GX-02 で配線）。
 * 多言語が無効なら何もしない（日本語のまま）。
 */
export function applyDeviceLanguage(): void {
  if (!MULTILINGUAL) return;
  useI18nStore.setState({ language: resolveAppLanguage(deviceTags()) });
}

export type TypedTranslator = (key: MessageKey, params?: Params) => string;

const translators = new Map<AppLanguage, TypedTranslator>();

/** 言語ごとに1つの関数を使い回す（`useT()` の戻り値を依存配列に入れても描き直しが続かない） */
function translatorFor(language: AppLanguage): TypedTranslator {
  let t = translators.get(language);
  if (!t) {
    t = createTranslator(DICTIONARIES, language) as TypedTranslator;
    translators.set(language, t);
  }
  return t;
}

/** 画面用。表示言語が変わると描き直す */
export function useT(): TypedTranslator {
  const language = useI18nStore((s) => s.language);
  return translatorFor(language);
}

export function useAppLanguage(): AppLanguage {
  return useI18nStore((s) => s.language);
}

/** 画面の外用（呼んだ時点の表示言語） */
export function getT(): TypedTranslator {
  return translatorFor(useI18nStore.getState().language);
}

export function getAppLanguage(): AppLanguage {
  return useI18nStore.getState().language;
}

/** 日付・数値の書式に渡すロケール（表示言語から決める。端末の地域ではない） */
export function getFormatLocale(): string {
  return formatLocaleOf(getAppLanguage());
}
