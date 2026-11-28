/** 繁體中文の辞書。キーは ja.ts と同じ（型で欠けを止める） */
import type { DictValue } from '../i18n-core';
import type { MessageKey } from './ja';

export const zhHant: Record<MessageKey, DictValue> = {
  'common.ok': '確定',
  'common.cancel': '取消',
  'common.close': '關閉',
  'common.save': '儲存',
  'common.delete': '刪除',
  'common.edit': '編輯',
  'common.back': '返回',
  'language.name.ja': '日文',
  'language.name.en': '英文',
  'language.name.ko': '韓文',
  'language.name.zh-Hant': '繁體中文',
  'settings.language.title': '顯示語言',
  'settings.language.followsSystem': '可在 iPhone 的「設定」中變更此 App 的語言。',
  'settings.language.openSystemSettings': '開啟「設定」',
  'count.records': { other: '{count} 筆' },
};
