// 翻訳ページのカメラ翻訳（iOS）。外国語を読むこと自体が目的。
//
// - カメラを向けると、見えている文字を約1秒ごとに読み取り、元の文字の位置に訳を重ねて表示する
//   （位置が揺れても読めるよう、同じ内容を枠の下に一覧でも出す）
// - シャッター＝静止画を撮って「写真翻訳」（長文を段落ごとにまとめて高精度に読む）へ渡す。
//   メインカメラのシャッター（価格OCR→保存）とは役割が違う
// - 映像フレームは端末内で認識して捨てる。撮影した写真もアプリのキャッシュにだけ置き、保存しない
// - 写っている価格には、旅行の通貨・レート（保存と同じ`manual_rate`）での円換算を添える（2026-10-24）。
//   位置が揺れる価格の上へ直接重ねず、枠の下部の帯（中央に近い3件）と枠の下の一覧に出す。
//   価格は追跡中の行から毎回作り直すので、カメラを動かして見えなくなった価格は自然に消える
// - 2026-11-25（実機の撮影で見つかった問題の修正）:
//   - 訳を重ねる行は、枠のうち「下タブの下・下部の帯に隠れていない範囲」の中央に近い順に選ぶ
//     （枠全体の中央で選ぶと、メニューの上の方の行が訳されなかった）
//   - 価格には商品名と説明を分けて添える（3列のメニューで説明が商品名になっていた）。確かでない時は名前を付けない
//   - 訳の札は1行・元の文字の高さに合わせ、同じ行の価格を隠さない。訳が届くまでは出さない
//   - （Build 6 の実機確認から）中央の列の説明ばかり訳され左の商品名が残る → 画面上の距離で測り、同じ行の
//     2番目以降の文字（説明）を少し後回しにし、見出しと前回選んだ行を少し優先する（`selectOverlayLines`）。
//     札の右端は同じ行で右にある文字の手前まで（`placeOverlayLabels`）
//   - （Build 7 の実機確認から）カメラを止めていても札・価格が消えたり入れ替わったりし続けた → 追跡（`updateTrackedLines`）で、
//     同じ場面を読み続けている間は読み落とした行を数フレーム残す・同じ値段の別の行へ付け替わった行を2行の途中に置かない・
//     1行にまとめて読んだ文字を新しい行にしない。別の所へ向けた時は従来と同じか早く替わる。重なって省いた札は次のフレームも
//     後に回す（重なる2つの札が交代し続けない）
// - ピンチで拡大・縮小、ダブルタップで2×⇄元の倍率（2026-10-24）。映像を引き伸ばさず、カメラそのものの倍率を
//   変える（認識する映像・撮影する写真も同じように拡大されるので、訳を重ねる位置の計算はそのまま使える）。
//   倍率を変えた直後は、変える前の映像で読んだ結果を誤った位置に出さないよう、追跡中の文字をいったん捨てて
//   読み取り直す。倍率の計算は`live-camera-zoom-core.ts`。ジェスチャーはメインカメラのピンチと同じ仕組み
//   （react-native-gesture-handler）だが、メインカメラ（価格OCR）のファイルは共有も変更もしない
//
// このコンポーネントは「翻訳ページにフォーカスがあり、カメラモードを選んでいる間」だけマウントする
// （メインカメラとsessionを同時に動かさないため。呼び出し側の責務）。
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { LiveTextScanner, type LiveTextScannerStatus } from '@/components/live-text/LiveTextScanner';
import {
  formatTranslationPrice,
  type TranslationPriceConversion,
} from '@/components/live-text/translation-price-format';
import { PrimaryButton } from '@/components/ui';
import { getLanguageDisplayName } from '@/config/translation-language-names';
import { useLiveTextFrames, useSceneTranslationQueue } from '@/hooks/use-live-text-translation';
import {
  isLiveCameraZoomed,
  pinchStepLiveCameraZoom,
  toggleLiveCameraZoom,
} from '@/lib/live-camera-zoom-core';
import {
  buildTranslationPriceEntries,
  extractTranslationPrices,
  getVisionLanguagesForSource,
  placeOverlayLabels,
  resolveSourceLanguageForText,
  hiddenFrameBottom,
  selectOverlayLines,
  unobstructedRegionInImage,
  type LiveTextFrame,
  type Size,
} from '@/lib/live-text-core';
import { color, radius, shadow } from '@/theme/tokens';
import { extractConfidentPriceCandidates } from '@/utils/extract-prices';
import { formatRate } from '@/utils/format';

/** 認識の間隔(ms) */
const LIVE_TRANSLATION_INTERVAL_MS = 800;
/**
 * 訳を重ねる候補の最大件数。実際に出る数は、札どうしが重ならない分だけ（下の配置で間引く）。
 * 8件では、メニューの「商品名＋説明」の2列が4行分しか入らず、残りの行は一度も訳されなかった（2026-11-25）
 */
const MAX_OVERLAY_LABELS = 14;
/**
 * 下タブの高さ（iOSの標準49pt。ホームインジケーターの分は別に足す）。
 * カメラ枠の下端がタブの下に入っている分を、利用者に見えていない範囲として扱うために使う
 */
const TAB_BAR_HEIGHT = 49;
/** 枠の下部の帯（価格・案内）の、枠の下端からの間隔 */
const BOTTOM_AREA_INSET = 10;
/** 1件の最大文字数（長い文章は写真翻訳へ） */
const MAX_LIVE_TEXT_LENGTH = 80;
/** 円換算を出す価格の最大件数（枠の下の一覧） */
const MAX_PRICE_ENTRIES = 6;
/** 枠の中の帯に出す価格の件数（映像を隠しすぎない） */
const MAX_FRAME_PRICE_ROWS = 3;
/**
 * 倍率を変えてから読み取りを再開するまで(ms)。倍率の反映を待ち、変わる途中の訳を出さない。
 * 変える前に撮った映像の結果（認識に時間がかかると、この時間より後に届く）は、別に「変えた後の最初の1フレーム」として捨てる
 */
const ZOOM_SETTLE_MS = LIVE_TRANSLATION_INTERVAL_MS + 100;

export type LiveTranslationCameraProps = {
  sourceLanguage: string;
  targetLanguage: string;
  /** シャッターで撮った写真（アプリのキャッシュ上の一時ファイル）を写真翻訳へ渡す */
  onCapture: (uri: string) => void;
  /** 円換算に使う旅行の通貨・レート（国内・旅行なしはnull＝円換算を出さない） */
  priceConversion: TranslationPriceConversion | null;
};

type PriceRow = {
  id: string;
  /** 商品名（訳せていれば訳）。商品名が分からない・確かでない価格はnull */
  name: string | null;
  /** 説明（訳せていれば訳）。無ければnull */
  description: string | null;
  /** 訳した時の商品名の原文 */
  original: string | null;
  foreign: string;
  /** 円換算。レート未設定ならnull */
  jpy: string | null;
};

export function LiveTranslationCamera({
  sourceLanguage,
  targetLanguage,
  onCapture,
  priceConversion,
}: LiveTranslationCameraProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureFailed, setCaptureFailed] = useState(false);
  const [viewSize, setViewSize] = useState<Size | null>(null);
  const [scannerStatus, setScannerStatus] = useState<LiveTextScannerStatus>('off');
  // 枠のうち利用者に見えていない下の部分(pt)。画面の高さによっては、開いた時に枠の下端が下タブの下に入る
  // （iPhone 16 Proの実機で約1割）。見えていない所の文字を中央扱いにしない・帯をタブの上に出すために使う
  const frameRef = useRef<View>(null);
  const { height: windowHeight } = useWindowDimensions();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const [hiddenBottom, setHiddenBottom] = useState(0);
  // 枠の下部の帯（価格・案内）の高さ。帯に隠れた所の文字にも訳を重ねない
  const [bottomAreaHeight, setBottomAreaHeight] = useState(0);

  // スクロールでも変わるので、レイアウト時と認識のたび（約0.8秒ごと）に測り直す。ずれが小さければ更新しない
  const measureHiddenBottom = useCallback(() => {
    frameRef.current?.measureInWindow((_x, y, _width, height) => {
      if (!(height > 0)) return;
      const hidden = hiddenFrameBottom({ top: y, height }, windowHeight, TAB_BAR_HEIGHT + safeBottom);
      setHiddenBottom((prev) => (Math.abs(prev - hidden) < 2 ? prev : hidden));
    });
  }, [windowHeight, safeBottom]);
  // expo-cameraのzoom（0〜1）。このコンポーネントは入力方法の切替・画面離脱・撮影でアンマウントされるので、
  // 次に開いた時は必ず元の倍率から始まる
  const [zoom, setZoom] = useState(0);
  // ピンチ中・倍率を変えた直後（ZOOM_SETTLE_MSの間）は、映像の文字を読まない（変える前の結果を誤った位置に出さない）。
  // 倍率を変えるたびに`zoomChangeCount`を進め、待ち終えた番号（`settledZoomChangeCount`）が追いつくまでを「直後」とする
  const [isPinching, setIsPinching] = useState(false);
  const [zoomChangeCount, setZoomChangeCount] = useState(0);
  const [settledZoomChangeCount, setSettledZoomChangeCount] = useState(0);
  const zoomSettling = isPinching || zoomChangeCount !== settledZoomChangeCount;

  useEffect(() => {
    if (zoomChangeCount === settledZoomChangeCount) return;
    // 続けて倍率を変えた時は前の予約を取り消し、最後に変えてから待つ。アンマウント時も取り消す
    const timer = setTimeout(() => setSettledZoomChangeCount(zoomChangeCount), ZOOM_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [zoomChangeCount, settledZoomChangeCount]);

  const active = cameraReady && permission?.granted === true;
  // 読み取りを止めると、追跡中の文字は捨てられ、再開後は新しい倍率の映像だけで組み立て直す（既存のhookの動き）
  const { tracked, frameSize, onFrame } = useLiveTextFrames(active && !zoomSettling);

  // 倍率を変えた後に最初に届く1フレームは捨てる。nativeは1フレームずつ順に認識し、届く時刻は認識が終わった時刻なので、
  // 変える前に撮って認識中だったフレーム（最大1つ）が待ち時間の後に届くことがある。同じ文字は位置に関係なく
  // 同じ行として追跡されるため、1件でも残すと訳の位置がずれる（独立レビューの指摘）
  const dropNextFrameRef = useRef(false);
  useEffect(() => {
    if (zoomChangeCount > 0) dropNextFrameRef.current = true;
  }, [zoomChangeCount]);
  const handleFrame = useCallback(
    (frame: LiveTextFrame) => {
      measureHiddenBottom();
      if (dropNextFrameRef.current) {
        dropNextFrameRef.current = false;
        return;
      }
      onFrame(frame);
    },
    [onFrame, measureHiddenBottom],
  );

  // 価格（メインカメラと同じ「商品名・説明＋価格」の組み立て）。日付・時刻・量・他の通貨の金額は除く。
  // 価格は帯・一覧に出すので、帯の下の価格も選ぶ。下タブの下（利用者に見えない所）だけは除き、見えている範囲の中央に近い順
  const onScreenRegion = useMemo(
    () => (frameSize == null || viewSize == null ? null : unobstructedRegionInImage(frameSize, viewSize, hiddenBottom)),
    [frameSize, viewSize, hiddenBottom],
  );
  const priceEntries = useMemo(() => {
    if (priceConversion == null || frameSize == null || onScreenRegion == null) return [];
    const { currency } = priceConversion;
    return buildTranslationPriceEntries(
      tracked,
      (text) => extractTranslationPrices(text, currency, (value) => extractConfidentPriceCandidates(value, currency)),
      {
        maxEntries: MAX_PRICE_ENTRIES,
        maxTextLength: MAX_LIVE_TEXT_LENGTH,
        minHits: 2,
        visibleRegion: onScreenRegion,
        imageSize: frameSize,
      },
    );
  }, [tracked, frameSize, onScreenRegion, priceConversion]);

  // 訳を重ねる範囲：枠のうち、下タブの下・下部の帯に隠れていない所。その中央に近い行から選ぶ。
  // 枠全体の中央で選ぶと、見えている範囲の下寄りの行ばかりになり、メニューの上の方の行が訳されなかった（2026-11-25）
  const showStrip = !isCapturing && priceEntries.length > 0;
  const occludedBottom = hiddenBottom + (showStrip ? BOTTOM_AREA_INSET + bottomAreaHeight : 0);
  // 隠れた分が大きすぎる時（帯が高い・スクロール途中）も、枠の上3割は必ず使う
  const attentionRegion = useMemo(
    () => (frameSize == null || viewSize == null ? null : unobstructedRegionInImage(frameSize, viewSize, occludedBottom)),
    [frameSize, viewSize, occludedBottom],
  );

  // 前回選んだ行は少し優先する（静止中に札が入れ替わり続けない）。選び方は`selectOverlayLines`の注記（2026-11-25）。
  // 前回の選択は「前回の値と比べてレンダー中に調整する」型で持つ（前回の選択を優先しても選ばれる行は変わらないので1回で落ち着く）
  const [previousOverlayIds, setPreviousOverlayIds] = useState<ReadonlySet<string>>(() => new Set());
  const overlayEntries = useMemo(() => {
    if (attentionRegion == null || frameSize == null) return [];
    return selectOverlayLines(tracked, {
      maxEntries: MAX_OVERLAY_LABELS,
      maxTextLength: MAX_LIVE_TEXT_LENGTH,
      minHits: 2,
      visibleRegion: attentionRegion,
      imageSize: frameSize,
      previousIds: previousOverlayIds,
    });
  }, [tracked, attentionRegion, frameSize, previousOverlayIds]);
  const overlayIdsKey = overlayEntries.map((entry) => entry.id).join('|');
  const [previousOverlayKey, setPreviousOverlayKey] = useState('');
  if (previousOverlayKey !== overlayIdsKey) {
    setPreviousOverlayKey(overlayIdsKey);
    setPreviousOverlayIds(new Set(overlayEntries.map((entry) => entry.id)));
  }

  // 訳を重ねる行を先に、価格の商品名・説明を後ろに足す（同じ文字は1回だけ）
  const translationItems = useMemo(() => {
    const items = overlayEntries.map((entry) => ({
      text: entry.text,
      sourceLanguage: resolveSourceLanguageForText(entry.text, sourceLanguage, targetLanguage),
    }));
    const seen = new Set(items.map((item) => item.text));
    for (const entry of priceEntries) {
      for (const text of [entry.label, entry.description]) {
        if (text == null || seen.has(text)) continue;
        seen.add(text);
        items.push({ text, sourceLanguage: resolveSourceLanguageForText(text, sourceLanguage, targetLanguage) });
      }
    }
    return items;
  }, [overlayEntries, priceEntries, sourceLanguage, targetLanguage]);

  const { lookup, notice, activate, translationSupported } = useSceneTranslationQueue({
    enabled: active && !isCapturing,
    targetLanguage,
    items: translationItems,
  });

  const rows = overlayEntries.map((entry, index) => {
    const translated = lookup(translationItems[index]?.sourceLanguage ?? null, entry.text);
    return { entry, translated: translated != null && translated !== '' ? translated : null };
  });

  const translate = (text: string | null): string | null => {
    if (text == null) return null;
    const translated = lookup(resolveSourceLanguageForText(text, sourceLanguage, targetLanguage), text);
    return translated != null && translated !== '' ? translated : null;
  };

  const priceRows: PriceRow[] =
    priceConversion == null
      ? []
      : priceEntries.flatMap((entry) => {
          const translatedName = translate(entry.label);
          const hasTranslation = translatedName != null && translatedName !== entry.label;
          const description = entry.description != null ? (translate(entry.description) ?? entry.description) : null;
          return entry.amounts.map((amount, index) => {
            const price = formatTranslationPrice(amount, priceConversion);
            return {
              id: `${entry.id}#${index}`,
              name: hasTranslation ? translatedName : entry.label,
              description,
              original: hasTranslation ? entry.label : null,
              foreign: price.foreign,
              jpy: price.jpy,
            };
          });
        });

  // 元の文字の位置へ訳を重ねる（置き方は`placeOverlayLabels`：選んだ順に置き、重なる札は省く・訳が届くまで出さない・
  // 札の右端は同じ行で右にある文字〔説明・価格〕の手前まで）。
  // 前のフレームで重なって省いた札は後に回す（静止中に2つの札が交代し続けない。2026-11-25）。
  // 引き継ぐのは「前のフレーム（`tracked`）の最後の描画で省いた札」。同じフレームの中では引き継ぐ値が変わらないので、
  // 訳が届いて描き直しても置き方は1回で決まる（描画中の調整が繰り返さない）
  const [placementMemory, setPlacementMemory] = useState<{
    tracked: readonly unknown[] | null;
    carried: ReadonlySet<string>;
    skipped: ReadonlySet<string>;
    skippedKey: string;
  }>(() => ({ tracked: null, carried: new Set(), skipped: new Set(), skippedKey: '' }));
  // 読み取りを止めている間、hookは描画のたびに新しい空の配列を返すので、空どうしは同じフレームとして扱う（描画を繰り返さない）
  const newFrame =
    placementMemory.tracked !== tracked && !(tracked.length === 0 && (placementMemory.tracked?.length ?? 0) === 0);
  const carriedSkipped = newFrame ? placementMemory.skipped : placementMemory.carried;
  const labelInputs = rows.map(({ entry, translated }) => ({ id: entry.id, box: entry.box, translated }));
  const labels =
    frameSize != null && viewSize != null
      ? placeOverlayLabels(labelInputs, tracked, {
          frameSize,
          viewSize,
          occludedBottom,
          minHits: 2,
          skippedIds: carriedSkipped,
        })
      : [];
  const placedIds = new Set(labels.map((label) => label.id));
  const skippedIds = labelInputs.filter((row) => row.translated != null && !placedIds.has(row.id)).map((row) => row.id);
  const skippedKey = [...skippedIds].sort().join('|');
  if (newFrame || placementMemory.skippedKey !== skippedKey) {
    setPlacementMemory({ tracked, carried: carriedSkipped, skipped: new Set(skippedIds), skippedKey });
  }

  const canZoom = cameraReady && !isCapturing;

  // ピンチで拡大・縮小（メインカメラのピンチと同じ仕組み）。撮影中は受け付けない
  const pinchGesture = Gesture.Pinch()
    .runOnJS(true)
    .enabled(canZoom)
    .onStart(() => setIsPinching(true))
    .onChange((event) => {
      setZoom((current) => pinchStepLiveCameraZoom(current, event.scale, event.scaleChange));
    })
    // 始まったピンチが終わった（取り消された時も含む）：少し待ってから読み取りを再開する
    .onEnd(() => setZoomChangeCount((count) => count + 1))
    // 始まらずに終わったピンチ（指が1本だけ等）も含め、ピンチ中の状態は必ず解く
    .onFinalize(() => setIsPinching(false));

  // ダブルタップで2×⇄元の倍率。1回のタップには何も割り当てない（従来どおり）
  const doubleTapGesture = Gesture.Tap()
    .runOnJS(true)
    .enabled(canZoom)
    .numberOfTaps(2)
    .onEnd((_event, success) => {
      if (!success) return;
      setZoom((current) => toggleLiveCameraZoom(current));
      setZoomChangeCount((count) => count + 1);
    });

  const zoomGesture = Gesture.Race(pinchGesture, doubleTapGesture);
  const zoomed = isLiveCameraZoomed(zoom);

  function handleLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    setViewSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
    measureHiddenBottom();
  }

  function handleBottomAreaLayout(event: LayoutChangeEvent) {
    const { height } = event.nativeEvent.layout;
    setBottomAreaHeight((prev) => (Math.abs(prev - height) < 1 ? prev : height));
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
      ? 'このカメラではライブ翻訳を使えません'
      : !cameraReady || scannerStatus === 'waiting' || scannerStatus === 'off'
        ? 'カメラを準備しています…'
        : zoomSettling
          ? '読み取り直しています…'
          : rows.length === 0 && priceRows.length === 0
          ? '文字にカメラを向けてください'
          : translationSupported === false
            ? '翻訳はiOS 18以降で利用できます'
            : 'ライブ翻訳中';

  return (
    <View style={styles.root}>
      {/* ピンチ・ダブルタップは枠の中だけ。1本指のスクロールはページのまま */}
      <GestureDetector gesture={zoomGesture}>
      <View ref={frameRef} style={styles.frame} onLayout={handleLayout}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          zoom={zoom}
          onCameraReady={() => setCameraReady(true)}
        />
        <LiveTextScanner
          enabled={cameraReady}
          paused={isCapturing}
          languages={getVisionLanguagesForSource(sourceLanguage)}
          intervalMs={LIVE_TRANSLATION_INTERVAL_MS}
          onFrame={handleFrame}
          onStatusChange={setScannerStatus}
        />

        {!isCapturing &&
          labels.map((label) => (
            <View
              key={label.id}
              pointerEvents="none"
              style={[styles.label, { left: label.left, top: label.top, maxWidth: label.maxWidth }]}>
              <ThemedText
                style={[styles.labelText, { fontSize: label.fontSize, lineHeight: label.fontSize * 1.3 }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}>
                {label.text}
              </ThemedText>
            </View>
          ))}

        <View style={styles.statusChip} pointerEvents="none">
          <ThemedText style={styles.statusText}>{statusLabel}</ThemedText>
        </View>

        {zoomed && (
          <View style={styles.zoomChip} pointerEvents="none">
            <ThemedText style={styles.statusText}>拡大中</ThemedText>
          </View>
        )}

        {!isCapturing && (notice != null || priceRows.length > 0) && (
          <View
            style={[styles.bottomArea, { bottom: BOTTOM_AREA_INSET + hiddenBottom }]}
            pointerEvents="box-none"
            onLayout={handleBottomAreaLayout}>
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

            {/* 円換算の帯（中央に近い価格から）。位置の揺れる価格の上には重ねない。
                1品1行（商品名・現地の価格・円）にして、映像を隠す高さを抑える。説明は下の一覧に出す */}
            {priceRows.length > 0 && (
              <View style={styles.priceStrip} pointerEvents="none">
                {priceRows.slice(0, MAX_FRAME_PRICE_ROWS).map((row, index) => (
                  <View key={row.id} style={[styles.priceStripRow, index > 0 && styles.priceStripDivider]}>
                    <ThemedText style={[styles.priceStripName, row.name == null && styles.priceStripNameUnknown]} numberOfLines={1}>
                      {row.name ?? '価格'}
                    </ThemedText>
                    <ThemedText style={styles.priceStripForeign} numberOfLines={1}>
                      {row.foreign}
                    </ThemedText>
                    <ThemedText style={row.jpy != null ? styles.priceStripJpy : styles.priceStripNoRate} numberOfLines={1}>
                      {row.jpy ?? 'レート未設定'}
                    </ThemedText>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {isCapturing && (
          <View pointerEvents="none" style={styles.capturingOverlay}>
            <ActivityIndicator color="#fff" />
            <ThemedText style={styles.capturingText}>撮影しています…</ThemedText>
          </View>
        )}
      </View>
      </GestureDetector>

      <PrimaryButton
        title="撮影して詳しく翻訳"
        onPress={() => void handleCapture()}
        loading={isCapturing}
        disabled={!cameraReady}
      />
      <ThemedText style={styles.caption}>
        ピンチ・ダブルタップで拡大できます。メニューの説明や注意書きなど長い文章は、撮影すると段落ごとにまとめて翻訳します
      </ThemedText>
      {captureFailed && <ThemedText style={styles.errorText}>撮影できませんでした。もう一度お試しください。</ThemedText>}

      {/* 見えている価格と円換算（枠の中の帯に入りきらない分も含めて一覧で出す） */}
      {priceConversion != null && priceRows.length > 0 && (
        <View style={styles.listCard}>
          <View style={styles.listTitleRow}>
            <ThemedText style={styles.listTitle}>見えている価格（円換算）</ThemedText>
            <ThemedText style={styles.listRate}>{formatRate(priceConversion.rate, priceConversion.currency)}</ThemedText>
          </View>
          {priceRows.map((row, index) => (
            <View key={row.id} style={[styles.priceListRow, index > 0 && styles.listRowDivider]}>
              <View style={styles.priceListText}>
                <ThemedText style={styles.listTranslated} numberOfLines={2}>
                  {row.name ?? '価格'}
                </ThemedText>
                {row.description != null && (
                  <ThemedText style={styles.listDescription} numberOfLines={2}>
                    {row.description}
                  </ThemedText>
                )}
                {row.original != null && (
                  <ThemedText style={styles.listOriginal} numberOfLines={1}>
                    {row.original}
                  </ThemedText>
                )}
              </View>
              <View style={styles.priceListAmount}>
                <ThemedText style={styles.priceListForeign}>{row.foreign}</ThemedText>
                <ThemedText style={row.jpy != null ? styles.priceListJpy : styles.priceListNoRate}>
                  {row.jpy ?? 'レート未設定'}
                </ThemedText>
              </View>
            </View>
          ))}
        </View>
      )}

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
    borderRadius: 5,
    paddingHorizontal: 4,
    paddingVertical: 1,
    ...shadow.card,
  },
  labelText: { color: color.text, fontWeight: '700' },

  statusChip: {
    position: 'absolute',
    top: 12,
    left: 12,
    // 右上の「拡大中」と重ならない幅に収める（長い文は折り返す）
    maxWidth: '68%',
    backgroundColor: 'rgba(0,0,0,0.52)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  zoomChip: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.52)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },

  // bottomは描画時に「枠の下端が隠れている分」を足して決める（帯を下タブの下に入れない）
  bottomArea: {
    position: 'absolute',
    left: 10,
    right: 10,
    gap: 6,
  },
  notice: {
    backgroundColor: 'rgba(17,32,30,0.85)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(127,216,204,0.45)',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  noticeText: { color: '#fff', fontSize: 12.5, fontWeight: '600', textAlign: 'center' },
  pressed: { opacity: 0.8 },

  priceStrip: {
    backgroundColor: 'rgba(17,32,30,0.80)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 1,
  },
  priceStripRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  priceStripDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.18)' },
  priceStripName: { flex: 1, minWidth: 0, color: '#fff', fontSize: 13.5, fontWeight: '700' },
  priceStripNameUnknown: { color: color.darkSub, fontWeight: '600' },
  priceStripForeign: { flexShrink: 0, color: color.darkSub, fontSize: 11.5, fontWeight: '600', fontVariant: ['tabular-nums'] },
  priceStripJpy: { flexShrink: 0, color: color.primaryAccent, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  priceStripNoRate: { flexShrink: 0, color: color.darkMuted, fontSize: 11.5, fontWeight: '600' },

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
  listTitleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  listRate: { fontSize: 11, fontWeight: '600', color: color.muted, marginBottom: 4 },
  priceListRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  priceListText: { flex: 1, minWidth: 0, gap: 2 },
  priceListAmount: { alignItems: 'flex-end', flexShrink: 0 },
  priceListForeign: { fontSize: 12.5, fontWeight: '600', color: color.muted, fontVariant: ['tabular-nums'] },
  priceListJpy: { fontSize: 16, fontWeight: '800', color: color.primaryDark, fontVariant: ['tabular-nums'] },
  priceListNoRate: { fontSize: 12, fontWeight: '600', color: color.muted },
  listRow: { paddingVertical: 8, gap: 2 },
  listRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line2 },
  listTranslated: { fontSize: 15, fontWeight: '700', color: color.text },
  listDescription: { fontSize: 13, fontWeight: '500', color: color.text },
  listOriginal: { fontSize: 12, fontWeight: '500', color: color.muted },
});
