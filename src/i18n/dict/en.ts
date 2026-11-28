/** 英語の辞書。キーは ja.ts と同じ（型で欠けを止める） */
import type { DictValue } from '../i18n-core';
import type { MessageKey } from './ja';

export const en: Record<MessageKey, DictValue> = {
  'common.ok': 'OK',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.back': 'Back',
  'language.name.ja': 'Japanese',
  'language.name.en': 'English',
  'language.name.ko': 'Korean',
  'language.name.zh-Hant': 'Chinese (Traditional)',
  'settings.language.title': 'Language',
  'settings.language.followsSystem': 'You can change the language for this app in iPhone Settings.',
  'settings.language.openSystemSettings': 'Open Settings',
  'count.records': { one: '{count} record', other: '{count} records' },
};
