import { NativeModule, registerWebModule } from 'expo';

import type {
  VisionOcrNativeOptions,
  VisionOcrRecognitionLevel,
  VisionOcrResult,
} from './VisionOcr.types';

// Apple Visionはweb未対応。通常OCR経路（CameraPreview.native.tsx）はPlatform.OS === 'ios'で、
// __DEV__比較パネルもnative限定で既にガードしているため、ここに到達するのは想定外の呼び出し時のみ。
class VisionOcrModule extends NativeModule<{}> {
  async recognizeText(_uri: string, _options: VisionOcrNativeOptions): Promise<VisionOcrResult> {
    throw new Error('VisionOcr is not supported on web.');
  }

  async getSupportedLanguages(_recognitionLevel: VisionOcrRecognitionLevel): Promise<string[]> {
    throw new Error('VisionOcr is not supported on web.');
  }
}

export default registerWebModule(VisionOcrModule, 'VisionOcrModule');
