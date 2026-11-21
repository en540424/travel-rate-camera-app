/**
 * Pro+ 旅行スケジュール：予定の純粋ロジック（import 0件・`node --test`で検証）。
 *
 * 既存の「買い物カレンダー」（記録＝過去の買い物を日付で表示）とは別物で、これから行く予定を管理する。
 * 予定は記録（conversion_history）に入れない（保存上限・分析・CSV・予算集計に影響させないため。設計書§3-1）。
 *
 * 時刻の規則（設計書§3-2）：現地の壁時計（`YYYY-MM-DDTHH:mm`）＋IANAタイムゾーンで持つ。
 * 端末の時刻設定・現在地に依存しない。絶対時刻が要る時（端末カレンダーへの追加）だけ変換する。
 */

export const EVENT_KINDS = ['sightseeing', 'shopping', 'meal', 'reservation', 'transport', 'other'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  sightseeing: '観光',
  shopping: '買い物',
  meal: '食事',
  reservation: '予約',
  transport: '移動',
  other: 'その他',
};

export type TripEvent = {
  id: string;
  tripId: number;
  kind: EventKind;
  title: string;
  /** 終日なら `YYYY-MM-DD`、時刻ありなら `YYYY-MM-DDTHH:mm`（現地の壁時計） */
  startsLocal: string;
  /** 終了（任意）。形式はstartsLocalと同じ */
  endsLocal: string | null;
  /** IANAタイムゾーン（例：Europe/Paris） */
  tz: string;
  allDay: boolean;
  placeId: string | null;
  memo: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export const EVENT_TITLE_MAX = 80;
export const EVENT_MEMO_MAX = 1000;
export const DEFAULT_DURATION_MIN = 60;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

type Parts = { y: number; mo: number; d: number; h: number; mi: number };

function validCalendarDate(y: number, mo: number, d: number): boolean {
  if (mo < 1 || mo > 12 || d < 1) return false;
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return d <= days;
}

/** 現地時刻の文字列を分解する。形式・日付が不正ならnull。allDayなら日付だけを受け付ける。 */
export function parseLocal(s: string, allDay: boolean): Parts | null {
  if (allDay) {
    const m = DATE_RE.exec(s);
    if (!m) return null;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return validCalendarDate(y, mo, d) ? { y, mo, d, h: 0, mi: 0 } : null;
  }
  const m = DATETIME_RE.exec(s);
  if (!m) return null;
  const [y, mo, d, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  if (!validCalendarDate(y, mo, d) || h > 23 || mi > 59) return null;
  return { y, mo, d, h, mi };
}

export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** あるUTC時刻における、そのタイムゾーンの壁時計（分単位）をUTCのミリ秒として表したもの。 */
function wallClockMs(utcMs: number, tz: string): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(utcMs))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/**
 * 現地の壁時計＋タイムゾーン → 絶対時刻（Date）。
 * 夏時間の開始で存在しない時刻（例：02:30）は、その直後の有効な時刻へ進める。重複する時刻は早い方。
 */
export function localToDate(local: string, tz: string, allDay = false): Date | null {
  const p = parseLocal(local, allDay);
  if (!p || !isValidTimeZone(tz)) return null;
  const target = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
  // 境界の前後（±1日）のオフセットで候補を2つ作る。夏時間の切替は1日に高々1回なので、どちらかが正しいオフセット
  const offsetAt = (ms: number) => wallClockMs(ms, tz) - ms;
  const candidates = [target - offsetAt(target - 86400_000), target - offsetAt(target + 86400_000)];
  const valid = candidates.filter((c) => wallClockMs(c, tz) === target);
  // 重複する時刻（秋）は早い方。存在しない時刻（春）は、切替前のオフセットで求めた方（＝直後の有効な時刻）
  return new Date(valid.length ? Math.min(...valid) : Math.max(...candidates));
}

export type EventInput = {
  tripId: number;
  kind?: EventKind;
  title: string;
  startsLocal: string;
  endsLocal?: string | null;
  tz: string;
  allDay?: boolean;
  placeId?: string | null;
  memo?: string;
};

export type EventValidation =
  | { ok: true; value: Omit<TripEvent, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>; warnings: string[] }
  | { ok: false; errors: string[] };

/**
 * 予定の入力を検証する。
 * trip（任意）を渡すと、旅行の期間（`YYYY-MM-DD`）から外れた予定に警告を出す（保存は止めない）。
 */
export function validateEventInput(
  input: EventInput,
  trip?: { startDate: string | null; endDate: string | null },
): EventValidation {
  const errors: string[] = [];
  const allDay = input.allDay ?? false;
  const title = (input.title ?? '').trim();
  if (title === '') errors.push('予定のタイトルを入力してください');
  if (title.length > EVENT_TITLE_MAX) errors.push(`タイトルは${EVENT_TITLE_MAX}文字までです`);
  const memo = (input.memo ?? '').trim();
  if (memo.length > EVENT_MEMO_MAX) errors.push(`メモは${EVENT_MEMO_MAX}文字までです`);
  const kind = input.kind ?? 'other';
  if (!EVENT_KINDS.includes(kind)) errors.push('予定の種類が不正です');
  if (!isValidTimeZone(input.tz)) errors.push('タイムゾーンが不正です');
  const start = parseLocal(input.startsLocal, allDay);
  if (!start) errors.push(allDay ? '日付を YYYY-MM-DD で入力してください' : '開始を YYYY-MM-DD HH:mm で入力してください');
  const endsLocal = input.endsLocal?.trim() ? input.endsLocal.trim() : null;
  if (endsLocal !== null) {
    const end = parseLocal(endsLocal, allDay);
    if (!end) errors.push('終了の形式が不正です');
    else if (start && endsLocal < input.startsLocal) errors.push('終了は開始より後にしてください');
  }
  if (errors.length) return { ok: false, errors };

  const warnings: string[] = [];
  const day = input.startsLocal.slice(0, 10);
  if (trip?.startDate && day < trip.startDate) warnings.push('旅行の開始日より前の予定です');
  if (trip?.endDate && day > trip.endDate) warnings.push('旅行の終了日より後の予定です');
  return {
    ok: true,
    warnings,
    value: {
      tripId: input.tripId, kind, title, startsLocal: input.startsLocal, endsLocal, tz: input.tz, allDay,
      placeId: input.placeId ?? null, memo,
    },
  };
}

function normalizeTitle(s: string): string {
  return s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** 同じ旅行・同じ開始・同じタイトル（表記ゆれを除く）の予定。重複登録の確認に使う。 */
export function findDuplicate(events: TripEvent[], candidate: Pick<TripEvent, 'tripId' | 'title' | 'startsLocal' | 'tz'>, excludeId?: string): TripEvent | null {
  const t = normalizeTitle(candidate.title);
  return events.find((e) =>
    e.deletedAt === null && e.id !== excludeId && e.tripId === candidate.tripId &&
    e.startsLocal === candidate.startsLocal && e.tz === candidate.tz && normalizeTitle(e.title) === t) ?? null;
}

/** 予定の開始・終了（絶対時刻）。終了が無ければ時刻ありは既定の長さ、終日は翌日0時。 */
export function eventRange(e: Pick<TripEvent, 'startsLocal' | 'endsLocal' | 'tz' | 'allDay'>): { start: Date; end: Date } | null {
  const start = localToDate(e.startsLocal, e.tz, e.allDay);
  if (!start) return null;
  if (e.allDay) {
    const last = e.endsLocal ?? e.startsLocal;
    const lastStart = localToDate(last, e.tz, true);
    if (!lastStart) return null;
    const [y, mo, d] = last.split('-').map(Number);
    const next = new Date(Date.UTC(y, mo - 1, d + 1)).toISOString().slice(0, 10);
    return { start, end: localToDate(next, e.tz, true) ?? new Date(lastStart.getTime() + 86400_000) };
  }
  const end = e.endsLocal ? localToDate(e.endsLocal, e.tz) : new Date(start.getTime() + DEFAULT_DURATION_MIN * 60_000);
  return end ? { start, end } : null;
}

/** 時間が重なる予定の組（終日の予定は除く）。予定一覧で注意を出す用。 */
export function findOverlaps(events: TripEvent[]): [TripEvent, TripEvent][] {
  const timed = events
    .filter((e) => e.deletedAt === null && !e.allDay)
    .map((e) => ({ e, r: eventRange(e) }))
    .filter((x): x is { e: TripEvent; r: { start: Date; end: Date } } => x.r !== null)
    .sort((a, b) => a.r.start.getTime() - b.r.start.getTime());
  const pairs: [TripEvent, TripEvent][] = [];
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length && timed[j].r.start < timed[i].r.end; j++) pairs.push([timed[i].e, timed[j].e]);
  }
  return pairs;
}

export type EventDay = { date: string; events: TripEvent[] };

/** 日別（現地の日付）にまとめる。日付の昇順、各日の中は終日→開始時刻の順。削除済みは除く。 */
export function groupEventsByDay(events: TripEvent[], tripId?: number): EventDay[] {
  const map = new Map<string, TripEvent[]>();
  for (const e of events) {
    if (e.deletedAt !== null || (tripId !== undefined && e.tripId !== tripId)) continue;
    const day = e.startsLocal.slice(0, 10);
    const list = map.get(day) ?? [];
    list.push(e);
    map.set(day, list);
  }
  return [...map.keys()].sort().map((date) => ({
    date,
    events: map.get(date)!.sort((a, b) =>
      Number(b.allDay) - Number(a.allDay) || a.startsLocal.localeCompare(b.startsLocal) || a.title.localeCompare(b.title)),
  }));
}

/** 表示用の時刻（例：「10:00〜11:30」「終日」）。 */
export function formatEventTime(e: Pick<TripEvent, 'startsLocal' | 'endsLocal' | 'allDay'>): string {
  if (e.allDay) return '終日';
  const s = e.startsLocal.slice(11, 16);
  if (!e.endsLocal) return s;
  const sameDay = e.endsLocal.slice(0, 10) === e.startsLocal.slice(0, 10);
  return `${s}〜${sameDay ? e.endsLocal.slice(11, 16) : `${e.endsLocal.slice(5, 10).replace('-', '/')} ${e.endsLocal.slice(11, 16)}`}`;
}

/** 端末のタイムゾーンと予定のタイムゾーンが違う時に出す注記（例：「現地時間（Europe/Paris）」）。 */
export function timeZoneNote(eventTz: string, deviceTz: string): string | null {
  return eventTz === deviceTz ? null : `現地時間（${eventTz}）`;
}

export type CalendarPayload = {
  title: string;
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  /** 時刻ありの予定のタイムゾーン。終日はnull（端末の日付として扱う） */
  timeZone: string | null;
  location: string | null;
  notes: string;
};

/**
 * 端末カレンダーへ追加する内容（OSの追加画面へ渡す）。追加後の変更はアプリへ戻らない（片方向）。
 *
 * 終日の予定は、EventKitでは端末のタイムゾーンに属さない「日付」として扱われ、終了日を含む（end-inclusive）。
 * そのため絶対時刻へ変換せず、端末の現地時刻で「開始日の0時」〜「最終日の0時」を渡し、タイムゾーンは付けない
 * （予定のタイムゾーンの0時を渡すと、端末が西側にあると前日にずれ、翌日0時を終了にすると2日間になる）。
 * 実機での確認はTEST_CHECKLIST #92。
 */
export function toCalendarPayload(e: TripEvent, placeName: string | null): CalendarPayload | null {
  const r = eventRange(e);
  if (!r) return null;
  let startDate = r.start;
  let endDate = r.end;
  if (e.allDay) {
    const s = parseLocal(e.startsLocal, true);
    const l = parseLocal(e.endsLocal ?? e.startsLocal, true);
    if (!s || !l) return null;
    startDate = new Date(s.y, s.mo - 1, s.d);
    endDate = new Date(l.y, l.mo - 1, l.d);
  }
  return {
    title: e.title,
    startDate,
    endDate,
    allDay: e.allDay,
    timeZone: e.allDay ? null : e.tz,
    location: placeName,
    notes: [e.memo, `旅レートカメラの旅行の予定（${EVENT_KIND_LABELS[e.kind]}）`].filter(Boolean).join('\n'),
  };
}

function compact(local: string, allDay: boolean): string {
  return allDay ? local.replace(/-/g, '') : `${local.replace(/[-:]/g, '')}00`;
}

/**
 * Googleカレンダーの予定作成画面を開くURL（ログイン・鍵不要・片方向）。時刻は現地の壁時計＋ctz で渡す。
 * 公式の仕様書は見つかっていない（設計書§3-4「1b」）。実機での動作確認が前提。
 */
export function googleCalendarUrl(e: TripEvent, placeName: string | null): string | null {
  const r = eventRange(e);
  if (!r) return null;
  let endLocal: string;
  if (e.allDay) {
    const last = e.endsLocal ?? e.startsLocal;
    const [y, mo, d] = last.split('-').map(Number);
    endLocal = new Date(Date.UTC(y, mo - 1, d + 1)).toISOString().slice(0, 10);
  } else if (e.endsLocal) {
    endLocal = e.endsLocal;
  } else {
    // 壁時計どうしの足し算（UTCの計算器として使うだけで、タイムゾーンの変換はしない）
    const p = parseLocal(e.startsLocal, false)!;
    endLocal = new Date(Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi + DEFAULT_DURATION_MIN)).toISOString().slice(0, 16);
  }
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${compact(e.startsLocal, e.allDay)}/${compact(endLocal, e.allDay)}`,
    ctz: e.tz,
  });
  if (e.memo) params.set('details', e.memo);
  if (placeName) params.set('location', placeName);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
