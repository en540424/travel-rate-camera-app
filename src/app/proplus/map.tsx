/**
 * 買い物マップ：保存した場所（店・地点）を地図と一覧で見る。現在地から近い順・外部地図アプリで経路案内。
 * 位置情報は「現在地」を押した時だけ求める。許可しなくても一覧・手入力・経路案内は使える。
 */
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';

import { MapCanvas } from '@/components/proplus/map-canvas';
import type { MapPin } from '@/components/proplus/map-canvas.types';
import { AccessNotice, Chip, Notice, pp, Row } from '@/components/proplus/proplus-ui';
import { ThemedText } from '@/components/themed-text';
import { EmptyState } from '@/components/ui/EmptyState';
import { GhostButton } from '@/components/ui/GhostButton';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { SecondaryButton } from '@/components/ui/SecondaryButton';
import { useProPlusAccess, useProPlusData } from '@/hooks/use-proplus';
import { useTripRecords } from '@/hooks/use-trip-records';
import { canEditProPlusData } from '@/lib/proplus/proplus-access-core';
import { getCurrentLocation, openExternalUrl } from '@/lib/proplus/device-services';
import { externalNavigationUrl, formatDistance, hasCoordinate, sortPlaces, type Place } from '@/lib/proplus/places-core';
import { useTripStore } from '@/stores/trip-store';

export default function ShoppingMapScreen() {
  const access = useProPlusAccess();
  const { data, blockedReason } = useProPlusData();
  const activeTrip = useTripStore((s) => s.activeTrip);
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [onlyThisTrip, setOnlyThisTrip] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const editable = canEditProPlusData(access) && !blockedReason;

  const tripFilter = onlyThisTrip && activeTrip ? activeTrip.id : null;
  const places = useMemo(() => sortPlaces(data.places, here, tripFilter), [data.places, here, tripFilter]);
  // ピンの色のため、表示中の場所が属する旅行の記録を読む
  const history = useTripRecords(places.map((p) => p.tripId).filter((id): id is number => id != null));

  // ピンの色：購入済みの記録がある場所／候補だけの場所／記録の無い場所
  const pins: MapPin[] = useMemo(() => {
    const byId = new Map(history.map((h) => [h.id, h]));
    return places.filter(hasCoordinate).map((p) => {
      const recs = data.links.filter((l) => l.placeId === p.id).map((l) => byId.get(l.historyId)).filter((h) => h != null);
      const kind: MapPin['kind'] = recs.some((h) => h!.is_purchased === 1) ? 'purchased' : recs.length ? 'candidate' : 'place';
      return { id: p.id, lat: p.lat as number, lng: p.lng as number, title: p.name, subtitle: recs.length ? `記録 ${recs.length}件` : p.memo, kind };
    });
  }, [places, data.links, history]);

  async function locate() {
    setLocating(true);
    const r = await getCurrentLocation();
    setLocating(false);
    if (r.status === 'ok') setHere({ lat: r.lat, lng: r.lng });
    else if (r.status === 'denied') Alert.alert('位置情報が許可されていません', '設定アプリで許可すると近い順に並べられます。場所は手入力でも登録できます。');
    else Alert.alert('現在地を取得できませんでした', '電波の良い場所でもう一度お試しください。');
  }

  async function navigate(p: Place, app: 'apple' | 'google') {
    const ok = await openExternalUrl(externalNavigationUrl(p, app));
    if (!ok) Alert.alert('地図アプリを開けませんでした');
  }

  return (
    <ScrollView style={pp.screen} contentContainerStyle={pp.content}>
      <AccessNotice access={access} blocked={blockedReason} />
      <MapCanvas pins={pins} here={here} selectedId={selectedId} onSelect={setSelectedId} />
      <View style={pp.rowButtons}>
        <SecondaryButton title={locating ? '取得中…' : '現在地'} onPress={locate} disabled={locating} style={{ flex: 1 }} />
        {editable && <PrimaryButton title="場所を追加" onPress={() => router.push('/proplus/place-edit')} style={{ flex: 1 }} />}
      </View>
      <View style={pp.chips}>
        <Chip label={activeTrip ? `この旅行（${activeTrip.name}）` : 'この旅行'} selected={onlyThisTrip} onPress={() => setOnlyThisTrip(true)} />
        <Chip label="すべての旅行" selected={!onlyThisTrip} onPress={() => setOnlyThisTrip(false)} />
      </View>
      {here && <ThemedText style={pp.muted}>現在地から近い順に並べています。</ThemedText>}
      {places.length === 0 ? (
        <EmptyState
          title="保存した場所はまだありません"
          body="買った店や、また行きたい店を登録すると、地図と一覧で見返せます。"
          primary={editable ? { title: '場所を追加', onPress: () => router.push('/proplus/place-edit') } : undefined}
        />
      ) : (
        <View>
          {places.map((p) => (
            <View key={p.id}>
              <Row
                title={p.name}
                sub={[p.distanceM != null ? formatDistance(p.distanceM) : null, hasCoordinate(p) ? null : '座標なし（店名で検索して案内）', p.memo || null].filter(Boolean).join('・')}
                onPress={() => router.push({ pathname: '/proplus/place-edit', params: { id: p.id } })}
              />
              <View style={pp.rowButtons}>
                <GhostButton title="Appleマップで案内" tone="primary" onPress={() => navigate(p, 'apple')} />
                <GhostButton title="Googleマップで案内" onPress={() => navigate(p, 'google')} />
              </View>
            </View>
          ))}
        </View>
      )}
      <Notice>地図の検索結果は保存しません。保存するのは、あなたが入力した店名と、現在地から取った座標だけです。</Notice>
    </ScrollView>
  );
}
