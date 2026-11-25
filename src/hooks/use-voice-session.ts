/**
 * Pro+ リアルタイム音声の1回分を、状態遷移（voiceReducer）・端末の入出力（voice-audio）・中継（openVoice）でつなぐ。
 * 規則は純粋ロジック（ai-translation-core・voice-pcm-core・voice-protocol-core）にあり、ここは配線だけ。
 *
 * - マイクの許可 → 中継へ接続 → `session` を受けてから取り込みを始める（許可される前に録音しない）
 * - マイクの音声は shouldForwardMic が真で、送信の歩調（UplinkPacer：実時間×1.05＋300ms）に収まる時だけ送る。送れない音声は捨てる
 *   （溜めた音声を後からまとめて流すと、中継の1.1倍の絞りで切断される）
 * - 訳の音声（バイナリ）は再生のキューへ。再生を止めるボタンは積んだ分を捨てる（通訳は続く）
 * - 切断：再開トークンがあれば同じセッションへ再開（session_id と resume_token）。待ちは 0.5→1→2→4→4→4 秒（台帳は30秒待つ）。
 *   回数の上限は状態遷移の側。再開の途中で通信が無い（offline）時も再開の1回として数える
 * - 接続中・再接続中・終了中は端末の期限（12秒）を置く：応答が無いまま画面が「終了中…」で詰まらない
 * - バックグラウンド：入力を止めて終える（バックグラウンドで録音しない。戻っても自動では再開しない）。
 *   inactive（通知センター・コントロールセンター・システムの確認）は送信を止めるだけで終えない
 * - 終わった（closed・error）・画面を離れた：取り込みを止め、接続を閉じ、古い接続の遅れた事象を捨てる（世代を進める）
 * **実機での動作は未確認**（TEST_CHECKLIST #100〜#105）。
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { AppState } from 'react-native';

import { AI_VOICE_HALF_DUPLEX } from '@/config/ai-gateway';
import type { AiGateway, VoiceConnection } from '@/lib/ai/ai-gateway-types';
import { VOICE_IDLE, voiceReducer, type AiDirection, type VoiceServerMessage } from '@/lib/ai/ai-translation-core';
import { createVoiceAudio, type VoiceAudio } from '@/lib/ai/voice-audio';
import { DEFAULT_FRAME_MS, shouldForwardMic, UplinkPacer } from '@/lib/ai/voice-pcm-core';
import { resumeDelayMs } from '@/lib/ai/voice-protocol-core';

/** 接続中・再接続中・終了中の端末の期限 */
const PHASE_TIMEOUT_MS = 12_000;

export function useVoiceSession({ gateway, direction, partnerLang, onQuota }: {
  gateway: AiGateway;
  direction: AiDirection;
  partnerLang: string;
  onQuota: (m: Extract<VoiceServerMessage, { type: 'quota' }>) => void;
}) {
  const [voice, dispatch] = useReducer(voiceReducer, VOICE_IDLE);
  const stateRef = useRef(voice);
  // 利用者が通訳を続けたいか（始める→真、終了・バックグラウンド・画面を離れる→偽）。描画の時差に左右されない判定に使う
  const wanted = useRef(false);
  const starting = useRef(false);
  const conn = useRef<VoiceConnection | null>(null);
  const audio = useRef<VoiceAudio | null>(null);
  const pacer = useRef(new UplinkPacer());
  const capturing = useRef(false);
  const foreground = useRef(AppState.currentState === 'active');
  const onQuotaRef = useRef(onQuota);
  // 接続の世代：古い接続の遅れた事象で今の状態を動かさない（閉じる時にも進める）
  const generation = useRef(0);
  useEffect(() => {
    stateRef.current = voice;
  }, [voice]);
  useEffect(() => {
    onQuotaRef.current = onQuota;
  }, [onQuota]);

  const closeConn = useCallback(() => {
    generation.current += 1;
    conn.current?.close();
    conn.current = null;
  }, []);

  const onFrame = useCallback((frame: Uint8Array) => {
    const a = audio.current;
    const c = conn.current;
    const s = stateRef.current;
    const ok = shouldForwardMic({ phase: s.phase, foreground: foreground.current, playing: a?.isPlaying() ?? false, halfDuplex: AI_VOICE_HALF_DUPLEX, socketOpen: c?.isOpen() ?? false });
    if (ok && c && pacer.current.allow(DEFAULT_FRAME_MS, Date.now())) c.sendAudio(frame);
    else a?.discardPending();
  }, []);

  const stopCapture = useCallback(async () => {
    if (!capturing.current) return;
    capturing.current = false;
    await audio.current?.stopCapture();
  }, []);

  const open = useCallback(async (resume: { sessionId: string | null; resumeToken: string | null } | null) => {
    closeConn();
    const gen = generation.current;
    pacer.current.reset();
    const c = await gateway.openVoice({ direction, partnerLang, resume }, {
      onMessage: (m) => {
        if (gen !== generation.current) return;
        dispatch({ type: 'server', msg: m });
        if (m.type === 'quota') onQuotaRef.current(m);
      },
      onAudio: (pcm) => {
        if (gen === generation.current) audio.current?.play(new Uint8Array(pcm));
      },
      onSocketLost: () => {
        if (gen === generation.current) dispatch({ type: 'socket_lost' });
      },
    });
    if (gen !== generation.current) {
      if (!('error' in c)) c.close();
      return;
    }
    if ('error' in c && !wanted.current) {
      // 開く途中に終了・バックグラウンド：エラーではなく、終了中を終える
      dispatch({ type: 'socket_lost' });
      return;
    }
    if ('error' in c) {
      // 再開の途中で通信が無い：再開の1回として数える（待ちの後にもう一度。上限で終わる）
      if (resume && c.error === 'offline') dispatch({ type: 'socket_lost' });
      else dispatch({ type: 'server', msg: { type: 'error', code: c.error } });
      return;
    }
    // 開いている途中に終了・バックグラウンドになった：この接続は使わない（中継へ start を送る前に閉じる）
    if (!wanted.current) {
      c.close();
      dispatch({ type: 'socket_lost' });
      return;
    }
    conn.current = c;
  }, [gateway, direction, partnerLang, closeConn]);

  const start = useCallback(async () => {
    const s = stateRef.current.phase;
    if (starting.current || (s !== 'idle' && s !== 'closed' && s !== 'error')) return;
    starting.current = true;
    try {
      // 模擬の中継（開発用）は音声の部品が無くても状態の確認だけできる
      audio.current ??= createVoiceAudio();
      const a = audio.current;
      if (!a && gateway.kind !== 'mock') {
        dispatch({ type: 'local_issue', issue: 'audio_unavailable' });
        return;
      }
      if (a) {
        const perm = await a.requestPermission();
        if (perm !== 'granted') {
          dispatch({ type: 'local_issue', issue: 'mic_denied' });
          return;
        }
        a.onPlaybackChange((playing) => dispatch({ type: 'playback', playing }));
      }
      wanted.current = true;
      dispatch({ type: 'start' });
      await open(null);
    } finally {
      starting.current = false;
    }
  }, [gateway, open]);

  const stop = useCallback(() => {
    wanted.current = false;
    dispatch({ type: 'stop' });
    // 入力はすぐ止める。訳の残り（排出）は中継が送り終えるまで再生する
    void stopCapture();
    conn.current?.stop();
  }, [stopCapture]);

  const stopPlayback = useCallback(() => {
    audio.current?.stopPlayback();
  }, []);

  const reset = useCallback(() => dispatch({ type: 'reset' }), []);

  // 状態ごとの配線：通訳中は取り込み、終了中は取り込みを止める、終わったら接続を閉じる
  useEffect(() => {
    if (voice.phase === 'active' && !capturing.current && audio.current) {
      capturing.current = true;
      void audio.current.startCapture(onFrame).then((ok) => {
        // 止められた後（capturing が偽）の失敗は部品の問題として扱わない
        if (!ok && capturing.current) {
          capturing.current = false;
          dispatch({ type: 'local_issue', issue: 'audio_unavailable' });
          closeConn();
        }
      });
    }
    if (voice.phase === 'draining') void stopCapture();
    if (voice.phase === 'closed' || voice.phase === 'error' || voice.phase === 'idle') {
      void stopCapture();
      if (voice.phase !== 'idle') {
        wanted.current = false;
        closeConn();
      }
    }
  }, [voice.phase, onFrame, stopCapture, closeConn]);

  // 接続中・再接続中・終了中の端末の期限
  const waitingKey = voice.phase === 'connecting' || voice.phase === 'draining' || voice.phase === 'reconnecting' ? `${voice.phase}:${voice.resumeCount}` : null;
  useEffect(() => {
    if (!waitingKey) return;
    // 事象を送るだけ。接続を閉じるのは状態の配線（closed・error）と次の open に任せる（期限の直前に通訳中へ進んだ時に閉じない）
    const t = setTimeout(() => dispatch({ type: 'timeout' }), PHASE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [waitingKey, closeConn]);

  // 切断の後の再開：待ちの後、同じ session_id と再開トークンで（回数の上限は状態遷移の側）
  const reconnectKey = voice.phase === 'reconnecting' ? `${voice.sessionId}:${voice.resumeCount}` : null;
  useEffect(() => {
    if (!reconnectKey) return;
    const t = setTimeout(() => {
      if (stateRef.current.phase !== 'reconnecting' || !wanted.current) return;
      void open({ sessionId: stateRef.current.sessionId, resumeToken: stateRef.current.resumeToken });
    }, resumeDelayMs(stateRef.current.resumeCount));
    return () => clearTimeout(t);
  }, [reconnectKey, open]);

  // バックグラウンド：入力を止めて終える。inactive は送信を止めるだけ（foreground が偽の間は送らない）
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      foreground.current = next === 'active';
      if (next !== 'background') return;
      const phase = stateRef.current.phase;
      if (phase === 'active' || phase === 'connecting' || phase === 'reconnecting') {
        wanted.current = false;
        dispatch({ type: 'background' });
        void stopCapture();
        audio.current?.stopPlayback();
        if (conn.current?.isOpen()) conn.current.stop();
        else {
          closeConn();
          dispatch({ type: 'socket_lost' }); // 終了中（draining）を中継の closed を待たずに終える
        }
      }
    });
    return () => sub.remove();
  }, [stopCapture, closeConn]);

  // 画面を離れた：接続と音声の部品を片付ける
  useEffect(() => () => {
    wanted.current = false;
    generation.current += 1;
    conn.current?.close();
    conn.current = null;
    capturing.current = false;
    void audio.current?.dispose();
    audio.current = null;
  }, []);

  return { voice, start, stop, stopPlayback, reset };
}
