/** 全言語の辞書の束。言語を足す時はここへ1行足す */
import type { Dictionaries } from '../i18n-core';
import { en } from './en';
import { ja } from './ja';
import { ko } from './ko';
import { zhHant } from './zh-Hant';

export const DICTIONARIES: Dictionaries = { ja, en, ko, 'zh-Hant': zhHant };
export type { MessageKey } from './ja';
