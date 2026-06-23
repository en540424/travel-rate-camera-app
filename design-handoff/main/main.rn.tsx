/**
 * メイン画面（価格OCR）・ 撮影前 / 起動時
 * folder: main/  ・ route: app/(tabs)/index.tsx ・ 下タブ active=カメラ
 *
 * React Native / Expo 移植用 雛形。
 * - 縞プレースホルダは expo-camera の <CameraView> に置換してください。
 * - 数値は main-spec.md の通り。色は theme/tokens.ts(color) に集約する想定。
 * - 共通事項は _common/rn-common-notes.md。
 */
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// import { CameraView } from 'expo-camera';

const color = {
  teal600: '#0E9488', teal700: '#0A766E', teal50: '#E7F5F2',
  ink: '#16211F', ink2: '#5B6764', ink3: '#7E8986', ink4: '#939E9B',
  appBg: '#F5F7F6', surface: '#FFFFFF', line: '#ECEFED', seg: '#EFF2F0',
};

type CameraMode = 'ocr' | 'product';

export default function MainCameraScreen() {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<CameraMode>('ocr'); // 起動時は必ず ocr

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      {/* TripRateHeader */}
      <View style={styles.header}>
        <Text style={styles.tripName}>ハワイ旅行</Text>
        <View style={styles.rateChip}>
          <Text style={styles.rateChipText}>🇺🇸 1ドル ¥158.00</Text>
        </View>
      </View>

      {/* ModeSegment（タップ主体・横スワイプ補助） */}
      <View style={styles.segment}>
        <Pressable style={[styles.segItem, mode === 'ocr' && styles.segItemActive]} onPress={() => setMode('ocr')}>
          <Text style={[styles.segText, mode === 'ocr' && styles.segTextActive]}>価格OCR</Text>
        </Pressable>
        <Pressable style={[styles.segItem, mode === 'product' && styles.segItemActive]} onPress={() => setMode('product')}>
          <Text style={[styles.segText, mode === 'product' && styles.segTextActive]}>商品写真</Text>
        </Pressable>
      </View>

      {/* CameraStage（flex:1） */}
      <View style={styles.camera}>
        {/* <CameraView style={StyleSheet.absoluteFill} /> */}
        <View style={styles.reticle} />
        <View style={styles.zoomBadge}><Text style={styles.zoomText}>3×</Text></View>
        <Text style={styles.guide}>値札・メニューの金額を枠に</Text>
      </View>

      {/* ShutterButton（読み取る・teal CTA） */}
      <Pressable style={styles.shutter} onPress={() => {/* → scanning */}}>
        <Text style={styles.shutterText}>読み取る</Text>
      </Pressable>

      {/* BudgetSummary */}
      <View style={styles.budgetRow}>
        <Text style={styles.budgetText}>
          残り <Text style={styles.budgetStrong}>¥56,132</Text>　|　今日 <Text style={styles.budgetStrong}>3件</Text>
        </Text>
        <Pressable hitSlop={8}><Text style={styles.manualLink}>手入力で記録</Text></Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.appBg, paddingHorizontal: 15, paddingBottom: 12, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tripName: { fontSize: 19, fontWeight: '700', color: color.ink, letterSpacing: -0.2 },
  rateChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: color.surface, borderWidth: 1, borderColor: color.line, paddingVertical: 5, paddingHorizontal: 11, borderRadius: 999 },
  rateChipText: { fontSize: 12, fontWeight: '600', color: color.ink2, fontVariant: ['tabular-nums'] },

  segment: { flexDirection: 'row', backgroundColor: color.seg, borderRadius: 12, padding: 3 },
  segItem: { flex: 1, height: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  segItemActive: { backgroundColor: color.surface, shadowColor: '#10211F', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.13, shadowRadius: 2, elevation: 2 },
  segText: { fontSize: 13.5, fontWeight: '600', color: color.ink3 },
  segTextActive: { fontWeight: '700', color: color.ink },

  camera: { flex: 1, borderRadius: 22, overflow: 'hidden', backgroundColor: '#A9B2AB', position: 'relative' },
  reticle: { position: 'absolute', top: '42%', left: '50%', width: 184, height: 108, marginLeft: -92, marginTop: -54, borderWidth: 2, borderColor: 'rgba(255,255,255,0.92)', borderRadius: 13 },
  zoomBadge: { position: 'absolute', top: 12, right: 12, backgroundColor: 'rgba(16,33,31,0.5)', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999 },
  zoomText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  guide: { position: 'absolute', bottom: 16, left: 0, right: 0, textAlign: 'center', fontSize: 12.5, fontWeight: '600', color: '#fff' },

  shutter: { height: 52, borderRadius: 16, backgroundColor: color.teal600, alignItems: 'center', justifyContent: 'center', shadowColor: color.teal600, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.45, shadowRadius: 18, elevation: 6 },
  shutterText: { fontSize: 16.5, fontWeight: '600', color: '#fff' },

  budgetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 3 },
  budgetText: { fontSize: 11.5, fontWeight: '600', color: color.ink3, fontVariant: ['tabular-nums'] },
  budgetStrong: { color: color.ink, fontWeight: '700' },
  manualLink: { fontSize: 12, fontWeight: '600', color: color.teal600 },
});
