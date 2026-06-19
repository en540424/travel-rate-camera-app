// iOS / Android 用 カメラプレビュー
// expo-camera を使用。金額入力は画面下のカードで行う。
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { CurrencyCode } from '@/constants/currencies';
import { color } from '@/theme/tokens';

export interface CameraPreviewProps {
  currency: CurrencyCode;
  rate: number;
  remainingIfSaved?: number | null;
  /** 将来の OCR 統合のために予約済み */
  amountText?: string;
  onAmountChange?: (text: string) => void;
  /** OCR検証: 撮影結果テキストを呼び出し元へ渡す */
  onOcrResult?: (rawText: string) => void;
  /** 撮影した写真のURIを呼び出し元へ渡す */
  onPhotoCapture?: (uri: string) => void;
}

const ZOOM_STEPS = [0, 0.25, 0.5] as const;
type ZoomLevel = typeof ZOOM_STEPS[number];
const ZOOM_LABELS: Record<ZoomLevel, string> = { 0: '1×', 0.25: '2×', 0.5: '3×' };

export function CameraPreview({ onOcrResult, onPhotoCapture }: CameraPreviewProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [zoom, setZoom] = useState<ZoomLevel>(0);
  const cameraRef = useRef<CameraView>(null);

  if (!permission) {
    return <View style={styles.placeholder} />;
  }

  if (!permission.granted) {
    // canAskAgain=false のとき（一度拒否済み）は設定アプリへ誘導する
    const alreadyDenied = !permission.canAskAgain;
    return (
      <View style={[styles.permissionBox, { backgroundColor: '#1a1a1a' }]}>
        <ThemedText style={styles.permissionText}>
          カメラへのアクセスが必要です
        </ThemedText>
        {alreadyDenied ? (
          <TouchableOpacity style={styles.permissionBtn} onPress={() => Linking.openSettings()}>
            <ThemedText style={styles.permissionBtnText}>設定アプリで許可する</ThemedText>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
            <ThemedText style={styles.permissionBtnText}>許可する</ThemedText>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  function cycleZoom() {
    setZoom((z) => {
      const idx = ZOOM_STEPS.indexOf(z);
      return ZOOM_STEPS[(idx + 1) % ZOOM_STEPS.length];
    });
  }

  async function handleScan() {
    if (Platform.OS === 'web' || !cameraRef.current || scanning) return;
    setScanning(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ base64: false });
      if (!photo?.uri) {
        onOcrResult?.('エラー: 撮影失敗（URIなし）');
        return;
      }
      onPhotoCapture?.(photo.uri);

      const { extractTextFromImage } = await import('expo-text-extractor');
      const result = await extractTextFromImage(photo.uri);

      let raw = '';
      if (Array.isArray(result)) {
        raw = result.join('\n');
      } else if (typeof result === 'string') {
        raw = result;
      } else {
        raw = JSON.stringify(result, null, 2);
      }

      onOcrResult?.(raw || 'テキストなし');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[OCR error]', e);
      onOcrResult?.(`エラー: ${msg}`);
    } finally {
      setScanning(false);
    }
  }

  return (
    <View style={styles.root}>
      {/* カメラ枠（映像・ガイド・倍率・読み取り中表示のみ） */}
      <View style={styles.previewFrame}>
        {/* カメラフィード */}
        <CameraView ref={cameraRef} style={styles.camera} zoom={zoom} />

        {/* ビューファインダー四隅（外側＝白ベース＋薄いティールのグロー） */}
        <View style={[styles.corner, styles.cornerTL]} />
        <View style={[styles.corner, styles.cornerTR]} />
        <View style={[styles.corner, styles.cornerBL]} />
        <View style={[styles.corner, styles.cornerBR]} />

        {/* 内側の四隅（薄いティール・控えめ） */}
        <View style={[styles.innerCorner, styles.innerCornerTL]} />
        <View style={[styles.innerCorner, styles.innerCornerTR]} />
        <View style={[styles.innerCorner, styles.innerCornerBL]} />
        <View style={[styles.innerCorner, styles.innerCornerBR]} />

        {/* スキャン案内文 */}
        <View style={styles.scanHint}>
          <ThemedText style={styles.scanHintText}>値札をここに合わせる</ThemedText>
        </View>

        {/* ズームボタン（右上） */}
        <TouchableOpacity style={styles.zoomBtn} onPress={cycleZoom} activeOpacity={0.75}>
          <ThemedText style={styles.zoomBtnText}>{ZOOM_LABELS[zoom]}</ThemedText>
        </TouchableOpacity>

        {/* 読み取り中オーバーレイ（表示専用・scanning 連動・タップは奪わない） */}
        {scanning && (
          <View pointerEvents="none" style={styles.scanningOverlay}>
            <ActivityIndicator color="#fff" size="small" />
            <ThemedText style={styles.scanningText}>値札を読み取り中…</ThemedText>
          </View>
        )}
      </View>

      {/* 読み取るCTA（カメラ枠の外・下の大きい teal ボタン） */}
      <TouchableOpacity
        style={[styles.scanCta, scanning && styles.scanCtaBusy]}
        onPress={handleScan}
        disabled={scanning}
        activeOpacity={0.85}>
        {scanning
          ? <ActivityIndicator color="#fff" />
          : <ThemedText style={styles.scanCtaText}>読み取る</ThemedText>
        }
      </TouchableOpacity>
    </View>
  );
}

const CORNER = 28;
const CORNER_W = 3;
const CORNER_COLOR = 'rgba(255,255,255,0.88)'; // 外側＝白ベース
const CORNER_GLOW = 'rgba(14,148,136,0.35)'; // 外側のごく薄いティールのグロー
const INNER = 20;
const INNER_W = 2;
const INNER_COLOR = 'rgba(14,148,136,0.40)'; // 内側＝薄いティール（撮影後プレビューで見えやすい中心範囲の目安）

const styles = StyleSheet.create({
  root: {
    gap: 12, // カメラ枠と読み取るCTAの間隔
  },
  previewFrame: {
    borderRadius: 16,
    overflow: 'hidden',
    aspectRatio: 3 / 4, // v2: 縦長でカメラ主役（従来 4/3 横長から変更）
    backgroundColor: '#111',
    position: 'relative',
  },
  camera: { ...StyleSheet.absoluteFill },
  placeholder: { aspectRatio: 3 / 4, backgroundColor: '#111' },
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

  corner: {
    position: 'absolute',
    width: CORNER,
    height: CORNER,
    // 外側にごく薄いティールのグロー（iOS）。Android は elevation 色が出ないため控えめ。
    shadowColor: CORNER_GLOW,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 6,
  },
  cornerTL: { top: 14, left: 14, borderTopWidth: CORNER_W, borderLeftWidth: CORNER_W, borderColor: CORNER_COLOR, borderTopLeftRadius: 8 },
  cornerTR: { top: 14, right: 14, borderTopWidth: CORNER_W, borderRightWidth: CORNER_W, borderColor: CORNER_COLOR, borderTopRightRadius: 8 },
  cornerBL: { bottom: 14, left: 14, borderBottomWidth: CORNER_W, borderLeftWidth: CORNER_W, borderColor: CORNER_COLOR, borderBottomLeftRadius: 8 },
  cornerBR: { bottom: 14, right: 14, borderBottomWidth: CORNER_W, borderRightWidth: CORNER_W, borderColor: CORNER_COLOR, borderBottomRightRadius: 8 },

  // 撮影後の小さい（横長）プレビューで見えやすい中心範囲の目安として、中央寄りの横長ボックスの四隅に配置。
  // 横: 16%〜84%（中央56%幅）/ 縦: 33%〜67%（中央34%高）＝外側より明確に小さい中央範囲。
  innerCorner: { position: 'absolute', width: INNER, height: INNER },
  innerCornerTL: { top: '33%', left: '16%', borderTopWidth: INNER_W, borderLeftWidth: INNER_W, borderColor: INNER_COLOR, borderTopLeftRadius: 6 },
  innerCornerTR: { top: '33%', right: '16%', borderTopWidth: INNER_W, borderRightWidth: INNER_W, borderColor: INNER_COLOR, borderTopRightRadius: 6 },
  innerCornerBL: { bottom: '33%', left: '16%', borderBottomWidth: INNER_W, borderLeftWidth: INNER_W, borderColor: INNER_COLOR, borderBottomLeftRadius: 6 },
  innerCornerBR: { bottom: '33%', right: '16%', borderBottomWidth: INNER_W, borderRightWidth: INNER_W, borderColor: INNER_COLOR, borderBottomRightRadius: 6 },

  scanHint: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanHintText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.82)',
    letterSpacing: 0.4,
  },

  zoomBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    backgroundColor: 'rgba(0,0,0,0.52)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  zoomBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },

  scanCta: {
    height: 52,
    borderRadius: 15,
    backgroundColor: color.primary, // v2 teal CTA（枠の外・下・フルワイド）
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanCtaBusy: {
    opacity: 0.7, // scanning 中は少し薄く
  },
  scanCtaText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  scanningOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: 'rgba(17,32,30,0.38)', // 暗すぎない薄幕
  },
  scanningText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
});
