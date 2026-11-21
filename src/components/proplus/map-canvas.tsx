/**
 * Web（およびnativeの地図が無い環境）用の代替表示。react-native-mapsはWebに対応しないため、ここでは読み込まない。
 * 一覧・外部地図アプリでの経路案内は地図が無くても使える。
 */
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { color } from '@/theme/tokens';

import type { MapCanvasProps } from './map-canvas.types';

export function MapCanvas({ pins, height = 160 }: MapCanvasProps) {
  return (
    <View style={[styles.box, { height }]}>
      <ThemedText style={styles.text}>この環境では地図を表示できません（ピン {pins.length}件）。一覧から外部の地図アプリで開けます。</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: 16, backgroundColor: color.primarySoft, alignItems: 'center', justifyContent: 'center', padding: 16 },
  text: { color: color.body, fontSize: 13, textAlign: 'center' },
});
