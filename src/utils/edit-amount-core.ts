/**
 * 履歴編集画面（`item-edit.tsx`）の金額欄の判定（純粋関数）。
 *
 * **react-native・nativeモジュール・値のimportを一切持たない自己完結モジュール。**
 * `node --test`から直接importして検証できる状態を保つ（`budget-core.ts`等と同じ規律）。
 *
 * ■ なぜ「不正な金額」を保存処理の**前**に判定するのか
 *   旧実装は金額の解析を保存処理の途中（写真確定の後）で行い、不正な場合は金額の書き込みだけ
 *   黙ってスキップしていた。ところが保存処理の最後では未保存フラグ解除と`router.back()`が
 *   無条件に走るため、「金額欄を空にして保存 → メモ等だけ保存され、金額は旧値のまま画面が閉じる」
 *   という、ユーザーへ何も伝えない不整合が起きていた（コード内コメントの「未保存のまま維持」とも矛盾）。
 *   ここで事前に判定し、不正なら**DBへ一切書かず**画面に留まる。
 *
 * ■ 解析規則：外貨は`parseFloat`（小数を保持）。JPYは`parseFloat`した値を`Math.round`で整数円へ丸め、
 *   現在値も同じ規則で丸めてから比較する（2026-09-18変更。旧実装は`parseInt`＝切り捨て）。
 *   JPYの丸め規則は repo 全体で`Math.round`（`formatJpy`・`budget-core`・SQL `ROUND(jpy_amount)`・下の外貨→円換算）
 *   であり、編集欄だけが切り捨てだと、`jpy_amount = 1200.5`のような既存の小数JPY記録を開いて金額を触らずに
 *   保存した時に `parseInt("1200.5") = 1200 ≠ 1200.5` → `changed:true` となり、メモだけ直したつもりでも
 *   `jpy_amount`が1200へ黙って書き換わっていた。現在値を丸めて比較するので、既存の小数値はこの関数からは
 *   書き換わらない（明示的に別の金額を入れた時だけ整数円で更新される）。
 *   有限かつ丸めた後で0より大きい値のみ有効。0や負数を許すかどうかは仕様の話であり、この修正では変えない。
 */

export type EditedAmountResolution =
  /** 入力が不正（空・非数値・0以下・非有限）。DBへ書かず、画面に留まる */
  | { ok: false }
  /** 有効だが現在値と同じ。DBへは触らない（他項目と同じ「変わっていなければ書かない」規律） */
  | { ok: true; changed: false }
  /** 有効かつ変更あり。この値でDBを更新する */
  | { ok: true; changed: true; foreignAmount: number; jpyAmount: number };

export interface EditedAmountInput {
  /** 記録の通貨。`'JPY'`なら円建て（整数）、それ以外は外貨建て */
  currency: string;
  /** 金額欄の文字列（trim前でよい） */
  text: string;
  /** 記録の現在値 */
  currentForeignAmount: number;
  currentJpyAmount: number;
  /** 保存時に固定したレート（外貨→円の換算に使う。記録ごとの値であり旅行の現在レートではない） */
  rateUsed: number;
  /** 記録の基準通貨と丸め。**未指定か基準通貨が 'JPY' なら今の規則のまま**（GX-06 段階 c） */
  home?: EditHomeContext;
}

/**
 * 記録の基準通貨（GX-06 段階 c・設計書 `design/gx05-home-currency-design.md` §4・§12-1 B2・§13 SF3）。
 * このモジュールは値の import を持たない（S8）ので、通貨の桁で丸める関数は呼び出し側が注入する
 * （画面は `money-core.ts` の `roundMoney`）。
 */
export interface EditHomeContext {
  /** 記録の基準通貨（`HistoryRow.home_currency`）。'JPY' なら今の規則のまま */
  homeCurrency: string;
  /** 基準通貨の桁で丸める（`roundMoney(x, 基準通貨)`） */
  roundHome: (amount: number) => number;
  /** 記録の通貨（現地通貨）の桁で丸める（`roundMoney(x, 記録の通貨)`） */
  roundLocal: (amount: number) => number;
}

/** 基準通貨が円以外の記録か（円の記録・未指定は今の規則の分岐へ） */
function nonJpyHome(home: EditHomeContext | undefined): home is EditHomeContext {
  return home != null && home.homeCurrency !== 'JPY';
}

export function resolveEditedAmount(input: EditedAmountInput): EditedAmountResolution {
  if (nonJpyHome(input.home)) return resolveEditedAmountNonJpyHome(input, input.home);
  const text = input.text.trim();
  if (input.currency === 'JPY') {
    const parsed = parseFloat(text);
    if (!isFinite(parsed)) return { ok: false };
    const n = Math.round(parsed);
    if (n <= 0) return { ok: false };
    if (n === Math.round(input.currentJpyAmount)) return { ok: true, changed: false };
    return { ok: true, changed: true, foreignAmount: n, jpyAmount: n };
  }
  const f = parseFloat(text);
  if (!isFinite(f) || f <= 0) return { ok: false };
  if (f === input.currentForeignAmount) return { ok: true, changed: false };
  return { ok: true, changed: true, foreignAmount: f, jpyAmount: Math.round(f * input.rateUsed) };
}

/**
 * 基準通貨が円以外の記録の編集（GX-06 段階 c）。
 * - 国内（記録の通貨＝基準通貨）：入力を基準通貨の桁で丸め、現在値も同じ桁で丸めて比べる（円の分岐と同じ規律）
 * - 外貨：入力と現在値を**記録の通貨の桁で丸めて**比べる（§12-1 B2：逆換算で保存した 6.666666666666667 を
 *   欄に 6.67 で出しても、触らずに保存すれば changed:false）。変更の時の基準通貨の額は基準通貨の桁で丸める
 *   （§11 の「保存は生値・編集は基準通貨の桁で丸める」の非対称を保つ）。保存する外貨の額は入力のまま
 * - 訪日客の記録（記録の通貨 'JPY'・基準通貨が円以外）は外貨として扱う（国内として foreign=jpy で上書きしない）
 * - 仕様：その通貨の最小単位より細かい変更（6.67 → 6.671）は、丸めると同じなので変更として扱わない（DB へ書かない）
 */
function resolveEditedAmountNonJpyHome(input: EditedAmountInput, home: EditHomeContext): EditedAmountResolution {
  const text = input.text.trim();
  // 未変更の判定を「0より大きいか」より先に行う：丸めると 0 になる小さな保存値（逆換算の 0.0038 USD 等）は欄に「0」と
  // 出るので、触らずに保存しても不正で止まらないようにする（DB へは書かない）。空・非数値は先に不正にする
  if (input.currency === home.homeCurrency) {
    const parsed = parseFloat(text);
    if (!isFinite(parsed)) return { ok: false };
    const n = home.roundHome(parsed);
    if (n === home.roundHome(input.currentJpyAmount)) return { ok: true, changed: false };
    if (!(n > 0)) return { ok: false };
    return { ok: true, changed: true, foreignAmount: n, jpyAmount: n };
  }
  const f = parseFloat(text);
  if (!isFinite(f)) return { ok: false };
  if (home.roundLocal(f) === home.roundLocal(input.currentForeignAmount)) return { ok: true, changed: false };
  if (f <= 0) return { ok: false };
  return { ok: true, changed: true, foreignAmount: f, jpyAmount: home.roundHome(f * input.rateUsed) };
}

/**
 * 編集欄の初期値（`item-edit.tsx` はこれだけを使う・SF3）。
 * - 基準通貨が円（未指定を含む）：今のまま（円の記録は `String(Math.round(jpy_amount))`、外貨の記録は `String(foreign_amount)`）
 * - 基準通貨が円以外：国内は基準通貨の桁、外貨は記録の通貨の桁で丸めて出す（`6.666666666666667` を出さない・§12-1 B2）
 */
export function initialAmountText(input: {
  currency: string;
  foreignAmount: number;
  jpyAmount: number;
  home?: EditHomeContext;
}): string {
  const { home } = input;
  if (nonJpyHome(home)) {
    return input.currency === home.homeCurrency
      ? String(home.roundHome(input.jpyAmount))
      : String(home.roundLocal(input.foreignAmount));
  }
  return input.currency === 'JPY' ? String(Math.round(input.jpyAmount)) : String(input.foreignAmount);
}

/**
 * 編集画面のプレビュー（基準通貨の額。出せない時は null）。
 * - 基準通貨が円（未指定を含む）：今の式のまま（外貨は `Math.round(f * rateUsed)`、円は `parseFloat`→`Math.round`）
 * - 基準通貨が円以外（SF3）：金額が未変更なら保存済みの額を基準通貨の桁で丸めた値、変更なら保存される値、不正なら null
 */
export function previewHomeAmount(input: EditedAmountInput): number | null {
  const { home } = input;
  if (nonJpyHome(home)) {
    const r = resolveEditedAmount(input);
    if (!r.ok) return null;
    return r.changed ? r.jpyAmount : home.roundHome(input.currentJpyAmount);
  }
  if (input.currency !== 'JPY') {
    const f = parseFloat(input.text);
    return isFinite(f) && f > 0 ? Math.round(f * input.rateUsed) : null;
  }
  const parsed = parseFloat(input.text);
  const n = isFinite(parsed) ? Math.round(parsed) : NaN;
  return isFinite(n) && n > 0 ? n : null;
}
