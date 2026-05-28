// iOS / Android 用 カメラプレビュー
// expo-camera を使用。現時点では OCR 未実装のため、
// カメラ越しに金額を手動入力して換算するスタイル。
import { CameraView, useCameraPermissions } from 'expo-camera';
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { CurrencyCode } from '@/constants/currencies';
import { CURRENCIES } from '@/constants/currencies';
import { formatJpy } from '@/utils/format';
import { convert } from '@/utils/currency';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';

export interface CameraPreviewProps {
  currency: CurrencyCode;
  rate: number;
  /** Phase A: Web の残り予算プレビュー（Native では未使用） */
  remainingIfSaved?: number | null;
  /** 入力中の金額文字列（外部で管理） */
  amountText: string;
  onAmountChange: (text: string) => void;
}

export function CameraPreview({
  currency,
  rate,
  amountText,
  onAmountChange,
}: CameraPreviewProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const theme = useTheme();
  const c = CURRENCIES[currency];
  const amount = parseFloat(amountText) || 0;
  const jpyAmount = rate > 0 ? convert(amount, rate) : 0;

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

      {/* 金額入力オーバーレイ（OCR実装まで手動入力） */}
      <View style={styles.inputOverlay}>
        <View style={styles.inputCard}>
          <ThemedText style={styles.inputHint}>
            {c.flag} 金額を入力
          </ThemedText>
          <View style={styles.inputRow}>
            <ThemedText style={styles.inputSymbol}>{c.symbol}</ThemedText>
            <TextInput
              style={[styles.input, { color: '#1a1a1a' }]}
              value={amountText}
              onChangeText={onAmountChange}
              placeholder="0"
              placeholderTextColor="#999"
              keyboardType="decimal-pad"
              inputMode="decimal"
              selectTextOnFocus
            />
          </View>
        </View>
      </View>

      {/* 円換算結果帯 */}
      <View style={styles.resultBand}>
        {amount > 0 && rate > 0 ? (
          <>
            <ThemedText style={styles.resultLabel}>日本円換算</ThemedText>
            <ThemedText style={styles.resultAmount}>{formatJpy(jpyAmount)}</ThemedText>
          </>
        ) : (
          <ThemedText style={styles.resultPlaceholder}>
            {rate <= 0 ? 'レートを設定してください' : '金額を入力してください'}
          </ThemedText>
        )}
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
    gap: Spacing.three,
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
  cornerBL: { bottom: 56, left: 14, borderBottomWidth: CORNER_W, borderLeftWidth: CORNER_W, borderColor: CORNER_COLOR },
  cornerBR: { bottom: 56, right: 14, borderBottomWidth: CORNER_W, borderRightWidth: CORNER_W, borderColor: CORNER_COLOR },

  inputOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 60,
  },
  inputCard: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 4,
    minWidth: 160,
  },
  inputHint: { fontSize: 11, color: '#666', fontWeight: '600' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  inputSymbol: { fontSize: 28, fontWeight: '700', color: '#1a1a1a' },
  input: {
    fontSize: 36,
    fontWeight: '800',
    minWidth: 80,
    textAlign: 'center',
  },

  resultBand: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.72)',
    paddingVertical: 10,
    alignItems: 'center',
    gap: 2,
  },
  resultLabel: { fontSize: 10, color: 'rgba(255,255,255,0.6)', letterSpacing: 0.8 },
  resultAmount: { fontSize: 30, fontWeight: '800', color: '#ffffff' },
  resultPlaceholder: { fontSize: 12, color: 'rgba(255,255,255,0.5)', paddingVertical: 4 },
});
