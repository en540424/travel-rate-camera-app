/**
 * 旅行の予定（これからの予定）。既存の「買い物カレンダー」（記録の表示）とは別の画面・別のデータ。
 * 使用中の旅行の予定を日別に表示する。時間の重なりには注意を出す。
 */
import { router } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, View } from 'react-native';

import { AccessNotice, Notice, pp, Row } from '@/components/proplus/proplus-ui';
import { ThemedText } from '@/components/themed-text';
import { EmptyState } from '@/components/ui/EmptyState';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { SectionCard } from '@/components/ui/SectionCard';
import { useProPlusAccess, useProPlusData } from '@/hooks/use-proplus';
import { canEditProPlusData } from '@/lib/proplus/proplus-access-core';
import { deviceTimeZone } from '@/lib/proplus/device-services';
import { EVENT_KIND_LABELS, findOverlaps, formatEventTime, groupEventsByDay, timeZoneNote } from '@/lib/proplus/trip-events-core';
import { useTripStore } from '@/stores/trip-store';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}月${d}日（${WEEKDAYS[w]}）`;
}

export default function ScheduleScreen() {
  const access = useProPlusAccess();
  const { data, blockedReason } = useProPlusData();
  const activeTrip = useTripStore((s) => s.activeTrip);
  const editable = canEditProPlusData(access) && !blockedReason && activeTrip != null;
  const days = useMemo(() => (activeTrip ? groupEventsByDay(data.events, activeTrip.id) : []), [data.events, activeTrip]);
  const overlaps = useMemo(() => findOverlaps(days.flatMap((d) => d.events)), [days]);
  const overlapIds = new Set(overlaps.flat().map((e) => e.id));
  const placeName = (id: string | null) => (id ? data.places.find((p) => p.id === id && p.deletedAt === null)?.name ?? null : null);
  const tz = deviceTimeZone();

  return (
    <ScrollView style={pp.screen} contentContainerStyle={pp.content}>
      <AccessNotice access={access} blocked={blockedReason} />
      {!activeTrip ? (
        <Notice>旅行を選ぶと、その旅行の予定を登録できます。</Notice>
      ) : (
        <ThemedText style={pp.muted}>{activeTrip.name} の予定（買い物カレンダーの記録とは別に管理します）</ThemedText>
      )}
      {editable && <PrimaryButton title="予定を追加" onPress={() => router.push('/proplus/event-edit')} />}
      {overlaps.length > 0 && <Notice>時間が重なっている予定があります（{overlaps.length}組）。</Notice>}
      {days.length === 0 ? (
        activeTrip && <EmptyState title="予定はまだありません" body="観光・食事・予約などの予定を登録し、端末のカレンダーへ追加できます。" />
      ) : (
        days.map((d) => (
          <SectionCard key={d.date}>
            <ThemedText style={pp.h2}>{dayLabel(d.date)}</ThemedText>
            <View>
              {d.events.map((e) => (
                <Row
                  key={e.id}
                  title={`${formatEventTime(e)}　${e.title}`}
                  sub={[EVENT_KIND_LABELS[e.kind], placeName(e.placeId), timeZoneNote(e.tz, tz), overlapIds.has(e.id) ? '時間が重なっています' : null].filter(Boolean).join('・')}
                  onPress={() => router.push({ pathname: '/proplus/event-edit', params: { id: e.id } })}
                />
              ))}
            </View>
          </SectionCard>
        ))
      )}
    </ScrollView>
  );
}
