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
 * ■ 解析規則は旧実装と同じ（JPYは`parseInt`、外貨は`parseFloat`。有限かつ0より大きい値のみ有効）。
 *   0や負数を許すかどうかは仕様の話であり、この修正では変えない。
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
    const n = parseInt(text, 10);
    if (!isFinite(n) || n <= 0) return { ok: false };
    if (n === input.currentJpyAmount) return { ok: true, changed: false };
    return { ok: true, changed: true, foreignAmount: n, jpyAmount: n };
  }
  const f = parseFloat(text);
  if (!isFinite(f) || f <= 0) return { ok: false };
  if (f === input.currentForeignAmount) return { ok: true, changed: false };
  return { ok: true, changed: true, foreignAmount: f, jpyAmount: Math.round(f * input.rateUsed) };
}
