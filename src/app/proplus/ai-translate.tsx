/**
 * Pro+ AI翻訳（テキスト・リアルタイム音声）。既存の翻訳タブ（端末内・無料）とは別の画面で、明示操作でのみ動く。
 * - 利用量はサーバーが正。この画面は残量を表示するだけで、上限の判定をしない
 * - 初回は送信先と内容の同意を取る。同意しなければ送信しない
 * - 枠切れ・停止・通信不可のときは、通常の翻訳（端末内）へ案内する
 */
import { router } from 'expo-router';
import { useEffect, useReducer, useRef, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';

import { AccessNotice, Chip, Notice, pp } from '@/components/proplus/proplus-ui';
import { ThemedText } from '@/components/themed-text';
import { FormInput } from '@/components/ui/FormInput';
import { GhostButton } from '@/components/ui/GhostButton';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { SecondaryButton } from '@/components/ui/SecondaryButton';
import { SectionCard } from '@/components/ui/SectionCard';
import { getLanguageDisplayName } from '@/config/translation-language-names';
import { useProPlusAccess } from '@/hooks/use-proplus';
import { hasAiConsent, saveAiConsent } from '@/lib/ai/ai-consent';
import { getAiGateway } from '@/lib/ai/ai-gateway-client';
import type { VoiceConnection } from '@/lib/ai/ai-gateway-types';
import {
  countChars, DEFAULT_TEXT_MAX_CHARS, describeAiError, formatDurationMs, formatQuota, languagePair, mergeQuota,
  keepIdempotencyKey, shouldRetryText, UNKNOWN_QUOTA, validateTextRequest, VOICE_IDLE, voiceReducer, type AiDirection, type AiErrorCode,
} from '@/lib/ai/ai-translation-core';
import { canEditProPlusData } from '@/lib/proplus/proplus-access-core';
import { newLocalId } from '@/lib/proplus/proplus-store-core';
import { speakText, stopSpeaking } from '@/lib/speech-synthesis-service';

const PARTNER_LANGS = ['en', 'ko', 'zh-Hans', 'zh-Hant', 'th', 'vi', 'fr', 'de', 'es', 'it'];

export default function AiTranslateScreen() {
  const access = useProPlusAccess();
  const gateway = getAiGateway();
  const usable = canEditProPlusData(access);
  const [consent, setConsent] = useState<boolean | null>(null);
  const [direction, setDirection] = useState<AiDirection>('from_ja');
  const [partner, setPartner] = useState('en');
  const [text, setText] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<AiErrorCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [quota, setQuota] = useState(UNKNOWN_QUOTA);
  const [voice, dispatch] = useReducer(voiceReducer, VOICE_IDLE);
  const conn = useRef<VoiceConnection | null>(null);
  // 同じ本文の再送は同じキー（サーバーで二重に消費されない）。本文が変わったら新しいキー
  const keyRef = useRef<{ body: string; key: string } | null>(null);

  useEffect(() => {
    void hasAiConsent().then(setConsent);
    return () => { conn.current?.close(); void stopSpeaking(); };
  }, []);

  // 残量の照会も利用者のIDを中継へ送るため、同意の後で、Pro+ を使える時だけ行う
  // （契約の無い利用者が照会すると、中継に「Pro+ でない」と覚えさせる経路になる。2026-11-25 検収 S4）
  useEffect(() => {
    if (consent && usable) void gateway.getQuota().then((r) => { if (r.ok) setQuota((q) => mergeQuota(q, r.quota)); });
  }, [consent, usable, gateway]);

  async function agree() {
    if (await saveAiConsent()) setConsent(true);
    else Alert.alert('保存できませんでした', 'もう一度お試しください。');
  }

  async function translate() {
    const req = { text, direction, partnerLang: partner };
    const errs = validateTextRequest(req);
    if (errs.length) { Alert.alert('確認', errs.join('\n')); return; }
    if (!consent) { setError('consent_required'); return; }
    const body = `${direction}|${partner}|${text}`;
    if (keyRef.current?.body !== body) keyRef.current = { body, key: newLocalId() };
    setBusy(true);
    setError(null);
    let attempt = 0;
    for (;;) {
      const r = await gateway.translateText(req, keyRef.current.key);
      if (r.quota) setQuota((q) => mergeQuota(q, r.quota!));
      // 同じキーを使い続けるのは、届いたか分からない時（offline）と中継で処理中の時（busy）だけ。答えが返った後は新しいキーにする
      // （中継は同じキーの再送に 409 を返すので、失敗の後に同じキーでは二度と通らない。2026-11-25 検収 B2）
      if (!keepIdempotencyKey(r.ok ? 'success' : r.code)) keyRef.current = { body, key: newLocalId() };
      if (r.ok) { setResult(r.translation); break; }
      if (!shouldRetryText(r.code, attempt)) { setError(r.code); break; }
      attempt += 1;
    }
    setBusy(false);
  }

  async function speak() {
    if (!result) return;
    const { target } = languagePair({ direction, partnerLang: partner });
    await speakText({ text: result, language: target === 'ja' ? 'ja-JP' : target }, { onStart: () => {}, onFinish: () => {}, onError: () => {} });
  }

  function openVoice(resumeToken: string | null) {
    // 再開の前に古い接続を閉じる（二重に開かない）
    conn.current?.close();
    conn.current = null;
    const c = gateway.openVoice({ direction, partnerLang: partner, resumeToken }, {
      onMessage: (m) => {
        dispatch({ type: 'server', msg: m });
        if (m.type === 'quota') setQuota((q) => mergeQuota(q, { voiceRemainingMs: m.remaining_user_ms, periodEnd: m.period_end }));
      },
      onSocketLost: () => dispatch({ type: 'socket_lost' }),
    });
    if ('error' in c) { dispatch({ type: 'server', msg: { type: 'error', code: c.error } }); return; }
    conn.current = c;
  }

  function startVoice() {
    if (!consent) { setError('consent_required'); return; }
    dispatch({ type: 'start' });
    openVoice(null);
  }

  // 切断後の再開：同じ再開トークンでつなぎ直す（回数の上限は状態遷移側。残量はサーバーが引き継ぐ）
  const reconnectToken = voice.phase === 'reconnecting' ? voice.resumeToken : null;
  useEffect(() => {
    if (reconnectToken) openVoice(reconnectToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconnectToken, voice.resumeCount]);

  function stopVoice() {
    dispatch({ type: 'stop' });
    conn.current?.stop();
  }

  const err = error ? describeAiError(error) : voice.error ? describeAiError(voice.error) : null;
  const voiceActive = voice.phase === 'active' || voice.phase === 'connecting' || voice.phase === 'reconnecting' || voice.phase === 'draining';
  const n = countChars(text.trim());

  return (
    <ScrollView style={pp.screen} contentContainerStyle={pp.content} keyboardShouldPersistTaps="handled">
      <AccessNotice access={access} />
      {gateway.kind === 'mock' && <Notice>開発用の模擬の中継で動いています。訳文は入力の写しで、翻訳ではありません（通信・課金なし）。</Notice>}
      {gateway.kind === 'unconfigured' && <Notice>AI翻訳は提供開始の準備中です。通常の翻訳（端末内・無料）をお使いください。</Notice>}
      <ThemedText style={pp.muted}>{formatQuota(quota)}</ThemedText>

      {consent === false && (
        <SectionCard>
          <ThemedText style={pp.h2}>AI翻訳を使う前に</ThemedText>
          <ThemedText style={pp.muted}>
            AI翻訳では、入力した文章・話した音声を旅レートカメラの中継サーバー経由で翻訳サービスへ送ります。翻訳の内容はサーバーに保存しません。
            通常の翻訳（翻訳タブ）は端末内で動き、送信しません。
          </ThemedText>
          <PrimaryButton title="同意してAI翻訳を使う" onPress={agree} disabled={!usable} />
        </SectionCard>
      )}

      <View style={pp.chips}>
        <Chip label="日本語 → 相手の言語" selected={direction === 'from_ja'} onPress={() => setDirection('from_ja')} />
        <Chip label="相手の言語 → 日本語" selected={direction === 'to_ja'} onPress={() => setDirection('to_ja')} />
      </View>
      <View style={pp.chips}>
        {PARTNER_LANGS.map((l) => <Chip key={l} label={getLanguageDisplayName(l)} selected={partner === l} onPress={() => setPartner(l)} />)}
      </View>

      <ThemedText style={pp.h2}>テキスト</ThemedText>
      <FormInput label={`文章（${n}/${DEFAULT_TEXT_MAX_CHARS}文字）`} value={text} onChangeText={setText} multiline editable={usable} />
      <PrimaryButton title="AIで翻訳" onPress={translate} loading={busy} disabled={!usable || busy || n === 0} />
      {result && (
        <SectionCard>
          <ThemedText selectable>{result}</ThemedText>
          <GhostButton title="読み上げ" tone="primary" onPress={speak} />
        </SectionCard>
      )}

      <ThemedText style={pp.h2}>リアルタイム音声</ThemedText>
      <ThemedText style={pp.muted}>
        状態：{{ idle: '待機中', connecting: '接続中…', active: '通訳中', draining: '終了中…', reconnecting: '再接続中…', closed: '終了しました', error: 'エラー' }[voice.phase]}
        {voice.sessionRemainingMs != null && voiceActive ? `・この回の残り ${formatDurationMs(voice.sessionRemainingMs)}` : ''}
      </ThemedText>
      {voice.warning && <Notice>{voice.warning}</Notice>}
      {voiceActive ? (
        <SecondaryButton title="終了" onPress={stopVoice} disabled={voice.phase === 'draining'} />
      ) : (
        <PrimaryButton title="音声で通訳を始める" onPress={startVoice} disabled={!usable} />
      )}

      {err && (
        <SectionCard>
          <ThemedText style={pp.error}>{err.message}</ThemedText>
          {err.recovery === 'use_device_translation' && <GhostButton title="通常の翻訳を開く" tone="primary" onPress={() => router.push('/translation')} />}
          {err.recovery === 'restore_purchase' && <GhostButton title="購入を復元" tone="primary" onPress={() => router.push('/purchase-restore')} />}
          {(err.recovery === 'retry' || err.recovery === 'retry_later') && <GhostButton title="もう一度" tone="primary" onPress={() => { setError(null); dispatch({ type: 'reset' }); }} />}
        </SectionCard>
      )}
    </ScrollView>
  );
}
