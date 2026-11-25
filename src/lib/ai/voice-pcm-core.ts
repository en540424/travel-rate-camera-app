/**
 * Pro+ リアルタイム音声：端末⇔中継の PCM の変換（純粋ロジック・import 0件・`node --test` で検証）。
 *
 * 音声の形式は**中継（tabirate-ai-gateway）が固定する**（設計書 §6-3）。端末はそれに合わせるだけで、形式を申告しない。
 *   上り：16kHz・16bit 符号付き・リトルエンディアン・モノラル＝ 32 バイト/ms（中継 `voice_input_bytes_per_ms`）
 *   下り：24kHz・16bit 符号付き・リトルエンディアン・モノラル＝ 48 バイト/ms（中継 `voice_output_bytes_per_ms`）
 * 中継は上りのバイナリのバイト数が 32 の倍数でなければ接続を閉じる。マイクの実際のサンプルレートは要求と違うことがある
 * （録音部品が返す `sampleRate` を使い、要求した値を仮定しない）。変換の後のサンプル数は半端になるので、16 サンプル（1ms）の
 * 倍数だけを送り、余りは次へ持ち越す。
 */

export const INPUT_SAMPLE_RATE = 16_000;
export const OUTPUT_SAMPLE_RATE = 24_000;
export const INPUT_BYTES_PER_MS = 32;
export const OUTPUT_BYTES_PER_MS = 48;
/** 上りの1ms のサンプル数（16kHz） */
export const INPUT_SAMPLES_PER_MS = INPUT_SAMPLE_RATE / 1000;
/** 上りの1回の送信の長さ（ms）。中継の受信の絞り（10秒で実時間の1.1倍）に対して十分に細かく、送信の回数を抑える長さ */
export const DEFAULT_FRAME_MS = 100;

/** float（-1〜1）を int16 へ。範囲外は切り詰め、NaN は 0 */
export function floatToInt16(input: ArrayLike<number>): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const v = input[i];
    const x = Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
    out[i] = x < 0 ? Math.round(x * 0x8000) : Math.round(x * 0x7fff);
  }
  return out;
}

/** int16 の LE バイト列を float（-1〜1）へ */
export function int16BytesToFloat(bytes: Uint8Array): Float32Array {
  const n = Math.floor(bytes.length / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    let v = bytes[2 * i] | (bytes[2 * i + 1] << 8);
    if (v & 0x8000) v -= 0x10000;
    out[i] = v < 0 ? v / 0x8000 : v / 0x7fff;
  }
  return out;
}

/**
 * 線形補間のサンプルレート変換（連続した塊をつなぎ目なく変換するため、状態を持つ）。
 * 音声認識・翻訳の入力の品質としては線形補間で足りる見込み（実機の品質は未確認）。
 */
export class LinearResampler {
  private pos = 0; // 次に出すサンプルの入力上の位置（前の塊の最後のサンプルを -1 とした相対）
  private last: number | null = null;
  readonly fromRate: number;
  readonly toRate: number;
  constructor(fromRate: number, toRate: number) {
    if (!(fromRate > 0) || !(toRate > 0)) throw new Error('invalid_rate');
    this.fromRate = fromRate;
    this.toRate = toRate;
  }

  process(input: ArrayLike<number>): Float32Array {
    if (input.length === 0) return new Float32Array(0);
    if (this.fromRate === this.toRate) {
      const same = Float32Array.from(input as ArrayLike<number>);
      this.last = same[same.length - 1];
      return same;
    }
    const step = this.fromRate / this.toRate;
    // 前の塊の最後のサンプルを先頭（位置 -1）に足した列の上で補間する
    const prev = this.last;
    const at = (i: number) => (i < 0 ? (prev ?? input[0]) : input[i]);
    const out: number[] = [];
    let p = this.last === null ? 0 : this.pos;
    while (p <= input.length - 1) {
      const i = Math.floor(p);
      const f = p - i;
      out.push(at(i) * (1 - f) + at(Math.min(i + 1, input.length - 1)) * f);
      p += step;
    }
    this.pos = p - input.length; // 次の塊の位置（-1 以上 0 未満の範囲にある）
    this.last = input[input.length - 1];
    return Float32Array.from(out);
  }

  reset() {
    this.pos = 0;
    this.last = null;
  }
}

/**
 * 上りの区画化：int16 のサンプルを溜め、`frameMs` 分ずつ（16 サンプルの倍数＝32 バイトの倍数）のバイト列で出す。
 * 溜まりすぎた音声は古い方から捨てる（再接続中・送れない間の音声を後からまとめて流さない。まとめて流すと中継の1.1倍の
 * 絞りで切断される）。
 */
export class PcmFramer {
  private buf: Int16Array;
  private len = 0;
  readonly frameSamples: number;
  readonly maxSamples: number;
  dropped = 0;

  constructor({ frameMs = DEFAULT_FRAME_MS, maxBufferedMs = 500 }: { frameMs?: number; maxBufferedMs?: number } = {}) {
    if (!Number.isInteger(frameMs) || frameMs <= 0) throw new Error('invalid_frame');
    this.frameSamples = frameMs * INPUT_SAMPLES_PER_MS;
    this.maxSamples = Math.max(this.frameSamples, maxBufferedMs * INPUT_SAMPLES_PER_MS);
    this.buf = new Int16Array(this.maxSamples + this.frameSamples);
  }

  /** サンプルを足し、出せる区画のバイト列を返す（それぞれ frameMs 分・32 バイトの倍数） */
  push(samples: Int16Array): Uint8Array[] {
    let src = samples;
    if (src.length > this.maxSamples) {
      this.dropped += src.length - this.maxSamples;
      src = src.subarray(src.length - this.maxSamples);
    }
    if (this.len + src.length > this.buf.length) {
      const over = this.len + src.length - this.buf.length;
      this.buf.copyWithin(0, over, this.len);
      this.len -= over;
      this.dropped += over;
    }
    this.buf.set(src, this.len);
    this.len += src.length;
    const out: Uint8Array[] = [];
    while (this.len >= this.frameSamples) {
      const frame = this.buf.slice(0, this.frameSamples);
      out.push(new Uint8Array(frame.buffer));
      this.buf.copyWithin(0, this.frameSamples, this.len);
      this.len -= this.frameSamples;
    }
    return out;
  }

  /** 止める時：残りのうち 1ms（16 サンプル）の倍数だけを出し、端数は捨てる */
  flush(): Uint8Array | null {
    const n = this.len - (this.len % INPUT_SAMPLES_PER_MS);
    this.len = 0;
    if (n === 0) return null;
    return new Uint8Array(this.buf.slice(0, n).buffer);
  }

  /** 送れない間（再接続中・バックグラウンド・再生中で入力を止める時）：溜めた音声を捨てる */
  discard() {
    this.dropped += this.len;
    this.len = 0;
  }

  get bufferedMs() {
    return this.len / INPUT_SAMPLES_PER_MS;
  }
}

/** マイクの塊（float・実際のサンプルレート）を、上りの形式の区画へ変換する一連の処理 */
export class UplinkEncoder {
  private resampler: LinearResampler | null = null;
  readonly framer: PcmFramer;
  constructor(opts?: { frameMs?: number; maxBufferedMs?: number }) {
    this.framer = new PcmFramer(opts);
  }

  encode(samples: ArrayLike<number>, sampleRate: number): Uint8Array[] {
    if (!(sampleRate > 0)) return [];
    if (!this.resampler || this.resampler.fromRate !== sampleRate) this.resampler = new LinearResampler(sampleRate, INPUT_SAMPLE_RATE);
    return this.framer.push(floatToInt16(this.resampler.process(samples)));
  }

  discard() {
    this.framer.discard();
    this.resampler?.reset();
  }
}

/**
 * 下りの復号：中継から届いた訳の音声（24kHz の int16 LE）を float へ。塊の境目で奇数バイトに割れても、1バイトを持ち越して
 * 次の塊とつなぐ（中継は事業者の塊をそのまま送るので、2バイト境界の保証は無い）。
 */
export class DownlinkDecoder {
  private carry: number | null = null;

  decode(chunk: Uint8Array): Float32Array {
    let bytes = chunk;
    if (this.carry !== null) {
      const joined = new Uint8Array(chunk.length + 1);
      joined[0] = this.carry;
      joined.set(chunk, 1);
      bytes = joined;
      this.carry = null;
    }
    if (bytes.length % 2 === 1) {
      this.carry = bytes[bytes.length - 1];
      bytes = bytes.subarray(0, bytes.length - 1);
    }
    return int16BytesToFloat(bytes);
  }

  reset() {
    this.carry = null;
  }
}

/** バイト数から ms（下り 24kHz） */
export function outputMsOf(bytes: number): number {
  return bytes / OUTPUT_BYTES_PER_MS;
}

/**
 * 再生の時計：積んだ音声の終わりの時刻を持ち、再生中かを判定する（再生の完了の検出・半二重の入力の止め）。
 * 実際の再生の終わりは端末の音声出力の遅延で前後する（実機で確認）。`tailMs` はその余裕。
 */
export class PlaybackClock {
  private endAt: number | null = null; // 何も積んでいない・止めた後は null
  private readonly tailMs: number;
  constructor(tailMs = 150) {
    this.tailMs = tailMs;
  }

  /** `ms` の音声を `now` に積んだ。前の音声の後ろへつなぐ */
  enqueue(ms: number, now: number) {
    if (!(ms > 0)) return;
    this.endAt = Math.max(this.endAt ?? now, now) + ms;
  }

  isPlaying(now: number) {
    return this.endAt !== null && now < this.endAt + this.tailMs;
  }

  /** 残りの再生時間（ms） */
  remainingMs(now: number) {
    return this.endAt === null ? 0 : Math.max(0, this.endAt - now);
  }

  stop() {
    this.endAt = null;
  }
}

/**
 * マイクの音声を中継へ送ってよいか。半二重（訳の再生中はマイクの音声を送らない＝スピーカーの音を拾って訳し直す事故を防ぐ）は
 * 設定で切り替える。**半二重にするかは操作方式の判断（H-P9）の一部で、未確定**。
 */
export function shouldForwardMic(s: { phase: string; foreground: boolean; playing: boolean; halfDuplex: boolean; socketOpen: boolean }): boolean {
  if (s.phase !== 'active' || !s.foreground || !s.socketOpen) return false;
  return !(s.halfDuplex && s.playing);
}
