/**
 * リアルタイム文字認識の結果を「表示できる状態」へまとめるhook群。
 * メインカメラ（スマートカメラ）と翻訳ページのカメラ翻訳で共有する。
 *
 * - `useLiveTextFrames` … nativeから届くフレーム（約1秒ごと）をフレーム間で追跡し、表示を安定させる
 * - `useSceneTranslationQueue` … 表示したい文字列を、同時に1要求までの単一キューで翻訳する
 *
 * 毎フレーム翻訳はしない。翻訳済みの文字はcacheから引き、新しく見えた文字だけを送る。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  DEFAULT_TRACKER_OPTIONS,
  canAutoTranslate,
  nextPairStatus,
  planTranslationRequests,
  updateTrackedLines,
  type LiveTextFrame,
  type PairEvent,
  type PairStatus,
  type Size,
  type TrackedLine,
  type TranslationPlanItem,
} from '@/lib/live-text-core';
import {
  getCachedSceneTranslation,
  getScenePairAvailability,
  hasCachedSceneTranslation,
  isSceneTranslationSupported,
  translateSceneTexts,
} from '@/lib/scene-translation-service';

// MARK: - フレームの追跡

export function useLiveTextFrames(active: boolean) {
  const [state, setState] = useState<{ tracked: TrackedLine[]; frameSize: Size | null }>({
    tracked: [],
    frameSize: null,
  });
  const trackedRef = useRef<TrackedLine[]>([]);
  const activeRef = useRef(active);

  // 無効になった時点で前回の表示を捨てる（再開直後に古い文字が一瞬出ないように）。
  // effectではなく「前回の値と比べてレンダー中に調整する」Reactの推奨パターンで行う
  const [prevActive, setPrevActive] = useState(active);
  if (prevActive !== active) {
    setPrevActive(active);
    if (!active) setState({ tracked: [], frameSize: null });
  }

  useEffect(() => {
    activeRef.current = active;
    if (!active) trackedRef.current = [];
  }, [active]);

  const onFrame = useCallback((frame: LiveTextFrame) => {
    if (!activeRef.current) return;
    const next = updateTrackedLines(trackedRef.current, frame.lines, frame.timestamp, DEFAULT_TRACKER_OPTIONS);
    trackedRef.current = next;
    setState({ tracked: next, frameSize: { width: frame.imageWidth, height: frame.imageHeight } });
  }, []);

  // 無効の間は何も出さない（effect内でsetStateせず、出力側で畳む）
  return {
    tracked: active ? state.tracked : [],
    frameSize: active ? state.frameSize : null,
    onFrame,
  };
}

// MARK: - 翻訳キュー

/** 1要求あたりの最大件数（新しく見えた文字を数件ずつ、中央に近い順に送る） */
const MAX_TEXTS_PER_REQUEST = 8;
/** ホストView登録待ちなどの一時的な失敗から自動で再試行するまでの時間(ms) */
const TRANSIENT_RETRY_MS = 1000;

export type SceneTranslationNotice = {
  sourceLanguage: string;
  status: Extract<PairStatus, 'needs_download' | 'failed' | 'unsupported'>;
};

/**
 * 表示したい文字列（優先度順）を翻訳する。
 *
 * - 同時に1要求まで。処理中に新しい文字が来たら、終わってから最新の状態でもう一度計画する
 * - 未導入（翻訳データDLが必要）・失敗した言語ペアには自動で送らない（DL案内の繰り返し防止）。
 *   `activate(source)`（利用者のボタン操作）で1回だけ送り直す
 * - 結果はcache（`scene-translation-service.ts`）に入り、`lookup`で描画時に引く
 */
export function useSceneTranslationQueue({
  enabled,
  targetLanguage,
  items,
}: {
  enabled: boolean;
  targetLanguage: string;
  items: readonly TranslationPlanItem[];
}) {
  const [pairStatus, setPairStatus] = useState<Record<string, PairStatus>>({});
  const [version, setVersion] = useState(0);
  const [supported, setSupported] = useState<boolean | null>(null);

  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const checkingPairsRef = useRef(new Set<string>());
  const latestRef = useRef({ enabled, targetLanguage, items, pairStatus, supported });

  useEffect(() => {
    latestRef.current = { enabled, targetLanguage, items, pairStatus, supported };
  });

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    void isSceneTranslationSupported().then((value) => {
      if (!cancelled) setSupported(value);
    });
    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, []);

  const pairKey = useCallback((source: string, target: string) => `${source}>${target}`, []);

  const applyPairEvent = useCallback(
    (source: string, target: string, event: PairEvent) => {
      if (!mountedRef.current) return;
      const key = pairKey(source, target);
      setPairStatus((prev) => ({ ...prev, [key]: nextPairStatus(prev[key] ?? 'unknown', event) }));
    },
    [pairKey],
  );

  const pump = useCallback(async () => {
    if (inFlightRef.current) return;
    const { enabled: isEnabled, targetLanguage: target, items: currentItems, pairStatus: statuses, supported: isSupported } =
      latestRef.current;
    if (!isEnabled || isSupported !== true) return;

    const plans = planTranslationRequests(
      currentItems,
      (source, text) => hasCachedSceneTranslation(source, target, text),
      (source) => !canAutoTranslate(statuses[pairKey(source, target)] ?? 'unknown'),
      MAX_TEXTS_PER_REQUEST,
    );
    const plan = plans[0];
    if (!plan) return;

    const key = pairKey(plan.sourceLanguage, target);
    inFlightRef.current = true;
    // 終わったらすぐ次を計画するか。ホストView待ちの時だけは少し待ってから再計画する（連打しない）
    let replanImmediately = true;
    try {
      // 初めての言語ペアは導入状態を先に確認する（未導入なら自動送信せずボタンを出す）
      if ((statuses[key] ?? 'unknown') === 'unknown' && !checkingPairsRef.current.has(key)) {
        checkingPairsRef.current.add(key);
        const availability = await getScenePairAvailability(plan.sourceLanguage, target);
        if (availability === 'supported') {
          applyPairEvent(plan.sourceLanguage, target, 'availability_supported');
          return;
        }
        if (availability === 'unsupported') {
          applyPairEvent(plan.sourceLanguage, target, 'availability_unsupported');
          return;
        }
        if (availability === 'installed') {
          applyPairEvent(plan.sourceLanguage, target, 'availability_installed');
        }
      }

      const result = await translateSceneTexts({
        texts: plan.texts,
        sourceLanguage: plan.sourceLanguage,
        targetLanguage: target,
      });
      if (!mountedRef.current) return;

      if (result.status === 'done') {
        applyPairEvent(plan.sourceLanguage, target, 'translate_succeeded');
      } else if (result.status === 'unavailable') {
        if (result.errorCode === 'unsupported_os') {
          setSupported(false);
        } else {
          applyPairEvent(plan.sourceLanguage, target, 'translate_unavailable');
        }
      } else if (result.status === 'cancelled') {
        // 別の要求に押し出された等。すぐ再送を繰り返さず、少し待ってから再計画する
        replanImmediately = false;
        setTimeout(() => {
          if (mountedRef.current) setVersion((value) => value + 1);
        }, TRANSIENT_RETRY_MS);
      } else if (result.status === 'failed') {
        if (result.errorCode === 'host_unavailable') {
          // 画面復帰直後などホストViewの登録待ち。少し待って自動で再計画する
          replanImmediately = false;
          setTimeout(() => {
            if (mountedRef.current) setVersion((value) => value + 1);
          }, TRANSIENT_RETRY_MS);
        } else {
          applyPairEvent(plan.sourceLanguage, target, 'translate_failed');
        }
      }
    } finally {
      inFlightRef.current = false;
      if (replanImmediately && mountedRef.current) setVersion((value) => value + 1);
    }
  }, [applyPairEvent, pairKey]);

  const itemsKey = JSON.stringify(items);

  useEffect(() => {
    if (!enabled) return;
    void pump();
  }, [enabled, itemsKey, pairStatus, supported, targetLanguage, version, pump]);

  /** 訳文（未翻訳ならundefined）。`version`の更新で再描画され、cacheから最新を引く */
  const lookup = useCallback(
    (sourceLanguage: string | null, text: string): string | undefined =>
      sourceLanguage == null ? undefined : getCachedSceneTranslation(sourceLanguage, targetLanguage, text),
    // versionが変わるたびに参照を変え、利用側のmemoを無効化する
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetLanguage, version],
  );

  /** 未導入・失敗で止めている言語ペアのうち、いま画面に必要なもの（最初の1件） */
  let notice: SceneTranslationNotice | null = null;
  if (enabled && supported === true) {
    for (const item of items) {
      if (item.sourceLanguage == null) continue;
      const status = pairStatus[pairKey(item.sourceLanguage, targetLanguage)];
      if (status === 'needs_download' || status === 'failed' || status === 'unsupported') {
        notice = { sourceLanguage: item.sourceLanguage, status };
        break;
      }
    }
  }

  /** 利用者のボタン操作で、止めていた言語ペアへ1回だけ送り直す（未導入ならApple標準のDL案内が出る） */
  const activate = useCallback(
    (sourceLanguage: string) => {
      const key = pairKey(sourceLanguage, targetLanguage);
      checkingPairsRef.current.add(key);
      setPairStatus((prev) => ({ ...prev, [key]: 'ready' }));
    },
    [pairKey, targetLanguage],
  );

  return { lookup, notice, activate, translationSupported: supported };
}
