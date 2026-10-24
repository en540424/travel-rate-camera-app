// 翻訳ページの「写真翻訳」パネル。写真を撮る／選ぶ → 読み取った文章を段落ごとに翻訳して表示する。
// 読み上げ・コピーは翻訳ページの既存の仕組み（TTS・クリップボード）を呼び出し側から受け取って使う。
//
// 写真は写真そのものの縦横比の枠（`FitPhoto`）で大きく出し、タップで全画面の拡大表示を開く。
// 写真に写った価格には、旅行の通貨・レートでの円換算を添える（原文・翻訳・コピーする文章には混ぜない）。
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { FitPhoto } from '@/components/fit-photo';
import { PhotoZoomViewer } from '@/components/live-text/PhotoZoomViewer';
import {
  formatTranslationPrice,
  type TranslationPriceConversion,
} from '@/components/live-text/translation-price-format';
import { ThemedText } from '@/components/themed-text';
import { ErrorMessage, GhostButton, PrimaryButton, SecondaryButton } from '@/components/ui';
import type { PhotoBlockTranslation, PhotoTranslationState } from '@/hooks/use-photo-translation';
import { annotatePhotoBlockPrices, extractTranslationPrices } from '@/lib/live-text-core';
import { canRetryPhotoTranslation, countPhotoTranslationProgress } from '@/lib/photo-translation-core';
import type { MemoTranslationErrorCode } from '@/lib/translation-types';
import { color, radius, shadow, spacing } from '@/theme/tokens';
import { extractPriceCandidates } from '@/utils/extract-prices';

const TRANSLATION_ERROR_MESSAGES: Partial<Record<MemoTranslationErrorCode, string>> = {
  unsupported_os: '翻訳はiOS 18以降で利用できます。読み取った原文のみ表示しています。',
  unsupported_language: 'この言語の組み合わせには対応していません。翻訳元・翻訳先を変えてお試しください。',
  host_unavailable: '翻訳を開始できませんでした。もう一度お試しください。',
  translation_failed: '一部を翻訳できませんでした。通信状況を確認してもう一度お試しください。',
  cancelled: '翻訳が中断されました。もう一度お試しください。',
};

export type PhotoTranslationPanelProps = {
  state: PhotoTranslationState;
  onTakePhoto: () => void;
  onPickPhoto: () => void;
  onRetry: () => void;
  onClear: () => void;
  onCopy: (text: string) => void;
  onUseAsInput: (text: string) => void;
  /** 読み上げ（翻訳ページ既存のTTS）。voice非対応ならundefined */
  onSpeak?: (text: string) => void;
  isSpeaking: boolean;
  speakFailed: boolean;
  /** 円換算に使う旅行の通貨・レート（国内・旅行なしはnull＝円換算を出さない） */
  priceConversion: TranslationPriceConversion | null;
};

const EMPTY_BLOCKS: PhotoBlockTranslation[] = [];

/** 「$12.50（約¥2,038）」の並び。レート未設定なら「（レート未設定）」 */
function PriceLine({ amounts, conversion }: { amounts: readonly number[]; conversion: TranslationPriceConversion }) {
  return (
    <View style={styles.priceLine}>
      {amounts.map((amount, index) => {
        const price = formatTranslationPrice(amount, conversion);
        return (
          <View key={`${index}:${amount}`} style={styles.priceChip}>
            <ThemedText style={styles.priceForeign}>{price.foreign}</ThemedText>
            <ThemedText style={price.jpy != null ? styles.priceJpy : styles.priceNoRate}>
              {price.jpy != null ? `（${price.jpy}）` : '（レート未設定）'}
            </ThemedText>
          </View>
        );
      })}
    </View>
  );
}

export function PhotoTranslationPanel({
  state,
  onTakePhoto,
  onPickPhoto,
  onRetry,
  onClear,
  onCopy,
  onUseAsInput,
  onSpeak,
  isSpeaking,
  speakFailed,
  priceConversion,
}: PhotoTranslationPanelProps) {
  // 拡大表示中の写真。写真を替えた・クリアした時は開いたままにしない（下の`viewerOpen`）
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const blocks = state.phase === 'translating' || state.phase === 'done' ? state.blocks : EMPTY_BLOCKS;

  // 段落ごとの価格（原文から読む。翻訳の進み具合とは関係なく、読み取った時点から出す）
  const blockPrices = useMemo(() => {
    if (priceConversion == null) return null;
    const { currency } = priceConversion;
    return annotatePhotoBlockPrices(blocks, (text) =>
      extractTranslationPrices(text, currency, (value) => extractPriceCandidates(value, currency)),
    );
  }, [blocks, priceConversion]);

  if (state.phase === 'idle') {
    return (
      <View style={styles.introCard}>
        <ThemedText style={styles.introTitle}>写真の文章をまとめて翻訳</ThemedText>
        <ThemedText style={styles.introBody}>
          メニュー・商品説明・注意書き・看板など、長い文章も段落ごとに読み取って翻訳します。写真は保存されません。
        </ThemedText>
        <PrimaryButton
          title="写真を撮る"
          onPress={onTakePhoto}
          icon={<SymbolView name={{ ios: 'camera.fill', android: 'photo_camera', web: 'photo_camera' }} tintColor="#fff" size={17} />}
        />
        <SecondaryButton
          title="写真を選ぶ"
          onPress={onPickPhoto}
          icon={<SymbolView name={{ ios: 'photo.on.rectangle', android: 'image', web: 'image' }} tintColor={color.text} size={17} />}
        />
      </View>
    );
  }

  const uri = state.uri;
  const viewerOpen = uri != null && viewerUri === uri;
  // 商品名の段落へ結び付けた「価格だけの段落」は単独の行として出さない
  const visibleBlocks = blocks
    .map((block, index) => ({ block, index, prices: blockPrices?.[index] ?? null }))
    .filter(({ prices }) => prices?.mergedInto == null);
  const translatedText = blocks
    .map((block) => block.translated ?? block.original)
    .join('\n');
  const originalText = blocks.map((block) => block.original).join('\n');
  const hasTranslation = blocks.some((block) => block.translated != null);
  const progress = countPhotoTranslationProgress(blocks);
  const canRetry = state.phase === 'done' && canRetryPhotoTranslation(state.errorCode, state.blocks);

  return (
    <View style={styles.wrap}>
      {uri != null && (
        <FitPhoto
          uri={uri}
          surface="photoTranslation"
          borderRadius={radius.card}
          onPress={() => setViewerUri(uri)}
          accessibilityLabel="写真を拡大して見る"
          overlay={
            <View style={styles.zoomBadge} pointerEvents="none">
              <SymbolView
                name={{ ios: 'arrow.up.left.and.arrow.down.right', android: 'zoom_in', web: 'zoom_in' }}
                tintColor="#fff"
                size={12}
              />
              <ThemedText style={styles.zoomBadgeText}>タップで拡大</ThemedText>
            </View>
          }
        />
      )}

      <View style={styles.photoActions}>
        <Pressable style={({ pressed }) => [styles.smallBtn, pressed && styles.pressed]} onPress={onTakePhoto}>
          <SymbolView name={{ ios: 'camera', android: 'photo_camera', web: 'photo_camera' }} tintColor={color.primaryDark} size={15} />
          <ThemedText style={styles.smallBtnText}>撮り直す</ThemedText>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.smallBtn, pressed && styles.pressed]} onPress={onPickPhoto}>
          <SymbolView name={{ ios: 'photo.on.rectangle', android: 'image', web: 'image' }} tintColor={color.primaryDark} size={15} />
          <ThemedText style={styles.smallBtnText}>写真を選ぶ</ThemedText>
        </Pressable>
        <GhostButton title="クリア" onPress={onClear} />
      </View>

      {state.phase === 'recognizing' && (
        <View style={styles.progress}>
          <ActivityIndicator color={color.primaryDark} />
          <ThemedText style={styles.progressText}>文字を読み取っています…</ThemedText>
        </View>
      )}

      {state.phase === 'no_text' && (
        <ErrorMessage message="文字が見つかりませんでした。明るい場所で、文字が大きくはっきり写るように撮影してください。" />
      )}

      {state.phase === 'error' && (
        <ErrorMessage
          message={
            state.reason === 'ocr_unavailable'
              ? 'この端末では写真の文字を読み取れません。'
              : '文字を読み取れませんでした。もう一度お試しください。'
          }
        />
      )}

      {(state.phase === 'translating' || state.phase === 'done') && (
        <View style={styles.resultCard}>
          <View style={styles.resultHeader}>
            <ThemedText style={styles.resultLabel}>写真の翻訳</ThemedText>
            <ThemedText style={styles.resultCount}>{visibleBlocks.length}件</ThemedText>
          </View>

          {state.phase === 'translating' && (
            <View style={styles.progressInline}>
              <ActivityIndicator size="small" color={color.primaryDark} />
              <ThemedText style={styles.progressText}>
                {state.needsDownload
                  ? '翻訳データのダウンロードが必要です。Appleの案内が表示されたら「ダウンロード」を選んでください（完了まで時間がかかる場合があります）'
                  : `翻訳しています…（${progress.translated}/${progress.total}件）`}
              </ThemedText>
            </View>
          )}

          {state.phase === 'translating' && state.slow && (
            <View style={styles.errorWrap}>
              <ThemedText style={styles.note}>
                {state.needsDownload
                  ? 'ダウンロード中はそのままお待ちください。案内が出ない・進まない場合は、やり直してください。'
                  : '時間がかかっています。初回は言語データの準備に時間がかかることがあります。このまま待つか、やり直してください。'}
              </ThemedText>
              <GhostButton title="やり直す" tone="primary" onPress={onRetry} />
            </View>
          )}

          {visibleBlocks.map(({ block, index, prices }, position) => {
            const amounts = prices?.amounts ?? [];
            // 価格だけの段落は原文（"$12.50"）の代わりに「$12.50（約¥2,038）」を出す
            const priceOnly = prices?.priceOnly === true;
            return (
              <View key={`${index}:${block.original}`} style={[styles.block, position > 0 && styles.blockDivider]}>
                {priceOnly ? null : block.translated != null ? (
                  <ThemedText style={styles.blockTranslated} selectable>
                    {block.translated}
                  </ThemedText>
                ) : block.sourceLanguage == null ? null : (
                  <ThemedText style={styles.blockPending}>{state.phase === 'done' ? '翻訳できませんでした' : '…'}</ThemedText>
                )}
                {!priceOnly && (
                  <ThemedText style={block.translated != null ? styles.blockOriginal : styles.blockOriginalOnly} selectable>
                    {block.original}
                  </ThemedText>
                )}
                {priceConversion != null && amounts.length > 0 && (
                  <PriceLine amounts={amounts} conversion={priceConversion} />
                )}
              </View>
            );
          })}

          {state.phase === 'done' && (state.errorCode != null || canRetry) && (
            <View style={styles.errorWrap}>
              <ErrorMessage
                message={
                  (state.errorCode != null ? TRANSLATION_ERROR_MESSAGES[state.errorCode] : undefined) ??
                  '翻訳できなかった項目があります。'
                }
              />
              {canRetry && <GhostButton title="もう一度翻訳する" tone="primary" onPress={onRetry} />}
            </View>
          )}

          {/* 原文を編集は翻訳の途中でも使える（翻訳を待たずに誤読を直して訳し直せるように） */}
          <View style={styles.resultActions}>
            {state.phase === 'done' && onSpeak != null && hasTranslation && (
              <Pressable
                style={({ pressed }) => [styles.actionBtn, isSpeaking && styles.actionBtnActive, pressed && styles.pressed]}
                onPress={() => onSpeak(translatedText)}
                accessibilityRole="button"
                accessibilityLabel={isSpeaking ? '読み上げを停止' : '訳文を読み上げる'}>
                <SymbolView
                  name={{ ios: isSpeaking ? 'stop.fill' : 'speaker.wave.2.fill', android: 'volume_up', web: 'volume_up' }}
                  tintColor={isSpeaking ? '#fff' : color.primaryDark}
                  size={15}
                />
                <ThemedText style={[styles.actionBtnText, isSpeaking && styles.actionBtnTextActive]}>
                  {isSpeaking ? '停止' : '読み上げ'}
                </ThemedText>
              </Pressable>
            )}
            {state.phase === 'done' && (
              <Pressable
                style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
                onPress={() => onCopy(translatedText)}
                accessibilityRole="button">
                <SymbolView name={{ ios: 'doc.on.doc', android: 'content_copy', web: 'content_copy' }} tintColor={color.primaryDark} size={15} />
                <ThemedText style={styles.actionBtnText}>コピー</ThemedText>
              </Pressable>
            )}
            <Pressable
              style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
              onPress={() => onUseAsInput(originalText)}
              accessibilityRole="button"
              accessibilityLabel="読み取った原文をテキスト入力へ移して編集する">
              <SymbolView name={{ ios: 'square.and.pencil', android: 'edit', web: 'edit' }} tintColor={color.primaryDark} size={15} />
              <ThemedText style={styles.actionBtnText}>原文を編集</ThemedText>
            </Pressable>
          </View>
          {speakFailed && <ThemedText style={styles.note}>読み上げできませんでした</ThemedText>}
        </View>
      )}

      <PhotoZoomViewer uri={viewerOpen ? uri : null} onClose={() => setViewerUri(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  introCard: {
    borderRadius: radius.cardLg,
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.line,
    padding: 16,
    gap: 12,
    ...shadow.card,
  },
  introTitle: { fontSize: 16, fontWeight: '700', color: color.text },
  introBody: { fontSize: 13, lineHeight: 20, fontWeight: '500', color: color.muted },

  zoomBadge: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  zoomBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  photoActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  smallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.primaryBorder,
    backgroundColor: color.primarySoft,
  },
  smallBtnText: { fontSize: 13, fontWeight: '700', color: color.primaryDark },

  progress: { alignItems: 'center', gap: 8, paddingVertical: 18 },
  progressInline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressText: { fontSize: 12.5, fontWeight: '500', color: color.muted, flexShrink: 1 },

  resultCard: {
    borderRadius: radius.cardLg,
    backgroundColor: color.primarySoft,
    borderWidth: 1,
    borderColor: color.primaryBorder,
    padding: 16,
    gap: 6,
    ...shadow.card,
  },
  resultHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  resultLabel: { fontSize: 13, fontWeight: '700', color: color.primaryDark },
  resultCount: { fontSize: 11.5, fontWeight: '600', color: color.primaryDark, opacity: 0.7 },
  block: { paddingVertical: 8, gap: 3 },
  blockDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.primaryBorder },
  blockTranslated: { fontSize: 16, lineHeight: 24, fontWeight: '600', color: color.text },
  blockPending: { fontSize: 13, fontWeight: '500', color: color.muted },
  blockOriginal: { fontSize: 12.5, lineHeight: 18, fontWeight: '500', color: color.muted },
  blockOriginalOnly: { fontSize: 15, lineHeight: 22, fontWeight: '500', color: color.text },
  priceLine: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, rowGap: 2, marginTop: 1 },
  priceChip: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' },
  priceForeign: { fontSize: 14, fontWeight: '700', color: color.text, fontVariant: ['tabular-nums'] },
  priceJpy: { fontSize: 14, fontWeight: '800', color: color.primaryDark, fontVariant: ['tabular-nums'] },
  priceNoRate: { fontSize: 12, fontWeight: '600', color: color.muted },
  errorWrap: { gap: 4 },
  resultActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', marginTop: 4 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.button,
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.primaryBorder,
  },
  actionBtnActive: { backgroundColor: color.primary, borderColor: color.primary },
  actionBtnText: { fontSize: 13.5, fontWeight: '700', color: color.primaryDark },
  actionBtnTextActive: { color: '#fff' },
  note: { fontSize: 12, fontWeight: '500', color: color.muted },
  pressed: { opacity: 0.85 },
});
