/**
 * Pro+ リアルタイム音声の端末の入出力（iOS・react-native-audio-api 1.0.1）。変換の規則は voice-pcm-core.ts（純粋・試験済み）。
 *
 * - 取り込み：AudioRecorder の onAudioReady（float・実際のサンプルレート）→ 16kHz の int16 の 100ms 区画（UplinkEncoder）
 * - 再生：AudioContext（24kHz）の AudioBufferQueueSourceNode に訳の音声を積む。start は1回で、空のキューは待機して再利用する。
 *   再生の停止は clearBuffers（ソースは再利用できる）。再生の完了は onbufferended の isLastBufferInQueue と再生の時計で判定する
 * - 音声の経路：iOS の playAndRecord・voiceChat・スピーカー（defaultToSpeaker）。iosVoiceProcessing（端末のエコー対策）を使う。
 *   **エコーの抑えは端末・音量・部屋で変わる**（公式の注意）。半二重（再生中はマイクの音声を送らない）は画面の設定で切り替える
 * - バックグラウンドでは録音しない（config plugin の iosBackgroundMode を false にしている。画面がバックグラウンドで止める）
 *
 * **実機での動作（取り込み・再生・エコー・既存の音声入力 expo-speech-recognition・読み上げ expo-speech・ライブ翻訳のカメラとの
 * 音声セッションの共存）は未確認。** ライブラリは必要になった時にだけ読み込む（native 実体の無いビルドで読み込んでも落ちない）。
 */
import { DownlinkDecoder, OUTPUT_SAMPLE_RATE, outputMsOf, PlaybackClock, UplinkEncoder } from './voice-pcm-core';

export type MicPermission = 'granted' | 'denied' | 'undetermined';

export type VoiceAudio = {
  /** マイクの許可を確かめ、未決定なら求める */
  requestPermission(): Promise<MicPermission>;
  /** 取り込みを始める。区画（32 バイトの倍数）ごとに onFrame。開けなければ false */
  startCapture(onFrame: (frame: Uint8Array) => void): Promise<boolean>;
  stopCapture(): Promise<void>;
  /** 送れない間（再接続中・半二重で再生中）：取り込み中の端数を捨てる */
  discardPending(): void;
  /** 訳の音声（24kHz の int16 LE）を再生のキューへ積む */
  play(chunk: Uint8Array): void;
  /** 再生を止め、積んだ分を捨てる */
  stopPlayback(): void;
  isPlaying(): boolean;
  /** 再生の状態が変わった時 */
  onPlaybackChange(fn: (playing: boolean) => void): void;
  /** 取り込み・再生・音声セッションを片付ける */
  dispose(): Promise<void>;
};

type AudioApi = typeof import('react-native-audio-api');

function loadAudioApi(): AudioApi | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-audio-api') as AudioApi;
  } catch {
    return null;
  }
}

/** 部品が使えなければ null（画面は「音声の部品が無い」と案内する） */
export function createVoiceAudio(): VoiceAudio | null {
  const api = loadAudioApi();
  if (!api) return null;
  let ctx: InstanceType<AudioApi['AudioContext']> | null = null;
  let queue: ReturnType<InstanceType<AudioApi['AudioContext']>['createBufferQueueSource']> | null = null;
  let recorder: InstanceType<AudioApi['AudioRecorder']> | null = null;
  let sessionActive = false;
  const encoder = new UplinkEncoder();
  const decoder = new DownlinkDecoder();
  const clock = new PlaybackClock();
  let listener: ((playing: boolean) => void) | null = null;
  let lastPlaying = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  // 取り込みの世代：開始の途中（音声セッションの有効化を待つ間）に停止が来たら、その開始は録音を始めない（マイクを残さない）
  let captureGen = 0;

  const notify = () => {
    const playing = clock.isPlaying(Date.now());
    if (playing !== lastPlaying) {
      lastPlaying = playing;
      listener?.(playing);
    }
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = playing ? setTimeout(notify, Math.max(50, clock.remainingMs(Date.now()) + 200)) : null;
  };

  async function ensureSession() {
    if (sessionActive) return;
    api!.AudioManager.setSystemOptions({ ios: { category: 'playAndRecord', mode: 'voiceChat', options: ['defaultToSpeaker', 'allowBluetoothHFP'] } });
    await api!.AudioManager.setAudioSessionActivity(true);
    sessionActive = true;
  }

  function ensurePlayback() {
    if (queue) return queue;
    ctx = new api!.AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    queue = ctx.createBufferQueueSource();
    queue.connect(ctx.destination);
    queue.onbufferended = (e) => {
      // 最後の塊の終わり。直後に次の塊を積んだ時と入れ違わないよう、再生の時計の残りが無い時だけ止める
      if (e.isLastBufferInQueue && clock.remainingMs(Date.now()) <= 100) {
        clock.stop();
        notify();
      }
    };
    queue.start();
    return queue;
  }

  return {
    async requestPermission() {
      try {
        const now = await api.AudioManager.checkRecordingPermissions();
        const s = now === 'Undetermined' ? await api.AudioManager.requestRecordingPermissions() : now;
        return s === 'Granted' ? 'granted' : s === 'Denied' ? 'denied' : 'undetermined';
      } catch {
        return 'denied';
      }
    },

    async startCapture(onFrame) {
      const my = (captureGen += 1);
      try {
        await ensureSession();
        if (my !== captureGen) return true; // 待つ間に止められた：始めない（失敗ではない）
        if (recorder) {
          // 前の取り込みが残っていれば止める（二重の取り込みで2倍の速さで送らない）
          const old = recorder;
          recorder = null;
          old.clearOnAudioReady();
          await old.stop().catch(() => undefined);
        }
        const rec = new api.AudioRecorder({ iosVoiceProcessing: true, androidInputPreset: 'voiceCommunication' });
        recorder = rec;
        const r = rec.onAudioReady({ sampleRate: 16_000, bufferLength: 1_600, channelCount: 1 }, ({ buffer, numFrames }) => {
          const samples = buffer.getChannelData(0).subarray(0, numFrames);
          for (const frame of encoder.encode(samples, buffer.sampleRate)) onFrame(frame);
        });
        if (r.status !== 'success') return false;
        const started = await rec.start();
        if (my !== captureGen) {
          // 録音を始める間に止められた：この開始が作った録音だけを止める（別の開始の録音には触れない。失敗ではない）
          if (recorder === rec) recorder = null;
          rec.clearOnAudioReady();
          await rec.stop().catch(() => undefined);
          return true;
        }
        return started.status === 'success';
      } catch {
        return false;
      }
    },

    async stopCapture() {
      captureGen += 1;
      const r = recorder;
      recorder = null;
      encoder.discard();
      if (!r) return;
      try {
        r.clearOnAudioReady();
        await r.stop();
      } catch {
        // 既に止まっている
      }
    },

    discardPending() {
      encoder.discard();
    },

    play(chunk) {
      const samples = decoder.decode(chunk);
      if (samples.length === 0) return;
      try {
        const q = ensurePlayback();
        const buf = ctx!.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE);
        buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
        q.enqueueBuffer(buf);
        clock.enqueue(outputMsOf(samples.length * 2), Date.now());
        notify();
      } catch {
        // 再生できない塊は捨てる（訳の文字は画面に出る想定。事業者層の決定後）
      }
    },

    stopPlayback() {
      try {
        queue?.clearBuffers();
      } catch {
        // 既に止まっている
      }
      decoder.reset();
      clock.stop();
      notify();
    },

    isPlaying() {
      return clock.isPlaying(Date.now());
    },

    onPlaybackChange(fn) {
      listener = fn;
    },

    async dispose() {
      await this.stopCapture();
      this.stopPlayback();
      if (idleTimer) clearTimeout(idleTimer);
      listener = null;
      try {
        queue?.stop();
        await ctx?.close();
      } catch {
        // 既に閉じている
      }
      queue = null;
      ctx = null;
      if (sessionActive) {
        sessionActive = false;
        await api.AudioManager.setAudioSessionActivity(false).catch(() => {});
      }
    },
  };
}
