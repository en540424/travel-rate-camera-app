/**
 * Pro+ リアルタイム音声の端末側の純ロジック（2026-11-25）：PCM の変換・区画化（voice-pcm-core）、中継との手順
 * （voice-protocol-core）、本人認証のトークン（ai-auth-core）、状態遷移の追加（再生中・バックグラウンド・端末の問題）。
 * マイク・スピーカー・WebSocket・StoreKit の実物は使わない（実機で確認する項目は TEST_CHECKLIST）。
 */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test, describe } from 'node:test';

register('../proplus/ts-resolve-hook.mjs', import.meta.url);
const P = await import('./voice-pcm-core.ts');
const W = await import('./voice-protocol-core.ts');
const A = await import('./ai-auth-core.ts');
const C = await import('./ai-translation-core.ts');

describe('PCM：上り（マイク → 中継）', () => {
  test('float → int16：範囲の端・範囲外の切り詰め・NaN', () => {
    assert.deepEqual([...P.floatToInt16([0, 1, -1, 2, -2, NaN, 0.5])], [0, 32767, -32768, 32767, -32768, 0, 16384]);
  });

  test('サンプルレート変換：48kHz → 16kHz は1/3の長さ。塊に分けても続けて変換した結果と一致する', () => {
    const src = Float32Array.from({ length: 4_800 }, (_, i) => Math.sin(i / 10));
    const whole = new P.LinearResampler(48_000, 16_000).process(src);
    assert.equal(whole.length, 1_600);
    const r = new P.LinearResampler(48_000, 16_000);
    const parts = [];
    for (let off = 0; off < src.length; off += 1_000) parts.push(...r.process(src.subarray(off, off + 1_000)));
    assert.equal(parts.length, whole.length);
    for (let i = 0; i < whole.length; i += 1) assert.ok(Math.abs(parts[i] - whole[i]) < 1e-6, `i=${i}`);
  });

  test('サンプルレート変換：44.1kHz → 16kHz（割り切れない比）も塊の境目でずれない', () => {
    const src = Float32Array.from({ length: 44_100 }, (_, i) => Math.sin(i / 7));
    const whole = new P.LinearResampler(44_100, 16_000).process(src);
    const r = new P.LinearResampler(44_100, 16_000);
    const parts = [];
    for (let off = 0; off < src.length; off += 4_410) parts.push(...r.process(src.subarray(off, off + 4_410)));
    assert.ok(Math.abs(parts.length - whole.length) <= 1, `${parts.length} vs ${whole.length}`);
    assert.ok(Math.abs(whole.length - 16_000) <= 1);
    for (let i = 0; i < Math.min(parts.length, whole.length); i += 1) assert.ok(Math.abs(parts[i] - whole[i]) < 1e-5, `i=${i}`);
  });

  test('16kHz → 16kHz はそのまま（要求したレートで届いた時）', () => {
    const r = new P.LinearResampler(16_000, 16_000);
    assert.deepEqual([...r.process([0.1, 0.2])].map((v) => Math.round(v * 10)), [1, 2]);
  });

  test('区画化：100ms（3,200バイト＝32の倍数）ずつ出し、端数は次へ持ち越す。止める時は1msの倍数だけ出す', () => {
    const f = new P.PcmFramer({ frameMs: 100 });
    assert.equal(f.push(new Int16Array(1_000)).length, 0);
    const out = f.push(new Int16Array(1_000)); // 合計 2,000 サンプル → 1区画（1,600）＋余り 400
    assert.equal(out.length, 1);
    assert.equal(out[0].byteLength, 3_200);
    assert.equal(out[0].byteLength % P.INPUT_BYTES_PER_MS, 0);
    assert.equal(f.bufferedMs, 25);
    f.push(new Int16Array(7)); // 407 サンプル
    const tail = f.flush();
    assert.equal(tail.byteLength, 400 * 2, '端数の7サンプルは捨てる');
    assert.equal(tail.byteLength % P.INPUT_BYTES_PER_MS, 0);
    assert.equal(f.flush(), null);
  });

  test('区画化：送れない間に溜めすぎない（古い方を捨てる）。捨てた後もバイト数は32の倍数', () => {
    const f = new P.PcmFramer({ frameMs: 100, maxBufferedMs: 300 });
    const out = f.push(new Int16Array(16_000)); // 1秒分を一度に
    assert.ok(out.length <= 4, `出すのは上限の分まで（${out.length}）`);
    assert.ok(f.dropped > 0);
    for (const b of out) assert.equal(b.byteLength % 32, 0);
    f.push(new Int16Array(500));
    f.discard();
    assert.equal(f.bufferedMs, 0);
  });

  test('マイクの塊（実際のレート）→ 区画：48kHz の 100ms は 16kHz の 100ms（3,200バイト）になる', () => {
    const enc = new P.UplinkEncoder({ frameMs: 100 });
    const frames = [];
    for (let i = 0; i < 10; i += 1) frames.push(...enc.encode(new Float32Array(480).fill(0.25), 48_000)); // 10ms × 10
    assert.equal(frames.length, 1);
    assert.equal(frames[0].byteLength, 3_200);
    assert.deepEqual(enc.encode(new Float32Array(10), 0), [], 'レートが分からない塊は捨てる');
  });
});

describe('PCM：下り（中継 → 再生）', () => {
  test('int16 LE → float。奇数バイトに割れた塊も持ち越してつなぐ', () => {
    const d = new P.DownlinkDecoder();
    const bytes = new Uint8Array(new Int16Array([0, 32767, -32768, 16384]).buffer);
    const a = d.decode(bytes.subarray(0, 3));
    const b = d.decode(bytes.subarray(3));
    const all = [...a, ...b];
    assert.equal(all.length, 4);
    assert.deepEqual(all.map((v) => Math.round(v * 100) / 100), [0, 1, -1, 0.5]);
    assert.equal(P.outputMsOf(4_800), 100);
  });

  test('再生の時計：積んだ長さの間（＋余裕）だけ再生中。続けて積むと後ろへつなぐ。止めると即時に終わる', () => {
    const c = new P.PlaybackClock(100);
    assert.equal(c.isPlaying(0), false);
    c.enqueue(500, 1_000);
    c.enqueue(500, 1_200);
    assert.equal(c.remainingMs(1_200), 800);
    assert.equal(c.isPlaying(1_950), true);
    assert.equal(c.isPlaying(2_050), true, '余裕の間');
    assert.equal(c.isPlaying(2_101), false);
    c.enqueue(300, 5_000);
    c.stop();
    assert.equal(c.isPlaying(5_000), false);
  });

  test('マイクの音声を送るか：通訳中・前面・接続中だけ。半二重なら再生中は送らない', () => {
    const base = { phase: 'active', foreground: true, playing: false, halfDuplex: true, socketOpen: true };
    assert.equal(P.shouldForwardMic(base), true);
    assert.equal(P.shouldForwardMic({ ...base, playing: true }), false);
    assert.equal(P.shouldForwardMic({ ...base, playing: true, halfDuplex: false }), true);
    for (const patch of [{ phase: 'draining' }, { phase: 'reconnecting' }, { foreground: false }, { socketOpen: false }]) assert.equal(P.shouldForwardMic({ ...base, ...patch }), false, JSON.stringify(patch));
  });
});

describe('中継との手順', () => {
  test('URL：https → wss、相手の言語と方向を付け、トークンを載せない。http は開発の時だけ', () => {
    assert.equal(W.voiceSocketUrl('https://gw.example/', 'from_ja', 'en'), 'wss://gw.example/v1/voice?direction=from_ja&lang=en');
    assert.equal(W.voiceSocketUrl('https://gw.example/base', 'to_ja', 'zh-Hans'), 'wss://gw.example/base/v1/voice?direction=to_ja&lang=zh-Hans');
    assert.equal(W.voiceSocketUrl('http://localhost:8787', 'from_ja', 'en'), null);
    assert.equal(W.voiceSocketUrl('http://localhost:8787', 'from_ja', 'en', { allowInsecure: true }), 'ws://localhost:8787/v1/voice?direction=from_ja&lang=en');
    assert.equal(W.voiceSocketUrl('https://gw.example', 'from_ja', 'ja'), null);
    assert.equal(W.voiceSocketUrl('not a url', 'from_ja', 'en'), null);
  });

  test('最初の制御メッセージ：再開は session_id と resume_token の両方がある時だけ', () => {
    assert.deepEqual(JSON.parse(W.helloMessage(null)), { type: 'start' });
    assert.deepEqual(JSON.parse(W.helloMessage({ sessionId: 's1', resumeToken: 'abcd' })), { type: 'resume', session_id: 's1', resume_token: 'abcd' });
    assert.deepEqual(JSON.parse(W.helloMessage({ sessionId: null, resumeToken: 'abcd' })), { type: 'start' });
    assert.deepEqual(JSON.parse(W.STOP_MESSAGE), { type: 'stop' });
  });

  test('受信の検査：中継の形だけを受け、壊れた・知らない値で状態を進めない', () => {
    assert.deepEqual(W.parseServerMessage('{"type":"session","session_id":"s","resume_token":"t","provisional":true}'), { type: 'session', session_id: 's', resume_token: 't', provisional: true });
    assert.deepEqual(W.parseServerMessage('{"type":"quota","remaining_user_ms":1000,"session_remaining_ms":2000}'), { type: 'quota', remaining_user_ms: 1000, session_remaining_ms: 2000 });
    assert.deepEqual(W.parseServerMessage('{"type":"closed","reason":"normal"}'), { type: 'closed', reason: 'normal' });
    assert.deepEqual(W.parseServerMessage('{"type":"error","code":"quota_exceeded"}'), { type: 'error', code: 'quota_exceeded' });
    for (const bad of ['', 'x', '[]', '{"type":"session","session_id":"s"}', '{"type":"quota","remaining_user_ms":-1,"session_remaining_ms":1}', '{"type":"quota","remaining_user_ms":"1","session_remaining_ms":1}', '{"type":"hello"}', 'x'.repeat(5_000)]) {
      assert.equal(W.parseServerMessage(bad), null, bad.slice(0, 40));
    }
  });

  test('閉じた時：終わりの制御メッセージを受けていなければ切断（再開を試す）', () => {
    assert.equal(W.closeEvent(true), 'none');
    assert.equal(W.closeEvent(false), 'socket_lost');
  });
});

describe('本人認証のトークン（端末）', () => {
  test('期限の少し前から使わない（取り直す）', () => {
    const t = { token: 'a.b.c', expiresAtMs: 1_000_000 };
    assert.equal(A.tokenUsable(t, 1_000_000 - 60_001), true);
    assert.equal(A.tokenUsable(t, 1_000_000 - 60_000), false);
    assert.equal(A.tokenUsable(null, 0), false);
    assert.equal(A.tokenUsable({ token: '', expiresAtMs: 2e12 }, 0), false);
  });

  test('交換の応答：200 はトークン、409 pending_link・503 unconfigured・401 not_entitled は語彙のまま', () => {
    const ok = A.exchangeOutcome(200, { token: 'a.b.c', expires_at: '2026-11-25T12:10:00.000Z' });
    assert.deepEqual(ok, { ok: true, token: { token: 'a.b.c', expiresAtMs: Date.parse('2026-11-25T12:10:00.000Z') } });
    assert.deepEqual(A.exchangeOutcome(409, { error: 'pending_link' }), { ok: false, code: 'pending_link' });
    assert.deepEqual(A.exchangeOutcome(503, { error: 'unconfigured' }), { ok: false, code: 'unconfigured' });
    assert.deepEqual(A.exchangeOutcome(401, { error: 'not_entitled' }), { ok: false, code: 'not_entitled' });
    assert.deepEqual(A.exchangeOutcome(200, { token: 'a', expires_at: 'x' }), { ok: false, code: 'unknown' });
    assert.deepEqual(A.exchangeOutcome(500, null), { ok: false, code: 'unknown' });
  });

  test('401 の後は1回だけ取り直して送り直す', () => {
    assert.equal(A.shouldRefreshAfter(401, 0), true);
    assert.equal(A.shouldRefreshAfter(401, 1), false);
    assert.equal(A.shouldRefreshAfter(403, 0), false);
    assert.equal(A.proofUnavailableCode('no_transaction'), 'not_entitled');
    assert.equal(A.proofUnavailableCode('unsupported'), 'unconfigured');
  });
});

describe('音声の状態遷移（追加分）', () => {
  const active = () => C.voiceReducer(C.voiceReducer(C.VOICE_IDLE, { type: 'start' }), { type: 'server', msg: { type: 'session', session_id: 's1', resume_token: 'tok', provisional: true } });

  test('session の provisional（暫定の枠）を持つ', () => {
    assert.equal(active().provisional, true);
    assert.equal(active().phase, 'active');
  });

  test('バックグラウンド：通訳中は入力を止めて終える（closed の理由は background）。再接続中ならその場で終える', () => {
    let s = C.voiceReducer(active(), { type: 'background' });
    assert.equal(s.phase, 'draining');
    s = C.voiceReducer(s, { type: 'server', msg: { type: 'closed', reason: 'normal' } });
    assert.deepEqual([s.phase, s.closedReason], ['closed', 'background']);
    const r = C.voiceReducer(C.voiceReducer(active(), { type: 'socket_lost' }), { type: 'background' });
    assert.deepEqual([r.phase, r.closedReason, r.resumeToken], ['closed', 'background', null]);
    assert.equal(C.voiceReducer(C.VOICE_IDLE, { type: 'background' }), C.VOICE_IDLE, '待機中は何もしない');
  });

  test('再生中の印：変わらなければ同じ状態を返す（再描画を増やさない）。終わると下ろす', () => {
    const a = active();
    const p = C.voiceReducer(a, { type: 'playback', playing: true });
    assert.equal(p.playing, true);
    assert.equal(C.voiceReducer(p, { type: 'playback', playing: true }), p);
    assert.equal(C.voiceReducer(p, { type: 'server', msg: { type: 'closed' } }).playing, false);
  });

  test('端末の問題（マイク拒否・部品なし・証拠なし）は error へ。再開トークンを捨てる。中継の語彙には入れない', () => {
    const s = C.voiceReducer(active(), { type: 'local_issue', issue: 'mic_denied' });
    assert.deepEqual([s.phase, s.localIssue, s.resumeToken], ['error', 'mic_denied', null]);
    assert.equal(C.normalizeErrorCode('mic_denied'), 'unknown', '中継の語彙（KNOWN_CODES）ではない');
    for (const i of ['mic_denied', 'audio_unavailable', 'proof_unavailable']) assert.ok(C.describeVoiceIssue(i).message.length > 0);
    assert.equal(C.voiceReducer(s, { type: 'start' }).localIssue, null, '始め直すと消える');
  });
});

describe('2026-11-26 独立検収の反映', () => {
  test('送信の歩調：実時間×1.05＋300ms を超える区画は捨てる（溜まった区画をまとめて送らない）。接続ごとに数え直す', () => {
    const p = new P.UplinkPacer();
    // 0ms に 30区画（3秒分）がまとめて届く：余裕の 300ms 分（3区画）だけ送る
    let sent = 0;
    for (let i = 0; i < 30; i += 1) if (p.allow(100, 0)) sent += 1;
    assert.equal(sent, 3);
    assert.equal(p.dropped, 27);
    // 実時間どおり（100ms ごとに100ms）は捨てない
    let ok = 0;
    for (let t = 100; t <= 10_000; t += 100) if (p.allow(100, t)) ok += 1;
    assert.equal(ok, 100);
    p.reset();
    assert.equal(p.allow(100, 50_000), true, '新しい接続では数え直す');
  });

  test('終わった後（closed・error）に遅れて届いた session・draining で通訳中へ戻らない', () => {
    const active = C.voiceReducer(C.voiceReducer(C.VOICE_IDLE, { type: 'start' }), { type: 'server', msg: { type: 'session', session_id: 's', resume_token: 't' } });
    const closed = C.voiceReducer(active, { type: 'server', msg: { type: 'closed', reason: 'normal' } });
    assert.equal(C.voiceReducer(closed, { type: 'server', msg: { type: 'session', session_id: 's', resume_token: 't2' } }), closed);
    assert.equal(C.voiceReducer(closed, { type: 'server', msg: { type: 'draining' } }), closed);
    const err = C.voiceReducer(active, { type: 'server', msg: { type: 'error', code: 'budget_stop' } });
    assert.equal(C.voiceReducer(err, { type: 'server', msg: { type: 'session', session_id: 's', resume_token: 't3' } }), err);
  });

  test('中継が端末の切断として閉じた（client_disconnected）時は再開を試す。利用者が止めた後なら終える', () => {
    const active = C.voiceReducer(C.voiceReducer(C.VOICE_IDLE, { type: 'start' }), { type: 'server', msg: { type: 'session', session_id: 's', resume_token: 't' } });
    const r = C.voiceReducer(active, { type: 'server', msg: { type: 'closed', reason: 'client_disconnected' } });
    assert.deepEqual([r.phase, r.resumeToken, r.resumeCount], ['reconnecting', 't', 1]);
    const stopping = C.voiceReducer(active, { type: 'stop' });
    assert.equal(C.voiceReducer(stopping, { type: 'server', msg: { type: 'closed', reason: 'client_disconnected' } }).phase, 'closed');
  });

  test('端末の期限：接続中は通信不可のエラー、再接続中は再開の1回、終了中は閉じる（詰まらない）', () => {
    const connecting = C.voiceReducer(C.VOICE_IDLE, { type: 'start' });
    assert.deepEqual([C.voiceReducer(connecting, { type: 'timeout' }).phase, C.voiceReducer(connecting, { type: 'timeout' }).error], ['error', 'offline']);
    const active = C.voiceReducer(connecting, { type: 'server', msg: { type: 'session', session_id: 's', resume_token: 't' } });
    const rec = C.voiceReducer(active, { type: 'socket_lost' });
    assert.equal(C.voiceReducer(rec, { type: 'timeout' }).resumeCount, 2);
    const drain = C.voiceReducer(active, { type: 'stop' });
    assert.deepEqual([C.voiceReducer(drain, { type: 'timeout' }).phase, C.voiceReducer(drain, { type: 'timeout' }).closedReason], ['closed', 'timeout']);
    assert.equal(C.voiceReducer(active, { type: 'timeout' }), active, '通訳中は何もしない');
  });

  test('再開の待ち：0.5→1→2→4→4 秒', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6].map(W.resumeDelayMs), [500, 1_000, 2_000, 4_000, 4_000, 4_000]);
  });

  test('終了の理由：中継が送る理由（provider_error・client_disconnected）と端末の期限に固有の文。知らない値は汎用', () => {
    for (const r of ['provider_error', 'client_disconnected', 'timeout', 'limit', 'idle', 'superseded', 'kill_switch', 'background']) {
      assert.notEqual(C.describeClosedReason(r), C.describeClosedReason('???'), r);
    }
  });
});

describe('2026-11-26 再確認の反映', () => {
  test('送信の歩調：長く実時間どおりに送った後の停滞のまとめ送りも通さない（貯められるのは300msまで）', () => {
    const p = new P.UplinkPacer();
    let t = 0;
    for (let i = 0; i < 600; i += 1) { t += 100; assert.equal(p.allow(100, t), true, `実時間どおり i=${i}`); }
    // JS が1.5秒止まり、15区画がまとめて届く
    t += 1_500;
    let sent = 0;
    for (let i = 0; i < 15; i += 1) if (p.allow(100, t)) sent += 1;
    assert.ok(sent <= 3, `まとめ送りは貯めた分まで（${sent}）`);
  });

  test('送信の歩調：どの10秒の窓でも 10,800ms を超えない（中継の絞り 11,000ms の内側）', () => {
    const p = new P.UplinkPacer();
    const sent = [];
    let t = 0;
    // 不規則な停滞とまとめ送りを繰り返す
    for (let k = 0; k < 400; k += 1) {
      t += (k % 7 === 0) ? 1_700 : 60;
      const burst = (k % 7 === 0) ? 20 : 1;
      for (let i = 0; i < burst; i += 1) if (p.allow(100, t)) sent.push(t);
    }
    for (const start of sent) {
      const inWindow = sent.filter((x) => x >= start && x < start + 10_000).length * 100;
      assert.ok(inWindow <= 10_800, `窓 ${start}: ${inWindow}ms`);
    }
  });
});
