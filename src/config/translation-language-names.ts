/**
 * BCP-47言語コード → 日本語表示名。専用翻訳ページの言語選択UI専用。
 *
 * **「対応言語の一覧」をここに持たせないこと。** 対応言語の正本は常に実機の
 * `getSupportedLanguages()`（`modules/translation`）であり、このファイルは
 * 取得済みコードを人が読める名前へ変換するだけの表示用テーブルである。
 * ここに無いコードが来ても壊れず、コードをそのまま表示して先へ進む
 * （Appleが将来言語を追加してもアプリ側の更新なしで機能し続けるため）。
 *
 * このファイルはreact-native・nativeモジュールへのimportを持たない
 * （`node --test`から直接読み込めるようにするため。`text-translation-core.ts`と同じ規律）。
 *
 * `zh-Hant`→`zh-TW`のように、Apple側が返す`minimalIdentifier`は要求した識別子と
 * 異なることがある（`translation-types.ts`に実機確認済みとして記載）。そのため
 * 要求側の識別子と解決後の識別子の両方を引けるようエイリアスも登録する。
 */

/** 既知の主要言語。網羅を目的とせず、実機で返りうる主要コードを人が読める形にする */
export const LANGUAGE_NAMES_JA: Record<string, string> = {
  ja: '日本語',
  en: '英語',
  ko: '韓国語',
  th: 'タイ語',
  'zh-Hans': '中国語（簡体字）',
  'zh-Hant': '中国語（繁体字）',
  // Apple側の正規化で返りうる地域付き識別子（zh-Hant→zh-TWは実機確認済み）
  'zh-CN': '中国語（簡体字）',
  'zh-TW': '中国語（繁体字）',
  ar: 'アラビア語',
  de: 'ドイツ語',
  es: 'スペイン語',
  fr: 'フランス語',
  hi: 'ヒンディー語',
  id: 'インドネシア語',
  it: 'イタリア語',
  nl: 'オランダ語',
  pl: 'ポーランド語',
  pt: 'ポルトガル語',
  'pt-BR': 'ポルトガル語（ブラジル）',
  ru: 'ロシア語',
  tr: 'トルコ語',
  uk: 'ウクライナ語',
  vi: 'ベトナム語',
};

/**
 * 表示名を引く。未知コードはコードをそのまま返す（画面が壊れないことが要件）。
 */
export function getLanguageDisplayName(code: string): string {
  return LANGUAGE_NAMES_JA[code] ?? code;
}

/**
 * 検索の突き合わせ対象。日本語表示名とBCP-47コードの両方でヒットさせる。
 * 未知コードでも必ずコード自身が対象に含まれる。
 */
export function matchesLanguageQuery(code: string, rawQuery: string): boolean {
  const query = rawQuery.trim();
  if (query === '') return true;
  const lower = query.toLowerCase();
  return (
    code.toLowerCase().includes(lower) || getLanguageDisplayName(code).includes(query)
  );
}
