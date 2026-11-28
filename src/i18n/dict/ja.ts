/**
 * 日本語の辞書（正本）。キーを足す時はここに足し、en・ko・zh-Hant にも同じキーを足す
 * （足し忘れは `tsc`〈`Record<MessageKey, …>`〉と `i18n-dict.test.mjs`〈補間名〉が止める）。
 * キーは「画面または領域.要素」の平らな文字列。既存の日本語の表示は変えずにここへ移す（GX-07）。
 */
import type { Dictionary } from '../i18n-core';

export const ja = {
  'common.ok': 'OK',
  'common.cancel': 'キャンセル',
  'common.close': '閉じる',
  'common.save': '保存',
  'common.delete': '削除',
  'common.edit': '編集',
  'common.back': '戻る',
  'language.name.ja': '日本語',
  'language.name.en': '英語',
  'language.name.ko': '韓国語',
  'language.name.zh-Hant': '中国語（繁体字）',
  'settings.language.title': '表示言語',
  'settings.language.followsSystem': 'iPhoneの「設定」でこのアプリの言語を変えられます',
  'settings.language.openSystemSettings': '「設定」を開く',
  'count.records': { other: '{count}件' },
} as const satisfies Dictionary;

export type MessageKey = keyof typeof ja;
