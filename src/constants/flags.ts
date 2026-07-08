import type { CurrencyCode } from './currencies';

/**
 * 通貨ごとの国旗PNG。カレンダー画面（(tabs)/calendar.tsx）で使われているPNGを正本とし、
 * アプリ内の他画面もこのマップを共通で参照する（絵文字国旗・別画像との混在を解消するため）。
 * PNGファイル自体（assets/flags/*.png）は編集・追加しない。
 */
export const FLAG_IMAGES: Record<CurrencyCode, number> = {
  USD: require('@/assets/flags/us.png') as number,
  KRW: require('@/assets/flags/kr.png') as number,
  TWD: require('@/assets/flags/tw.png') as number,
  THB: require('@/assets/flags/th.png') as number,
  EUR: require('@/assets/flags/eu.png') as number,
  GBP: require('@/assets/flags/gb.png') as number,
  JPY: require('@/assets/flags/jp.png') as number,
};
