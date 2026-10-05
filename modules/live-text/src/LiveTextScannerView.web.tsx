import type { LiveTextScannerNativeProps } from './LiveText.types';

// Apple Visionはweb未対応。呼び出し側はiOSでしか読み込まないが、念のため何も描画しない。
export function LiveTextScannerView(_props: LiveTextScannerNativeProps) {
  return null;
}
