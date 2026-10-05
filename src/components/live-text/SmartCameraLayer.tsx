// メインカメラの「スマートカメラ」層（iOS）。カメラ枠（previewFrame）の中に重ねる。
//
// カメラを向けているだけで、商品名・短文の翻訳と、価格の現地通貨額・円換算をカメラ枠の下部に出す。
// **「見て決める」ための補助であり、価格OCR・保存フロー（読み取るボタン）は一切置き換えない。**
// - 円換算は既存の`convert`（保存と同じ旅行レート）を使う。新しい為替取得はしない
// - 長文は出さない。中央に近い最大3件まで（画面を価格表示で埋めない）
// - 映像フレームは端末内で認識して捨てる。保存・送信しない
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { LiveTextScanner, type LiveTextScannerStatus } from '@/components/live-text/LiveTextScanner';
import type { CurrencyCode } from '@/constants/currencies';
import { getOcrLanguagesForCurrency } from '@/config/ocr-languages';
import { getLanguageDisplayName } from '@/config/translation-language-names';
import { useLiveTextFrames, useSceneTranslationQueue } from '@/hooks/use-live-text-translation';
import {
  DEFAULT_SMART_CAMERA_OPTIONS,
  buildSmartCameraEntries,
  resolveSourceLanguageForText,
  visibleRegionInImage,
  type Size,
  type SmartCameraEntry,
} from '@/lib/live-text-core';
import { color } from '@/theme/tokens';
import { convert } from '@/utils/currency';
import { extractPriceCandidates } from '@/utils/extract-prices';
import { formatForeign, formatJpy } from '@/utils/format';

/** 認識の間隔(ms)。毎フレームではなく約1秒ごと（端末負荷と見やすさの両立） */
const SMART_CAMERA_INTERVAL_MS = 900;

export type SmartCameraLayerProps = {
  currency: CurrencyCode;
  /** 1外貨あたりの円（保存と同じ旅行レート）。0ならレート未設定 */
  rate: number;
  /** 通貨から決まる翻訳元（`getTranslationSourceLanguage`）。nullの通貨ではこの層自体を出さない */
  sourceLanguage: string;
  targetLanguage: string;
  /** 利用者のON/OFF（OFFで映像フレーム出力をsessionから外す） */
  enabled: boolean;
  onToggle: () => void;
  /** カメラのsessionが開始済みか（onCameraReady後にだけ出力を追加する） */
  cameraReady: boolean;
  /** 撮影・OCR処理中／他タブ表示中。フレームを捨てて表示を畳むだけで、出力の付け外しはしない */
  paused: boolean;
};

type DisplayRow = {
  id: string;
  primary: string;
  secondary: string | null;
  price: string | null;
  jpy: string | null;
};

export function SmartCameraLayer({
  currency,
  rate,
  sourceLanguage,
  targetLanguage,
  enabled,
  onToggle,
  cameraReady,
  paused,
}: SmartCameraLayerProps) {
  const [viewSize, setViewSize] = useState<Size | null>(null);
  const [scannerStatus, setScannerStatus] = useState<LiveTextScannerStatus>('off');
  // 映像出力をsessionへ付けておくか（利用者のON/OFFとカメラ準備だけで決め、タブ切替では付け外ししない）
  const attached = enabled && cameraReady;
  // 認識結果を表示・翻訳するか
  const active = attached && !paused;
  const { tracked, frameSize, onFrame } = useLiveTextFrames(active);

  const entries = useMemo<SmartCameraEntry[]>(() => {
    if (!active || frameSize == null || viewSize == null) return [];
    return buildSmartCameraEntries(tracked, (text) => extractPriceCandidates(text, currency), {
      ...DEFAULT_SMART_CAMERA_OPTIONS,
      visibleRegion: visibleRegionInImage(frameSize, viewSize),
    });
  }, [active, tracked, frameSize, viewSize, currency]);

  const translationItems = useMemo(
    () =>
      entries
        .map((entry) => (entry.kind === 'price' ? entry.label : entry.text))
        .filter((text): text is string => text != null)
        .map((text) => ({
          text,
          sourceLanguage: resolveSourceLanguageForText(text, sourceLanguage, targetLanguage),
        })),
    [entries, sourceLanguage, targetLanguage],
  );

  const { lookup, notice, activate } = useSceneTranslationQueue({
    enabled: active,
    targetLanguage,
    items: translationItems,
  });

  const rows: DisplayRow[] = entries.map((entry) => {
    const original = entry.kind === 'price' ? entry.label : entry.text;
    const translated =
      original != null
        ? lookup(resolveSourceLanguageForText(original, sourceLanguage, targetLanguage), original)
        : undefined;
    const hasTranslation = translated != null && translated !== '' && translated !== original;
    if (entry.kind === 'price') {
      const jpyAmount = rate > 0 ? convert(entry.amount, rate, 'TO_JPY') : 0;
      return {
        id: entry.id,
        primary: hasTranslation ? translated : (original ?? '価格'),
        secondary: hasTranslation ? original : null,
        price: formatForeign(entry.amount, currency),
        jpy: rate > 0 && Number.isFinite(jpyAmount) ? `約${formatJpy(jpyAmount)}` : null,
      };
    }
    return {
      id: entry.id,
      primary: hasTranslation ? translated : entry.text,
      secondary: hasTranslation ? entry.text : null,
      price: null,
      jpy: null,
    };
  });

  function handleLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    setViewSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
  }

  const showHint = active && rows.length === 0 && scannerStatus === 'scanning';

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" onLayout={handleLayout}>
      <LiveTextScanner
        enabled={attached}
        paused={paused}
        languages={getOcrLanguagesForCurrency(currency)}
        intervalMs={SMART_CAMERA_INTERVAL_MS}
        onFrame={onFrame}
        onStatusChange={setScannerStatus}
      />

      {/* ON/OFF（左上。右上はズームボタン）。OFFで映像フレームの取得自体を止める */}
      <Pressable
        style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
        onPress={onToggle}
        // 撮影・読み取り中は切り替えない（撮影中に映像出力を付け外ししない）
        disabled={paused}
        hitSlop={6}
        accessibilityRole="switch"
        accessibilityState={{ checked: enabled, disabled: paused }}
        accessibilityLabel="かざして翻訳・円換算">
        <SymbolView
          name={{ ios: 'character.bubble', android: 'translate', web: 'translate' }}
          tintColor={enabled ? color.primaryAccent : 'rgba(255,255,255,0.7)'}
          size={14}
        />
        <ThemedText style={[styles.toggleText, !enabled && styles.toggleTextOff]}>
          {enabled ? '翻訳・円換算 ON' : '翻訳・円換算 OFF'}
        </ThemedText>
      </Pressable>

      {active && (
        <View style={styles.bottomArea} pointerEvents="box-none">
          {notice != null && (
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

          {rows.length > 0 ? (
            <View style={styles.strip} pointerEvents="none">
              {rows.map((row, index) => (
                <View key={row.id} style={[styles.row, index > 0 && styles.rowDivider]}>
                  <View style={styles.rowText}>
                    <ThemedText style={styles.primary} numberOfLines={1}>
                      {row.primary}
                    </ThemedText>
                    {row.secondary != null && (
                      <ThemedText style={styles.secondary} numberOfLines={1}>
                        {row.secondary}
                      </ThemedText>
                    )}
                  </View>
                  {row.price != null && (
                    <View style={styles.rowPrice}>
                      <ThemedText style={styles.foreign} numberOfLines={1}>
                        {row.price}
                      </ThemedText>
                      <ThemedText style={row.jpy != null ? styles.jpy : styles.noRate} numberOfLines={1}>
                        {row.jpy ?? 'レート未設定'}
                      </ThemedText>
                    </View>
                  )}
                </View>
              ))}
            </View>
          ) : (
            showHint && (
              <View style={styles.hint} pointerEvents="none">
                <ThemedText style={styles.hintText}>商品名や値札にかざすと、翻訳と円換算を表示します</ThemedText>
              </View>
            )
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: {
    position: 'absolute',
    top: 14,
    left: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.52)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  toggleText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  toggleTextOff: { color: 'rgba(255,255,255,0.7)' },
  pressed: { opacity: 0.8 },

  bottomArea: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    gap: 6,
  },
  notice: {
    alignSelf: 'center',
    backgroundColor: 'rgba(17,32,30,0.82)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(127,216,204,0.45)',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  noticeText: { color: '#fff', fontSize: 12, fontWeight: '600', textAlign: 'center' },

  strip: {
    backgroundColor: 'rgba(17,32,30,0.80)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 7,
  },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.18)' },
  rowText: { flex: 1, minWidth: 0 },
  primary: { color: '#fff', fontSize: 15, fontWeight: '700' },
  secondary: { color: color.darkSub, fontSize: 11.5, fontWeight: '500', marginTop: 1 },
  rowPrice: { alignItems: 'flex-end', flexShrink: 0, maxWidth: '48%' },
  foreign: { color: color.darkSub, fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  jpy: { color: color.primaryAccent, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
  noRate: { color: color.darkMuted, fontSize: 11.5, fontWeight: '600' },

  hint: {
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  hintText: { color: 'rgba(255,255,255,0.9)', fontSize: 11.5, fontWeight: '600' },
});
