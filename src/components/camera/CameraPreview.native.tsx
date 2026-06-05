// iOS / Android 用 カメラプレビュー
// expo-camera を使用。金額入力は画面下のカードで行う。
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { CurrencyCode } from '@/constants/currencies';

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

  function cycleZoom() {
    setZoom((z) => {
      const idx = ZOOM_STEPS.indexOf(z);
      return ZOOM_STEPS[(idx + 1) % ZOOM_STEPS.length];
    });
  }

  async function handleScan() {
    if (!cameraRef.current || scanning) return;
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

      console.log('[OCR raw]', raw);
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
    <View style={styles.wrapper}>
      {/* カメラフィード */}
      <CameraView ref={cameraRef} style={styles.camera} zoom={zoom} />

      {/* ビューファインダー四隅 */}
      <View style={[styles.corner, styles.cornerTL]} />
      <View style={[styles.corner, styles.cornerTR]} />
      <View style={[styles.corner, styles.cornerBL]} />
      <View style={[styles.corner, styles.cornerBR]} />

      {/* スキャン案内文 */}
      <View style={styles.scanHint}>
        <ThemedText style={styles.scanHintText}>値札をここに合わせる</ThemedText>
      </View>

      {/* ズームボタン（右上） */}
      <TouchableOpacity style={styles.zoomBtn} onPress={cycleZoom} activeOpacity={0.75}>
        <ThemedText style={styles.zoomBtnText}>{ZOOM_LABELS[zoom]}</ThemedText>
      </TouchableOpacity>

      {/* 読み取りボタン */}
      <TouchableOpacity
        style={[styles.scanBtn, scanning && styles.scanBtnBusy]}
        onPress={handleScan}
        disabled={scanning}
        activeOpacity={0.8}>
        {scanning
          ? <ActivityIndicator color="#fff" size="small" />
          : <ThemedText style={styles.scanBtnText}>読み取る</ThemedText>
        }
      </TouchableOpacity>
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

  scanBtn: {
    position: 'absolute',
    bottom: 14,
    alignSelf: 'center',
    backgroundColor: 'rgba(32,138,239,0.92)',
    borderRadius: 20,
    paddingHorizontal: 24,
    paddingVertical: 10,
    minWidth: 100,
    alignItems: 'center',
  },
  scanBtnBusy: {
    backgroundColor: 'rgba(32,138,239,0.55)',
  },
  scanBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});
