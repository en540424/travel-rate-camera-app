import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, Modal, Platform, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { CameraPreview } from '@/components/camera/CameraPreview';
import { ThemedText } from '@/components/themed-text';
import {
  CurrencyFlagImage,
  SaveLimitBanner,
} from '@/components/domain';
import { SaveLimitSheet } from '@/components/domain/SaveLimitSheet';
import { isTranslationPlatformSupported, TranslationHost } from '@/components/translation-host';
import { ActionSheet, EmptyState, SectionCard, SecondaryButton, PrimaryButton, Toast } from '@/components/ui';
import type { ConversionDirection, CurrencyCode } from '@/constants/currencies';
import { CURRENCIES, FOREIGN_CURRENCY_CODES } from '@/constants/currencies';
import {
  FALLBACK_BUDGET_JPY,
  FALLBACK_TRIP_NAME,
} from '@/constants/camera-screen';
import { DT } from '@/constants/designTokens';
import { FREE_LIMITS, canSaveEntry } from '@/config/limits';
import { SHOW_PRO } from '@/config/feature-flags';
import { getTranslationSourceLanguage } from '@/config/translation-languages';
import { createPendingCandidates, translateMemoLines } from '@/lib/translation-service';
import type { MemoCandidate } from '@/lib/translation-types';
import { useHistory } from '@/hooks/use-history';
import { useIsPro } from '@/hooks/use-purchases';
import { useRates } from '@/hooks/use-rates';
import { useTrips } from '@/hooks/use-trips';
import { useSettingsStore } from '@/stores/settings-store';
import { color, radius, shadow, spacing, statusColor, typography } from '@/theme/tokens';
import { convert } from '@/utils/currency';
import { extractMemoLines, extractPriceCandidates } from '@/utils/extract-prices';
import { formatForeign, formatJpy, formatRate } from '@/utils/format';
import { mergeMemoCandidates, resolveMemoCandidateDisplay } from '@/utils/memo-candidate-display';
import { resolveMemoInsertText } from '@/utils/memo-candidate-insert';
import { appendMemoText, MEMO_MAX_LENGTH, removeMemoText, replaceMemoText } from '@/utils/memo-text';
import {
  DEFAULT_BENCHMARK_ARMS,
  EXTRA_BENCHMARK_ARMS,
  fetchSupportedLanguages,
  runBenchmarkArm,
} from '@/utils/ocr-benchmark';
import type { VisionOcrBenchmarkArmDefinition, VisionOcrBenchmarkArmId, VisionOcrBenchmarkResult } from '@/utils/ocr-benchmark';
import { registerTabScrollReset } from '@/utils/tab-scroll-reset';
import { getTripStatsForDisplay } from '@/utils/trip-stats';

const MEMO_PREVIEW_COUNT = 3;
const PRICE_PREVIEW_COUNT = 3;
const NEAR_SAVE_LIMIT = FREE_LIMITS.saves - 5;
// OCR写真プレビュー枠の高さ（styles.ocrPhotoPreviewFrameと一致させる・中心スクロール計算に使用）
const OCR_PHOTO_PREVIEW_FRAME_HEIGHT = 110;

/** 撮影前メイン画面の撮影モード。価格OCR（既定）/ 商品写真（補助） */
type CaptureMode = 'ocr' | 'photo';

/** 価格OCRモードの表示フェーズ。scanning は CameraPreview 内部 state のため camera に含める。 */
type Phase = 'camera' | 'scanning' | 'result';

export default function CameraScreen() {
  const insets = useSafeAreaInsets();
  // 保存成功トースト（Alertではない軽量通知）。文言が入ると表示、Toast側で自動的にnullへ戻す。
  // hideToastはuseCallbackで参照を固定し、他state変化での再renderでToast内部のuseEffectが
  // 毎回再始動してフェードが終わらなくなる事態を防ぐ。
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  // 補足行はトーストごとに変わる（保存＝「履歴で確認できます」／メモ上限＝案内文）。
  // 文言を出し分けるためmessageと対で持ち、必ず同じ場所で両方セットする。
  const [toastCaption, setToastCaption] = useState<string | null>(null);
  // depsは空のまま（toastCaptionを足すと参照が変わりフェードが終わらなくなる。上のコメント参照）
  const hideToast = useCallback(() => {
    setToastMessage(null);
    setToastCaption(null);
  }, []);
  const [nativeAmount, setNativeAmount] = useState('');
  const [scanKey, setScanKey] = useState(0);
  const [inputMode, setInputMode] = useState<ConversionDirection>('TO_JPY');
  const [memo, setMemo] = useState('');
  const [ocrResult, setOcrResult] = useState<{
    raw: string;
    prices: string[];
    memoLines: string[];
  } | null>(null);
  const [ocrRawExpanded, setOcrRawExpanded] = useState(false);
  const [pendingPhotoUri, setPendingPhotoUri] = useState<string | null>(null);
  // pendingPhotoUriの出どころ。「履歴に残す写真」カードの文言分岐に使う（値札写真のままか/商品写真等に変えたか）
  const [pendingPhotoSource, setPendingPhotoSource] = useState<'ocr' | 'product' | 'library' | null>(null);
  // 「写真なしで保存」：保存対象写真(pendingPhotoUri)はそのまま保持し、保存時だけ写真を付けない。
  // 上部のOCR写真プレビュー（読み取り確認用・ocrPreviewUri）はpendingPhotoUriに依存するため、ここでは消さない。
  const [excludePhotoFromSave, setExcludePhotoFromSave] = useState(false);
  const [ocrPhotoUri, setOcrPhotoUri] = useState<string | null>(null);
  // 再読み取りで得た新しい結果（写真込み）。「新しい読み取りを使う」を選ぶまでocrResult/ocrPhotoUriへは反映しない
  const [ocrResultCandidate, setOcrResultCandidate] = useState<{
    photoUri: string | null;
    ocrResult: { raw: string; prices: string[]; memoLines: string[] };
  } | null>(null);
  // 値札再読み取り／商品写真の新しい撮影分。保存対象写真(pendingPhotoUri)へは即反映せず、
  // 「履歴に残す写真」欄で「新しい写真を使う/今の保存写真を使う」を選ぶまで保持する
  const [newPhotoCandidate, setNewPhotoCandidate] = useState<{
    uri: string;
    source: 'ocr' | 'product';
  } | null>(null);
  const [saveAsPurchased, setSaveAsPurchased] = useState(false);
  const [selectedPrice, setSelectedPrice] = useState<string | null>(null);
  // 追加済みメモ候補。key = 候補のoriginalText（選択状態のidentity）、
  // value = **実際にメモ本文へ挿入した文字列**。
  // Phase 3Aではvalue === originalTextだが、Phase 3Cで訳文を挿入するようになると両者が分かれる。
  // 削除時に「訳文 or 原文」を再計算するとpending中にタップされた候補で食い違うため、
  // 挿入した文字列そのものをここへ記録しておく必要がある。
  const [addedMemoEntries, setAddedMemoEntries] = useState<Map<string, string>>(new Map());
  const [memoExpanded, setMemoExpanded] = useState(false);
  const [pricesExpanded, setPricesExpanded] = useState(false);
  // 候補一覧セクション自体の開閉（タップでは閉じない・手動操作のみ）。OCR成功直後は開いている。
  const [pricesSectionOpen, setPricesSectionOpen] = useState(true);
  const [memoSectionOpen, setMemoSectionOpen] = useState(true);
  const [manualAdjustExpanded, setManualAdjustExpanded] = useState(false);
  const [photoPreviewVisible, setPhotoPreviewVisible] = useState(false);
  const [captureMode, setCaptureMode] = useState<CaptureMode>('ocr');
  const [showManualInput, setShowManualInput] = useState(false);
  const [photoSheetVisible, setPhotoSheetVisible] = useState(false);
  const [showSaveLimitSheet, setShowSaveLimitSheet] = useState(false);
  // カメラ表示の切替：true=大きいライブカメラ / false=撮影済みOCR写真プレビュー（表示専用）
  const [cameraLive, setCameraLive] = useState(true);
  // 撮影済みOCR写真を拡大表示するモーダル
  const [ocrPhotoZoomVisible, setOcrPhotoZoomVisible] = useState(false);
  // 撮影した値札写真の縦横比（width/height）。読み込み時に確定し、プレビュー高さを実寸に合わせる。
  const [ocrImgAspect, setOcrImgAspect] = useState(0.75);
  // [診断] OCRデバッグパネル開閉 — リリース前に削除
  const [showOcrDebug, setShowOcrDebug] = useState(false);
  // [検証] Apple Vision OCR比較パネル開閉・結果。本番ビルドには一切含めない開発用検証基盤（AGENTS.md参照）。
  const [showVisionBenchmark, setShowVisionBenchmark] = useState(false);
  const [benchmarkResults, setBenchmarkResults] = useState<
    Partial<Record<VisionOcrBenchmarkArmId, VisionOcrBenchmarkResult>>
  >({});
  const [isRunningAllBenchmarks, setIsRunningAllBenchmarks] = useState(false);
  const [supportedLanguagesInfo, setSupportedLanguagesInfo] = useState<{
    languages: string[];
    errorMessage?: string;
  } | null>(null);
  // 翻訳候補。メモ候補チップの表示（訳文＝主表示／原文＝補助表示）と挿入文字列の決定に使う。
  // 生成はiOS・翻訳対象通貨のときだけで、それ以外（Android/Web・JPY旅行）はnullのまま
  // （＝チップは原文1段で表示され、タップすると原文がメモへ入る）。
  const [memoCandidates, setMemoCandidates] = useState<MemoCandidate[] | null>(null);
  // 翻訳ホストViewはこの画面にフォーカスがある間だけマウントする。
  const [isScreenFocused, setIsScreenFocused] = useState(false);

  const scrollViewRef = useRef<ScrollView>(null);
  // 下タブでこのタブ（カメラ）を押した時（＝タブ切替で入ってきた時）だけ先頭へ戻す。
  // (tabs)/_layout.tsxのtabPress（タブバー押下）からtriggerTabScrollResetで呼ばれる。
  // タブ内の詳細/編集画面遷移は無いため、通常のフォーカスでは影響しない。
  useEffect(() => {
    return registerTabScrollReset('index', () => {
      scrollViewRef.current?.scrollTo({ y: 0, animated: false });
    });
  }, []);
  const inputCardYRef = useRef(0);
  // 「✎ 金額を修正」展開時のスクロール先（編集パネルのSectionCard内オフセット）
  const manualAdjustYRef = useRef(0);
  // メモ欄フォーカス時のスクロール先（保存の設定セクションのSectionCard内オフセット）
  const memoRowYRef = useRef(0);
  // 保存の設定内メモ欄のref（フォーカス制御用）
  const memoInputRef = useRef<TextInput>(null);
  // 手入力金額フィールドのref（openManualInput時のフォーカス制御用）
  const amountInputRef = useRef<TextInput>(null);
  // OCR写真プレビュー（読み取った値札）の縦スクロールを中心位置にするための参照
  const ocrPhotoPreviewScrollRef = useRef<ScrollView>(null);
  // 再読み取りで撮影した直後の写真URI。OCR処理が終わりhandleOcrResultが呼ばれるまでocrPhotoUriへは反映しない
  const lastScannedPhotoUriRef = useRef<string | null>(null);
  // [検証] Phase 2：OCR結果の世代。翻訳結果が古い世代のものなら破棄する。
  // scanKeyはCameraPreviewの再マウント専用のkeyであり、非同期リクエストの世代管理には流用しない。
  const translationGenerationRef = useRef(0);

  const { rates } = useRates();
  const { selectedCurrency, setSelectedCurrency } = useSettingsStore();
  const isPro = useIsPro();
  const { history, totalCount, addEntry, reload } = useHistory();
  const { activeTrip } = useTrips();

  const tripName = activeTrip?.name ?? FALLBACK_TRIP_NAME;
  const tripBudgetJpy = activeTrip?.budget_jpy ?? FALLBACK_BUDGET_JPY;

  useFocusEffect(
    useCallback(() => {
      reload();
      const { pendingCameraAmount, setPendingCameraAmount } = useSettingsStore.getState();
      if (pendingCameraAmount) {
        setNativeAmount(pendingCameraAmount);
        setPendingCameraAmount(null);
        setInputMode('TO_JPY');
      }
    }, [reload]),
  );

  // 翻訳ホストViewの寿命管理。
  // フォーカス中だけホストViewをマウントし、離脱時はアンマウント＋世代を進めて結果を破棄する。
  //
  // ここで cancelTranslation()（= native cancelAll()）は呼ばない。
  // ホストViewのアンマウントで走る`hostDidDisappear()`が、isHostAlive=false・configuration=nil・
  // 未処理jobのfailAll(HOST_UNMOUNTED)をすべて行うため上位互換であり、
  // 一方でcancelAllはReactのアンマウントより先に走りうる。その場合coordinatorが生きたまま
  // `configuration == nil`で残り、次のsubmitがinvalidate()経由の再トリガを使えなくなる
  // （＝pending固定の再発）。キャンセルはアンマウントに一本化する。
  //
  // 世代を進めるため、離脱中に返ってきた翻訳結果はstateへ反映されない
  // （＝画面へ戻ると候補は「翻訳中…」のまま残る。次のOCR結果確定で正常に翻訳し直される）。
  useFocusEffect(
    useCallback(() => {
      if (!isTranslationPlatformSupported) return;
      setIsScreenFocused(true);
      return () => {
        setIsScreenFocused(false);
        translationGenerationRef.current += 1;
      };
    }, []),
  );

  const isJpyMode = activeTrip?.base_currency === 'JPY';
  const currencyForDisplay = activeTrip?.base_currency ?? selectedCurrency;
  const tripRate = activeTrip?.manual_rate ?? 0;
  const globalRate = rates[currencyForDisplay] ?? 0;
  const rate = activeTrip ? (isJpyMode ? 1 : tripRate) : globalRate;
  const isReverse = !isJpyMode && inputMode === 'FROM_JPY';
  const inputNum = parseFloat(nativeAmount) || 0;
  const foreignAmount = isJpyMode ? inputNum : (isReverse ? convert(inputNum, rate, 'FROM_JPY') : inputNum);
  const jpyAmount = isJpyMode ? inputNum : (isReverse ? inputNum : convert(inputNum, rate, 'TO_JPY'));
  const canSave = isJpyMode
    ? !!activeTrip && inputNum > 0
    : !!activeTrip && rate > 0 && foreignAmount > 0 && jpyAmount > 0;
  const c = CURRENCIES[currencyForDisplay];

  // 価格候補セクションを畳んだときの見出しサブ情報用（選択済み金額の円換算・表示専用）
  const selectedPriceNum = selectedPrice != null ? Number(selectedPrice) : NaN;
  const selectedPriceJpy = rate > 0 && isFinite(selectedPriceNum) ? convert(selectedPriceNum, rate, 'TO_JPY') : 0;

  // 円ヒーローの外貨額・レート表示用：6桁（10万円）以上は縦を使う2段ではなく1行にまとめる（表示判定のみ）
  const jpyDigits = jpyAmount > 0 ? Math.round(jpyAmount).toString().length : 0;
  const isLargeJpyAmount = jpyDigits >= 6;

  // 価格候補の初期プレビュー（最大PRICE_PREVIEW_COUNT件）。選択済みが4件目以降でも、
  // 最後の1件と入れ替えて必ず含める（選択状態が隠れないようにする・表示専用、並び替えは保存に影響しない）
  const pricePreviewBase = ocrResult != null ? ocrResult.prices.slice(0, PRICE_PREVIEW_COUNT) : [];
  const pricePreview =
    selectedPrice != null && !pricePreviewBase.includes(selectedPrice)
      ? [...pricePreviewBase.slice(0, PRICE_PREVIEW_COUNT - 1), selectedPrice]
      : pricePreviewBase;

  // メモ候補チップの描画元。並び・件数はocrResult.memoLinesのままで、翻訳結果は原文をキーに
  // 引き当てるだけ（翻訳の有無でMEMO_PREVIEW_COUNTの折りたたみ条件・選択状態が変わらないようにする）
  const memoChipCandidates = useMemo(
    () => mergeMemoCandidates(ocrResult?.memoLines ?? [], memoCandidates),
    [ocrResult?.memoLines, memoCandidates],
  );

  // 「入力をリセット」は入力欄だけを消す操作なので、入力系の有無だけで判定する
  // （OCR結果・保存写真だけが残っている状態ではボタンを出さない）
  const hasInputToReset = !!(
    nativeAmount ||
    memo ||
    selectedPrice ||
    addedMemoEntries.size > 0
  );

  const stats = useMemo(
    () => getTripStatsForDisplay(history, tripBudgetJpy, activeTrip?.id),
    [history, totalCount, tripBudgetJpy, activeTrip?.id],
  );

  const remainingIfSaved = canSave
    ? Math.max(0, stats.remainingBudget - Math.round(jpyAmount))
    : null;

  // 下部サマリー「今日」用。既存の history を読むだけ（新規クエリなし）
  const todayCount = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDate();
    return history.filter((row) => {
      if (row.entry_date) {
        const [ry, rm, rd] = row.entry_date.split('-').map((v) => parseInt(v, 10));
        return ry === y && rm === m + 1 && rd === d;
      }
      const iso = row.created_at.includes('T')
        ? row.created_at
        : `${row.created_at.replace(' ', 'T')}Z`;
      const dt = new Date(iso);
      return dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d;
    }).length;
  }, [history]);

  // 入力カードは「OCR後」または「手入力で記録を開いたとき」だけ前面に出す（撮影前は主役＝カメラ）
  const showInputCard = ocrResult != null || showManualInput;

  const isWeb = Platform.OS === 'web';

  // 撮影後に見せる「読み取った値札」プレビュー画像（ヘッダー小サムネ／拡大モーダル用）。
  // 初回スキャンはpendingPhotoUriに、再スキャン以降はocrPhotoUriに入る（handleOcrResultでOCR完了時に確定）。
  const ocrPreviewUri = ocrPhotoUri ?? pendingPhotoUri;
  // 撮影後はライブカメラの代わりに「読み取った値札」プレビュー（ドラッグ/ズーム/拡大）を出す
  const showOcrPhotoPreview =
    !isWeb &&
    captureMode === 'ocr' &&
    !cameraLive &&
    ocrResult != null &&
    ocrPreviewUri != null;
  // 手入力で調整：OCR失敗 or 手入力モードは既定で開く / OCR成功時は折りたたむ
  const manualOpenByDefault = ocrResult == null || ocrResult.prices.length === 0;
  const manualOpen = manualOpenByDefault || manualAdjustExpanded;
  const ocrSuccess = ocrResult != null && ocrResult.prices.length > 0;

  // 表示フェーズ（価格OCRモードのカメラ↔結果確認）。
  // 'scanning' は CameraPreview 内部 state のため index 側からは観測せず 'camera' に含める
  // （カメラ表示中＝フッター非表示なので、読み取るCTAを隠す問題は起きない）。
  // result = ライブカメラを撮影済みプレビューに切替済み（cameraLive=false）かつ OCR結果あり。
  const phase: Phase = !cameraLive && ocrResult != null ? 'result' : 'camera';
  const isPriceOcrMode = captureMode === 'ocr';
  // 固定フッターは「価格OCRモードで結果確認中、かつOCR成功（価格候補あり）」のときだけ。
  // → カメラ表示中・スキャン中・商品写真モード中・OCR失敗時は出さない。
  const showFooter = !isWeb && isPriceOcrMode && phase === 'result' && ocrSuccess;
  // 価格未選択（＝金額未確定）なら保存ボタンだけ disabled。手入力で金額が入れば canSave で有効化される。
  const saveDisabled = !canSave;

  function switchInputMode(mode: ConversionDirection) {
    setInputMode(mode);
    setNativeAmount('');
  }

  function handlePhotoCapture(uri: string) {
    if (pendingPhotoUri == null) {
      setPendingPhotoUri(uri);
      setPendingPhotoSource('ocr');
      setExcludePhotoFromSave(false);
    } else {
      // 再読み取りの撮影分はOCR処理(handleOcrResult)が完了するまでocrPhotoUriへ確定しない
      lastScannedPhotoUriRef.current = uri;
    }
  }

  async function handlePickPhotoFromLibrary() {
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        allowsEditing: false,
      });
      if (!picked.canceled && picked.assets[0]) {
        setPendingPhotoUri(picked.assets[0].uri);
        setPendingPhotoSource('library');
        setExcludePhotoFromSave(false);
        // 写真選択後は手入力カードを開き、サムネ位置（入力カード）へスクロールして変化を示す
        setShowManualInput(true);
        scrollToInputCard();
      }
    } catch (e) {
      console.warn('[photo library]', e);
    }
  }

  // 既に保存対象写真があるときは撮影してすぐに上書きせず、「履歴に残す写真」欄で選んでもらう。
  async function handleTakeProductPhoto() {
    try {
      const captured = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        allowsEditing: false,
      });
      if (captured.canceled || !captured.assets[0]) return;
      const newUri = captured.assets[0].uri;
      if (pendingPhotoUri == null) {
        setPendingPhotoUri(newUri);
        setPendingPhotoSource('product');
        setExcludePhotoFromSave(false);
        // 撮影後は手入力カードを開き、サムネ位置（入力カード）へスクロールして変化を示す
        setShowManualInput(true);
        scrollToInputCard();
        return;
      }
      // 保存対象写真は即上書きせず、「履歴に残す写真」欄の案内から選んでもらう
      setNewPhotoCandidate({ uri: newUri, source: 'product' });
      scrollToInputCard();
    } catch (e) {
      console.warn('[camera]', e);
    }
  }

  function handleChangePhoto() {
    setPhotoSheetVisible(true);
  }

  function handleAddPhoto() {
    setPhotoSheetVisible(true);
  }

  // iOS では ActionSheet(Modal) が閉じきる前に native picker / Alert を呼ぶと
  // カメラが即終了・固まることがあるため、シートを閉じてから実行する。
  function closeSheetThen(action: () => void) {
    setPhotoSheetVisible(false);
    setTimeout(action, 250);
  }

  function handleUseOcrPhoto() {
    if (!ocrPhotoUri) return;
    setPendingPhotoUri(ocrPhotoUri);
    setPendingPhotoSource('ocr');
    setExcludePhotoFromSave(false);
    setOcrPhotoUri(null);
    // この値札写真を直接採用したので、同じ写真を指していた候補案内は不要
    setNewPhotoCandidate((prev) => (prev?.source === 'ocr' ? null : prev));
    scrollToInputCard(); // 反映先（入力カードのサムネ）へスクロールして変化を示す
  }

  // 「履歴に残す写真」欄の「新しい写真を使う」：新しい写真候補を保存対象写真へ反映する
  function handleUseNewPhotoCandidate() {
    if (!newPhotoCandidate) return;
    setPendingPhotoUri(newPhotoCandidate.uri);
    setPendingPhotoSource(newPhotoCandidate.source);
    setExcludePhotoFromSave(false);
    if (newPhotoCandidate.source === 'ocr') setOcrPhotoUri(null);
    setNewPhotoCandidate(null);
    scrollToInputCard();
  }

  // 「履歴に残す写真」欄の「今の保存写真を使う」：候補を消すだけで保存対象写真は変えない
  function handleKeepCurrentPhoto() {
    setNewPhotoCandidate(null);
    setExcludePhotoFromSave(false);
  }

  function handleRemovePhoto() {
    Alert.alert(
      '写真を削除しますか？',
      '保存する写真だけを削除します。金額やメモは残ります。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除',
          style: 'destructive',
          onPress: () => {
            setPendingPhotoUri(null);
            setPendingPhotoSource(null);
            setExcludePhotoFromSave(false);
            setNewPhotoCandidate(null);
            setPhotoPreviewVisible(false);
          },
        },
      ],
    );
  }

  // OCR結果が確定した瞬間に世代を進める。
  // 進行中だった翻訳の結果は、返ってきても世代不一致で破棄される（stale result対策の本体）。
  // iOS以外・翻訳非対象通貨（JPY）では世代を進めるだけで何も起こさない
  // （＝memoCandidatesはnullのままで、メモ候補チップは原文1段で表示される）。
  function startMemoTranslation(memoLines: string[]) {
    const generation = translationGenerationRef.current + 1;
    translationGenerationRef.current = generation;
    if (!isTranslationPlatformSupported) return;

    const sourceLanguage = getTranslationSourceLanguage(currencyForDisplay);
    if (sourceLanguage == null || memoLines.length === 0) {
      setMemoCandidates(null);
      return;
    }

    // 翻訳を待たずに原文候補を即表示する（OCR完了が翻訳待ちにならないようにする）
    setMemoCandidates(createPendingCandidates(memoLines, sourceLanguage));
    if (__DEV__) {
      console.log('[Translation] start', `gen=${generation} lines=${memoLines.length} src=${sourceLanguage}`);
    }

    void (async () => {
      try {
        // ここで cancelTranslation()（= native cancelAll()）を呼んではいけない。
        // cancelAllはcoordinatorの`configuration`をnilにするが、`applyConfiguration`の
        // 「同じ言語ペアならinvalidate()で再実行」という再トリガ経路は
        // `if var current = configuration`に守られており、nilのときは到達できない。
        // その結果、直後のsubmitはinvalidate()を経ずに等価なConfigurationを作るだけになり、
        // jobがnative側のpendingに積まれたままdrainされず、Promiseが永久にsettleしない
        // （＝候補が「翻訳中…」で固定される）。
        // 古い結果は世代不一致で捨てれば足りるため、新翻訳の前段でのcancelは行わない。
        const result = await translateMemoLines({ lines: memoLines, sourceLanguage, generation });
        const isStale = result.generation !== translationGenerationRef.current;
        // [診断ログ] 破棄する結果もここまでは見えるようにする（race・cancelの実機確認に必要）。
        // 開発ビルドのみ出力する（Release正式接続後は毎回のOCRで走るため）。
        if (__DEV__) {
          console.log(
            '[Translation] result',
            `gen=${result.generation} current=${translationGenerationRef.current}${isStale ? ' stale-discard' : ''}`,
            result.candidates
              .map((c) => c.translationStatus + (c.errorCode ? `:${c.errorCode}` : ''))
              .join(','),
          );
        }
        if (isStale) return; // 古い世代の結果はstateへ反映しない
        setMemoCandidates(result.candidates);
      } catch (error) {
        // TranslationServiceはrejectしない設計だが、想定外の例外でも現世代の候補を
        // 「翻訳中…」のまま放置しない。stateではなくmemoLinesから組み直すため、
        // 新しい世代の候補を上書きすることはない。
        if (__DEV__) console.warn('[Translation] error', error);
        if (generation !== translationGenerationRef.current) return;
        setMemoCandidates(
          createPendingCandidates(memoLines, sourceLanguage).map((candidate) =>
            candidate.translationStatus === 'pending'
              ? { ...candidate, translationStatus: 'failed' as const, errorCode: 'translation_failed' as const }
              : candidate,
          ),
        );
      }
    })();
  }

  function handleOcrResult(raw: string) {
    if (isWeb) return;
    // [診断ログ] 開発ビルドのみ出力。本番では実行されない（P0-06）
    if (__DEV__) {
      console.log('[OCR Raw Text]', raw);
      console.log('[OCR Lines]', raw.split('\n').map((l, i) => `${i + 1}: ${l.trim()}`).filter((l) => l.length > 3));
      console.log('[EUR Debug Active Trip] name:', activeTrip?.name ?? '(none)', '/ base_currency:', activeTrip?.base_currency ?? '(none)', '/ rate:', activeTrip?.manual_rate ?? 0);
      console.log('[EUR Debug Extract Call] currencyForDisplay:', currencyForDisplay, '/ raw.length:', raw.length);
    }
    const newPhotoUri = lastScannedPhotoUriRef.current;
    lastScannedPhotoUriRef.current = null;
    const newResult = {
      raw,
      prices: extractPriceCandidates(raw, currencyForDisplay),
      memoLines: extractMemoLines(raw),
    };

    setCameraLive(false); // 読み取り完了→ライブカメラを撮影済みプレビューに切替（表示専用）

    if (ocrResult != null) {
      // 再読み取り：新しい結果は即反映せず、現在の結果と比較して選べる候補として保持する
      setOcrResultCandidate({ photoUri: newPhotoUri, ocrResult: newResult });
      return;
    }

    // 初回スキャン：比較対象がまだ無いため即反映する
    if (newPhotoUri != null) setOcrPhotoUri(newPhotoUri);
    setOcrResult(newResult);
    startMemoTranslation(newResult.memoLines);
    setSelectedPrice(null);
    setAddedMemoEntries(new Map());
    setMemoExpanded(false);
    setPricesExpanded(false); // 価格候補も初期は4件まで
    setPricesSectionOpen(true); // 新しいOCR結果では候補セクションを開いた状態に戻す
    setMemoSectionOpen(true);
    setManualAdjustExpanded(false); // 成功時は手入力を畳む
  }

  // [検証] Vision OCR比較の1アーム実行。旧OCRと同じ撮影画像(ocrPreviewUri)に対して実行し、
  // 既存extractPriceCandidates/extractMemoLinesへ通した結果を比較パネル用stateへ格納する。
  async function runOneBenchmarkArm(arm: VisionOcrBenchmarkArmDefinition) {
    if (!ocrPreviewUri) return;
    setBenchmarkResults((prev) => ({ ...prev, [arm.id]: { status: 'running' } }));
    const result = await runBenchmarkArm(arm, ocrPreviewUri, currencyForDisplay);
    setBenchmarkResults((prev) => ({ ...prev, [arm.id]: result }));
  }

  // [検証] デフォルト比較アーム（旧方式＋新方式8件）を順番に実行する。並列実行はせず、実機の処理時間・発熱を抑える。
  async function runDefaultBenchmarkArms() {
    if (!ocrPreviewUri || isRunningAllBenchmarks) return;
    setIsRunningAllBenchmarks(true);
    try {
      setSupportedLanguagesInfo(await fetchSupportedLanguages('accurate'));
      for (const arm of DEFAULT_BENCHMARK_ARMS) {
        await runOneBenchmarkArm(arm);
      }
    } finally {
      setIsRunningAllBenchmarks(false);
    }
  }

  // 「新しい読み取りを使う」：候補だった結果を実際に反映する（保存対象写真pendingPhotoUriは別途、保存欄で選ぶ）
  function handleUseOcrResultCandidate() {
    if (!ocrResultCandidate) return;
    const { photoUri, ocrResult: newResult } = ocrResultCandidate;
    if (photoUri != null) {
      setOcrPhotoUri(photoUri);
      // 新しい値札写真は保存対象写真へ即反映せず、「履歴に残す写真」欄で選んでもらう候補として保持する
      setNewPhotoCandidate({ uri: photoUri, source: 'ocr' });
    }
    setOcrResult(newResult);
    startMemoTranslation(newResult.memoLines);
    setSelectedPrice(null);
    setAddedMemoEntries(new Map());
    setMemoExpanded(false);
    setPricesExpanded(false);
    setPricesSectionOpen(true);
    setMemoSectionOpen(true);
    setManualAdjustExpanded(false);
    setOcrResultCandidate(null);
  }

  // 「前の読み取りを残す」：候補を捨てて現在のOCR結果を維持する
  function handleKeepCurrentOcrResult() {
    setOcrResultCandidate(null);
  }

  function scrollToInputCard() {
    // レイアウト確定後にスクロールするため、少し長めのタイマーで待つ
    setTimeout(() => {
      scrollViewRef.current?.scrollTo({
        y: Math.max(inputCardYRef.current - 16, 0),
        animated: true,
      });
    }, 250);
  }

  // 「✎ 金額を修正」展開時に編集パネルまでスクロール。
  // manualAdjustYRefはSectionCard内オフセット（resultPanelの padding=spacing.lg 分を加算）。
  function scrollToManualAdjust() {
    setTimeout(() => {
      scrollViewRef.current?.scrollTo({
        y: Math.max(inputCardYRef.current + spacing.lg + manualAdjustYRef.current - 16, 0),
        animated: true,
      });
    }, 250);
  }

  // メモ欄フォーカス時にキーボードへ隠れないようスクロール。
  // キーボード表示アニメーション中にスクロールが効くよう、少し長めのタイマーで待つ（他のスクロール先と同じ250ms）。
  // memoRowYRefはSectionCard内オフセット（同上）。
  function scrollToMemoInput() {
    setTimeout(() => {
      scrollViewRef.current?.scrollTo({
        y: Math.max(inputCardYRef.current + spacing.lg + memoRowYRef.current - 16, 0),
        animated: true,
      });
    }, 250);
  }

  // 上部のカメラ位置へ戻す（「もう一度読み取る」で撮り直し先を示す）
  function scrollToCamera() {
    scrollViewRef.current?.scrollTo({ y: 0, animated: true });
  }

  function handlePickPrice(price: string) {
    setNativeAmount(price);
    setInputMode('TO_JPY');
    // OCRカードは閉じない（全文を見ながらメモを書けるようにする）
    setSelectedPrice(price);
    scrollToInputCard();
  }

  // メモ候補のトグル：未追加→追加してチェック、追加済み→メモから取り除いてチェック解除。
  // 選択状態のidentityは常にcandidate.originalText（訳文をキーにしない：
  // 會員價／会员价のように別の原文が同じ訳文になることがあるため）。
  function handleToggleMemoLine(candidate: MemoCandidate) {
    const originalText = candidate.originalText;
    if (!originalText.trim()) return;

    const insertedText = addedMemoEntries.get(originalText);
    if (insertedText !== undefined) {
      // 削除：**タップ時に実際に挿入した文字列**だけを取り除く。
      // 現在のcandidate.translatedTextから計算し直してはいけない
      //（pending中に原文で追加→後から訳文が届いた場合、消す対象がずれる）。
      setMemo((prev) => removeMemoText(prev, insertedText));
      setAddedMemoEntries((prev) => {
        const next = new Map(prev);
        next.delete(originalText);
        return next;
      });
      return;
    }

    // 追加：挿入文字列は**このタップ時点の候補**で確定する（訳文があれば訳文、無ければ原文）。
    // 後から翻訳が届いても、既にメモへ入れた文字列は書き換えない。
    const textToInsert = resolveMemoInsertText(candidate);
    // 上限判定はappendMemoText側の責務。ここでlength判定やsliceを再実装しない。
    // 関数型更新ではなく現在のmemoを直接読むのは、追加できたときだけMap更新・
    // できなかったときだけトーストという分岐が必要なため（更新関数内で副作用を起こさない）。
    const result = appendMemoText(memo, textToInsert);
    if (!result.ok) {
      // 上限超過は「押したのに何も起きない」に見えるため、既存の軽量トーストで案内する。
      // 途中で切って入れることはしない（Phase 3C正式仕様）。
      if (result.reason === 'too_long') {
        setToastMessage(`メモは${MEMO_MAX_LENGTH}文字までです`);
        setToastCaption('この候補は追加できません');
      }
      return;
    }
    setMemo(result.memo);
    // valueはメモ本文に実際に入った文字列そのもの（削除時はこれだけを消す）
    setAddedMemoEntries((prev) => new Map(prev).set(originalText, textToInsert));
    // 自動スクロールしない：チェック表示・選択色の変化で追加を確認できるため、
    // 複数候補を連続タップできることを優先する（実機確認で正式採用）。
  }

  // 入力をリセット（軽量）：入力欄だけを消す。
  // OCR結果・候補カード・保存写真・入力カードは残す（完全クリアではない）。
  function handleResetInput() {
    setNativeAmount('');
    setSelectedPrice(null);
    setMemo('');
    setAddedMemoEntries(new Map());
    setSaveAsPurchased(false);
    setCameraLive(true); // 入力リセット後は撮影前のライブカメラ表示に戻す
  }

  function openManualInput() {
    setShowManualInput(true);
    scrollToManualAdjust();
    setTimeout(() => { amountInputRef.current?.focus(); }, 350);
  }

  function handleCopyRawToMemo() {
    if (!ocrResult) return;
    // memo候補と同じ100文字仕様（入るなら丸ごと・入らないなら何もしない、途中で切らない）。
    // OCR全文は実質常に100文字を超えるため、この経路では超過案内が出るのが通常の結果になる。
    const result = replaceMemoText(ocrResult.raw);
    if (!result.ok) {
      setToastMessage(`メモは${MEMO_MAX_LENGTH}文字までです`);
      setToastCaption('100文字を超えるため追加できません');
      return;
    }
    setMemo(result.memo);
  }

  // 保存用メモの削除：確認Alertで確定した時だけメモ本文を空にする（候補抽出・追加処理には触らない）。
  function handleDeleteMemo() {
    Alert.alert(
      'メモを削除しますか？',
      '保存するメモから削除します。',
      [
        { text: 'キャンセル', style: 'cancel' },
        { text: '削除', style: 'destructive', onPress: () => setMemo('') },
      ],
    );
  }

  function cycleCurrency() {
    const idx = FOREIGN_CURRENCY_CODES.indexOf(selectedCurrency);
    setSelectedCurrency(
      FOREIGN_CURRENCY_CODES[(idx + 1) % FOREIGN_CURRENCY_CODES.length] as CurrencyCode,
    );
  }

  // もう一度読み取る：価格OCRだけ撮り直す。
  // 保存写真(pendingPhotoUri)・入力中の金額/メモ・入力カードは残す。
  // 既存のOCR写真・結果はここでは消さない（新しい結果はhandleOcrResultで候補として保持し、選ぶまで反映しない）。
  function handleRescan() {
    setScanKey((k) => k + 1);
    setCameraLive(true); // 再撮影＝大きいライブカメラへ戻す（表示専用）
    setPhotoPreviewVisible(false);
    scrollToCamera(); // 上のカメラで撮り直すことを示す
  }

  async function handleSaveCandidate() {
    if (!canSave || !activeTrip) return;
    if (!canSaveEntry(isPro, totalCount)) {
      setShowSaveLimitSheet(true);
      return;
    }
    let savedPhotoUri: string | undefined;
    // 「写真なしで保存」が選ばれている時は、保存対象写真があってもコピーしない（既存の写真なし保存と同じ扱い）。
    if (pendingPhotoUri && !excludePhotoFromSave && Platform.OS !== 'web') {
      try {
        const FileSystem = await import('expo-file-system/legacy');
        const docsDir = FileSystem.documentDirectory;
        if (docsDir) {
          const photosDir = `${docsDir}photos/`;
          await FileSystem.makeDirectoryAsync(photosDir, { intermediates: true });
          const destUri = `${photosDir}${Date.now()}.jpg`;
          await FileSystem.copyAsync({ from: pendingPhotoUri, to: destUri });
          savedPhotoUri = destUri;
        }
      } catch (e) {
        console.warn('[photo save]', e);
      }
    }
    const currencyToSave = activeTrip.base_currency;
    const rateToSave = currencyToSave === 'JPY' ? 1 : activeTrip.manual_rate;
    const foreignAmountToSave = currencyToSave === 'JPY' ? jpyAmount : foreignAmount;
    try {
      const result = await addEntry(
        currencyToSave,
        foreignAmountToSave,
        jpyAmount,
        rateToSave,
        memo.trim() || undefined,
        savedPhotoUri,
        saveAsPurchased,
      );
      if (result.blocked) {
        setShowSaveLimitSheet(true);
        return; // 入力値を保持したまま終了
      }
    } catch (e) {
      console.warn('[save error]', e);
      Alert.alert(
        '保存できませんでした',
        '記録の保存中にエラーが発生しました。もう一度お試しください。',
        [{ text: 'OK' }],
      );
      return; // 入力値を保持したまま終了
    }
    // 保存成功トースト（候補/購入済みの文言はリセット前のsaveAsPurchasedで決める）
    setToastMessage(saveAsPurchased ? '購入済みに保存しました' : '候補に保存しました');
    setToastCaption('履歴で確認できます');
    // 保存成功時のみリセット
    setNativeAmount('');
    setMemo('');
    // メモ本文を空にするので追加済み候補も必ず一緒に消す
    // （残すと「メモは空なのに追加済み扱い」の不整合が残る）
    setAddedMemoEntries(new Map());
    setOcrResult(null);
    startMemoTranslation([]); // OCR結果を消したので世代を進め、遅れて届く翻訳結果を破棄する
    setCameraLive(true); // 保存後は撮影前のライブカメラ表示に戻す
    setOcrRawExpanded(false);
    setPendingPhotoUri(null);
    setPendingPhotoSource(null);
    setExcludePhotoFromSave(false);
    setOcrPhotoUri(null);
    setOcrResultCandidate(null);
    setNewPhotoCandidate(null);
    setPhotoPreviewVisible(false);
    setSaveAsPurchased(false);
    setShowManualInput(false);
    if (Platform.OS !== 'web') {
      try {
        const { notificationAsync, NotificationFeedbackType } = await import('expo-haptics');
        await notificationAsync(NotificationFeedbackType.Success);
      } catch (e) {
        console.warn('Haptics not available:', e);
      }
    }
  }

  const cameraPreview = (
    <CameraPreview
      key={scanKey}
      currency={currencyForDisplay}
      rate={rate}
      remainingIfSaved={remainingIfSaved}
      onOcrResult={Platform.OS !== 'web' ? handleOcrResult : undefined}
      onPhotoCapture={Platform.OS !== 'web' ? handlePhotoCapture : undefined}
    />
  );

  return (
    <View style={styles.screen}>
      {/* 翻訳ホストView（透明・絶対配置・タッチ透過）。これがマウントされている間だけ
          translateBatchが成功する。iOS 18未満・iOS以外では何も描画されない。 */}
      <TranslationHost active={isScreenFocused} />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          contentContainerStyle={[styles.scroll, showFooter && styles.scrollWithFooter]}
          showsVerticalScrollIndicator={false}
          // 撮影前の純粋なスタート画面（OCR結果なし・手入力/保存設定が未展開）は1画面に収まるため、
          // 上下スワイプで動いてしまわないようスクロールそのものを止める。結果・保存設定表示中は通常通り有効。
          scrollEnabled={showInputCard}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}>

          <View style={styles.container}>

            {/* 上部：旅行名 ＋ 小さいレートチップ（v4撮影前ヘッダー） */}
            {activeTrip ? (
              <View style={styles.header}>
                <ThemedText style={styles.headerTripName} numberOfLines={1}>
                  {tripName}
                </ThemedText>
                {isJpyMode ? (
                  <View style={[styles.rateChip, styles.rateChipRow]}>
                    <CurrencyFlagImage currency="JPY" size={14} outlined />
                    <ThemedText style={styles.rateChipText}>JPY 国内</ThemedText>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[styles.rateChip, styles.rateChipRow]}
                    onPress={cycleCurrency}
                    activeOpacity={0.75}>
                    <CurrencyFlagImage currency={currencyForDisplay} size={14} outlined />
                    <ThemedText style={styles.rateChipText} numberOfLines={1}>
                      {rate > 0 ? formatRate(rate, currencyForDisplay) : 'レート未設定'}
                    </ThemedText>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <EmptyState
                tone="neutral"
                title="旅行が選択されていません"
                body="設定で旅行を作成するか、既存の旅行を選択すると、レートや予算に合わせて記録できます。"
                primary={{ title: '設定で旅行を作成・選択', onPress: () => router.push('/settings') }}
              />
            )}

            {/* モード切替セグメント（価格OCR / 商品写真）。選択中＝白背景＋少し強めの影＋tealアイコン */}
            <View style={styles.modeSegment}>
              <TouchableOpacity
                style={[styles.modeSegmentBtn, captureMode === 'ocr' && styles.modeSegmentBtnActive]}
                onPress={() => setCaptureMode('ocr')}
                activeOpacity={0.8}>
                <View style={styles.modeSegmentBtnContent}>
                  <SymbolView
                    name={{ ios: 'text.viewfinder', android: 'document_scanner', web: 'document_scanner' }}
                    tintColor={captureMode === 'ocr' ? color.primaryDark : color.muted}
                    weight="semibold"
                    size={16}
                  />
                  <ThemedText
                    style={[styles.modeSegmentText, captureMode === 'ocr' && styles.modeSegmentTextActive]}>
                    価格OCR
                  </ThemedText>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modeSegmentBtn, captureMode === 'photo' && styles.modeSegmentBtnActive]}
                onPress={() => setCaptureMode('photo')}
                activeOpacity={0.8}>
                <View style={styles.modeSegmentBtnContent}>
                  <SymbolView
                    name={{ ios: 'camera', android: 'photo_camera', web: 'photo_camera' }}
                    tintColor={captureMode === 'photo' ? color.primaryDark : color.muted}
                    weight="semibold"
                    size={16}
                  />
                  <ThemedText
                    style={[styles.modeSegmentText, captureMode === 'photo' && styles.modeSegmentTextActive]}>
                    商品写真
                  </ThemedText>
                </View>
              </TouchableOpacity>
            </View>

            {/* 中央：価格OCR=ライブカメラ / 撮影後=読み取った値札プレビュー（実用：元画像と候補を見比べる） / 商品写真=商品パネル */}
            {captureMode === 'ocr' ? (
              showOcrPhotoPreview && ocrPreviewUri != null ? (
                <View style={styles.ocrPhotoPreview}>
                  {/* 見出し（左）＋ 拡大・再読み取り（右上に集約） */}
                  <View style={styles.ocrPhotoPreviewHeader}>
                    <ThemedText style={styles.ocrPhotoPreviewLabel}>読み取った値札</ThemedText>
                    <View style={styles.ocrPhotoPreviewActions}>
                      <TouchableOpacity
                        onPress={() => setOcrPhotoZoomVisible(true)}
                        hitSlop={8}
                        activeOpacity={0.7}>
                        <ThemedText style={styles.ocrPhotoPreviewZoom}>拡大</ThemedText>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={handleRescan} hitSlop={8} activeOpacity={0.7}>
                        <ThemedText style={styles.ocrPhotoPreviewRescan}>再読み取り</ThemedText>
                      </TouchableOpacity>
                    </View>
                  </View>
                  {/* 再読み取り直後だけ表示。新しい結果はまだ未反映で、選ぶまで現在の結果を維持する */}
                  {ocrResultCandidate != null && (
                    <View style={styles.newPhotoCandidateBanner}>
                      <View style={styles.newPhotoCandidateCompareRow}>
                        <View style={styles.newPhotoCandidateCompareCol}>
                          <View style={styles.newPhotoCandidateThumbWrap}>
                            {ocrPreviewUri != null ? (
                              <Image
                                source={{ uri: ocrPreviewUri }}
                                style={styles.newPhotoCandidateThumb}
                                contentFit="cover"
                              />
                            ) : (
                              <SymbolView
                                name={{ ios: 'photo', android: 'image', web: 'image' }}
                                tintColor={color.muted}
                                size={20}
                              />
                            )}
                          </View>
                          <ThemedText style={styles.newPhotoCandidateCompareLabel}>
                            現在の読み取り結果
                          </ThemedText>
                        </View>
                        <View style={styles.newPhotoCandidateCompareCol}>
                          <View style={styles.newPhotoCandidateThumbWrap}>
                            {ocrResultCandidate.photoUri != null ? (
                              <Image
                                source={{ uri: ocrResultCandidate.photoUri }}
                                style={styles.newPhotoCandidateThumb}
                                contentFit="cover"
                              />
                            ) : (
                              <SymbolView
                                name={{ ios: 'photo', android: 'image', web: 'image' }}
                                tintColor={color.muted}
                                size={20}
                              />
                            )}
                          </View>
                          <ThemedText style={styles.newPhotoCandidateCompareLabel}>
                            新しい読み取り結果
                          </ThemedText>
                        </View>
                      </View>
                      {/* サムネ表示は左:現在の読み取り結果／右:新しい読み取り結果。ボタンの左右も同じ並びに揃える */}
                      <View style={styles.photoSettingsActionsRow}>
                        <TouchableOpacity
                          style={[styles.photoSettingsActionBtn, styles.photoSettingsActionBtnGhost]}
                          onPress={handleKeepCurrentOcrResult}
                          activeOpacity={0.7}>
                          <ThemedText style={styles.photoSettingsActionBtnGhostText}>
                            前の読み取りを残す
                          </ThemedText>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.photoSettingsActionBtn}
                          onPress={handleUseOcrResultCandidate}
                          activeOpacity={0.7}>
                          <ThemedText style={styles.photoSettingsActionBtnText}>
                            新しい読み取りを使う
                          </ThemedText>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                  {/* 横長コンパクト。全幅(実寸比)で表示し縦スクロール／iOSピンチで全体確認。枠内クリップ。
                      撮影時に中心へ合わせた値札がプレビューでも中心付近に見えるよう、画像の高さが確定したら
                      縦スクロール位置を中央へ補正する（上寄せのまま固定しない）。 */}
                  <View style={styles.ocrPhotoPreviewFrame}>
                    <ScrollView
                      ref={ocrPhotoPreviewScrollRef}
                      style={StyleSheet.absoluteFill}
                      contentContainerStyle={styles.ocrPhotoPreviewScrollContent}
                      nestedScrollEnabled
                      showsVerticalScrollIndicator
                      minimumZoomScale={1}
                      maximumZoomScale={3}
                      centerContent>
                      <Image
                        source={{ uri: ocrPreviewUri }}
                        style={[styles.ocrPhotoPreviewImg, { aspectRatio: ocrImgAspect }]}
                        contentFit="contain"
                        onLoad={(e) => {
                          const w = e?.source?.width;
                          const h = e?.source?.height;
                          if (w && h) setOcrImgAspect(w / h);
                        }}
                        onLayout={(e) => {
                          const renderedHeight = e.nativeEvent.layout.height;
                          const centerY = Math.max((renderedHeight - OCR_PHOTO_PREVIEW_FRAME_HEIGHT) / 2, 0);
                          ocrPhotoPreviewScrollRef.current?.scrollTo({ y: centerY, animated: false });
                        }}
                      />
                    </ScrollView>
                  </View>
                </View>
              ) : (
                cameraPreview
              )
            ) : (
              <View style={styles.productPanel}>
                <View style={styles.productPurposeBanner}>
                  <ThemedText style={styles.productPurposeText}>
                    商品写真を撮ったあと、金額を入力して保存できます。金額の読み取りはしません。
                  </ThemedText>
                </View>
                {Platform.OS !== 'web' && (
                  <TouchableOpacity
                    style={styles.productShutterBtn}
                    onPress={handleTakeProductPhoto}
                    activeOpacity={0.85}>
                    <ThemedText style={styles.productShutterText}>商品を撮る</ThemedText>
                  </TouchableOpacity>
                )}
                <SecondaryButton
                  title="🖼  写真ライブラリから選ぶ"
                  onPress={handlePickPhotoFromLibrary}
                />
              </View>
            )}

            {/* OCR結果＋保存を1枚にまとめた結果パネル（v2：1枚で完結） */}
            {showInputCard && (
            <View onLayout={(e) => { inputCardYRef.current = e.nativeEvent.layout.y; }}>
            <SectionCard style={styles.resultPanel}>
              {/* 円換算ヒーロー（確認画面の主役）。「✎ 金額を修正」はヒーロー右上の自然なアクション
                  （手入力パネルの開閉）。読み取りステータスはヒーロー＝成功 / 下の失敗ブロック＝失敗で表現。 */}
              {(jpyAmount > 0 || (ocrResult != null && ocrResult.prices.length > 0)) && (
                <View style={styles.heroBlock}>
                  {ocrSuccess && (
                    <TouchableOpacity
                      style={styles.heroEditLink}
                      onPress={() => {
                        // 開く時だけ編集パネルへスクロール（閉じる時は無理にスクロールしない）
                        const opening = !manualAdjustExpanded;
                        setManualAdjustExpanded(opening);
                        if (opening) scrollToManualAdjust();
                      }}
                      hitSlop={8}
                      activeOpacity={0.7}>
                      <ThemedText style={styles.heroEditLinkText}>
                        {manualOpen ? '閉じる' : '✎ 金額を修正'}
                      </ThemedText>
                    </TouchableOpacity>
                  )}
                  {/* 円換算ヒーロー：円金額は左、外貨額＋レートはヒーロー右端へ逃がす。
                      小さい金額＝右端に2段、大きい金額（6桁以上）＝縦を使わず1行にまとめる。
                      狭い画面・長い文字列は自然に折り返す。保存時のcurrency/rate計算には触れない（表示のみ）。 */}
                  <View style={styles.heroJpy}>
                    <ThemedText style={styles.heroJpyLabel}>日本円で</ThemedText>
                    <View style={styles.heroValueRow}>
                      <ThemedText style={jpyAmount > 0 ? styles.heroJpyValue : styles.heroPlaceholderValue}>
                        {jpyAmount > 0 ? formatJpy(jpyAmount) : '¥—'}
                      </ThemedText>
                      {jpyAmount > 0 && !isJpyMode && rate > 0 && (
                        isLargeJpyAmount ? (
                          <ThemedText style={styles.heroRateSubInline} numberOfLines={1}>
                            {formatForeign(foreignAmount, currencyForDisplay)}{'・'}{formatRate(rate, currencyForDisplay)}
                          </ThemedText>
                        ) : (
                          <View style={styles.heroRateSubWrap}>
                            <ThemedText style={styles.heroRateSub} numberOfLines={1}>
                              {formatForeign(foreignAmount, currencyForDisplay)}
                            </ThemedText>
                            <ThemedText style={styles.heroRateSub} numberOfLines={1}>
                              {formatRate(rate, currencyForDisplay)}
                            </ThemedText>
                          </View>
                        )
                      )}
                    </View>
                    {jpyAmount <= 0 && (
                      <ThemedText style={styles.heroPlaceholderHint}>下の価格候補を選ぶと換算されます</ThemedText>
                    )}
                  </View>
                  {tripBudgetJpy > 0 && (
                    <View style={styles.budgetPill}>
                      <ThemedText style={styles.budgetPillText}>
                        残り {formatJpy(remainingIfSaved != null ? remainingIfSaved : stats.remainingBudget)}
                      </ThemedText>
                    </View>
                  )}
                </View>
              )}

              {/* 読み取り結果セクション（Web非表示）。価格候補をヒーロー直下に置く（独立した「候補を少なく表示」行は撤去） */}
              {!isWeb && ocrResult != null && (
              <View style={styles.ocrSectionWrap}>
                {/* 価格候補（ヒーロー直下）。見出し右に「さらに表示」＋セクション自体の開閉（手動のみ・タップでは閉じない） */}
                <View style={styles.ocrSection}>
                  <View style={styles.ocrSectionHeader}>
                    <View style={styles.ocrSectionLabelGroup}>
                      <ThemedText style={styles.ocrSectionLabel}>価格候補</ThemedText>
                    </View>
                    {ocrResult.prices.length > 0 && (
                      <View style={styles.ocrSectionActions}>
                        {pricesSectionOpen && ocrResult.prices.length > PRICE_PREVIEW_COUNT && (
                          <TouchableOpacity
                            onPress={() => setPricesExpanded((v) => !v)}
                            hitSlop={8}
                            activeOpacity={0.6}>
                            <ThemedText style={styles.ocrSectionMore}>
                              {pricesExpanded ? '少なく表示' : `さらに${ocrResult.prices.length - PRICE_PREVIEW_COUNT}件`}
                            </ThemedText>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          onPress={() => setPricesSectionOpen((v) => !v)}
                          hitSlop={8}
                          activeOpacity={0.6}>
                          <ThemedText style={styles.ocrSectionMore}>
                            {pricesSectionOpen ? '閉じる' : '候補を見る'}
                          </ThemedText>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                  {/* 閉じている時は選択中の価格を「ボックス」で見せる（文字行だけで終わらせない） */}
                  {!pricesSectionOpen && ocrResult.prices.length > 0 && selectedPrice != null && (
                    <View style={styles.priceSelectedBox}>
                      <ThemedText style={styles.priceSelectedBoxLabel}>選択中の価格</ThemedText>
                      <ThemedText style={styles.priceSelectedBoxValue} numberOfLines={1}>
                        {c.symbol}{selectedPrice}
                        {!isJpyMode && selectedPriceJpy > 0 ? ` → ${formatJpy(selectedPriceJpy)}` : ''}
                      </ThemedText>
                    </View>
                  )}
                  {ocrResult.prices.length === 0 ? (
                    <View style={styles.ocrFailBlock}>
                      <View style={styles.ocrFailIconWrap}>
                        <ThemedText style={styles.ocrFailIcon}>🔍</ThemedText>
                      </View>
                      <ThemedText style={styles.ocrFailTitle}>金額を読み取れませんでした</ThemedText>
                      <ThemedText style={styles.ocrFailDesc}>
                        値札全体が入るよう少し離して、明るい場所で撮り直してください。読めない場合は下の欄に手入力できます。
                      </ThemedText>
                      <PrimaryButton
                        title="✎ 手入力で金額を入れる"
                        onPress={openManualInput}
                        style={styles.ocrFailPrimary}
                      />
                      <View style={styles.ocrFailSubRow}>
                        <SecondaryButton
                          title="値札をもう一度読み取る"
                          onPress={handleRescan}
                          style={styles.ocrFailSubBtn}
                        />
                        <SecondaryButton
                          title="商品写真を保存"
                          onPress={handleTakeProductPhoto}
                          style={styles.ocrFailSubBtn}
                        />
                      </View>
                    </View>
                  ) : pricesSectionOpen ? (
                    <View style={styles.ocrPriceRow}>
                      {(pricesExpanded ? ocrResult.prices : pricePreview).map((p) => {
                        const isSelected = p === selectedPrice;
                        const numP = Number(p);
                        const jpyForP = rate > 0 && isFinite(numP) ? convert(numP, rate, 'TO_JPY') : 0;
                        return (
                          <TouchableOpacity
                            key={p}
                            style={[styles.priceCard, isSelected && styles.priceCardSelected]}
                            onPress={() => handlePickPrice(p)}
                            activeOpacity={0.8}>
                            <ThemedText
                              style={[styles.priceCardForeign, isSelected && styles.priceCardForeignSelected]}>
                              {isSelected ? '✓ ' : ''}{c.symbol}{p}
                            </ThemedText>
                            {!isJpyMode && jpyForP > 0 && (
                              <ThemedText
                                style={[styles.priceCardJpy, isSelected && styles.priceCardJpySelected]}>
                                {formatJpy(jpyForP)}
                              </ThemedText>
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ) : null}
                </View>

                {/* メモ候補（行全体タップで追加。右端は状態表示。見出し右にさらに◯件＋セクション開閉） */}
                {ocrResult.memoLines.length > 0 && (
                  <View style={styles.ocrSection}>
                    <View style={styles.ocrSectionHeader}>
                      <View style={styles.ocrSectionLabelGroup}>
                        <ThemedText style={styles.ocrSectionLabel}>メモ候補（タップで追加）</ThemedText>
                      </View>
                      <View style={styles.ocrSectionActions}>
                        {memoSectionOpen && ocrResult.memoLines.length > MEMO_PREVIEW_COUNT && (
                          <TouchableOpacity
                            onPress={() => setMemoExpanded((v) => !v)}
                            hitSlop={8}
                            activeOpacity={0.6}>
                            <ThemedText style={styles.ocrSectionMore}>
                              {memoExpanded ? '少なく表示' : `さらに${ocrResult.memoLines.length - MEMO_PREVIEW_COUNT}件`}
                            </ThemedText>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          onPress={() => setMemoSectionOpen((v) => !v)}
                          hitSlop={8}
                          activeOpacity={0.6}>
                          <ThemedText style={styles.ocrSectionMore}>
                            {memoSectionOpen ? '閉じる' : '候補を見る'}
                          </ThemedText>
                        </TouchableOpacity>
                      </View>
                    </View>
                    {/* 閉じている時は追加済みメモの中身をチップで見せる（「追加済みN件」だけで終わらせない） */}
                    {!memoSectionOpen && addedMemoEntries.size > 0 && (
                      <View style={styles.addedMemoBox}>
                        <ThemedText style={styles.addedMemoBoxLabel}>追加済みメモ</ThemedText>
                        <View style={styles.addedMemoChipRow}>
                          {/* keyは原文（identity）、表示はメモ本文へ実際に入れた文字列 */}
                          {Array.from(addedMemoEntries.entries())
                            .slice(0, MEMO_PREVIEW_COUNT)
                            .map(([originalText, insertedText]) => (
                              <View key={originalText} style={styles.addedMemoChip}>
                                <ThemedText style={styles.addedMemoChipText} numberOfLines={1}>
                                  {insertedText}
                                </ThemedText>
                              </View>
                            ))}
                          {addedMemoEntries.size > MEMO_PREVIEW_COUNT && (
                            <ThemedText style={styles.addedMemoMore}>
                              +{addedMemoEntries.size - MEMO_PREVIEW_COUNT}
                            </ThemedText>
                          )}
                        </View>
                      </View>
                    )}
                    {memoSectionOpen && (
                      <View style={styles.ocrMemoChipRow}>
                        {(memoExpanded
                          ? memoChipCandidates
                          : memoChipCandidates.slice(0, MEMO_PREVIEW_COUNT)
                        ).map((candidate) => {
                          // 選択状態・タップ対象は常に原文（identity）。表示だけが訳文になる
                          const line = candidate.originalText;
                          const added = addedMemoEntries.has(line);
                          const { primaryText, secondaryText } = resolveMemoCandidateDisplay(candidate);
                          return (
                            <TouchableOpacity
                              key={line}
                              style={[styles.memoChip, added && styles.memoChipAdded]}
                              onPress={() => handleToggleMemoLine(candidate)}
                              activeOpacity={0.75}>
                              <ThemedText
                                style={[styles.memoChipText, added && styles.memoChipTextAdded]}
                                numberOfLines={1}>
                                {added ? '✓ ' : '+ '}{primaryText}
                              </ThemedText>
                              {/* 補助表示の原文。訳文が主表示のときだけ2段になる（最大2行に収める） */}
                              {secondaryText != null && (
                                <ThemedText
                                  style={[styles.memoChipSubText, added && styles.memoChipSubTextAdded]}
                                  numberOfLines={1}>
                                  {secondaryText}
                                </ThemedText>
                              )}
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                  </View>
                )}
              {/* ===== 開発用OCR診断パネル =====
                  本番ユーザーには一切表示しない（P0-05）。__DEV__ビルドでのみ表示・操作可能。 */}
              {__DEV__ && (
              <TouchableOpacity
                onPress={() => setShowOcrDebug((v) => !v)}
                style={{ padding: 8, marginTop: 10, backgroundColor: '#1a1a2e', borderRadius: 6 }}
                activeOpacity={0.8}>
                <ThemedText style={{ fontSize: 11, color: '#6cb6ff', textAlign: 'center' }}>
                  {showOcrDebug ? '▲ OCRデバッグ 閉じる' : '▼ OCRデバッグ 表示'}
                </ThemedText>
              </TouchableOpacity>
              )}
              {__DEV__ && showOcrDebug && (() => {
                const raw = ocrResult.raw;
                const rawLines = raw.split('\n');
                const hasEur     = /€/.test(raw);
                const hasEurWord = /EUR/i.test(raw);
                const hasDot     = /\d+\.\d+/.test(raw);
                const hasComma   = /\d+,\d+/.test(raw);
                const hasNum     = /\d/.test(raw);
                const hasPct     = /%/.test(raw);
                const hasSpace   = /^\d{1,3}\s+\d{2}$/m.test(raw);
                const hasSplitDec = (() => {
                  const ls = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                  return ls.some((l, i) => /^\d{1,3}[.,]$/.test(l) && i + 1 < ls.length && /^\d{2}$/.test(ls[i + 1]));
                })();
                const hasSplitNum = (() => {
                  const ls = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                  return ls.some((l, i) => /^\d{1,2}$/.test(l) && i + 1 < ls.length && /^\d{2}$/.test(ls[i + 1]));
                })();
                const cands      = ocrResult.prices;
                let reason: string;
                if (cands.length > 0)              { reason = '候補あり (' + cands.length + '件)'; }
                else if (!hasNum)                  { reason = 'rawに数字なし'; }
                else if ((hasEur || hasEurWord) && !hasDot && !hasComma) { reason = '€/EUR記号あり・数値形式不一致'; }
                else if (hasPct && !hasDot && !hasComma) { reason = '%のみ確認・価格形式なし'; }
                else                               { reason = '数字あり・regex不一致'; }
                const monoFont = Platform.OS === 'ios' ? 'Courier New' : 'monospace';
                return (
                  <ScrollView
                    nestedScrollEnabled
                    style={{ maxHeight: 320, backgroundColor: '#0d1117', borderRadius: 6, marginTop: 4 }}>
                    <ThemedText
                      selectable
                      style={{ fontSize: 10, color: '#e6edf3', fontFamily: monoFont, padding: 8, lineHeight: 16 }}>
                      {'[Currency]\n'}
                      {'  base:    ' + (activeTrip?.base_currency ?? '(none)') + '\n'}
                      {'  display: ' + currencyForDisplay + '\n'}
                      {'  passed:  ' + currencyForDisplay + '\n\n'}
                      {'[Raw] len=' + raw.length + '\n'}
                      {raw + '\n\n'}
                      {'[Lines]\n'}
                      {rawLines.map((l, i) => i + ': ' + l).join('\n') + '\n\n'}
                      {'[Search]\n'}
                      {'  €:           ' + (hasEur     ? 'true' : 'false') + '\n'}
                      {'  EUR:         ' + (hasEurWord ? 'true' : 'false') + '\n'}
                      {'  dot(1.99):   ' + (hasDot     ? 'true' : 'false') + '\n'}
                      {'  comma(1,99): ' + (hasComma   ? 'true' : 'false') + '\n'}
                      {'  number:      ' + (hasNum     ? 'true' : 'false') + '\n'}
                      {'  %:           ' + (hasPct     ? 'true' : 'false') + '\n'}
                      {'  space(1 99): ' + (hasSpace    ? 'true' : 'false') + '\n'}
                      {'  split dec:   ' + (hasSplitDec ? 'true' : 'false') + '\n'}
                      {'  split num:   ' + (hasSplitNum ? 'true' : 'false') + '\n\n'}
                      {'[Candidates] count=' + cands.length + '\n'}
                      {JSON.stringify(cands) + '\n\n'}
                      {'[UI decision]\n'}
                      {'  prices.length: ' + cands.length + '\n'}
                      {'  ocrResult:     set\n'}
                      {'  reason:        ' + reason}
                    </ThemedText>
                  </ScrollView>
                );
              })()}
              {/* ===== [検証] Apple Vision OCR比較パネル =====
                  現行expo-text-extractorとの比較検証用。本番ユーザーには一切表示しない。__DEV__ビルドでのみ表示・操作可能。
                  新OCR結果はここでのみ保持し、本番のonOcrResult・保存フローへは一切接続しない。 */}
              {__DEV__ && (
              <TouchableOpacity
                onPress={() => setShowVisionBenchmark((v) => !v)}
                style={{ padding: 8, marginTop: 6, backgroundColor: '#1a2e1a', borderRadius: 6 }}
                activeOpacity={0.8}>
                <ThemedText style={{ fontSize: 11, color: '#7ee6a8', textAlign: 'center' }}>
                  {showVisionBenchmark ? '▲ Vision OCR比較 閉じる' : '▼ Vision OCR比較 表示（開発検証用）'}
                </ThemedText>
              </TouchableOpacity>
              )}
              {__DEV__ && showVisionBenchmark && (() => {
                const monoFont = Platform.OS === 'ios' ? 'Courier New' : 'monospace';
                return (
                  <View style={{ marginTop: 4, backgroundColor: '#0d1117', borderRadius: 6, padding: 8 }}>
                    <ThemedText
                      selectable
                      style={{ fontSize: 10, color: '#e6edf3', fontFamily: monoFont, marginBottom: 6 }}>
                      {'[対象画像] ' + (ocrPreviewUri ?? '(なし・先に値札を撮影してください)')}
                    </ThemedText>

                    <TouchableOpacity
                      disabled={!ocrPreviewUri || isRunningAllBenchmarks}
                      onPress={runDefaultBenchmarkArms}
                      style={{
                        backgroundColor: !ocrPreviewUri || isRunningAllBenchmarks ? '#333' : '#0e9488',
                        borderRadius: 6,
                        paddingVertical: 8,
                        marginBottom: 8,
                        alignItems: 'center',
                      }}
                      activeOpacity={0.8}>
                      <ThemedText style={{ fontSize: 12, color: '#fff', fontWeight: '700' }}>
                        {isRunningAllBenchmarks
                          ? '実行中…（順次実行のため数十秒かかります）'
                          : 'デフォルト比較アームをまとめて実行（旧OCR + Vision8件・順次）'}
                      </ThemedText>
                    </TouchableOpacity>

                    {supportedLanguagesInfo && (
                      <ThemedText
                        selectable
                        style={{ fontSize: 10, color: '#e6edf3', fontFamily: monoFont, marginBottom: 8 }}>
                        {'[実機 supportedLanguages / accurate]\n' +
                          (supportedLanguagesInfo.errorMessage
                            ? 'エラー: ' + supportedLanguagesInfo.errorMessage
                            : JSON.stringify(supportedLanguagesInfo.languages))}
                      </ThemedText>
                    )}

                    <ThemedText style={{ fontSize: 10, color: '#8b949e', marginBottom: 4 }}>
                      デフォルト比較アーム（基準＝旧OCR + Vision新方式8件）
                    </ThemedText>
                    {DEFAULT_BENCHMARK_ARMS.map((arm) => (
                      <VisionBenchmarkArmRow
                        key={arm.id}
                        arm={arm}
                        result={benchmarkResults[arm.id]}
                        disabled={!ocrPreviewUri}
                        monoFont={monoFont}
                        onRun={() => runOneBenchmarkArm(arm)}
                      />
                    ))}

                    <ThemedText style={{ fontSize: 10, color: '#8b949e', marginTop: 10, marginBottom: 4 }}>
                      追加検証アーム（手動実行のみ・まとめて実行には含めない）
                    </ThemedText>
                    {EXTRA_BENCHMARK_ARMS.map((arm) => (
                      <VisionBenchmarkArmRow
                        key={arm.id}
                        arm={arm}
                        result={benchmarkResults[arm.id]}
                        disabled={!ocrPreviewUri}
                        monoFont={monoFont}
                        onRun={() => runOneBenchmarkArm(arm)}
                      />
                    ))}
                  </View>
                );
              })()}
              </View>
              )}

              {/* 読み取り結果（OCR）と保存確認の区切り */}
              {ocrResult != null && <View style={styles.cardDivider} />}

              {/* ===== 金額の手入力（コンパクト編集パネル） =====
                  OCR成功時はヒーロー右上の「金額を修正」で開閉。失敗・手入力主導時は既定で開く。
                  入力state（nativeAmount）・切替（switchInputMode）・計算ロジックは一切変更しない。 */}
              {manualOpen && (
                <View
                  style={styles.editPanel}
                  onLayout={(e) => { manualAdjustYRef.current = e.nativeEvent.layout.y; }}>
                  <View style={styles.editPanelHead}>
                    <ThemedText style={styles.editPanelTitle}>金額を手入力</ThemedText>
                    <View style={styles.editPanelHeadActions}>
                      {/* 数字キーボードには分かりやすい完了導線がないため、確実に見える位置に常設する */}
                      <TouchableOpacity
                        onPress={() => Keyboard.dismiss()}
                        hitSlop={8}
                        activeOpacity={0.7}>
                        <ThemedText style={styles.editPanelClose}>キーボードを閉じる</ThemedText>
                      </TouchableOpacity>
                      {ocrSuccess && (
                        <TouchableOpacity
                          onPress={() => setManualAdjustExpanded(false)}
                          hitSlop={8}
                          activeOpacity={0.7}>
                          <ThemedText style={styles.editPanelClose}>閉じる</ThemedText>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>

                  {/* 入力モード切替（JPYモードでは非表示）。失敗・手入力主導は2ボタン / OCR成功は逆換算リンク。 */}
                  {!isJpyMode && (
                    manualOpenByDefault ? (
                      <View style={styles.inputModeRow}>
                        <TouchableOpacity
                          style={[styles.inputModeBtn, !isReverse && styles.inputModeBtnActive]}
                          onPress={() => switchInputMode('TO_JPY')}
                          activeOpacity={0.75}>
                          <ThemedText style={[styles.inputModeBtnText, !isReverse && styles.inputModeBtnTextActive]}>
                            {currencyForDisplay} → JPY
                          </ThemedText>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.inputModeBtn, isReverse && styles.inputModeBtnActive]}
                          onPress={() => switchInputMode('FROM_JPY')}
                          activeOpacity={0.75}>
                          <ThemedText style={[styles.inputModeBtnText, isReverse && styles.inputModeBtnTextActive]}>
                            JPY → {currencyForDisplay}
                          </ThemedText>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={styles.reverseLink}
                        onPress={() => switchInputMode(isReverse ? 'TO_JPY' : 'FROM_JPY')}
                        hitSlop={8}
                        activeOpacity={0.7}>
                        <ThemedText style={styles.reverseLinkText}>
                          {isReverse ? `${currencyForDisplay}から入力する` : '円から入力する'}
                        </ThemedText>
                      </TouchableOpacity>
                    )
                  )}

                  {/* 金額入力（外貨/円）。記号＋数字で「読み取った値の調整」として見せる。
                      キーボードを閉じる導線はeditPanelHead内の「キーボードを閉じる」テキストボタンが主役。 */}
                  <View style={styles.inputAmountRow}>
                    <ThemedText style={styles.inputCurrencySymbol}>
                      {isReverse ? '¥' : c.symbol}
                    </ThemedText>
                    <TextInput
                      ref={amountInputRef}
                      style={styles.inputAmountField}
                      value={nativeAmount}
                      onChangeText={setNativeAmount}
                      placeholder="0"
                      placeholderTextColor={DT.colors.textMuted}
                      keyboardType="decimal-pad"
                      selectTextOnFocus
                      returnKeyType="done"
                      onSubmitEditing={() => Keyboard.dismiss()}
                    />
                  </View>
                </View>
              )}

              {/* 保存の設定パネル（商品名・円金額・外貨金額・大きな写真プレビューはここに出さない）。
                  メモ／写真／保存先を1枚のカードにまとめ、区切り線で行を整理する。
                  メモはiOS標準の「完了」キーで閉じられるため独自バーは出さない。
                  写真は「商品写真を撮る」を直接アクション、「他から」でphotoSheet(ActionSheet)に委ねる構成。
                  state・onPress・保存ロジック・メモ編集ロジックは既存のまま、UI構造のみ作り直し。
                  onLayoutのYはmemoRowYRef（メモ欄フォーカス時のスクロール先）に保持する。 */}
              <View onLayout={(e) => { memoRowYRef.current = e.nativeEvent.layout.y; }}>
                <ThemedText style={styles.saveSettingsHeading}>保存の設定</ThemedText>

                <View style={styles.saveSettingsCard}>
                  <View style={styles.saveSettingsSection}>
                    <View style={styles.saveSettingsSectionLabelRow}>
                      <ThemedText style={styles.saveSettingsSectionLabel}>メモ</ThemedText>
                      {memo.trim().length > 0 && (
                        <TouchableOpacity
                          onPress={handleDeleteMemo}
                          hitSlop={8}
                          activeOpacity={0.6}>
                          <ThemedText style={styles.memoDeleteBtnText}>削除</ThemedText>
                        </TouchableOpacity>
                      )}
                    </View>
                    <TextInput
                      ref={memoInputRef}
                      style={styles.memoInputInline}
                      value={memo}
                      onChangeText={setMemo}
                      placeholder="メモを追加できます"
                      placeholderTextColor={DT.colors.textMuted}
                      returnKeyType="done"
                      onSubmitEditing={() => Keyboard.dismiss()}
                      onFocus={scrollToMemoInput}
                      maxLength={100}
                    />
                  </View>

                  {Platform.OS !== 'web' && (
                    <View>
                      <View style={styles.saveSettingsDivider} />
                      <View style={styles.saveSettingsSection}>
                        <View style={styles.saveSettingsSectionLabelRow}>
                          <ThemedText style={styles.saveSettingsSectionLabel}>履歴に残す写真</ThemedText>
                          {pendingPhotoUri != null && (
                            <TouchableOpacity
                              onPress={() => setExcludePhotoFromSave((v) => !v)}
                              hitSlop={8}
                              activeOpacity={0.6}>
                              <ThemedText style={styles.photoExcludeLinkText}>
                                {excludePhotoFromSave ? '写真を残す' : '写真なしで保存'}
                              </ThemedText>
                            </TouchableOpacity>
                          )}
                        </View>
                        <View style={styles.photoSettingsRow}>
                          <TouchableOpacity
                            style={styles.photoSettingsThumbWrap}
                            onPress={
                              pendingPhotoUri != null && !excludePhotoFromSave
                                ? () => setPhotoPreviewVisible(true)
                                : handleAddPhoto
                            }
                            activeOpacity={0.8}>
                            {pendingPhotoUri != null && !excludePhotoFromSave ? (
                              <Image
                                source={{ uri: pendingPhotoUri }}
                                style={styles.photoSettingsThumb}
                                contentFit="cover"
                              />
                            ) : (
                              <SymbolView
                                name={{ ios: 'photo', android: 'image', web: 'image' }}
                                tintColor={color.muted}
                                size={26}
                              />
                            )}
                          </TouchableOpacity>
                          <View style={styles.photoSettingsInfo}>
                            <ThemedText style={styles.photoSettingsRowText}>
                              {excludePhotoFromSave
                                ? '写真なしで保存します'
                                : pendingPhotoUri == null
                                  ? '写真なし'
                                  : pendingPhotoSource === 'ocr'
                                    ? 'OCR写真を保存中'
                                    : '商品写真を保存に使用中'}
                            </ThemedText>
                            {pendingPhotoUri != null && !excludePhotoFromSave && pendingPhotoSource === 'ocr' && (
                              <ThemedText style={styles.photoSettingsHint}>
                                商品写真に変更できます
                              </ThemedText>
                            )}
                          </View>
                        </View>
                        {newPhotoCandidate != null && (
                          <View style={styles.newPhotoCandidateBanner}>
                            {newPhotoCandidate.source === 'product' ? (
                              <View style={styles.newPhotoCandidateCompareRow}>
                                <View style={styles.newPhotoCandidateCompareCol}>
                                  <View style={styles.newPhotoCandidateThumbWrap}>
                                    {pendingPhotoUri != null ? (
                                      <Image
                                        source={{ uri: pendingPhotoUri }}
                                        style={styles.newPhotoCandidateThumb}
                                        contentFit="cover"
                                      />
                                    ) : (
                                      <SymbolView
                                        name={{ ios: 'photo', android: 'image', web: 'image' }}
                                        tintColor={color.muted}
                                        size={20}
                                      />
                                    )}
                                  </View>
                                  <ThemedText style={styles.newPhotoCandidateCompareLabel}>
                                    現在の保存写真
                                  </ThemedText>
                                </View>
                                <View style={styles.newPhotoCandidateCompareCol}>
                                  <View style={styles.newPhotoCandidateThumbWrap}>
                                    <Image
                                      source={{ uri: newPhotoCandidate.uri }}
                                      style={styles.newPhotoCandidateThumb}
                                      contentFit="cover"
                                    />
                                  </View>
                                  <ThemedText style={styles.newPhotoCandidateCompareLabel}>
                                    新しく撮った商品写真
                                  </ThemedText>
                                </View>
                              </View>
                            ) : (
                              <ThemedText style={styles.newPhotoCandidateText}>
                                新しく撮った値札写真があります
                              </ThemedText>
                            )}
                            <View style={styles.photoSettingsActionsRow}>
                              {newPhotoCandidate.source === 'product' ? (
                                <>
                                  {/* サムネ表示は左:現在の保存写真／右:新しい商品写真。ボタンの左右も同じ並びに揃える */}
                                  <TouchableOpacity
                                    style={[styles.photoSettingsActionBtn, styles.photoSettingsActionBtnGhost]}
                                    onPress={handleKeepCurrentPhoto}
                                    activeOpacity={0.7}>
                                    <ThemedText style={styles.photoSettingsActionBtnGhostText}>
                                      現在の保存写真を使う
                                    </ThemedText>
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={styles.photoSettingsActionBtn}
                                    onPress={handleUseNewPhotoCandidate}
                                    activeOpacity={0.7}>
                                    <ThemedText style={styles.photoSettingsActionBtnText}>
                                      新しい商品写真を使う
                                    </ThemedText>
                                  </TouchableOpacity>
                                </>
                              ) : (
                                <>
                                  <TouchableOpacity
                                    style={styles.photoSettingsActionBtn}
                                    onPress={handleUseNewPhotoCandidate}
                                    activeOpacity={0.7}>
                                    <ThemedText style={styles.photoSettingsActionBtnText}>
                                      新しい写真を使う
                                    </ThemedText>
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={[styles.photoSettingsActionBtn, styles.photoSettingsActionBtnGhost]}
                                    onPress={handleKeepCurrentPhoto}
                                    activeOpacity={0.7}>
                                    <ThemedText style={styles.photoSettingsActionBtnGhostText}>
                                      今の保存写真を使う
                                    </ThemedText>
                                  </TouchableOpacity>
                                </>
                              )}
                            </View>
                          </View>
                        )}
                        <View style={styles.photoSettingsActionsRow}>
                          <TouchableOpacity
                            style={styles.photoSettingsActionBtn}
                            onPress={handleTakeProductPhoto}
                            activeOpacity={0.7}>
                            <ThemedText style={styles.photoSettingsActionBtnText}>
                              商品写真を撮る
                            </ThemedText>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.photoSettingsActionBtn, styles.photoSettingsActionBtnGhost]}
                            onPress={handleChangePhoto}
                            activeOpacity={0.7}>
                            <ThemedText style={styles.photoSettingsActionBtnGhostText}>他から</ThemedText>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  )}

                  <View style={styles.saveSettingsDivider} />

                  <View style={styles.saveSettingsSection}>
                    <ThemedText style={styles.saveSettingsSectionLabel}>保存先</ThemedText>
                    <View style={styles.saveTargetSegment}>
                      <TouchableOpacity
                        style={[
                          styles.saveTargetSegmentBtn,
                          !saveAsPurchased && styles.saveTargetSegmentBtnCandidateActive,
                        ]}
                        onPress={() => setSaveAsPurchased(false)}
                        activeOpacity={0.8}>
                        <ThemedText
                          style={[
                            styles.saveTargetSegmentText,
                            !saveAsPurchased && styles.saveTargetSegmentTextCandidateActive,
                          ]}>
                          候補として残す
                        </ThemedText>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.saveTargetSegmentBtn,
                          saveAsPurchased && styles.saveTargetSegmentBtnPurchasedActive,
                        ]}
                        onPress={() => setSaveAsPurchased(true)}
                        activeOpacity={0.8}>
                        <ThemedText
                          style={[
                            styles.saveTargetSegmentText,
                            saveAsPurchased && styles.saveTargetSegmentTextPurchasedActive,
                          ]}>
                          購入済みにする
                        </ThemedText>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </View>

              {/* 読み取った文字（折りたたみ・全文コピーはここに）。確認用のため保存導線より下に置く。 */}
              {!isWeb && ocrResult != null && (
                <View>
                  <TouchableOpacity
                    style={styles.ocrRawToggle}
                    onPress={() => setOcrRawExpanded((v) => !v)}
                    activeOpacity={0.7}>
                    <ThemedText style={styles.ocrRawToggleText}>
                      {ocrRawExpanded ? '▾ 読み取った文字（全文）' : '▸ 読み取った文字（全文）'}
                    </ThemedText>
                  </TouchableOpacity>
                  {ocrRawExpanded && (
                    <View style={styles.ocrSection}>
                      <ThemedText style={styles.ocrRawText} selectable>
                        {ocrResult.raw || 'テキストなし'}
                      </ThemedText>
                      <TouchableOpacity
                        style={styles.ocrCopyBtn}
                        onPress={handleCopyRawToMemo}
                        activeOpacity={0.75}>
                        <ThemedText style={styles.ocrCopyBtnText}>
                          全文をメモにコピー
                        </ThemedText>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}

              {/* 保存上限（無料版）。初回MVPは上限を露出しないためSHOW_PROで非表示（P0-03） */}
              {SHOW_PRO && !isPro && totalCount >= NEAR_SAVE_LIMIT && (
                <SaveLimitBanner currentCount={totalCount} isPro={isPro} />
              )}

              {/* 保存ボタン（カードの主役アクション）。
                  OCR成功時は固定フッターへ移すため、ここでは非表示（重複回避）。 */}
              {!showFooter && (
                <PrimaryButton
                  title={
                    canSave
                      ? `${formatJpy(Math.round(jpyAmount))} を${saveAsPurchased ? '購入済みで' : '候補に'}保存`
                      : saveAsPurchased
                        ? '購入済みとして保存'
                        : '買い物候補に保存'
                  }
                  onPress={handleSaveCandidate}
                  disabled={saveDisabled}
                />
              )}

              {/* 保存しないで次を撮る（v2 secondary・撮影に戻る）。
                  固定フッター表示時はフッター内に置くため、ここでは非表示。 */}
              {ocrResult != null && !showFooter && (
                <TouchableOpacity
                  style={styles.nextShotBtn}
                  onPress={handleRescan}
                  activeOpacity={0.7}>
                  <ThemedText style={styles.nextShotText}>保存しないで次を撮る →</ThemedText>
                </TouchableOpacity>
              )}
            </SectionCard>
            </View>
            )}

            {/* 下部：小さな予算サマリー ＋ 手入力サブ導線（撮影前のみ。結果パネル表示中は隠す）。
                横1列のコンパクトバー（見本準拠）。カード化はせず、テキストのみで構成する。 */}
            {activeTrip && !showInputCard && (
              <View style={styles.bottomSummary}>
                <View style={styles.bottomSummaryLeft}>
                  <ThemedText style={styles.bottomSummaryText} numberOfLines={1}>
                    残り{' '}
                    <ThemedText style={styles.bottomSummaryValue}>
                      {tripBudgetJpy > 0 ? formatJpy(stats.remainingBudget) : '—'}
                    </ThemedText>
                  </ThemedText>
                  <ThemedText style={styles.bottomSummarySep}>|</ThemedText>
                  <ThemedText style={styles.bottomSummaryText} numberOfLines={1}>
                    今日{' '}
                    <ThemedText style={styles.bottomSummaryValue}>{todayCount}件</ThemedText>
                  </ThemedText>
                </View>
                <TouchableOpacity onPress={openManualInput} hitSlop={8} activeOpacity={0.7}>
                  <ThemedText style={styles.bottomSummaryAction} numberOfLines={1}>
                    ✎ 手入力で記録
                  </ThemedText>
                </TouchableOpacity>
              </View>
            )}

          </View>
        </ScrollView>
      </SafeAreaView>

      {/* 価格OCR・結果確認中のみ表示する画面下固定の保存フッター（縦長緩和）。
          下タブの上に収まる位置。価格未選択でも消さず保存ボタンだけ disabled。保存処理は既存ハンドラを呼ぶだけ。 */}
      {showFooter && (
        <View style={styles.saveFooter}>
          <PrimaryButton
            title={
              canSave
                ? `${formatJpy(Math.round(jpyAmount))} を${saveAsPurchased ? '購入済みで' : '候補に'}保存`
                : saveAsPurchased
                  ? '購入済みとして保存'
                  : '買い物候補に保存'
            }
            onPress={handleSaveCandidate}
            disabled={saveDisabled}
          />
          {ocrResult != null && (
            <TouchableOpacity
              style={styles.footerNextShot}
              onPress={handleRescan}
              activeOpacity={0.7}>
              <ThemedText style={styles.footerNextShotText}>保存しないで次を撮る →</ThemedText>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* 保存写真プレビュー */}
      {pendingPhotoUri != null && Platform.OS !== 'web' && (
        <Modal
          visible={photoPreviewVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setPhotoPreviewVisible(false)}>
          <View style={styles.photoPreviewOverlay}>
            <ScrollView
              key={photoPreviewVisible ? 'preview-open' : 'preview-closed'}
              style={styles.photoPreviewScroll}
              contentContainerStyle={styles.photoPreviewScrollContent}
              minimumZoomScale={1}
              maximumZoomScale={3}
              centerContent
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}>
              <Image
                source={{ uri: pendingPhotoUri }}
                style={styles.photoPreviewImage}
                contentFit="contain"
              />
            </ScrollView>
            <TouchableOpacity
              style={styles.photoPreviewCloseBtn}
              onPress={() => setPhotoPreviewVisible(false)}
              activeOpacity={0.75}>
              <ThemedText style={styles.photoPreviewCloseBtnText}>閉じる</ThemedText>
            </TouchableOpacity>
          </View>
        </Modal>
      )}

      {/* 読み取った値札の拡大表示（OCR確認用・contain・暗背景）。
          ※ピンチズーム/ドラッグは将来TODO。今回は contain 表示と閉じる導線のみ。 */}
      {ocrPreviewUri != null && Platform.OS !== 'web' && (
        <Modal
          visible={ocrPhotoZoomVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setOcrPhotoZoomVisible(false)}>
          <View style={styles.photoPreviewOverlay}>
            <ScrollView
              key={ocrPhotoZoomVisible ? 'ocr-zoom-open' : 'ocr-zoom-closed'}
              style={styles.photoPreviewScroll}
              contentContainerStyle={styles.photoPreviewScrollContent}
              minimumZoomScale={1}
              maximumZoomScale={3}
              centerContent
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}>
              <Image
                source={{ uri: ocrPreviewUri }}
                style={styles.photoPreviewImage}
                contentFit="contain"
              />
            </ScrollView>
            <TouchableOpacity
              style={styles.photoPreviewCloseBtn}
              onPress={() => setOcrPhotoZoomVisible(false)}
              activeOpacity={0.75}>
              <ThemedText style={styles.photoPreviewCloseBtnText}>閉じる</ThemedText>
            </TouchableOpacity>
          </View>
        </Modal>
      )}

      {/* 保存写真アクションシート（メイン画面・Alert置換）。
          閉じている時は描画しない＝透明Modal/backdropがタップを奪わないようにする。 */}
      {photoSheetVisible && (
      <ActionSheet visible={photoSheetVisible} onClose={() => setPhotoSheetVisible(false)}>
        <View style={styles.photoSheetGrabber} />
        <ThemedText style={styles.photoSheetTitle}>保存する写真</ThemedText>
        <ThemedText style={styles.photoSheetSubtitle}>
          ライブラリの写真や値札写真に切り替えられます。
        </ThemedText>
        <View style={styles.photoSheetList}>
          <TouchableOpacity
            style={styles.photoSheetRow}
            onPress={() => closeSheetThen(handlePickPhotoFromLibrary)}
            activeOpacity={0.7}>
            <ThemedText style={styles.photoSheetRowText}>ライブラリから選ぶ</ThemedText>
          </TouchableOpacity>
          {ocrPhotoUri != null && (
            <TouchableOpacity
              style={styles.photoSheetRow}
              onPress={() => closeSheetThen(handleUseOcrPhoto)}
              activeOpacity={0.7}>
              <ThemedText style={styles.photoSheetRowText}>値札写真を使う</ThemedText>
            </TouchableOpacity>
          )}
          {pendingPhotoUri != null && (
            <TouchableOpacity
              style={styles.photoSheetRow}
              onPress={() => closeSheetThen(handleRemovePhoto)}
              activeOpacity={0.7}>
              <ThemedText style={styles.photoSheetRowText}>写真を外す</ThemedText>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.photoSheetRow, styles.photoSheetRowCancel]}
            onPress={() => setPhotoSheetVisible(false)}
            activeOpacity={0.7}>
            <ThemedText style={[styles.photoSheetRowText, styles.photoSheetRowTextCancel]}>
              キャンセル
            </ThemedText>
          </TouchableOpacity>
        </View>
      </ActionSheet>
      )}

      {/* 保存成功トースト（Alertではない軽量通知・1.5秒程度で自動的に消える）。
          画面のリセット・スクロールとは無関係に最前面へ固定表示する。 */}
      <Toast
        message={toastMessage}
        caption={toastCaption ?? undefined}
        onHide={hideToast}
        style={{ top: insets.top + 8 }}
      />

      <SaveLimitSheet
        visible={showSaveLimitSheet}
        onClose={() => setShowSaveLimitSheet(false)}
        onUpgrade={() => { setShowSaveLimitSheet(false); router.push('/pro'); }}
        saved={totalCount}
        limit={FREE_LIMITS.saves}
      />
    </View>
  );
}

// [検証] Vision OCR比較パネルの1アーム行。__DEV__限定。本番ビルドのUI・保存フローとは無関係。
function VisionBenchmarkArmRow({
  arm,
  result,
  disabled,
  monoFont,
  onRun,
}: {
  arm: VisionOcrBenchmarkArmDefinition;
  result: VisionOcrBenchmarkResult | undefined;
  disabled: boolean;
  monoFont: string;
  onRun: () => void;
}) {
  const status = result?.status ?? 'idle';
  const statusLabel =
    status === 'idle' ? '未実行'
    : status === 'running' ? '実行中…'
    : status === 'success' ? '成功'
    : '失敗';
  const statusColor =
    status === 'idle' ? '#8b949e'
    : status === 'running' ? '#e6c15c'
    : status === 'success' ? '#7ee6a8'
    : '#f28b82';

  const detailText = (() => {
    if (status === 'error') {
      return '[Error] ' + (result?.errorCode ? result.errorCode + ': ' : '') + (result?.errorMessage ?? '');
    }
    if (status !== 'success') return '';
    const lineConfLines =
      result?.lineConfidences && result.lineConfidences.length > 0
        ? '[LineConfidence]\n' +
          result.lineConfidences.map((l) => `${l.confidence.toFixed(2)}  ${l.text}`).join('\n')
        : '';
    return [
      '[Settings] level=' + (result?.recognitionLevel ?? '-') +
        ' correction=' + String(result?.usesLanguageCorrection) +
        ' autoDetect=' + String(result?.automaticallyDetectsLanguage) +
        ' minHeight=' + String(result?.minimumTextHeight),
      '[Languages] requested=' + JSON.stringify(result?.requestedLanguages ?? []),
      '[elapsedMs] js=' + result?.elapsedMs +
        (result?.nativeElapsedMs != null ? ' native=' + result.nativeElapsedMs.toFixed(1) : ''),
      '[FullText]\n' + (result?.fullText || '(空)'),
      '[PriceCandidates] ' + JSON.stringify(result?.priceCandidates ?? []),
      '[MemoLines] ' + JSON.stringify(result?.memoLines ?? []),
      lineConfLines,
    ].filter(Boolean).join('\n\n');
  })();

  return (
    <View style={{ marginBottom: 8, borderTopWidth: 1, borderTopColor: '#21262d', paddingTop: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <ThemedText style={{ fontSize: 11, color: '#e6edf3', flex: 1 }} numberOfLines={1}>
          {arm.label}
        </ThemedText>
        <ThemedText style={{ fontSize: 10, color: statusColor, marginRight: 8 }}>{statusLabel}</ThemedText>
        <TouchableOpacity
          disabled={disabled || status === 'running'}
          onPress={onRun}
          style={{
            backgroundColor: disabled || status === 'running' ? '#333' : '#30363d',
            borderRadius: 4,
            paddingHorizontal: 8,
            paddingVertical: 4,
          }}
          activeOpacity={0.75}>
          <ThemedText style={{ fontSize: 10, color: '#fff' }}>実行</ThemedText>
        </TouchableOpacity>
      </View>
      {arm.note && (
        <ThemedText style={{ fontSize: 9, color: '#8b949e', marginTop: 2 }}>{arm.note}</ThemedText>
      )}
      {detailText.length > 0 && (
        <ScrollView
          nestedScrollEnabled
          style={{ maxHeight: 160, marginTop: 4, backgroundColor: '#0a0c10', borderRadius: 4 }}>
          <ThemedText
            selectable
            style={{ fontSize: 9, color: '#e6edf3', fontFamily: monoFont, padding: 6, lineHeight: 13 }}>
            {detailText}
          </ThemedText>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.bgScreen, // v2 地色（#F4F6F5）
  },
  safe: { flex: 1 },
  scrollView: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingTop: 10,
    // 手入力時、下部の保存ボタンが下タブ/ホームインジケータに隠れないための余白。
    // 64だと下タブの実高さを下回り、保存ボタンが隠れてスクロールでも逃げ場がなかったため引き上げた。
    paddingBottom: 120,
    paddingHorizontal: 15, // v2 基準の画面左右余白
  },
  scrollWithFooter: {
    paddingBottom: 150, // 固定フッター（保存CTA＋次を撮る）に隠れないための余白
  },
  container: {
    width: '100%',
    maxWidth: 430,
    alignSelf: 'center',
    gap: 14,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingTop: 8, // v2 ヘッダー上余白
  },
  headerTripName: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: color.text,
    letterSpacing: -0.3,
  },
  rateChip: {
    maxWidth: '60%',
    backgroundColor: color.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  rateChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  rateChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: color.primaryDark,
    fontVariant: ['tabular-nums'],
  },
  modeSegment: {
    flexDirection: 'row',
    backgroundColor: color.line2,
    borderRadius: radius.chip,
    padding: 3,
    gap: 3,
  },
  modeSegmentBtn: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: DT.radius.sm,
  },
  modeSegmentBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  modeSegmentBtnActive: {
    backgroundColor: color.card,
    shadowColor: '#10211F',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  modeSegmentText: {
    fontSize: 14,
    fontWeight: '600',
    color: color.muted,
  },
  modeSegmentTextActive: {
    color: color.text,
    fontWeight: '700',
  },
  // 撮影後の「読み取った値札」静止プレビュー（OCR確認用・指でドラッグ可・保存写真とは別）
  ocrPhotoPreview: {
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.card,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  ocrPhotoPreviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
  },
  ocrPhotoPreviewLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: color.muted,
  },
  ocrPhotoPreviewActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  ocrPhotoPreviewZoom: {
    fontSize: 13,
    fontWeight: '700',
    color: color.primary,
  },
  ocrPhotoPreviewFrame: {
    height: OCR_PHOTO_PREVIEW_FRAME_HEIGHT, // 横長コンパクト（従来200→150→110）。拡大で全体確認できるため低めでOK。戻す場合はここを調整。
    borderRadius: radius.chip,
    overflow: 'hidden',
    backgroundColor: '#111',
    position: 'relative',
  },
  ocrPhotoPreviewScrollContent: {
    // 画像が枠より小さいときは中央、大きいときは縦スクロールで全体を確認
    minHeight: '100%',
    justifyContent: 'center',
  },
  ocrPhotoPreviewImg: {
    width: '100%',
    // 高さは aspectRatio（実寸比）で決まる。枠より高ければ縦スクロールで上下を見渡せる。
  },
  ocrPhotoPreviewRescan: {
    fontSize: 13,
    fontWeight: '700',
    color: color.primary,
  },
  // 商品写真モード（captureMode==='photo'）のパネル
  productPanel: {
    gap: spacing.md,
  },
  productPurposeBanner: {
    flexDirection: 'row',
    backgroundColor: color.candidateSoft2,
    borderWidth: 1,
    borderColor: color.candidateBorder,
    borderRadius: radius.chip,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  productPurposeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
    color: color.candidateText,
  },
  productShutterBtn: {
    height: 52,
    borderRadius: radius.button,
    backgroundColor: color.productShutter, // チャコール（teal CTAと区別・純黒不可）
    alignItems: 'center',
    justifyContent: 'center',
    // 弱い影（CTAグローは使わない）
    shadowColor: '#10211F',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 3,
  },
  productShutterText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },

  ocrCard: {
    gap: spacing.md,
  },
  // OCR結果＋保存を1枚にまとめた結果パネル
  resultPanel: {
    gap: 10,
  },
  // ヒーロー右上の「✎ 金額を修正」（手入力パネルの開閉）
  heroEditLink: {
    position: 'absolute',
    top: 0,
    right: 0,
    zIndex: 2,
    paddingVertical: 2,
    paddingLeft: 8,
  },
  heroEditLinkText: {
    fontSize: 13,
    fontWeight: '700',
    color: color.primary,
  },
  // 円換算ヒーロー（パネル最上部の主役）＋ 残予算pill
  heroBlock: {
    gap: 6,
    position: 'relative',
    marginBottom: -6,
  },
  heroJpy: {
    alignItems: 'flex-start',
  },
  heroJpyLabel: {
    ...typography.overline,
    color: color.muted,
    marginBottom: spacing.xs,
  },
  // 円価格（主役・左）とレート補足情報（右端）を分ける。alignSelf:'stretch'でヒーロー全幅を確保し、
  // justifyContent:'space-between'で右端へ逃がす（stretchがないとrowが内容幅にしか広がらず右に逃げない）
  heroValueRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
  },
  heroJpyValue: {
    fontSize: 44,
    lineHeight: 46,
    fontWeight: '700',
    letterSpacing: -1.6,
    color: color.text,
    fontVariant: ['tabular-nums'],
  },
  // 小さい金額用：外貨額・レートの2行を右端でまとめる（主役の円価格と窮屈に並べない）
  heroRateSubWrap: {
    alignItems: 'flex-end',
    flexShrink: 1,
    paddingLeft: 12,
    paddingBottom: 2,
  },
  heroRateSub: {
    fontSize: 13,
    fontWeight: '500',
    color: color.muted,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  // 大きい金額用：外貨額＋レートを1行にまとめ、縦を無駄に使わない
  heroRateSubInline: {
    fontSize: 13,
    fontWeight: '500',
    color: color.muted,
    paddingLeft: 12,
    paddingBottom: 2,
    fontVariant: ['tabular-nums'],
  },
  heroPlaceholderValue: {
    fontSize: 44,
    lineHeight: 46,
    fontWeight: '700',
    color: color.faint2,
    letterSpacing: -1.6,
  },
  heroPlaceholderHint: {
    fontSize: 12,
    fontWeight: '500',
    color: color.muted,
    marginTop: 2,
  },
  budgetPill: {
    alignSelf: 'flex-start',
    backgroundColor: color.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  budgetPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: color.primaryDark,
    fontVariant: ['tabular-nums'],
  },
  // 金額の手入力（コンパクト編集パネル）。淡背景の囲みで「フォーム」ではなく「調整パネル」に見せる
  editPanel: {
    backgroundColor: color.bgScreen,
    borderRadius: radius.chip,
    padding: spacing.md,
    gap: spacing.sm,
  },
  editPanelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  editPanelTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: color.muted,
    letterSpacing: 0.4,
  },
  // 「キーボードを閉じる」「閉じる」を並べる（両方出る場合のみ間隔をあける）
  editPanelHeadActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  editPanelClose: {
    fontSize: 12.5,
    fontWeight: '700',
    color: color.primary,
  },
  // OCR成功時の逆換算への補助リンク（円から入力する / 外貨から入力する）
  reverseLink: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  reverseLinkText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: color.primary,
  },
  // OCR成功時の画面下固定 保存フッター
  saveFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: color.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
    paddingHorizontal: 15,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 4,
    ...shadow.card,
  },
  footerNextShot: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  footerNextShotText: {
    fontSize: 13,
    fontWeight: '700',
    color: color.body,
  },
  nextShotBtn: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  nextShotText: {
    fontSize: 13,
    fontWeight: '700',
    color: color.body,
  },
  ocrSectionWrap: {
    gap: 4,
  },
  ocrSection: {
    gap: 6,
  },
  ocrSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: color.muted,
    letterSpacing: 0.5,
  },
  ocrSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  // 見出しラベル＋畳んだ時のサブ情報（選択中の金額／追加済み件数）
  ocrSectionLabelGroup: {
    flex: 1,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  // 「さらに◯件」と「閉じる／候補を見る」を並べる
  ocrSectionActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  ocrSectionMore: {
    fontSize: 12,
    fontWeight: '700',
    color: color.primary,
  },
  ocrPriceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: -4,
  },
  // 価格候補カード：未選択＝白地+薄いグレー枠、選択中＝淡いミント地+ティール枠+チェック（塗りつぶしは使わない）
  priceCard: {
    flexBasis: '31%',
    flexGrow: 0,
    alignItems: 'center',
    backgroundColor: color.card,
    borderRadius: radius.chip,
    borderWidth: 1.5,
    borderColor: color.line,
    paddingVertical: 6,
    paddingHorizontal: 8,
    gap: 2,
  },
  priceCardSelected: {
    backgroundColor: color.primarySoft,
    borderColor: color.primary,
  },
  priceCardForeign: {
    color: color.text,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  priceCardForeignSelected: {
    color: color.primaryDark,
  },
  priceCardJpy: {
    color: color.body,
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  priceCardJpySelected: {
    color: color.primaryDark,
  },
  // 価格候補を閉じている時の「選択中ボックス」。保存ボタン(primary/teal)と区別するため青系で統一する
  priceSelectedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: '#EAF4FF',
    borderRadius: radius.chip,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  priceSelectedBoxLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1C6EA6',
  },
  priceSelectedBoxValue: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#1C6EA6',
    fontVariant: ['tabular-nums'],
  },
  ocrFailBlock: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
  },
  ocrFailIconWrap: {
    width: 56,
    height: 56,
    borderRadius: radius.card,
    backgroundColor: color.candidateSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ocrFailIcon: {
    fontSize: 24,
  },
  ocrFailTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: color.text,
    textAlign: 'center',
  },
  ocrFailDesc: {
    fontSize: 12.5,
    lineHeight: 19,
    fontWeight: '500',
    color: color.muted,
    textAlign: 'center',
  },
  ocrFailPrimary: {
    alignSelf: 'stretch',
    marginTop: spacing.xs,
  },
  ocrFailSubRow: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    gap: spacing.sm,
  },
  ocrFailSubBtn: {
    flex: 1,
  },
  // メモ候補（横並びチップ）。未選択＝淡teal地に＋、選択済み＝濃teal地に白文字✓。価格候補カードと同系統の見せ方
  // alignItems: 'flex-start' … 訳文付き（2段）と原文のみ（1段）のチップが同じ行に並んでも、
  // 1段側が2段側の高さへ引き伸ばされないようにする
  ocrMemoChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: 8,
  },
  memoChip: {
    maxWidth: '70%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.chip,
    backgroundColor: color.primarySoft,
    borderWidth: 1,
    borderColor: color.primaryBorder,
  },
  memoChipAdded: {
    backgroundColor: color.primaryDark,
    borderColor: color.primaryDark,
  },
  memoChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: color.primaryDark,
  },
  memoChipTextAdded: {
    color: '#fff',
  },
  // 訳文を主表示にしたときの補助行（OCR原文）。主表示より一段小さく・弱くして高さを増やしすぎない
  memoChipSubText: {
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 15,
    color: color.muted,
  },
  memoChipSubTextAdded: {
    color: color.primaryAccent,
  },
  // メモ候補を閉じている時の「追加済みメモ」ボックス（「追加済みN件」だけで終わらせず中身を見せる）
  addedMemoBox: {
    backgroundColor: color.candidateSoft,
    borderRadius: radius.chip,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  addedMemoBoxLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: color.candidateText,
  },
  addedMemoChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  addedMemoChip: {
    maxWidth: '70%',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.chip,
    backgroundColor: color.candidateStrong,
  },
  addedMemoChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  addedMemoMore: {
    fontSize: 12,
    fontWeight: '700',
    color: color.candidateText,
  },
  ocrRawToggle: {
    paddingVertical: 4,
  },
  ocrRawToggleText: {
    fontSize: 12,
    color: color.muted,
    fontWeight: '600',
  },
  ocrRawText: {
    fontSize: 12,
    color: color.body,
    lineHeight: 18,
  },
  ocrCopyBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: color.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 4,
  },
  ocrCopyBtnText: {
    fontSize: 12,
    color: color.primary,
    fontWeight: '600',
  },

  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.line2,
  },
  inputModeRow: {
    flexDirection: 'row',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: color.line,
    overflow: 'hidden',
  },
  inputModeBtn: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
  },
  inputModeBtnActive: {
    backgroundColor: color.primary,
  },
  inputModeBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: color.body,
  },
  inputModeBtnTextActive: {
    color: '#fff',
  },
  inputAmountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inputCurrencySymbol: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '700',
    color: color.text,
  },
  inputAmountField: {
    flex: 1,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: color.text,
    paddingVertical: 0,
  },
  // 保存の設定パネルの見出し（カードの外、上に置く）
  saveSettingsHeading: {
    fontSize: 12,
    fontWeight: '700',
    color: color.muted,
    letterSpacing: 0.4,
  },
  // 保存の設定カード（メモ／写真／保存先を1枚にまとめ、区切り線で行を整理する）
  saveSettingsCard: {
    backgroundColor: color.bgScreen,
    borderRadius: radius.chip,
    paddingHorizontal: spacing.md,
  },
  saveSettingsDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.line2,
  },
  saveSettingsSection: {
    paddingVertical: spacing.sm,
    gap: 6,
  },
  saveSettingsSectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  saveSettingsSectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: color.muted,
    letterSpacing: 0.4,
  },
  memoDeleteBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: color.muted,
  },
  memoInputInline: {
    fontSize: 14,
    color: color.text,
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.inputBorder,
    borderRadius: radius.chip,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  photoSettingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  photoSettingsThumbWrap: {
    width: 72,
    height: 72,
    borderRadius: radius.chip,
    backgroundColor: color.line2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoSettingsThumb: {
    width: 72,
    height: 72,
    borderRadius: radius.chip,
  },
  photoSettingsInfo: {
    flex: 1,
    gap: 4,
  },
  photoSettingsRowText: {
    fontSize: 14,
    fontWeight: '700',
    color: color.text,
  },
  photoSettingsHint: {
    fontSize: 11.5,
    fontWeight: '500',
    color: color.muted,
  },
  photoExcludeLinkText: {
    fontSize: 12,
    fontWeight: '600',
    color: color.muted,
  },
  photoSettingsActionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  photoSettingsActionBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: radius.chip,
    backgroundColor: color.primarySoft,
  },
  photoSettingsActionBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: color.primaryDark,
  },
  photoSettingsActionBtnGhost: {
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.line,
  },
  photoSettingsActionBtnGhostText: {
    fontSize: 13,
    fontWeight: '700',
    color: color.body,
  },
  newPhotoCandidateBanner: {
    backgroundColor: color.candidateSoft2,
    borderWidth: 1,
    borderColor: color.candidateBorder,
    borderRadius: radius.chip,
    padding: spacing.md,
    gap: spacing.sm,
  },
  newPhotoCandidateText: {
    fontSize: 12,
    fontWeight: '600',
    color: color.candidateText,
  },
  newPhotoCandidateCompareRow: {
    flexDirection: 'row',
    gap: 12,
  },
  newPhotoCandidateCompareCol: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  newPhotoCandidateThumbWrap: {
    width: 56,
    height: 56,
    borderRadius: radius.chip,
    backgroundColor: color.line2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  newPhotoCandidateThumb: {
    width: 56,
    height: 56,
    borderRadius: radius.chip,
  },
  newPhotoCandidateCompareLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: color.candidateText,
    textAlign: 'center',
  },

  // 横1列のコンパクトバー（カード化しない・見本準拠）。camera-stage直下の間隔も少し詰める。
  bottomSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 3,
    paddingVertical: 4,
    marginTop: -6,
  },
  bottomSummaryLeft: {
    flex: 1,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bottomSummarySep: {
    fontSize: 12,
    color: color.inputBorder,
  },
  bottomSummaryText: {
    fontSize: 12,
    fontWeight: '600',
    color: color.muted,
    fontVariant: ['tabular-nums'],
  },
  bottomSummaryValue: {
    fontSize: 12,
    fontWeight: '700',
    color: color.text,
    fontVariant: ['tabular-nums'],
  },
  bottomSummaryAction: {
    fontSize: 13,
    fontWeight: '700',
    color: color.primary,
  },

  judgmentSection: {
    gap: 10,
    alignItems: 'stretch',
  },
  // 保存先（候補/購入済みの2択を大きめセグメントで切り替える）
  saveTargetSegment: {
    flexDirection: 'row',
    backgroundColor: color.line2,
    borderRadius: radius.pill,
    padding: 4,
    gap: 4,
  },
  saveTargetSegmentBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: radius.pill,
    backgroundColor: 'transparent',
  },
  saveTargetSegmentBtnCandidateActive: {
    backgroundColor: statusColor.candidate.badgeBg,
    ...shadow.card,
  },
  saveTargetSegmentBtnPurchasedActive: {
    backgroundColor: statusColor.purchased.badgeBg,
    ...shadow.card,
  },
  saveTargetSegmentText: {
    fontSize: 14,
    fontWeight: '600',
    color: color.muted,
  },
  saveTargetSegmentTextCandidateActive: {
    color: statusColor.candidate.text,
    fontWeight: '700',
  },
  saveTargetSegmentTextPurchasedActive: {
    color: statusColor.purchased.text,
    fontWeight: '700',
  },
  // 保存内容カードの外に置く弱いテキストリンク（区切り線は付けず目立たせない）
  resetInputBtn: {
    alignSelf: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  resetInputBtnText: {
    fontSize: 11,
    fontWeight: '500',
    color: color.faint,
  },

  // 保存写真アクションシート
  photoSheetGrabber: {
    alignSelf: 'center',
    width: 38,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: color.line2,
    marginBottom: spacing.xs,
  },
  photoSheetTitle: {
    ...typography.title,
    color: color.text,
    textAlign: 'center',
  },
  photoSheetSubtitle: {
    ...typography.body,
    color: color.muted,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: spacing.md,
  },
  photoSheetList: {
    gap: spacing.sm,
  },
  photoSheetRow: {
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: color.line,
    backgroundColor: color.card,
    paddingVertical: 15,
    alignItems: 'center',
  },
  photoSheetRowCancel: {
    borderColor: color.inputBorder,
    marginTop: 2,
  },
  photoSheetRowText: {
    fontSize: 15,
    fontWeight: '700',
    color: color.text,
  },
  photoSheetRowTextCancel: {
    color: color.body,
  },

  photoPreviewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: DT.spacing.xl,
  },
  photoPreviewScroll: {
    width: '100%',
    height: '75%',
  },
  photoPreviewScrollContent: {
    flexGrow: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPreviewImage: {
    width: '100%',
    height: '100%',
  },
  photoPreviewCloseBtn: {
    marginTop: DT.spacing.xl,
    paddingHorizontal: DT.spacing.xl,
    paddingVertical: DT.spacing.sm,
    borderRadius: DT.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  photoPreviewCloseBtnText: {
    fontSize: DT.fontSize.md,
    fontWeight: DT.fontWeight.semibold,
    color: '#fff',
  },
});
