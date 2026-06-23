/**
 * 読み取り中 ・ phase='scanning'
 * folder: scanning/ ・ route: app/(tabs)/index.tsx（phase='scanning'）
 *
 * main.rn.tsx と同一スクリーン。スキャン中オーバーレイの差分のみ。
 * 共通事項は _common/rn-common-notes.md、数値は scanning-spec.md。
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, Easing, StyleSheet, ActivityIndicator } from 'react-native';

const color = { ink: '#16211F', mutedBtnBg: '#EEF1F0', mutedBtnFg: '#A6AEAB', scan: '#34D8C6' };

/** カメラ枠の子として重ねるスキャン中オーバーレイ */
export function ScanningOverlay({ frameHeight }: { frameHeight: number }) {
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(y, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(y, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [y]);

  const translateY = y.interpolate({ inputRange: [0, 1], outputRange: [frameHeight * 0.16, frameHeight * 0.74] });

  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(16,33,31,0.36)' }]} />
      <Animated.View style={[styles.line, { transform: [{ translateY }] }]} />
      <View style={styles.reticle} />
      <View style={styles.pill}>
        <ActivityIndicator size="small" color="#fff" />
        <Text style={styles.pillText}>読み取り中…</Text>
      </View>
    </View>
  );
}

/** 無効シャッター */
export function ScanningShutter() {
  return (
    <View style={styles.mutedBtn}>
      <Text style={styles.mutedBtnText}>金額とメモを認識中…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { position: 'absolute', left: '8%', right: '8%', height: 2, backgroundColor: color.scan, shadowColor: color.scan, shadowOpacity: 0.6, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } },
  reticle: { position: 'absolute', top: '50%', left: '50%', width: 184, height: 108, marginLeft: -92, marginTop: -54, borderWidth: 2, borderColor: 'rgba(255,255,255,0.55)', borderRadius: 13 },
  pill: { position: 'absolute', bottom: 16, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(16,33,31,0.6)', paddingVertical: 8, paddingHorizontal: 15, borderRadius: 999 },
  pillText: { fontSize: 12.5, fontWeight: '600', color: '#fff' },
  mutedBtn: { height: 52, borderRadius: 16, backgroundColor: color.mutedBtnBg, alignItems: 'center', justifyContent: 'center' },
  mutedBtnText: { fontSize: 16, fontWeight: '600', color: color.mutedBtnFg },
});
