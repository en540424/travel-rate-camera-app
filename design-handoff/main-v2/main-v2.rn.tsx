/**
 * v2 メイン画面（価格OCR）・ 撮影前 / 起動時
 * folder: main-v2/  ・ route: app/(tabs)/index.tsx ・ 下タブ active=カメラ
 *
 * これは「見た目の正」を RN に写した雛形です。実装は既存 src/app/(tabs)/index.tsx を
 * 部分修正で寄せること（全面書き換えしない）。
 * - 色・余白・角丸・影は src/theme/tokens.ts を正とする（下の color は tokens.ts の抜粋）。
 * - カメラは既存 components/camera/CameraPreview に置換。
 * - 保存ロジック・レート固定・写真保存先は変更しない（main-v2-spec.md「触ってはいけないロジック」）。
 */
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// import { CameraPreview } from '@/components/camera/CameraPreview';

// src/theme/tokens.ts の抜粋（実装では import { color, radius, spacing } from '@/theme/tokens'）
const color = {
  primary: '#0E9488', primaryDark: '#0A766E', primarySoft: '#E7F5F2',
  text: '#16211F', body: '#5B6764', muted: '#7E8986', faint2: '#A6AEAB',
  bgScreen: '#F4F6F5', card: '#FFFFFF', line: '#ECEFED', line2: '#EEF1F0',
};

type CaptureMode = 'ocr' | 'photo';

export default function MainCameraScreenV2() {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<CaptureMode>('ocr'); // 起動時は必ず ocr

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      {/* TripRateHeader */}
      <View style={styles.header}>
        <Text style={styles.tripName} numberOfLines={1}>ハワイ旅行</Text>
        <Pressable style={styles.rateChip} hitSlop={6}>
          <Text style={styles.rateChipText}>🇺🇸 1 USD = ¥158.00</Text>
        </Pressable>
      </View>

      {/* ModeSegment（タップ主体・横スワイプ補助。選択側=白＋影） */}
      <View style={styles.segment}>
        <Pressable style={[styles.segItem, mode === 'ocr' && styles.segItemActive]} onPress={() => setMode('ocr')}>
          <Text style={[styles.segText, mode === 'ocr' && styles.segTextActive]}>価格OCR</Text>
        </Pressable>
        <Pressable style={[styles.segItem, mode === 'photo' && styles.segItemActive]} onPress={() => setMode('photo')}>
          <Text style={[styles.segText, mode === 'photo' && styles.segTextActive]}>商品写真</Text>
        </Pressable>
      </View>

      {/* CameraStage（flex:1）— 実装は <CameraPreview /> に置換 */}
      <View style={styles.camera}>
        {/* <CameraPreview currency={currencyForDisplay} rate={rate} onOcrResult={...} onPhotoCapture={...} /> */}
        <View style={[styles.corner, styles.cornerTL]} />
        <View style={[styles.corner, styles.cornerTR]} />
        <View style={[styles.corner, styles.cornerBL]} />
        <View style={[styles.corner, styles.cornerBR]} />
        <View style={styles.zoomBadge}><Text style={styles.zoomText}>3×</Text></View>
        <Text style={styles.guide}>値札をここに合わせる</Text>
        <Pressable style={styles.shutter}><Text style={styles.shutterText}>読み取る</Text></Pressable>
      </View>

      {/* BudgetSummary */}
      <View style={styles.budgetRow}>
        <View style={styles.budgetItem}>
          <Text style={styles.budgetLabel}>残り</Text>
          <Text style={styles.budgetValue}>¥56,132</Text>
        </View>
        <View style={styles.budgetDivider} />
        <View style={styles.budgetItem}>
          <Text style={styles.budgetLabel}>今日</Text>
          <Text style={styles.budgetValue}>3件</Text>
        </View>
        <View style={styles.budgetDivider} />
        <Pressable style={styles.budgetItem} hitSlop={6}>
          <Text style={styles.manualLink}>✎ 手入力で記録</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgScreen, paddingHorizontal: 15, paddingBottom: 12, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  tripName: { flex: 1, fontSize: 20, fontWeight: '700', color: color.text, letterSpacing: -0.3 },
  rateChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: color.primarySoft, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999 },
  rateChipText: { fontSize: 13, fontWeight: '700', color: color.primaryDark, fontVariant: ['tabular-nums'] },

  segment: { flexDirection: 'row', backgroundColor: color.line2, borderRadius: 12, padding: 3, gap: 3 },
  segItem: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  segItemActive: { backgroundColor: color.card, shadowColor: '#10211F', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.13, shadowRadius: 2, elevation: 2 },
  segText: { fontSize: 14, fontWeight: '600', color: color.muted },
  segTextActive: { fontWeight: '700', color: color.text },

  camera: { flex: 1, borderRadius: 16, overflow: 'hidden', backgroundColor: '#A9B2AB', position: 'relative' },
  corner: { position: 'absolute', width: 28, height: 28 },
  cornerTL: { top: 14, left: 14, borderTopWidth: 3, borderLeftWidth: 3, borderColor: 'rgba(255,255,255,0.85)' },
  cornerTR: { top: 14, right: 14, borderTopWidth: 3, borderRightWidth: 3, borderColor: 'rgba(255,255,255,0.85)' },
  cornerBL: { bottom: 14, left: 14, borderBottomWidth: 3, borderLeftWidth: 3, borderColor: 'rgba(255,255,255,0.85)' },
  cornerBR: { bottom: 14, right: 14, borderBottomWidth: 3, borderRightWidth: 3, borderColor: 'rgba(255,255,255,0.85)' },
  zoomBadge: { position: 'absolute', top: 14, right: 14, backgroundColor: 'rgba(16,33,31,0.52)', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 14 },
  zoomText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  guide: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, textAlign: 'center', textAlignVertical: 'center', fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.55)' },
  shutter: { position: 'absolute', bottom: 14, alignSelf: 'center', minWidth: 120, height: 40, borderRadius: 20, backgroundColor: 'rgba(14,148,136,0.92)', alignItems: 'center', justifyContent: 'center' },
  shutterText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  budgetRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: color.card, borderWidth: 1, borderColor: color.line, borderRadius: 12, paddingVertical: 10 },
  budgetItem: { flex: 1, alignItems: 'center', gap: 2 },
  budgetDivider: { width: 1, alignSelf: 'stretch', backgroundColor: color.line },
  budgetLabel: { fontSize: 10.5, fontWeight: '600', color: color.muted },
  budgetValue: { fontSize: 15, fontWeight: '700', color: color.text, letterSpacing: -0.3, fontVariant: ['tabular-nums'] },
  manualLink: { fontSize: 13, fontWeight: '700', color: color.primary },
});
