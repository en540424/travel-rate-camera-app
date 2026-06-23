/**
 * 商品写真モード ・ 撮影前（補助）
 * folder: product-camera/ ・ route: app/(tabs)/index.tsx（mode='product'）
 *
 * main.rn.tsx と同一スクリーンの mode 分岐版。雛形として要点のみ抜粋。
 * 共通事項は _common/rn-common-notes.md、数値は product-camera-spec.md。
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

const color = {
  teal600: '#0E9488', ink: '#16211F', ink3: '#7E8986', ink4: '#939E9B',
  appBg: '#F5F7F6', surface: '#FFFFFF', line: '#ECEFED', seg: '#EFF2F0',
  charcoal: '#36443F',
};

/** main.rn.tsx の CameraStage / ShutterButton を mode で出し分けた差分 */

export function CameraStage({ mode }: { mode: 'ocr' | 'product' }) {
  const isProduct = mode === 'product';
  return (
    <View style={[styles.camera, { backgroundColor: isProduct ? '#B0A89F' : '#A9B2AB' }]}>
      {/* <CameraView style={StyleSheet.absoluteFill} /> */}
      <View
        style={[
          styles.reticle,
          isProduct
            ? { width: 150, height: 150, marginLeft: -75, marginTop: -75, borderRadius: 18 }
            : { width: 184, height: 108, marginLeft: -92, marginTop: -54, borderRadius: 13 },
        ]}
      />
      <Text style={styles.guide}>
        {isProduct ? '商品全体が入るように撮る' : '値札・メニューの金額を枠に'}
      </Text>
    </View>
  );
}

export function ShutterButton({ mode, onPress }: { mode: 'ocr' | 'product'; onPress?: () => void }) {
  const isProduct = mode === 'product';
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.shutter,
        isProduct
          ? { backgroundColor: color.charcoal, shadowColor: '#16211F', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 }
          : { backgroundColor: color.teal600, shadowColor: color.teal600, shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
      ]}>
      <Text style={styles.shutterText}>{isProduct ? '商品を撮る' : '読み取る'}</Text>
    </Pressable>
  );
}

/** 商品写真モードのみ：BudgetSummary の位置に出す補助文 */
export function ProductModeHint() {
  return (
    <View style={{ alignItems: 'center', paddingHorizontal: 3 }}>
      <Text style={styles.hint}>金額はあとで手入力 / 価格OCRで追加できます</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  camera: { flex: 1, borderRadius: 22, overflow: 'hidden', position: 'relative' },
  reticle: { position: 'absolute', top: '42%', left: '50%', borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)' },
  guide: { position: 'absolute', bottom: 16, left: 0, right: 0, textAlign: 'center', fontSize: 12.5, fontWeight: '600', color: '#fff' },
  shutter: { height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  shutterText: { fontSize: 16.5, fontWeight: '600', color: '#fff' },
  hint: { fontSize: 11.5, fontWeight: '500', color: color.ink4 },
});
