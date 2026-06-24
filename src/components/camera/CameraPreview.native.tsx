// iOS / Android 用 カメラプレビュー
// expo-camera を使用。金額入力は画面下のカードで行う。
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

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

// zoom（expo-cameraのzoomプロップ、0〜1）と表示倍率（1.0x〜3.0x）の対応。
// 既存の1x/2x/3xプリセット（0, 0.25, 0.5）がちょうど display=1+4*zoom の直線に乗るため、
// ピンチ範囲も同じ式で0〜0.5（=1.0x〜3.0x）に揃える。
const ZOOM_STEPS = [0, 0.25, 0.5] as const;
const ZOOM_PRESET_LABELS = ['1×', '2×', '3×'] as const;
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];
const PINCH_SENSITIVITY = 0.5; // ピンチのscale変化量→zoom変化量の係数
// 安定待ちの判定は内部zoom値ではなく「ユーザーが見ている表示倍率」基準で行う（1x〜2.4xでは絶対に発生させない）。
const HIGH_ZOOM_MULTIPLIER_THRESHOLD = 2.5;
const STABILIZE_DELAY_MS = 250; // 0.25秒固定。0.35秒以上にはしない（旅行中の撮影テンポを優先）。

function zoomToMultiplier(z: number): number {
  return 1 + z * 4;
}

function zoomToDisplayX(z: number): string {
  return `${zoomToMultiplier(z).toFixed(1)}x`;
}

function zoomLabel(z: number): string {
  const presetIndex = ZOOM_STEPS.findIndex((step) => Math.abs(step - z) < 0.001);
  return presetIndex >= 0 ? ZOOM_PRESET_LABELS[presetIndex] : zoomToDisplayX(z);
}

export function CameraPreview({ onOcrResult, onPhotoCapture }: CameraPreviewProps) {
  const [permission, requestPermission] = useCameraPermissions();
  // 撮影前（高倍率時のみ）の手ブレ対策の安定待ち。OCR処理中とは別stateで管理し、
  // 1x〜2.4xではこのstateが一切trueにならないようにする。
  const [isStabilizing, setIsStabilizing] = useState(false);
  // 撮影後（takePictureAsync〜OCR文字抽出）の処理中。安定待ちとは無関係に、これまで通り全倍率で発生する。
  const [isProcessingOcr, setIsProcessingOcr] = useState(false);
  const isBusy = isStabilizing || isProcessingOcr;
  const [zoom, setZoom] = useState<number>(0);
  const cameraRef = useRef<CameraView>(null);
  // プリセットボタンの巡回先（ピンチでzoomが中間値になっても1x→2x→3xの巡回は崩さない）
  const presetIndexRef = useRef(0);
  // ピンチ開始時点のzoom（指の移動量＝相対scaleをここからの増減に変換する基準点）
  const pinchBaseZoomRef = useRef(0);

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

  // プリセット巡回はpresetIndexRef基準で進める（ピンチ後のzoomが中間値でも1x→2x→3xを保つ）
  function cycleZoom() {
    const nextIndex = (presetIndexRef.current + 1) % ZOOM_STEPS.length;
    presetIndexRef.current = nextIndex;
    setZoom(ZOOM_STEPS[nextIndex]);
  }

  // ピンチズーム（1.0x〜3.0x ＝ zoom 0〜0.5）。安定待ち中・OCR処理中はズーム変更を受け付けない。
  const pinchGesture = Gesture.Pinch()
    .runOnJS(true)
    .enabled(!isBusy)
    .onStart(() => {
      pinchBaseZoomRef.current = zoom;
    })
    .onUpdate((e) => {
      const next = pinchBaseZoomRef.current + (e.scale - 1) * PINCH_SENSITIVITY;
      setZoom(Math.min(Math.max(next, 0), MAX_ZOOM));
    });

  async function handleScan() {
    if (Platform.OS === 'web' || !cameraRef.current || isBusy) return;

    // 安定待ちの判定は表示倍率（1.0x〜3.0x）基準。2.5x以上だけ撮影前に一瞬待ち、
    // 1x〜2.4xはこの分岐に入らず即座に撮影へ進む（isStabilizingは常にfalseのまま）。
    const currentZoomMultiplier = zoomToMultiplier(zoom);
    const shouldUseStabilizeDelay = currentZoomMultiplier >= HIGH_ZOOM_MULTIPLIER_THRESHOLD;
    // 確認用ログ（採用判断のための一時確認。リリース前に削除する）。
    console.log('[OCR Capture]', { currentZoomMultiplier, shouldUseStabilizeDelay });
    if (shouldUseStabilizeDelay) {
      setIsStabilizing(true);
      await new Promise((resolve) => setTimeout(resolve, STABILIZE_DELAY_MS));
      setIsStabilizing(false);
    }

    setIsProcessingOcr(true);
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
      setIsProcessingOcr(false);
    }
  }

  return (
    <View style={styles.root}>
      {/* カメラ枠（映像・ガイド・倍率・読み取り中表示のみ）。GestureDetectorでピンチズームのみを枠内に限定する。 */}
      <GestureDetector gesture={pinchGesture}>
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

        {/* ズームボタン（右上）。タップ＝プリセット巡回、表示はプリセット中は1x/2x/3x、
            ピンチで中間倍率の時だけ小数（例: 2.4x）に切り替わる。 */}
        <TouchableOpacity style={styles.zoomBtn} onPress={cycleZoom} activeOpacity={0.75}>
          <ThemedText style={styles.zoomBtnText}>{zoomLabel(zoom)}</ThemedText>
        </TouchableOpacity>

        {/* 安定待ちオーバーレイ（高倍率時のみ・isStabilizing連動）。1x〜2.4xでは絶対に表示されない。
            OCR処理中オーバーレイとは別state・別文言にして混同を避ける（タップは奪わない）。 */}
        {isStabilizing && (
          <View pointerEvents="none" style={styles.scanningOverlay}>
            <ActivityIndicator color="#fff" size="small" />
            <ThemedText style={styles.scanningText}>読み取り中…</ThemedText>
          </View>
        )}

        {/* OCR処理中オーバーレイ（表示専用・isProcessingOcr連動・タップは奪わない）。倍率に関わらず従来通り表示。 */}
        {isProcessingOcr && (
          <View pointerEvents="none" style={styles.scanningOverlay}>
            <ActivityIndicator color="#fff" size="small" />
            <ThemedText style={styles.scanningText}>値札を読み取り中…</ThemedText>
          </View>
        )}
      </View>
      </GestureDetector>

      {/* 読み取るCTA（カメラ枠の外・下の大きい teal ボタン） */}
      <TouchableOpacity
        style={[styles.scanCta, isBusy && styles.scanCtaBusy]}
        onPress={handleScan}
        disabled={isBusy}
        activeOpacity={0.85}>
        {isBusy
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
    aspectRatio: 0.8, // v3: 開始画面を1画面に収めるため、縦長を少しだけ控える（従来 3/4 から微調整）
    backgroundColor: '#111',
    position: 'relative',
  },
  camera: { ...StyleSheet.absoluteFill },
  placeholder: { aspectRatio: 0.8, backgroundColor: '#111' },
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
    opacity: 0.7, // 安定待ち・OCR処理中は少し薄く
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
