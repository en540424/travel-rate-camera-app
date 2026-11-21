/**
 * 買い物マップの地図（iOS：Apple地図。`provider` 未指定・鍵不要）。
 * 表示するのは保存済みの場所（端末GPS・手入力の座標）だけ。地図検索の結果は保存しない（Apple DPLA §2.5）。
 *
 * react-native-mapsは描画の時に読み込む。地図のnativeを含まない古いBuild（development client等）で
 * 読み込みに失敗しても、アプリ全体を落とさず代替表示（`map-canvas.tsx`）にする。
 */
import { Component, type ComponentType, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import { regionForPoints } from '@/lib/proplus/places-core';

import { MapCanvas as FallbackCanvas } from './map-canvas';
import type { MapCanvasProps } from './map-canvas.types';

type MapsModule = { default: ComponentType<Record<string, unknown>>; Marker: ComponentType<Record<string, unknown>> };
let maps: MapsModule | null | undefined;

function loadMaps(): MapsModule | null {
  if (maps !== undefined) return maps;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    maps = require('react-native-maps') as MapsModule;
  } catch (e) {
    if (__DEV__) console.warn('[proplus] react-native-maps unavailable', e);
    maps = null;
  }
  return maps;
}

/** 描画時にnativeの地図が見つからない（古いBuild）場合も、代替表示へ切り替える */
class MapErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    if (__DEV__) console.warn('[proplus] map render failed', e);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function MapCanvas(props: MapCanvasProps) {
  const { pins, here, selectedId, onSelect, height = 280 } = props;
  const m = loadMaps();
  if (!m) return <FallbackCanvas {...props} />;
  const MapView = m.default;
  const Marker = m.Marker;
  const points = pins.map((p) => ({ lat: p.lat, lng: p.lng }));
  if (here) points.push({ lat: here.lat, lng: here.lng });
  const region = regionForPoints(points) ?? { latitude: 35.6812, longitude: 139.7671, latitudeDelta: 0.2, longitudeDelta: 0.2 };
  return (
    <MapErrorBoundary fallback={<FallbackCanvas {...props} />}>
    <MapView style={[styles.map, { height }]} initialRegion={region} showsUserLocation={here != null}>
      {pins.map((p) => (
        <Marker
          key={p.id}
          coordinate={{ latitude: p.lat, longitude: p.lng }}
          title={p.title}
          description={p.subtitle}
          pinColor={p.kind === 'purchased' ? '#0E9488' : p.kind === 'candidate' ? '#E0A53B' : p.id === selectedId ? '#0A766E' : '#7E8986'}
          onPress={() => onSelect?.(p.id)}
        />
      ))}
    </MapView>
    </MapErrorBoundary>
  );
}

const styles = StyleSheet.create({ map: { width: '100%', borderRadius: 16 } });
