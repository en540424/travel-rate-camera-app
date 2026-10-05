import type { ViewProps } from 'react-native';

/** nativeが返す1行。座標は正立画像に対する0〜1の比率で、原点は「左上」（native側で変換済み）。 */
export type LiveTextNativeLine = {
  text: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LiveTextDetectedEvent = {
  lines: LiveTextNativeLine[];
  /** 正立（縦向き）にしたフレームの幅(px)。プレビューへの位置合わせに使う */
  imageWidth: number;
  imageHeight: number;
  /** 認識1回にかかった時間(ms) */
  elapsedMs: number;
  /** 認識完了時刻（epoch ms） */
  timestamp: number;
};

/**
 * - off … 無効（出力を外している）
 * - waiting … カメラの準備待ち
 * - scanning … 認識中
 * - unavailable … このカメラ構成では映像フレームを受け取れない
 */
export type LiveTextScannerStatus = 'off' | 'waiting' | 'scanning' | 'unavailable';

export type LiveTextScannerNativeProps = ViewProps & {
  enabled: boolean;
  paused: boolean;
  intervalMs: number;
  languages: string[];
  minimumTextHeight: number;
  onTextDetected?: (event: { nativeEvent: LiveTextDetectedEvent }) => void;
  onScannerStatus?: (event: { nativeEvent: { status: LiveTextScannerStatus } }) => void;
};
