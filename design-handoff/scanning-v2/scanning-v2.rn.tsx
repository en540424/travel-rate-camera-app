/**
 * v2 読み取り中（scanning）・ OCR処理中のローディング状態
 * folder: scanning-v2/  ・ route: app/(tabs)/index.tsx の状態（独立画面ではない）
 *
 * 実体は既存 components/camera/CameraPreview の `scanning` state（handleScan 実行中）。
 * v2では「撮影 → 暗転＋スピナー＋スキャンライン → OCR結果」の見せ方を整える。
 * 処理本体（takePictureAsync / extractTextFromImage）は変更しない。
 */
import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';

const color = {
  primaryAccent: '#7FD8CC', // スキャンライン（tokens.ts color.primaryAccent）
  text: '#16211F', muted: '#7E8986',
};

/** CameraStage 内のローディングオーバーレイ。CameraPreview の scanning=true で重ねる。 */
export function ScanningOverlay() {
  return (
    <View style={styles.overlay}>
      {/* スキャンライン（teal accent） */}
      <View style={styles.scanLine} />
      <View style={styles.center}>
        <ActivityIndicator color="#fff" />
        <Text style={styles.title}>読み取り中…</Text>
        <Text style={styles.sub}>金額とテキストを認識しています</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(27,36,34,0.82)', // dark 系の暗転
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanLine: {
    position: 'absolute',
    left: 0, right: 0, top: '46%',
    height: 2,
    backgroundColor: color.primaryAccent,
    shadowColor: color.primaryAccent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 6,
  },
  center: { alignItems: 'center', gap: 14 },
  title: { fontSize: 14, fontWeight: '700', color: '#fff' },
  sub: { fontSize: 11.5, fontWeight: '500', color: 'rgba(255,255,255,0.6)' },
});
