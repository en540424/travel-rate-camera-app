import { NativeModule, requireNativeModule } from 'expo';

import type {
  VisionOcrNativeOptions,
  VisionOcrRecognitionLevel,
  VisionOcrResult,
} from './VisionOcr.types';

declare class VisionOcrNativeModule extends NativeModule<{}> {
  recognizeText: (uri: string, options: VisionOcrNativeOptions) => Promise<VisionOcrResult>;
  getSupportedLanguages: (recognitionLevel: VisionOcrRecognitionLevel) => Promise<string[]>;
}

export default requireNativeModule<VisionOcrNativeModule>('VisionOcr');
