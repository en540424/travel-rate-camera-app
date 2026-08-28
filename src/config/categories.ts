/**
 * 買い物カテゴリーの単一ソース。
 *
 * **react-native・nativeモジュール・`@/`エイリアスを一切importしない。**
 * `node --test`から直接importして検証できる状態を保つため
 * （`speech-locales.ts`・`tts-voice-preferences-core.ts`と同じ規律）。
 *
 * ■ DBへ保存するのは`id`（英字slug）であって`label`（日本語）ではない
 *   `conversion_history.category`には必ず`id`を書く。日本語ラベルを保存すると、
 *   将来ラベルを言い換えた瞬間に既存recordが孤児になり、戻す手段が無くなる（一方通行）。
 *   表示は常に`id → label`の変換で行う。
 *
 * ■ `null`（未分類）は「その他」ではない
 *   カテゴリー機能の追加以前に保存された既存recordは全て`null`になる。
 *   「その他」はユーザーが**選んだ**結果であり、未分類とは意味が違うため、
 *   集計・表示のどちらでも同一視しない（`category-analytics-core.ts`参照）。
 */

export type CategoryId = 'food' | 'souvenir' | 'clothing' | 'transport' | 'entertainment' | 'other';

export type CategoryDef = { id: CategoryId; label: string };

/** 表示順もこの配列順を正とする（UIのチップ並び・集計の同額時の並び） */
export const CATEGORIES: readonly CategoryDef[] = [
  { id: 'food', label: '食事' },
  { id: 'souvenir', label: 'お土産' },
  { id: 'clothing', label: '衣類' },
  { id: 'transport', label: '交通' },
  { id: 'entertainment', label: '娯楽' },
  { id: 'other', label: 'その他' },
] as const;

/** 未分類（DB上は`null`）の表示ラベル。カテゴリーidではないので`CATEGORIES`には含めない */
export const UNCATEGORIZED_LABEL = '未分類';

/**
 * DBから読んだ値が既知のカテゴリーidか判定する。
 * 未知の値（将来カテゴリーを減らした場合の残骸・手で書き換えられた値）は`null`扱いにして
 * 表示・集計から安全に外すため、読み取り側は必ずこの関数を通す。
 */
export function isCategoryId(value: string | null | undefined): value is CategoryId {
  if (value == null || value === '') return false;
  return CATEGORIES.some((category) => category.id === value);
}

/** 既知のidならそのまま、未知・未設定なら`null`へ正規化する */
export function normalizeCategoryId(value: string | null | undefined): CategoryId | null {
  return isCategoryId(value) ? value : null;
}

/** カテゴリーidの表示ラベル。未知・未設定は`UNCATEGORIZED_LABEL` */
export function getCategoryLabel(value: string | null | undefined): string {
  const id = normalizeCategoryId(value);
  if (id === null) return UNCATEGORIZED_LABEL;
  return CATEGORIES.find((category) => category.id === id)?.label ?? UNCATEGORIZED_LABEL;
}

/*
 * ここから下はカテゴリー別集計（分析タブ用）。
 * 別ファイルへ分けず`speech-locales.ts`と同じく「表＋その表を使う純粋関数」を1ファイルに置く。
 * 相対importを持たない自己完結モジュールにしておくことで、`node --test`から
 * そのままimportして検証できる状態を保つ。
 */

/** 集計対象の1件。呼び出し側で期間・購入済みの絞り込みを済ませてから渡す */
export type CategoryAggregateInput = {
  /** DBの`conversion_history.category`の生値。未知の値・未設定は未分類として扱う */
  category: string | null | undefined;
  /** 円換算済み金額（`HistoryRow.jpy_amount`。通貨正規化は保存時に完了している） */
  jpyAmount: number;
};

/** 集計結果の1行 */
export type CategoryAggregateRow = {
  /** 未分類は`null` */
  id: CategoryId | null;
  label: string;
  /** 金額合計（円） */
  total: number;
  /** 件数 */
  count: number;
  /** 全体に対する金額比（0〜1）。合計が0のときは0 */
  share: number;
};

/** `CATEGORIES`の定義順。同額時の並びを安定させるために使う（未分類は常に最後） */
function definitionOrder(id: CategoryId | null): number {
  if (id === null) return Number.MAX_SAFE_INTEGER;
  const index = CATEGORIES.findIndex((category) => category.id === id);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/**
 * カテゴリー別に件数・金額合計・構成比を集計する。
 *
 * ■ 期間・購入済みの絞り込みはここでは行わない
 *   `analytics.tsx`側の既存`tripSummary`が「`is_purchased === 1` かつ `matchesPeriod(...)`」で
 *   絞っているため、**同じ絞り込み結果を渡す**のが呼び出し側の責務。ここで別の条件を足すと、
 *   同じ画面に並ぶ「旅行別」カードと「カテゴリー別」カードで合計が食い違って見える。
 *
 * 並び順は金額合計の降順。同額の場合は`CATEGORIES`の定義順（未分類は常に最後）。
 * 1件も無いカテゴリーは行を作らない（0円の行で埋めない）。
 */
export function aggregateByCategory(
  rows: readonly CategoryAggregateInput[],
): CategoryAggregateRow[] {
  const list = rows ?? [];

  const buckets = new Map<CategoryId | null, { total: number; count: number }>();
  let grandTotal = 0;

  for (const row of list) {
    const id = normalizeCategoryId(row.category);
    const amount = Number.isFinite(row.jpyAmount) ? row.jpyAmount : 0;
    const bucket = buckets.get(id) ?? { total: 0, count: 0 };
    bucket.total += amount;
    bucket.count += 1;
    buckets.set(id, bucket);
    grandTotal += amount;
  }

  const result: CategoryAggregateRow[] = [];
  for (const [id, bucket] of buckets) {
    result.push({
      id,
      label: id === null ? UNCATEGORIZED_LABEL : getCategoryLabel(id),
      total: bucket.total,
      count: bucket.count,
      share: grandTotal > 0 ? bucket.total / grandTotal : 0,
    });
  }

  result.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return definitionOrder(a.id) - definitionOrder(b.id);
  });

  return result;
}
