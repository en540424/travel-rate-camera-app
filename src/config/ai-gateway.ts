/**
 * AI翻訳の中継（tabirate-ai-gateway）のURL。**未設定（null）の間、AI翻訳は「準備中」として動かない。**
 *
 * 中継の本番環境の作成・deploy・Secretの設定はHuman-only（H-P12）。URLを入れるのは、中継の外部入口・認証・
 * 利用量の台帳が揃い、Pro+の商品がASC・RevenueCatに登録された後。鍵（APIキー）はここにもアプリのどこにも入れない。
 */
export const AI_GATEWAY_URL: string | null = null;

/**
 * リアルタイム音声翻訳の端末側（マイクのPCMの連続取得・訳の音声の連続再生）が入っているか。**未導入のため false。**
 * 中継の音声の入口（WebSocket）はサーバー側にあるが、アプリ側の取り込み・再生部品（ネイティブ依存・Buildが必要）は次の工程。
 * Pro+ の購入画面はこの値で音声を「準備中」と表示する（使えない機能を利用可と書かない）。
 */
export const AI_VOICE_CAPTURE_READY = false;
