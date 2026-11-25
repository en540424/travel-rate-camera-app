/**
 * Pro+ AI翻訳のアプリ側ロジック（入力検査・残量表示・エラー案内・音声セッションの状態）と、開発用の模擬の中継の検証。
 */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';

register('../proplus/ts-resolve-hook.mjs', import.meta.url);
const C = await import('./ai-translation-core.ts');
const { createMockGateway } = await import('./ai-gateway-mock.ts');

test('テキスト：空・長すぎ・相手の言語の不正を拒否し、文字数は合成文字を1文字と数える', () => {
  const ok = { text: 'こんにちは', direction: 'from_ja', partnerLang: 'fr' };
  assert.deepEqual(C.validateTextRequest(ok), []);
  assert.equal(C.validateTextRequest({ ...ok, text: '   ' }).length, 1);
  assert.equal(C.validateTextRequest({ ...ok, text: 'あ'.repeat(501) }).length, 1);
  assert.deepEqual(C.validateTextRequest({ ...ok, text: 'あ'.repeat(500) }), []);
  assert.equal(C.validateTextRequest({ ...ok, text: 'a'.repeat(101) }, 100).length, 1, 'サーバーの上限で上書きできる');
  assert.equal(C.validateTextRequest({ ...ok, partnerLang: 'ja' }).length, 1);
  assert.equal(C.validateTextRequest({ ...ok, partnerLang: 'zh-Hans' }).length, 0);
  assert.equal(C.countChars('が'.normalize('NFD')), 1);
  assert.deepEqual(C.languagePair({ direction: 'to_ja', partnerLang: 'ko' }), { source: 'ko', target: 'ja' });
});

test('残量：サーバーの値を表示し、無ければ「確認中」。欠けた項目は前の値を残す', () => {
  assert.equal(C.formatQuota(C.UNKNOWN_QUOTA), '今月の残り：確認中');
  const q = C.mergeQuota(C.UNKNOWN_QUOTA, { textRemaining: 180, voiceRemainingMs: 750_000, periodEnd: '2026-12-01T00:00:00+09:00' });
  assert.equal(C.formatQuota(q), '今月の残り：テキスト 180回・音声 12分30秒（12月1日に更新）');
  assert.equal(C.mergeQuota(q, { textRemaining: 179 }).voiceRemainingMs, 750_000);
  assert.equal(C.formatQuota({ ...q, trial: true }).startsWith('無料体験の残り'), true);
  assert.equal(C.formatDurationMs(59_999), '59秒');
});

test('エラー：設計書§6-11の種類はすべて案内を持ち、未知の値はunknown。枠切れは通常翻訳へ案内', () => {
  for (const code of ['not_entitled', 'quota_exceeded', 'busy', 'budget_stop', 'provider_error', 'pending_link', 'resume_rejected']) {
    assert.equal(C.normalizeErrorCode(code), code);
    assert.ok(C.describeAiError(code).message.length > 0);
  }
  assert.equal(C.normalizeErrorCode('entitlement_stale'), 'unknown', '中継と台帳の間だけの種類は端末へ来ない');
  assert.equal(C.normalizeErrorCode(42), 'unknown');
  assert.equal(C.describeAiError('quota_exceeded').recovery, 'use_device_translation');
  assert.equal(C.describeAiError('not_entitled').recovery, 'restore_purchase');
  assert.equal(C.shouldRetryText('offline', 0), true);
  assert.equal(C.shouldRetryText('offline', 2), false);
  assert.equal(C.shouldRetryText('quota_exceeded', 0), false, '枠切れは再試行しない');
});

test('音声：開始→session→quota→warn→stop→closed。残量はサーバーの値だけで更新する', () => {
  let s = C.voiceReducer(C.VOICE_IDLE, { type: 'start' });
  assert.equal(s.phase, 'connecting');
  assert.equal(C.canSendAudio(s), false);
  s = C.voiceReducer(s, { type: 'server', msg: { type: 'session', session_id: 'a', resume_token: 't' } });
  assert.equal(s.phase, 'active');
  assert.equal(C.canSendAudio(s), true);
  s = C.voiceReducer(s, { type: 'server', msg: { type: 'quota', remaining_user_ms: 600_000, session_remaining_ms: 290_000 } });
  assert.equal(s.remainingUserMs, 600_000);
  s = C.voiceReducer(s, { type: 'server', msg: { type: 'warn', remaining_user_ms: 60_000 } });
  assert.match(s.warning, /1分00秒/);
  s = C.voiceReducer(s, { type: 'stop' });
  assert.equal(s.phase, 'draining');
  assert.equal(C.canSendAudio(s), false, '排出中は送らない');
  s = C.voiceReducer(s, { type: 'server', msg: { type: 'closed', reason: 'stopped' } });
  assert.equal(s.phase, 'closed');
  assert.equal(s.resumeToken, null);
});

test('音声：切断は再開トークンがあれば上限まで再開、無ければエラー。枠切れのエラーは再開しない', () => {
  let s = C.voiceReducer(C.voiceReducer(C.VOICE_IDLE, { type: 'start' }), { type: 'server', msg: { type: 'session', session_id: 'a', resume_token: 't' } });
  for (let i = 0; i < C.MAX_RESUMES; i++) {
    s = C.voiceReducer(s, { type: 'socket_lost' });
    assert.equal(s.phase, 'reconnecting');
    s = C.voiceReducer(s, { type: 'server', msg: { type: 'session', session_id: 'a', resume_token: `t${i}` } });
  }
  s = C.voiceReducer(s, { type: 'socket_lost' });
  assert.equal(s.phase, 'error', '上限を超えたら再開しない');
  const lost = C.voiceReducer(C.voiceReducer(C.voiceReducer(C.VOICE_IDLE, { type: 'start' }), { type: 'server', msg: { type: 'session', session_id: 'a', resume_token: 't' } }), { type: 'socket_lost' });
  assert.equal(C.voiceReducer(lost, { type: 'stop' }).phase, 'closed', '再接続中の終了は排出を待たない');
  const noToken = C.voiceReducer(C.voiceReducer(C.VOICE_IDLE, { type: 'start' }), { type: 'socket_lost' });
  assert.equal(noToken.phase, 'error');
  let q = C.voiceReducer(C.voiceReducer(C.VOICE_IDLE, { type: 'start' }), { type: 'server', msg: { type: 'session', session_id: 'a', resume_token: 't' } });
  q = C.voiceReducer(q, { type: 'server', msg: { type: 'error', code: 'quota_exceeded' } });
  assert.equal(q.resumeToken, null);
  assert.equal(C.voiceReducer(q, { type: 'start' }).phase, 'connecting', 'エラー後は新しく始められる');
});

test('模擬の中継：同じキーの再送は二重に数えず、別の本文に同じキーは拒否。枠切れでquota_exceeded', async () => {
  const g = createMockGateway({ textLimit: 2 });
  const req = { text: 'hello', direction: 'to_ja', partnerLang: 'en' };
  const a = await g.translateText(req, 'k1');
  const again = await g.translateText(req, 'k1');
  assert.equal(a.ok, true);
  assert.match(a.translation, /^［模擬・ja］/, '模擬であることが訳文に出る');
  assert.deepEqual(again, a);
  assert.equal(g.state.textUsed, 1);
  assert.equal((await g.translateText({ ...req, text: 'other' }, 'k1')).ok, false);
  await g.translateText({ ...req, text: 'b' }, 'k2');
  const over = await g.translateText({ ...req, text: 'c' }, 'k3');
  assert.deepEqual([over.ok, over.code, over.quota.textRemaining], [false, 'quota_exceeded', 0]);
});

test('模擬の中継：音声は1秒ごとに残量を送り、停止でdraining→closed。枠が無ければ開始しない', () => {
  const ticks = [];
  const g = createMockGateway({ voiceLimitMs: 3000, setTimer: (fn) => { ticks.push(fn); return 1; }, clearTimer: () => {} });
  const msgs = [];
  const conn = g.openVoice({ direction: 'from_ja', partnerLang: 'en' }, { onMessage: (m) => msgs.push(m), onSocketLost: () => {} });
  ticks[0]();
  ticks[0]();
  assert.deepEqual(msgs.map((m) => m.type), ['session', 'quota', 'quota']);
  ticks[0]();
  assert.deepEqual(msgs.slice(-2).map((m) => m.type), ['draining', 'closed']);
  assert.equal(msgs.at(-1).reason, 'quota_exceeded');
  conn.stop();
  assert.deepEqual(g.openVoice({ direction: 'from_ja', partnerLang: 'en' }, { onMessage: () => {}, onSocketLost: () => {} }), { error: 'quota_exceeded' });
});

test('冪等キー：届いたか分からない時（offline）だけ同じキーを使い、答えが返った後は新しいキー（2026-11-25 検収 B2）', () => {
  assert.equal(C.keepIdempotencyKey('offline'), true);
  assert.equal(C.keepIdempotencyKey('busy'), true, '中継でまだ処理中の同じキーは使い続ける（2回目を予約しない）');
  for (const outcome of ['success', 'provider_error', 'unknown', 'quota_exceeded', 'budget_stop', 'not_entitled']) {
    assert.equal(C.keepIdempotencyKey(outcome), false, outcome);
  }
  // provider_error は再試行するが新しいキーで送る（中継は同じキーの再送に 409 を返す）
  assert.equal(C.shouldRetryText('provider_error', 0), true);
});
