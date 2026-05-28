// Web用 カメラプレビューモック
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { CurrencyCode } from '@/constants/currencies';
import { convert } from '@/utils/currency';
import { formatForeign, formatJpy } from '@/utils/format';

const DEMO_AMOUNT = 29.99;
const BRAND = '#208AEF';
const RESULT_H = 108;

export interface CameraPreviewProps {
  currency: CurrencyCode;
  rate: number;
  /** この価格を候補に入れた場合の残り予算（表示のみ） */
  remainingIfSaved?: number | null;
  /** Native専用（Web版では無視） */
  amountText?: string;
  onAmountChange?: (text: string) => void;
}

export function CameraPreview({ currency, rate, remainingIfSaved }: CameraPreviewProps) {
  const jpyAmount = rate > 0 ? convert(DEMO_AMOUNT, rate) : 0;
  const demoLabel = formatForeign(DEMO_AMOUNT, currency);

  return (
    <View style={styles.feed}>

      <View style={styles.gridH1} />
      <View style={styles.gridH2} />
      <View style={styles.gridV1} />
      <View style={styles.gridV2} />

      <View style={[styles.corner, styles.cornerTL]} />
      <View style={[styles.corner, styles.cornerTR]} />
      <View style={[styles.corner, styles.cornerBL]} />
      <View style={[styles.corner, styles.cornerBR]} />

      <View style={styles.demoPill}>
        <View style={styles.demoDot} />
        <ThemedText style={styles.demoText}>デモ表示</ThemedText>
      </View>

      <View style={styles.priceTagArea}>
        <ThemedText style={styles.readLabel}>読み取り価格</ThemedText>
        <View style={styles.scanFrame}>
          <View style={styles.priceTag}>
            <ThemedText style={styles.tagAmount}>{demoLabel}</ThemedText>
          </View>
        </View>
      </View>

      <View style={styles.resultHud}>
        {rate > 0 ? (
          <View style={styles.resultBlock}>
            <View style={styles.resultRow}>
              <ThemedText style={styles.resultPrefix}>約</ThemedText>
              <ThemedText style={styles.resultAmount}>
                {formatJpy(jpyAmount)}
              </ThemedText>
            </View>
            <ThemedText style={styles.resultHint}>保存前に円で確認</ThemedText>
            {remainingIfSaved != null && remainingIfSaved >= 0 && (
              <ThemedText style={styles.remainingHint}>
                この価格を保存すると残り {formatJpy(remainingIfSaved)}
              </ThemedText>
            )}
          </View>
        ) : (
          <ThemedText style={styles.noRate}>
            レートを設定すると換算結果が表示されます
          </ThemedText>
        )}
      </View>

    </View>
  );
}

const CORNER = 22;
const CORNER_W = 2;
const CORNER_C = 'rgba(255,255,255,0.75)';
const GRID_C = 'rgba(255,255,255,0.06)';

const styles = StyleSheet.create({
  feed: {
    backgroundColor: '#0A0A0C',
    width: '100%',
    height: 268,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },

  gridH1: {
    position: 'absolute',
    top: '33.3%',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: GRID_C,
  },
  gridH2: {
    position: 'absolute',
    top: '66.6%',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: GRID_C,
  },
  gridV1: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '33.3%',
    width: StyleSheet.hairlineWidth,
    backgroundColor: GRID_C,
  },
  gridV2: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '66.6%',
    width: StyleSheet.hairlineWidth,
    backgroundColor: GRID_C,
  },

  corner: {
    position: 'absolute',
    width: CORNER,
    height: CORNER,
  },
  cornerTL: {
    top: 12,
    left: 12,
    borderTopWidth: CORNER_W,
    borderLeftWidth: CORNER_W,
    borderColor: CORNER_C,
    borderTopLeftRadius: 3,
  },
  cornerTR: {
    top: 12,
    right: 12,
    borderTopWidth: CORNER_W,
    borderRightWidth: CORNER_W,
    borderColor: CORNER_C,
    borderTopRightRadius: 3,
  },
  cornerBL: {
    bottom: RESULT_H + 12,
    left: 12,
    borderBottomWidth: CORNER_W,
    borderLeftWidth: CORNER_W,
    borderColor: CORNER_C,
    borderBottomLeftRadius: 3,
  },
  cornerBR: {
    bottom: RESULT_H + 12,
    right: 12,
    borderBottomWidth: CORNER_W,
    borderRightWidth: CORNER_W,
    borderColor: CORNER_C,
    borderBottomRightRadius: 3,
  },

  demoPill: {
    position: 'absolute',
    top: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  demoDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: BRAND,
  },
  demoText: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '600',
  },

  priceTagArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: RESULT_H + 4,
    paddingHorizontal: 24,
    gap: 8,
  },
  readLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 0.5,
  },
  scanFrame: {
    borderWidth: 1.5,
    borderColor: 'rgba(32,138,239,0.5)',
    borderRadius: 12,
    padding: 3,
  },
  priceTag: {
    backgroundColor: '#FAFAF8',
    borderRadius: 10,
    paddingHorizontal: 28,
    paddingVertical: 14,
    alignItems: 'center',
    minWidth: 152,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  tagAmount: {
    fontSize: 30,
    fontWeight: '700',
    color: '#1C1C1E',
    letterSpacing: -0.8,
    lineHeight: 36,
  },

  resultHud: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    minHeight: RESULT_H,
    backgroundColor: 'rgba(8,8,10,0.94)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  resultBlock: {
    alignItems: 'center',
    gap: 5,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  resultPrefix: {
    fontSize: 22,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.55)',
    lineHeight: 38,
  },
  resultAmount: {
    fontSize: 38,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -1,
    lineHeight: 44,
    fontVariant: ['tabular-nums'],
  },
  resultHint: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.42)',
  },
  remainingHint: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(32,138,239,0.95)',
    marginTop: 2,
  },
  noRate: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 16,
  },
});
