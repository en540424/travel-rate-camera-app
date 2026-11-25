/**
 * AI翻訳の中継（tabirate-ai-gateway）のURL。**未設定（null）の間、AI翻訳は「準備中」として動かない。**
 *
 * 中継の本番環境の作成・deploy・Secretの設定はHuman-only（H-P12）。URLを入れるのは、中継の外部入口・認証・
 * 利用量の台帳が揃い、Pro+の商品がASC・RevenueCatに登録された後。鍵（APIキー）はここにもアプリのどこにも入れない。
 */
export const AI_GATEWAY_URL: string | null = null;

/**
 * リアルタイム音声翻訳の端末側（マイクのPCMの連続取得・訳の音声の連続再生）を release で使ってよいか。**実機で確かめるまで false。**
 * 2026-11-26：取り込み・再生のコード（react-native-audio-api 1.0.1・src/lib/ai/voice-audio.native.ts）と中継との手順は入ったが、
 * ネイティブ依存で Build が要り、実機（TEST_CHECKLIST #100〜#105）が未確認。false の間、release の画面は音声を「準備中」にする。
 * Pro+ の購入画面はこの値で音声を「準備中」と表示する（使えない機能を利用可と書かない）。
 */
export const AI_VOICE_CAPTURE_READY = false;

/**
 * 訳の音声の再生中はマイクの音声を中継へ送らない（半二重）か。スピーカーの訳を拾って訳し直す事故を防ぐ。
 * **暫定の値。音声の操作方式（H-P9：話す側1本か常時2本か・押している間だけか）と一緒に Human が決める。**
 * 端末のエコー対策（iOS の voice processing）だけで足りるかは実機で確かめる。
 */
export const AI_VOICE_HALF_DUPLEX = true;
