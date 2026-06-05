// iOS / Android 用 カメラプレビュー
// expo-camera を使用。金額入力は画面下のカードで行う。
import { CameraView, useCameraPermissions } from 'expo-camera';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { CurrencyCode } from '@/constants/currencies';

export interface CameraPreviewProps {
  currency: CurrencyCode;
  rate: number;
  remainingIfSaved?: number | null;
  /** 将来の OCR 統合のために予約済み */
  amountText?: string;
  onAmountChange?: (text: string) => void;
}

export function CameraPreview(_props: CameraPreviewProps) {
  const [permission, requestPermission] = useCameraPermissions();

  if (!permission) {
    return <View style={styles.placeholder} />;
  }

  if (!permission.granted) {
    return (
      <View style={[styles.permissionBox, { backgroundColor: '#1a1a1a' }]}>
        <ThemedText style={styles.permissionText}>
          カメラへのアクセスが必要です
        </ThemedText>
        <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
          <ThemedText style={styles.permissionBtnText}>許可する</ThemedText>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>
      {/* カメラフィード */}
      <CameraView style={styles.camera} />

      {/* ビューファインダー四隅 */}
      <View style={[styles.corner, styles.cornerTL]} />
      <View style={[styles.corner, styles.cornerTR]} />
      <View style={[styles.corner, styles.cornerBL]} />
      <View style={[styles.corner, styles.cornerBR]} />

      {/* スキャン案内文 */}
      <View style={styles.scanHint}>
        <ThemedText style={styles.scanHintText}>値札をここに合わせる</ThemedText>
      </View>
    </View>
  );
}

const CORNER = 28;
const CORNER_W = 3;
const CORNER_COLOR = 'rgba(255,255,255,0.85)';

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: 16,
    overflow: 'hidden',
    aspectRatio: 4 / 3,
    backgroundColor: '#111',
    position: 'relative',
  },
  camera: { ...StyleSheet.absoluteFill },
  placeholder: { aspectRatio: 4 / 3, backgroundColor: '#111' },
  permissionBox: {
    aspectRatio: 4 / 3,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  permissionText: { color: '#fff', fontSize: 14 },
  permissionBtn: {
    backgroundColor: '#208AEF',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  permissionBtnText: { color: '#fff', fontWeight: '700' },

  corner: { position: 'absolute', width: CORNER, height: CORNER },
  cornerTL: { top: 14, left: 14, borderTopWidth: CORNER_W, borderLeftWidth: CORNER_W, borderColor: CORNER_COLOR },
  cornerTR: { top: 14, right: 14, borderTopWidth: CORNER_W, borderRightWidth: CORNER_W, borderColor: CORNER_COLOR },
  cornerBL: { bottom: 14, left: 14, borderBottomWidth: CORNER_W, borderLeftWidth: CORNER_W, borderColor: CORNER_COLOR },
  cornerBR: { bottom: 14, right: 14, borderBottomWidth: CORNER_W, borderRightWidth: CORNER_W, borderColor: CORNER_COLOR },

  scanHint: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanHintText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 0.4,
  },
});
