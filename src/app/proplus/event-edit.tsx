/**
 * 予定の追加・編集・削除と、端末カレンダー／Googleカレンダーへの追加（片方向のコピー）。
 * 時刻は現地の壁時計＋タイムゾーンで持つ（端末の時刻設定に依存しない）。
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, Switch, View } from 'react-native';

import { AccessNotice, Chip, Notice, pp } from '@/components/proplus/proplus-ui';
import { ThemedText } from '@/components/themed-text';
import { FormInput } from '@/components/ui/FormInput';
import { GhostButton } from '@/components/ui/GhostButton';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { SecondaryButton } from '@/components/ui/SecondaryButton';
import { useProPlusAccess, useProPlusData } from '@/hooks/use-proplus';
import { canEditProPlusData } from '@/lib/proplus/proplus-access-core';
import { addToDeviceCalendar, deviceTimeZone, openExternalUrl } from '@/lib/proplus/device-services';
import {
  EVENT_KIND_LABELS, EVENT_KINDS, findDuplicate, googleCalendarUrl, toCalendarPayload, type EventKind, type TripEvent,
} from '@/lib/proplus/trip-events-core';
import { proPlusOps } from '@/stores/proplus-store';
import { useTripStore } from '@/stores/trip-store';

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function EventEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const access = useProPlusAccess();
  const { data, apply, blockedReason } = useProPlusData();
  const activeTrip = useTripStore((s) => s.activeTrip);
  const current = id ? data.events.find((e) => e.id === id && e.deletedAt === null) ?? null : null;
  const editable = canEditProPlusData(access) && !blockedReason;
  const tripId = current?.tripId ?? activeTrip?.id ?? null;
  const lastTz = data.events.filter((e) => e.tripId === tripId && e.deletedAt === null).at(-1)?.tz;

  const [title, setTitle] = useState(current?.title ?? '');
  const [kind, setKind] = useState<EventKind>(current?.kind ?? 'sightseeing');
  const [allDay, setAllDay] = useState(current?.allDay ?? false);
  const [date, setDate] = useState(current?.startsLocal.slice(0, 10) ?? activeTrip?.started_at?.slice(0, 10) ?? todayLocal());
  const [time, setTime] = useState(current && !current.allDay ? current.startsLocal.slice(11, 16) : '10:00');
  const [endTime, setEndTime] = useState(current?.endsLocal && !current.allDay ? current.endsLocal.slice(11, 16) : '');
  const [tz, setTz] = useState(current?.tz ?? lastTz ?? deviceTimeZone());
  const [placeId, setPlaceId] = useState<string | null>(current?.placeId ?? null);
  const [memo, setMemo] = useState(current?.memo ?? '');
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const places = data.places.filter((p) => p.deletedAt === null && (p.tripId === tripId || p.id === placeId));

  const tripRange = activeTrip ? { startDate: activeTrip.started_at?.slice(0, 10) ?? null, endDate: activeTrip.ended_at?.slice(0, 10) ?? null } : undefined;

  function buildInput() {
    const startsLocal = allDay ? date.trim() : `${date.trim()}T${time.trim()}`;
    const endsLocal = allDay || !endTime.trim() ? null : `${date.trim()}T${endTime.trim()}`;
    return { tripId: tripId ?? -1, kind, title, startsLocal, endsLocal, tz: tz.trim(), allDay, placeId, memo };
  }

  async function persist(): Promise<TripEvent | null> {
    const input = buildInput();
    const r = current
      ? await apply((s, c) => proPlusOps.updateEvent(s, current.id, input, c, tripRange))
      : await apply((s, c) => proPlusOps.addEvent(s, input, c, tripRange));
    if (!r.ok) { setErrors(r.errors); return null; }
    if (r.warnings?.length) Alert.alert('確認', r.warnings.join('\n'));
    return r.value;
  }

  async function save() {
    if (saving || tripId == null) return;
    const input = buildInput();
    const dup = findDuplicate(data.events, input, current?.id);
    const go = async () => {
      setSaving(true);
      const saved = await persist();
      setSaving(false);
      if (saved) router.back();
    };
    if (dup) {
      Alert.alert('同じ予定があります', `${dup.title}（${dup.startsLocal.replace('T', ' ')}）が既にあります。追加しますか？`, [
        { text: 'やめる', style: 'cancel' },
        { text: '追加する', onPress: go },
      ]);
    } else {
      await go();
    }
  }

  function placeName(pid: string | null) {
    return pid ? data.places.find((p) => p.id === pid)?.name ?? null : null;
  }

  async function addToCalendar() {
    if (!current) return;
    const payload = toCalendarPayload(current, placeName(current.placeId));
    if (!payload) return;
    const r = await addToDeviceCalendar(payload);
    if (r.status === 'denied') Alert.alert('カレンダーへのアクセスが許可されていません', '設定アプリで許可するか、Googleカレンダーで追加してください。');
    else if (r.status === 'unavailable' || r.status === 'error') Alert.alert('カレンダーを開けませんでした', 'Googleカレンダーでの追加もお試しください。');
  }

  async function addToGoogle() {
    if (!current) return;
    const url = googleCalendarUrl(current, placeName(current.placeId));
    if (!url || !(await openExternalUrl(url))) Alert.alert('Googleカレンダーを開けませんでした');
  }

  function remove() {
    if (!current) return;
    Alert.alert('この予定を削除しますか？', '端末のカレンダーへ追加済みの予定は、そちらで削除してください。', [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: async () => {
        const r = await apply((s, c) => proPlusOps.deleteEvent(s, current.id, c));
        if (r.ok) router.back(); else setErrors(r.errors);
      } },
    ]);
  }

  if (tripId == null) return <View style={pp.content}><Notice>旅行を選んでから予定を追加してください。</Notice></View>;

  return (
    <ScrollView style={pp.screen} contentContainerStyle={pp.content} keyboardShouldPersistTaps="handled">
      <AccessNotice access={access} blocked={blockedReason} />
      <FormInput label="タイトル" value={title} onChangeText={setTitle} editable={editable} placeholder="例：美術館・ディナーの予約" maxLength={80} />
      <View style={pp.chips}>
        {EVENT_KINDS.map((k) => <Chip key={k} label={EVENT_KIND_LABELS[k]} selected={kind === k} onPress={() => editable && setKind(k)} />)}
      </View>
      <View style={[pp.rowButtons, { alignItems: 'center' }]}>
        <ThemedText style={{ flex: 1 }}>終日</ThemedText>
        <Switch value={allDay} onValueChange={setAllDay} disabled={!editable} />
      </View>
      <FormInput label="日付（YYYY-MM-DD）" value={date} onChangeText={setDate} editable={editable} keyboardType="numbers-and-punctuation" />
      {!allDay && (
        <View style={pp.rowButtons}>
          <FormInput label="開始（HH:mm）" value={time} onChangeText={setTime} editable={editable} keyboardType="numbers-and-punctuation" containerStyle={{ flex: 1 }} />
          <FormInput label="終了（任意）" value={endTime} onChangeText={setEndTime} editable={editable} keyboardType="numbers-and-punctuation" containerStyle={{ flex: 1 }} />
        </View>
      )}
      <FormInput label="タイムゾーン（現地）" value={tz} onChangeText={setTz} editable={editable} autoCapitalize="none" placeholder="例：Europe/Paris" />
      <View style={pp.chips}>
        <Chip label={`この端末（${deviceTimeZone()}）`} selected={tz === deviceTimeZone()} onPress={() => editable && setTz(deviceTimeZone())} />
        {lastTz && lastTz !== deviceTimeZone() && <Chip label={`前の予定（${lastTz}）`} selected={tz === lastTz} onPress={() => editable && setTz(lastTz)} />}
      </View>
      {places.length > 0 && (
        <>
          <ThemedText style={pp.h2}>場所（任意）</ThemedText>
          <View style={pp.chips}>
            <Chip label="なし" selected={placeId === null} onPress={() => editable && setPlaceId(null)} />
            {places.map((p) => <Chip key={p.id} label={p.name} selected={placeId === p.id} onPress={() => editable && setPlaceId(p.id)} />)}
          </View>
        </>
      )}
      <FormInput label="メモ" value={memo} onChangeText={setMemo} editable={editable} multiline />
      {errors.map((e) => <ThemedText key={e} style={pp.error}>{e}</ThemedText>)}
      {editable && <PrimaryButton title={current ? '保存' : '追加'} onPress={save} loading={saving} />}
      {current && (
        <>
          <SecondaryButton title="端末のカレンダーに追加" onPress={addToCalendar} />
          <GhostButton title="Googleカレンダーで追加" tone="primary" onPress={addToGoogle} />
          <ThemedText style={pp.muted}>カレンダーへはコピーとして追加されます。追加した後にここで変更しても、カレンダー側には反映されません。</ThemedText>
          {editable && <GhostButton title="この予定を削除" tone="danger" onPress={remove} />}
        </>
      )}
    </ScrollView>
  );
}
