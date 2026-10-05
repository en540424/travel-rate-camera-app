export type {
  LiveTextDetectedEvent,
  LiveTextNativeLine,
  LiveTextScannerNativeProps,
  LiveTextScannerStatus,
} from './src/LiveText.types';

/**
 * カメラ映像のリアルタイム文字認識（iOS専用・Apple Vision）。
 *
 * **このファイルはアプリ側でトップレベルimportしないこと。** Androidにはnative実体が無く、
 * `requireNativeViewManager`が読み込み時点で例外を投げるため、`@/components/live-text/LiveTextScanner`
 * 経由（iOSでのみ動的import）で使う。
 */
export { LiveTextScannerView } from './src/LiveTextScannerView';
