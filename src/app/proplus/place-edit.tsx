/**
 * 場所の追加・編集・削除と、記録（買い物候補・購入済み）との紐付け。
 * 座標は「現在地を入れる」（端末GPS）か手入力。地図の検索結果は保存しない。
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';

import { AccessNotice, Chip, pp } from '@/components/proplus/proplus-ui';
import { ThemedText } from '@/components/themed-text';
import { FormInput } from '@/components/ui/FormInput';
import { GhostButton } from '@/components/ui/GhostButton';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { SecondaryButton } from '@/components/ui/SecondaryButton';
import { useProPlusAccess, useProPlusData } from '@/hooks/use-proplus';
import { useTripRecords } from '@/hooks/use-trip-records';
import { canEditProPlusData } from '@/lib/proplus/proplus-access-core';
import { getCurrentLocation } from '@/lib/proplus/device-services';
import type { CoordSource } from '@/lib/proplus/places-core';
import { proPlusOps } from '@/stores/proplus-store';
import { useTripStore } from '@/stores/trip-store';
import { formatJpy } from '@/utils/format';

/** データの読み込みが終わってからフォームを作る（読み込み前の空の値で初期化して、保存で上書きしないため） */
export default function PlaceEditScreen() {
  const { status } = useProPlusData();
  if (status === 'idle' || status === 'loading') return <View style={pp.content}><ThemedText style={pp.muted}>読み込み中…</ThemedText></View>;
  return <PlaceEditForm />;
}

function PlaceEditForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const access = useProPlusAccess();
  const { data, apply, blockedReason } = useProPlusData();
  const activeTrip = useTripStore((s) => s.activeTrip);
  const current = id ? data.places.find((p) => p.id === id && p.deletedAt === null) ?? null : null;
  const editable = canEditProPlusData(access) && !blockedReason;

  const [name, setName] = useState(current?.name ?? '');
  const [memo, setMemo] = useState(current?.memo ?? '');
  const [lat, setLat] = useState(current?.lat != null ? String(current.lat) : '');
  const [lng, setLng] = useState(current?.lng != null ? String(current.lng) : '');
  const [coordSource, setCoordSource] = useState<CoordSource | null>(current?.coordSource ?? null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // 紐付けの候補：この場所の旅行（新規なら使用中の旅行）の記録
  // 既存の場所は登録時の旅行のまま（旅行の無い場所を、編集で使用中の旅行へ付け替えない）
  const tripId = current ? current.tripId : activeTrip?.id ?? null;
  const records = useTripRecords(tripId != null ? [tripId] : []);
  const linked = new Set(data.links.filter((l) => l.placeId === current?.id).map((l) => l.historyId));

  async function fillHere() {
    const r = await getCurrentLocation();
    if (r.status === 'ok') {
      setLat(r.lat.toFixed(6));
      setLng(r.lng.toFixed(6));
      setCoordSource('device_gps');
    } else {
      Alert.alert(r.status === 'denied' ? '位置情報が許可されていません' : '現在地を取得できませんでした', '店名だけでも保存できます。');
    }
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    const input = { name, memo, lat, lng, coordSource: coordSource ?? 'manual', tripId };
    const r = current
      ? await apply((s, c) => proPlusOps.updatePlace(s, current.id, input, c))
      : await apply((s, c) => proPlusOps.addPlace(s, input, c));
    setSaving(false);
    if (!r.ok) { setErrors(r.errors); return; }
    router.back();
  }

  function remove() {
    if (!current) return;
    Alert.alert('この場所を削除しますか？', '記録・予定は残ります（場所の紐付けだけが外れます）。', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除', style: 'destructive', onPress: async () => {
          const r = await apply((s, c) => proPlusOps.deletePlace(s, current.id, c));
          if (r.ok) router.back(); else setErrors(r.errors);
        },
      },
    ]);
  }

  async function toggleLink(historyId: number) {
    if (!current) return;
    const r = await apply((s) => proPlusOps.setRecordPlace(s, historyId, linked.has(historyId) ? null : current.id));
    if (!r.ok) setErrors(r.errors);
  }

  return (
    <ScrollView style={pp.screen} contentContainerStyle={pp.content} keyboardShouldPersistTaps="handled">
      <AccessNotice access={access} blocked={blockedReason} />
      <FormInput label="店名・地点名" value={name} onChangeText={setName} editable={editable} placeholder="例：駅前のパン屋" maxLength={60} />
      <FormInput label="メモ" value={memo} onChangeText={setMemo} editable={editable} placeholder="営業時間・また買いたい物など" multiline />
      <ThemedText style={pp.h2}>位置（任意）</ThemedText>
      <View style={pp.rowButtons}>
        <FormInput label="緯度" value={lat} onChangeText={(v) => { setLat(v); setCoordSource('manual'); }} editable={editable} keyboardType="numbers-and-punctuation" containerStyle={{ flex: 1 }} />
        <FormInput label="経度" value={lng} onChangeText={(v) => { setLng(v); setCoordSource('manual'); }} editable={editable} keyboardType="numbers-and-punctuation" containerStyle={{ flex: 1 }} />
      </View>
      {editable && <SecondaryButton title="現在地を入れる" onPress={fillHere} />}
      {coordSource === 'device_gps' && <ThemedText style={pp.muted}>座標は端末の現在地から入れました。</ThemedText>}
      {errors.map((e) => <ThemedText key={e} style={pp.error}>{e}</ThemedText>)}
      {editable && <PrimaryButton title={current ? '保存' : '追加'} onPress={save} loading={saving} />}

      {current && (
        <>
          <ThemedText style={pp.h2}>この場所の記録</ThemedText>
          <ThemedText style={pp.muted}>買い物候補・購入済みの記録を、この場所に紐付けます（1つの記録に場所は1つ）。</ThemedText>
          {records.length === 0 ? (
            <ThemedText style={pp.muted}>この旅行の記録はまだありません。</ThemedText>
          ) : (
            <View style={pp.chips}>
              {records.slice(0, 60).map((h) => (
                <Chip
                  key={h.id}
                  label={`${h.is_purchased ? '購入' : '候補'} ${h.memo || '（メモなし）'} ${formatJpy(h.jpy_amount)}`}
                  selected={linked.has(h.id)}
                  onPress={() => editable && toggleLink(h.id)}
                />
              ))}
            </View>
          )}
          {editable && <GhostButton title="この場所を削除" tone="danger" onPress={remove} />}
        </>
      )}
    </ScrollView>
  );
}
