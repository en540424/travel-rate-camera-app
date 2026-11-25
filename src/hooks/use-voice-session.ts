/**
 * Pro+ リアルタイム音声の1回分を、状態遷移（voiceReducer）・端末の入出力（voice-audio）・中継（openVoice）でつなぐ。
 * 規則は純粋ロジック（ai-translation-core・voice-pcm-core・voice-protocol-core）にあり、ここは配線だけ。
 *
 * - マイクの許可 → 中継へ接続 → `session` を受けてから取り込みを始める（許可される前に録音しない）
 * - マイクの音声は shouldForwardMic が真の時だけ送る（通訳中・前面・接続中・半二重なら再生中は送らない）。送れない音声は捨てる
 * - 訳の音声（バイナリ）は再生のキューへ。再生を止めるボタンは積んだ分を捨てる（通訳は続く）
 * - 切断：再開トークンがあれば同じセッションへ再開（session_id と resume_token）。回数の上限は状態遷移の側
 * - バックグラウンド：入力を止めて終える（バックグラウンドで録音しない。戻っても自動では再開しない）
 * - 終わった（closed・error）・画面を離れた：取り込みを止め、接続と音声の部品を片付ける
 * **実機での動作は未確認**（TEST_CHECKLIST）。
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { AppState } from 'react-native';

import { AI_VOICE_HALF_DUPLEX } from '@/config/ai-gateway';
import type { AiGateway, VoiceConnection } from '@/lib/ai/ai-gateway-types';
import { VOICE_IDLE, voiceReducer, type AiDirection, type VoiceServerMessage } from '@/lib/ai/ai-translation-core';
import { createVoiceAudio, type VoiceAudio } from '@/lib/ai/voice-audio';
import { shouldForwardMic } from '@/lib/ai/voice-pcm-core';

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
  const conn = useRef<VoiceConnection | null>(null);
  const audio = useRef<VoiceAudio | null>(null);
  const capturing = useRef(false);
  const foreground = useRef(AppState.currentState === 'active');
  const onQuotaRef = useRef(onQuota);
  useEffect(() => {
    stateRef.current = voice;
  }, [voice]);
  useEffect(() => {
    onQuotaRef.current = onQuota;
  }, [onQuota]);
  // 接続の世代：古い接続の遅れた事象で今の状態を動かさない
  const generation = useRef(0);

  const onFrame = useCallback((frame: Uint8Array) => {
    const a = audio.current;
    const c = conn.current;
    const s = stateRef.current;
    const ok = shouldForwardMic({ phase: s.phase, foreground: foreground.current, playing: a?.isPlaying() ?? false, halfDuplex: AI_VOICE_HALF_DUPLEX, socketOpen: c?.isOpen() ?? false });
    if (ok && c) c.sendAudio(frame);
    else a?.discardPending();
  }, []);

  const stopCapture = useCallback(async () => {
    if (!capturing.current) return;
    capturing.current = false;
    await audio.current?.stopCapture();
  }, []);

  const open = useCallback(async (resume: { sessionId: string | null; resumeToken: string | null } | null) => {
    const gen = (generation.current += 1);
    conn.current?.close();
    conn.current = null;
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
    if ('error' in c) {
      dispatch({ type: 'server', msg: { type: 'error', code: c.error } });
      return;
    }
    // 開いている途中に終了・バックグラウンドになった：この接続は使わない（中継へ start を送る前に閉じる）
    if (!wanted.current) {
      c.close();
      // 終了中（draining）を、中継の closed を待たずに終える（まだ何も送っていない）
      dispatch({ type: 'socket_lost' });
      return;
    }
    conn.current = c;
  }, [gateway, direction, partnerLang]);

  const start = useCallback(async () => {
    const s = stateRef.current.phase;
    if (s !== 'idle' && s !== 'closed' && s !== 'error') return;
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

  // session を受けて通訳中になったら取り込みを始める（再開の後も同じ取り込みを使い続ける）
  useEffect(() => {
    if (voice.phase === 'active' && !capturing.current && audio.current) {
      capturing.current = true;
      void audio.current.startCapture(onFrame).then((ok) => {
        if (!ok) {
          capturing.current = false;
          dispatch({ type: 'local_issue', issue: 'audio_unavailable' });
          conn.current?.close();
        }
      });
    }
    if (voice.phase === 'closed' || voice.phase === 'error' || voice.phase === 'idle') {
      void stopCapture();
      if (voice.phase !== 'idle') {
        conn.current?.close();
        conn.current = null;
      }
    }
  }, [voice.phase, onFrame, stopCapture]);

  // 切断の後の再開：同じ session_id と再開トークンで（回数の上限は状態遷移の側）
  const reconnectKey = voice.phase === 'reconnecting' ? `${voice.sessionId}:${voice.resumeCount}` : null;
  useEffect(() => {
    if (reconnectKey) void open({ sessionId: stateRef.current.sessionId, resumeToken: stateRef.current.resumeToken });
  }, [reconnectKey, open]);

  // バックグラウンド：入力を止めて終える
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      foreground.current = next === 'active';
      if (next === 'active') return;
      const phase = stateRef.current.phase;
      if (phase === 'active' || phase === 'connecting' || phase === 'reconnecting') {
        wanted.current = false;
        dispatch({ type: 'background' });
        void stopCapture();
        audio.current?.stopPlayback();
        if (conn.current?.isOpen()) conn.current.stop();
        else {
          conn.current?.close();
          conn.current = null;
        }
      }
    });
    return () => sub.remove();
  }, [stopCapture]);

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
