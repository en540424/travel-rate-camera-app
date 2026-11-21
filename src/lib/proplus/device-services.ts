/**
 * Pro+が使う端末機能（現在地・端末カレンダー・外部の地図アプリ）の薄い層。
 *
 * - nativeモジュールは動的importにする（載っていないBuild・Webで画面を壊さないため。`csv-export-service.ts`と同じ規律）
 * - 位置情報は「使用中のみ」。許可を求めるのは利用者が「現在地」を押した時だけ（画面を開いただけでは求めない）
 * - 端末カレンダーへは、OSの追加画面を開いて利用者が保存する（片方向。追加後の変更はアプリへ戻らない）
 *   iOS 17以降は権限なしで画面を開ける。iOS 16.x（deployment target 16.4〜）は権限が要るため、拒否されたら理由を返す
 * - 拒否・失敗は例外にせず状態で返し、画面は手入力・Googleカレンダー・外部地図などの代替へ案内する
 */
import { Linking, Platform } from 'react-native';

import type { CalendarPayload } from './trip-events-core';

export type LocationResult =
  | { status: 'ok'; lat: number; lng: number; accuracyM: number | null }
  | { status: 'denied' | 'unavailable' | 'error' };

export async function getCurrentLocation(): Promise<LocationResult> {
  if (Platform.OS === 'web') return { status: 'unavailable' };
  try {
    const Location = await import('expo-location');
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return { status: 'denied' };
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { status: 'ok', lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy ?? null };
  } catch (e) {
    if (__DEV__) console.warn('[proplus] location failed', e);
    return { status: 'error' };
  }
}

export type CalendarAddResult = { status: 'saved' | 'canceled' | 'done' | 'denied' | 'unavailable' | 'error' };

function iosMajor(): number {
  return Platform.OS === 'ios' ? parseInt(String(Platform.Version), 10) : 0;
}

export async function addToDeviceCalendar(p: CalendarPayload): Promise<CalendarAddResult> {
  if (Platform.OS === 'web') return { status: 'unavailable' };
  try {
    const Calendar = await import('expo-calendar/legacy');
    if (Platform.OS === 'ios' && iosMajor() < 17) {
      const perm = await Calendar.requestCalendarPermissionsAsync();
      if (perm.status !== 'granted') return { status: 'denied' };
    }
    const r = await Calendar.createEventInCalendarAsync({
      title: p.title,
      startDate: p.startDate,
      endDate: p.endDate,
      allDay: p.allDay,
      timeZone: p.timeZone,
      location: p.location ?? undefined,
      notes: p.notes,
    });
    if (r.action === 'saved') return { status: 'saved' };
    if (r.action === 'canceled') return { status: 'canceled' };
    return { status: 'done' };
  } catch (e) {
    if (__DEV__) console.warn('[proplus] calendar failed', e);
    return { status: 'error' };
  }
}

/** URL（外部地図・Googleカレンダー）を開く。開けなければfalse。 */
export async function openExternalUrl(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

/** 端末のタイムゾーン（IANA）。取れなければUTC。 */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
