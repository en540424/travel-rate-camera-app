import { requireNativeViewManager } from 'expo-modules-core';
import * as React from 'react';

import type { LiveTextScannerNativeProps } from './LiveText.types';

/**
 * 透明なスキャナーView。**expo-cameraの`CameraView`と同じ親View（カメラ枠）の中に置くこと。**
 * native側は親Viewの中からカメラのプレビューを探し、そのsessionへ映像フレーム出力を追加する。
 */
const NativeView: React.ComponentType<LiveTextScannerNativeProps> = requireNativeViewManager('LiveText');

export function LiveTextScannerView(props: LiveTextScannerNativeProps) {
  return <NativeView {...props} />;
}
