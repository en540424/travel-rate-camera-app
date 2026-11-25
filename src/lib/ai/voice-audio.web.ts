// Web では Pro+ の音声の通訳を提供しない（取り込み・再生の部品は iOS 用）。画面は「音声の部品が無い」と案内する。
import type { VoiceAudio } from './voice-audio.native';

export type { MicPermission, VoiceAudio } from './voice-audio.native';

export function createVoiceAudio(): VoiceAudio | null {
  return null;
}
