// 翻訳ページのカメラ翻訳（iOS）。外国語を読むこと自体が目的。
//
// - カメラを向けると、見えている文字を約1秒ごとに読み取り、元の文字の位置に訳を重ねて表示する
//   （位置が揺れても読めるよう、同じ内容を枠の下に一覧でも出す）
// - シャッター＝静止画を撮って「写真翻訳」（長文を段落ごとにまとめて高精度に読む）へ渡す。
//   メインカメラのシャッター（価格OCR→保存）とは役割が違う
// - 映像フレームは端末内で認識して捨てる。撮影した写真もアプリのキャッシュにだけ置き、保存しない
//
// このコンポーネントは「翻訳ページにフォーカスがあり、カメラモードを選んでいる間」だけマウントする
// （メインカメラとsessionを同時に動かさないため。呼び出し側の責務）。
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { LiveTextScanner, type LiveTextScannerStatus } from '@/components/live-text/LiveTextScanner';
import { PrimaryButton } from '@/components/ui';
import { getLanguageDisplayName } from '@/config/translation-language-names';
import { useLiveTextFrames, useSceneTranslationQueue } from '@/hooks/use-live-text-translation';
import {
  getVisionLanguagesForSource,
  mapBoxToView,
  resolveSourceLanguageForText,
  selectOverlayLines,
  visibleRegionInImage,
  type Size,
} from '@/lib/live-text-core';
import { color, radius, shadow } from '@/theme/tokens';

/** 認識の間隔(ms) */
const LIVE_TRANSLATION_INTERVAL_MS = 800;
/** 枠の中に重ねる最大件数（読みにくくならないように） */
const MAX_OVERLAY_LABELS = 8;
/** 1件の最大文字数（長い文章は写真翻訳へ） */
const MAX_LIVE_TEXT_LENGTH = 80;

export type LiveTranslationCameraProps = {
  sourceLanguage: string;
  targetLanguage: string;
  /** シャッターで撮った写真（アプリのキャッシュ上の一時ファイル）を写真翻訳へ渡す */
  onCapture: (uri: string) => void;
};

type PlacedLabel = {
  id: string;
  left: number;
  top: number;
  maxWidth: number;
  fontSize: number;
  text: string;
  translated: boolean;
};

export function LiveTranslationCamera({ sourceLanguage, targetLanguage, onCapture }: LiveTranslationCameraProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureFailed, setCaptureFailed] = useState(false);
  const [viewSize, setViewSize] = useState<Size | null>(null);
  const [scannerStatus, setScannerStatus] = useState<LiveTextScannerStatus>('off');

  const active = cameraReady && permission?.granted === true;
  const { tracked, frameSize, onFrame } = useLiveTextFrames(active);

  const overlayEntries = useMemo(() => {
    if (frameSize == null || viewSize == null) return [];
    return selectOverlayLines(tracked, {
      maxEntries: MAX_OVERLAY_LABELS,
      maxTextLength: MAX_LIVE_TEXT_LENGTH,
      minHits: 2,
      visibleRegion: visibleRegionInImage(frameSize, viewSize),
    });
  }, [tracked, frameSize, viewSize]);

  const translationItems = useMemo(
    () =>
      overlayEntries.map((entry) => ({
        text: entry.text,
        sourceLanguage: resolveSourceLanguageForText(entry.text, sourceLanguage, targetLanguage),
      })),
    [overlayEntries, sourceLanguage, targetLanguage],
  );

  const { lookup, notice, activate, translationSupported } = useSceneTranslationQueue({
    enabled: active && !isCapturing,
    targetLanguage,
    items: translationItems,
  });

  const rows = overlayEntries.map((entry, index) => {
    const translated = lookup(translationItems[index]?.sourceLanguage ?? null, entry.text);
    return { entry, translated: translated != null && translated !== '' ? translated : null };
  });

  // 元の文字の位置へ訳を重ねる。重なりすぎる札は省く（下の一覧には全件出る）
  const labels: PlacedLabel[] = [];
  if (frameSize != null && viewSize != null) {
    const placed: { left: number; top: number; right: number; bottom: number }[] = [];
    const ordered = [...rows].sort((a, b) => a.entry.box.y - b.entry.box.y);
    for (const { entry, translated } of ordered) {
      const rect = mapBoxToView(entry.box, frameSize, viewSize);
      const fontSize = Math.min(18, Math.max(11, rect.height * 0.62));
      const left = Math.min(Math.max(rect.left, 4), Math.max(4, viewSize.width - 64));
      const top = Math.min(Math.max(rect.top, 4), Math.max(4, viewSize.height - 28));
      const maxWidth = Math.max(64, Math.min(viewSize.width - left - 4, Math.max(rect.width * 1.6, 120)));
      const estimatedHeight = fontSize * 1.35 * 2 + 6;
      const box = { left, top, right: left + Math.min(maxWidth, rect.width + 24), bottom: top + estimatedHeight * 0.6 };
      const overlaps = placed.some(
        (other) => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top,
      );
      if (overlaps) continue;
      placed.push(box);
      labels.push({
        id: entry.id,
        left,
        top,
        maxWidth,
        fontSize,
        text: translated ?? entry.text,
        translated: translated != null,
      });
    }
  }

  function handleLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    setViewSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
  }

  async function handleCapture() {
    if (!cameraRef.current || isCapturing) return;
    setIsCapturing(true);
    setCaptureFailed(false);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      if (photo?.uri) {
        onCapture(photo.uri);
      } else {
        setCaptureFailed(true);
      }
    } catch (error) {
      if (__DEV__) console.warn('[LiveTranslationCamera] 撮影に失敗', error);
      setCaptureFailed(true);
    } finally {
      setIsCapturing(false);
    }
  }

  if (!permission) {
    return <View style={styles.placeholder} />;
  }

  if (!permission.granted) {
    const alreadyDenied = !permission.canAskAgain;
    return (
      <View style={styles.permissionBox}>
        <ThemedText style={styles.permissionText}>カメラで翻訳するには、カメラへのアクセスが必要です</ThemedText>
        {alreadyDenied ? (
          <Pressable style={styles.permissionBtn} onPress={() => void Linking.openSettings()}>
            <ThemedText style={styles.permissionBtnText}>設定アプリで許可する</ThemedText>
          </Pressable>
        ) : (
          <Pressable style={styles.permissionBtn} onPress={() => void requestPermission()}>
            <ThemedText style={styles.permissionBtnText}>許可する</ThemedText>
          </Pressable>
        )}
      </View>
    );
  }

  const statusLabel =
    scannerStatus === 'unavailable'
      ? 'このカメラではリアルタイム翻訳を使えません'
      : !cameraReady || scannerStatus === 'waiting' || scannerStatus === 'off'
        ? 'カメラを準備しています…'
        : rows.length === 0
          ? '文字にカメラを向けてください'
          : translationSupported === false
            ? '翻訳はiOS 18以降で利用できます'
            : 'リアルタイム翻訳中';

  return (
    <View style={styles.root}>
      <View style={styles.frame} onLayout={handleLayout}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          onCameraReady={() => setCameraReady(true)}
        />
        <LiveTextScanner
          enabled={cameraReady}
          paused={isCapturing}
          languages={getVisionLanguagesForSource(sourceLanguage)}
          intervalMs={LIVE_TRANSLATION_INTERVAL_MS}
          onFrame={onFrame}
          onStatusChange={setScannerStatus}
        />

        {!isCapturing &&
          labels.map((label) => (
            <View
              key={label.id}
              pointerEvents="none"
              style={[styles.label, { left: label.left, top: label.top, maxWidth: label.maxWidth }]}>
              <ThemedText
                style={[
                  styles.labelText,
                  { fontSize: label.fontSize, lineHeight: label.fontSize * 1.3 },
                  !label.translated && styles.labelTextPending,
                ]}
                numberOfLines={2}>
                {label.text}
              </ThemedText>
            </View>
          ))}

        <View style={styles.statusChip} pointerEvents="none">
          <ThemedText style={styles.statusText}>{statusLabel}</ThemedText>
        </View>

        {notice != null && !isCapturing && (
          <Pressable
            style={({ pressed }) => [styles.notice, pressed && notice.status !== 'unsupported' && styles.pressed]}
            onPress={() => {
              if (notice.status !== 'unsupported') activate(notice.sourceLanguage);
            }}
            disabled={notice.status === 'unsupported'}
            accessibilityRole="button">
            <ThemedText style={styles.noticeText} numberOfLines={2}>
              {notice.status === 'unsupported'
                ? `${getLanguageDisplayName(notice.sourceLanguage)}の翻訳には対応していません`
                : notice.status === 'needs_download'
                  ? `${getLanguageDisplayName(notice.sourceLanguage)}の翻訳データが必要です（タップでダウンロード）`
                  : `${getLanguageDisplayName(notice.sourceLanguage)}を翻訳できませんでした（タップで再試行）`}
            </ThemedText>
          </Pressable>
        )}

        {isCapturing && (
          <View pointerEvents="none" style={styles.capturingOverlay}>
            <ActivityIndicator color="#fff" />
            <ThemedText style={styles.capturingText}>撮影しています…</ThemedText>
          </View>
        )}
      </View>

      <PrimaryButton
        title="撮影して詳しく翻訳"
        onPress={() => void handleCapture()}
        loading={isCapturing}
        disabled={!cameraReady}
      />
      <ThemedText style={styles.caption}>
        メニューの説明や注意書きなど長い文章は、撮影すると段落ごとにまとめて翻訳します
      </ThemedText>
      {captureFailed && <ThemedText style={styles.errorText}>撮影できませんでした。もう一度お試しください。</ThemedText>}

      {/* 位置が揺れても読めるよう、見えている文字の訳を一覧でも出す */}
      {rows.length > 0 && (
        <View style={styles.listCard}>
          <ThemedText style={styles.listTitle}>見えている文字</ThemedText>
          {rows.map(({ entry, translated }, index) => (
            <View key={entry.id} style={[styles.listRow, index > 0 && styles.listRowDivider]}>
              <ThemedText style={styles.listTranslated} numberOfLines={2}>
                {translated ?? '…'}
              </ThemedText>
              <ThemedText style={styles.listOriginal} numberOfLines={2}>
                {entry.text}
              </ThemedText>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  frame: {
    borderRadius: radius.card,
    overflow: 'hidden',
    aspectRatio: 3 / 4,
    backgroundColor: '#111',
  },
  placeholder: { aspectRatio: 3 / 4, borderRadius: radius.card, backgroundColor: '#111' },
  permissionBox: {
    aspectRatio: 4 / 3,
    borderRadius: radius.card,
    backgroundColor: color.dark,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 20,
  },
  permissionText: { color: '#fff', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  permissionBtn: {
    backgroundColor: color.primary,
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  permissionBtnText: { color: '#fff', fontWeight: '700' },

  label: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
    ...shadow.card,
  },
  labelText: { color: color.text, fontWeight: '700' },
  labelTextPending: { color: color.muted, fontWeight: '500' },

  statusChip: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: 'rgba(0,0,0,0.52)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  notice: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    backgroundColor: 'rgba(17,32,30,0.85)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(127,216,204,0.45)',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  noticeText: { color: '#fff', fontSize: 12.5, fontWeight: '600', textAlign: 'center' },
  pressed: { opacity: 0.8 },

  capturingOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: 'rgba(17,32,30,0.38)',
  },
  capturingText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  caption: { fontSize: 12, fontWeight: '500', color: color.muted, textAlign: 'center' },
  errorText: { fontSize: 12.5, fontWeight: '600', color: color.danger, textAlign: 'center' },

  listCard: {
    borderRadius: radius.cardLg,
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.line,
    paddingHorizontal: 14,
    paddingVertical: 10,
    ...shadow.card,
  },
  listTitle: { fontSize: 12.5, fontWeight: '700', color: color.primaryDark, marginBottom: 4 },
  listRow: { paddingVertical: 8, gap: 2 },
  listRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line2 },
  listTranslated: { fontSize: 15, fontWeight: '700', color: color.text },
  listOriginal: { fontSize: 12, fontWeight: '500', color: color.muted },
});
