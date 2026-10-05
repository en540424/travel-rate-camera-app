// カメラ映像のリアルタイム文字認識（iOS専用）のスキャナー。描画物を持たない透明View。
//
// **expo-cameraの`CameraView`と同じ親View（カメラ枠）の中に置くこと。** native側は親Viewの中から
// カメラのプレビューを探し、そのsessionへ映像フレーム出力を1つ追加する（撮影経路には触れない）。
//
// **このファイルはトップレベルで`modules/live-text`をimportしないこと。**
// Androidにはnative実体が無く、`requireNativeViewManager`がimport時点で例外を投げるため、
// iOSでだけ実行時に動的importで読み込む（`translation-host.tsx`と同じ規律）。
import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { Platform, StyleSheet } from 'react-native';

import type { LiveTextFrame } from '@/lib/live-text-core';
import type {
  LiveTextScannerNativeProps,
  LiveTextScannerStatus,
} from '../../../modules/live-text';

/** リアルタイム文字認識が使えるプラットフォームか（Apple Vision・iOSのみ） */
export const isLiveTextPlatformSupported = Platform.OS === 'ios';

export type { LiveTextScannerStatus };

export type LiveTextScannerProps = {
  /** falseで映像フレーム出力をsessionから外す（安全スイッチ）。カメラ準備完了前はfalseにする */
  enabled: boolean;
  /** trueの間はフレームを捨てるだけ（撮影処理中など。出力の付け外しはしない） */
  paused: boolean;
  /** Vision OCRの認識言語 */
  languages: string[];
  /** 認識の最小間隔(ms) */
  intervalMs?: number;
  /** 小さすぎる文字を無視する（画像高さに対する比率）。認識を速くする */
  minimumTextHeight?: number;
  onFrame: (frame: LiveTextFrame) => void;
  onStatusChange?: (status: LiveTextScannerStatus) => void;
};

export function LiveTextScanner({
  enabled,
  paused,
  languages,
  intervalMs = 1000,
  minimumTextHeight = 0.015,
  onFrame,
  onStatusChange,
}: LiveTextScannerProps) {
  const [Scanner, setScanner] = useState<ComponentType<LiveTextScannerNativeProps> | null>(null);

  useEffect(() => {
    if (!isLiveTextPlatformSupported) return;
    let cancelled = false;
    import('../../../modules/live-text')
      .then((m) => {
        if (!cancelled) setScanner(() => m.LiveTextScannerView);
      })
      .catch((error: unknown) => {
        if (__DEV__) console.warn('[LiveText] スキャナーを読み込めませんでした', error);
        if (!cancelled) onStatusChange?.('unavailable');
      });
    return () => {
      cancelled = true;
    };
    // 読み込みはマウント時の1回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (Scanner == null) return null;

  return (
    <Scanner
      style={styles.scanner}
      pointerEvents="none"
      enabled={enabled}
      paused={paused}
      intervalMs={intervalMs}
      languages={languages}
      minimumTextHeight={minimumTextHeight}
      onTextDetected={(event) => {
        const { lines, imageWidth, imageHeight, timestamp } = event.nativeEvent;
        onFrame({
          lines: lines.map((line) => ({
            text: line.text,
            confidence: line.confidence,
            box: { x: line.x, y: line.y, width: line.width, height: line.height },
          })),
          imageWidth,
          imageHeight,
          timestamp,
        });
      }}
      onScannerStatus={(event) => onStatusChange?.(event.nativeEvent.status)}
    />
  );
}

const styles = StyleSheet.create({
  // レイアウトへ影響させないため絶対配置。描画物を持たないViewなので見た目にも出ない
  scanner: { position: 'absolute', top: 0, left: 0, width: 1, height: 1, opacity: 0 },
});
