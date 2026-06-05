// Web用 カメラプレビューモック
// 金額入力・JPY表示はカメラ枠の外（index.tsx の inputCard）で行う。
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { CurrencyCode } from '@/constants/currencies';

export interface CameraPreviewProps {
  currency: CurrencyCode;
  rate: number;
  remainingIfSaved?: number | null;
  amountText?: string;
  onAmountChange?: (text: string) => void;
  onOcrResult?: (rawText: string) => void;
}

export function CameraPreview(_props: CameraPreviewProps) {
  return (
    <View style={styles.feed}>
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

const CORNER = 22;
const CORNER_W = 2;
const CORNER_C = 'rgba(255,255,255,0.75)';

const styles = StyleSheet.create({
  feed: {
    backgroundColor: '#0A0A0C',
    width: '100%',
    height: 268,
    position: 'relative',
  },

  corner: { position: 'absolute', width: CORNER, height: CORNER },
  cornerTL: {
    top: 12, left: 12,
    borderTopWidth: CORNER_W, borderLeftWidth: CORNER_W,
    borderColor: CORNER_C, borderTopLeftRadius: 3,
  },
  cornerTR: {
    top: 12, right: 12,
    borderTopWidth: CORNER_W, borderRightWidth: CORNER_W,
    borderColor: CORNER_C, borderTopRightRadius: 3,
  },
  cornerBL: {
    bottom: 12, left: 12,
    borderBottomWidth: CORNER_W, borderLeftWidth: CORNER_W,
    borderColor: CORNER_C, borderBottomLeftRadius: 3,
  },
  cornerBR: {
    bottom: 12, right: 12,
    borderBottomWidth: CORNER_W, borderRightWidth: CORNER_W,
    borderColor: CORNER_C, borderBottomRightRadius: 3,
  },

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
