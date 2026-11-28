/** 韓国語の辞書。キーは ja.ts と同じ（型で欠けを止める） */
import type { DictValue } from '../i18n-core';
import type { MessageKey } from './ja';

export const ko: Record<MessageKey, DictValue> = {
  'common.ok': '확인',
  'common.cancel': '취소',
  'common.close': '닫기',
  'common.save': '저장',
  'common.delete': '삭제',
  'common.edit': '편집',
  'common.back': '뒤로',
  'language.name.ja': '일본어',
  'language.name.en': '영어',
  'language.name.ko': '한국어',
  'language.name.zh-Hant': '중국어(번체)',
  'settings.language.title': '표시 언어',
  'settings.language.followsSystem': 'iPhone 설정에서 이 앱의 언어를 바꿀 수 있습니다.',
  'settings.language.openSystemSettings': '설정 열기',
  'count.records': { other: '{count}건' },
  'csv.header.convertedAmount': '환산 금액',
  'csv.header.convertedCurrency': '환산 통화',
};
