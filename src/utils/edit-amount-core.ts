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
}

export function resolveEditedAmount(input: EditedAmountInput): EditedAmountResolution {
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
