/**
 * 多言語の共通コア（GX-01・2026-11-28）。React・RN・ライブラリに依存しない純粋関数だけを置く。
 *
 * ■ 言語の登録表（`APP_LANGUAGES`）
 *   アプリが画面を表示できる言語。**言語を足す時はここと辞書（`dict/`）だけを足す**（タイ語は次の候補）。
 *   表示言語は「通貨」「旅行先」と独立（言語と通貨を一対一で結び付けない）。
 *
 * ■ 辞書
 *   キーは平らな文字列（`'trip.create.title'`）。値は文字列か、複数形の `{ one, other }`。
 *   `{name}` は補間。語順は言語ごとに文全体で持つ（文を断片に割らない）。
 *   ja が正本の辞書で、他の言語は同じキーを持つ（`i18n-dict.test.mjs` が一致を検査する）。
 *
 * ■ 欠けたキー
 *   表示言語 → 英語 → 日本語 の順に探し、どれにも無ければキーそのものを返す（画面を壊さない）。
 *   本番で欠けが出ないことは検査（GX-03）で担保する。
 *
 * ■ 複数形
 *   Hermes の `Intl.PluralRules` の対応を確かめていないため使わない。
 *   ja・ko・zh-Hant は数で語形が変わらない（常に other）。en は 1 だけ one。
 */

export const APP_LANGUAGES = ['ja', 'en', 'ko', 'zh-Hant'] as const;
export type AppLanguage = (typeof APP_LANGUAGES)[number];

/** 端末の言語がどれにも当たらない時の言語（海外の利用者に日本語を出さない） */
export const DEFAULT_LANGUAGE: AppLanguage = 'en';

/** 辞書の正本の言語（欠けたキーの最後の補い先） */
export const SOURCE_LANGUAGE: AppLanguage = 'ja';

export function isAppLanguage(value: unknown): value is AppLanguage {
  return typeof value === 'string' && (APP_LANGUAGES as readonly string[]).includes(value);
}

/** 日付・数値の書式に渡す BCP-47 の地域付きタグ（表示言語ごとに1つ） */
const FORMAT_LOCALE: Record<AppLanguage, string> = {
  ja: 'ja-JP',
  en: 'en-US',
  ko: 'ko-KR',
  'zh-Hant': 'zh-TW',
};

export function formatLocaleOf(language: AppLanguage): string {
  return FORMAT_LOCALE[language];
}

/**
 * 端末の言語の一覧（好みの順。例 `['ko-KR', 'en-US']`）から表示言語を決める。
 * - 中国語は字体で分ける：`Hant` か地域 TW・HK・MO は繁体字。簡体字（`zh-Hans`・`zh-CN` 等）は対応外として次の候補へ進む
 *   （簡体字の利用者に繁体字を出さない）
 * - どれにも当たらなければ `DEFAULT_LANGUAGE`
 */
export function resolveAppLanguage(preferredTags: readonly (string | null | undefined)[]): AppLanguage {
  for (const raw of preferredTags) {
    const lang = matchLanguage(raw);
    if (lang) return lang;
  }
  return DEFAULT_LANGUAGE;
}

function matchLanguage(raw: string | null | undefined): AppLanguage | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const parts = raw.trim().replace(/_/g, '-').split('-');
  const base = parts[0].toLowerCase();
  const rest = parts.slice(1).map((p) => p.toLowerCase());
  switch (base) {
    case 'ja':
      return 'ja';
    case 'en':
      return 'en';
    case 'ko':
      return 'ko';
    case 'zh':
    case 'yue': // 広東語（香港・マカオ）は繁体字で読む
      if (rest.includes('hans')) return null;
      if (rest.includes('hant') || rest.some((p) => p === 'tw' || p === 'hk' || p === 'mo')) return 'zh-Hant';
      return null;
    default:
      return null;
  }
}

export type PluralForms = { one?: string; other: string };
export type DictValue = string | PluralForms;
export type Dictionary = Readonly<Record<string, DictValue>>;
export type Params = Readonly<Record<string, string | number>>;

/** 複数形の区分（自前の規則。上のコメント参照） */
export function pluralCategory(language: AppLanguage, count: number): 'one' | 'other' {
  if (language === 'en' && Math.abs(count) === 1) return 'one';
  return 'other';
}

/** `{name}` を値で置き換える。値が無い名前はそのまま残す（欠けに気づけるように） */
export function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name: string) => {
    if (!Object.hasOwn(params, name)) return whole;
    const v = params[name];
    return v === undefined || v === null ? whole : String(v);
  });
}

/** 文の中の補間名（検査で全言語の一致を見るために使う） */
export function placeholdersOf(value: DictValue): string[] {
  const texts = typeof value === 'string' ? [value] : [value.one ?? '', value.other];
  const names = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(/\{([A-Za-z0-9_]+)\}/g)) names.add(m[1]);
  return [...names].sort();
}

export type Dictionaries = Readonly<Record<AppLanguage, Dictionary>>;

function lookup(dicts: Dictionaries, language: AppLanguage, key: string): { value: DictValue; language: AppLanguage } | null {
  for (const lang of [language, DEFAULT_LANGUAGE, SOURCE_LANGUAGE] as const) {
    const dict = dicts[lang];
    if (dict && Object.hasOwn(dict, key)) return { value: dict[key], language: lang };
  }
  return null;
}

/**
 * 訳を引く。複数形の値は `params.count` で語形を選ぶ（count が無ければ other）。
 * 見つからなければキーそのもの（画面を壊さない・検査で欠けを止める）。
 */
export function translate(dicts: Dictionaries, language: AppLanguage, key: string, params?: Params): string {
  const hit = lookup(dicts, language, key);
  if (!hit) return key;
  const { value } = hit;
  if (typeof value === 'string') return interpolate(value, params);
  const count = params?.count === undefined ? NaN : Number(params.count);
  const form = Number.isFinite(count) && pluralCategory(hit.language, count) === 'one' && value.one !== undefined ? value.one : value.other;
  return interpolate(form, params);
}

/**
 * 起動時の表示言語。
 * - 多言語の画面が無効（`SHOW_MULTILINGUAL_UI` も開発のプレビューも無い）なら常に日本語（本番の今の挙動）
 * - Web（静的出力のサーバー描画とブラウザの初回描画）は日本語。ビルド機の言語で HTML を作らず、
 *   初回の描画を HTML と揃える（ハイドレーションの食い違いを防ぐ）。ブラウザの言語へはマウントの後に切り替える
 *   （`index.ts` の `applyDeviceLanguage`）
 * - それ以外（iPhone のアプリ）は端末の言語の一覧から決める
 */
export function decideInitialLanguage(input: {
  multilingual: boolean;
  isWeb: boolean;
  preferredTags: readonly (string | null | undefined)[];
}): AppLanguage {
  if (!input.multilingual || input.isWeb) return SOURCE_LANGUAGE;
  return resolveAppLanguage(input.preferredTags);
}

/** 端末の言語の一覧：`navigator.languages` → `navigator.language` → 無い時だけ `Intl` の既定のロケール */
export function collectPreferredTags(nav: { languages?: readonly string[]; language?: string } | undefined, intlLocale: string | undefined): string[] {
  if (nav?.languages?.length) return [...nav.languages];
  if (nav?.language) return [nav.language];
  return intlLocale ? [intlLocale] : [];
}

export type Translator = (key: string, params?: Params) => string;

export function createTranslator(dicts: Dictionaries, language: AppLanguage): Translator {
  return (key, params) => translate(dicts, language, key, params);
}
