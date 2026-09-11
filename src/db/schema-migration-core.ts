/**
 * DBマイグレーションの判断ロジック（純粋関数）。
 *
 * **react-native・expo-sqlite・値のimportを一切持たない自己完結モジュール。**
 * `node --test`から直接importして検証できる状態を保つ（`budget-core.ts`等と同じ規律）。
 * 実際のSQL実行は`schema.ts`側の責務で、ここは「今のテーブル状態から何をすべきか」だけを決める。
 *
 * ■ 背景（Fable 5.1 / Codex独立監査 2026-09-11、HEAD dbd99ce、S2-9）
 *   v3（tripsテーブルの再作成）はtransaction外で、途中終了すると再起動時に
 *   `DROP TABLE IF EXISTS _trips_old`が**バックアップごと**旅行データを消し、
 *   さらに新スキーマの`trips`を旧扱いして`currency`列から移行しようとして失敗→起動不能になり得た。
 *   v4〜v7のALTERは重複列以外の失敗も握り潰し、列が無いままversionだけ進む可能性があった。
 */

/** v3（trips再作成）で取るべき経路 */
export type TripsV3Plan =
  /** `trips`が旧スキーマ（`currency`列）：rename→新規作成→コピー→旧削除（通常経路） */
  | 'rename_and_copy'
  /** `_trips_old`が残っている（前回中断）：`trips`が無ければ新規作成し、`_trips_old`から未コピー分を取り込んで旧削除 */
  | 'resume_copy'
  /** `trips`が既に新スキーマで`_trips_old`も無い：テーブル操作は不要（列追加・version更新のみ） */
  | 'already_migrated'
  /** `trips`も`_trips_old`も無い：新スキーマで作るだけ（通常はv2で作られるため到達しない防御分岐） */
  | 'fresh_create';

export type TripsV3State = {
  /** `PRAGMA table_info(trips)`の列名。テーブルが無ければnull */
  tripsColumns: readonly string[] | null;
  /** `_trips_old`テーブルが存在するか */
  hasTripsOld: boolean;
};

/** 新スキーマの目印になる列（v3で追加された列） */
const NEW_SCHEMA_MARKER_COLUMN = 'base_currency';

export function planTripsV3(state: TripsV3State): TripsV3Plan {
  const { tripsColumns, hasTripsOld } = state;
  if (tripsColumns == null) {
    return hasTripsOld ? 'resume_copy' : 'fresh_create';
  }
  const isNewSchema = tripsColumns.includes(NEW_SCHEMA_MARKER_COLUMN);
  if (isNewSchema) {
    return hasTripsOld ? 'resume_copy' : 'already_migrated';
  }
  // 旧スキーマ。`_trips_old`が同時に存在するのは通常到達しない状態だが、データは`trips`（旧）側にある
  // （renameが成功していれば`trips`は旧スキーマで残らない）ため、通常経路で進めてよい。
  return 'rename_and_copy';
}

/**
 * `ALTER TABLE ... ADD COLUMN`の失敗が「列が既に存在する」ものか。
 *
 * これだけを無視し、それ以外（I/Oエラー・DB破損・ロック等）は投げ直してversionを進めない
 * （列が無いままversionだけ進み、以後の全SELECTが失敗し続ける不整合を固定しないため）。
 * SQLiteの文言は`duplicate column name: xxx`。厳密一致ではなく部分一致・大文字小文字無視で判定し、
 * 文言の細かな差で「これまで黙って進んでいた経路」を起動不能にしない。
 */
export function isDuplicateColumnError(error: unknown): boolean {
  const message =
    typeof error === 'string'
      ? error
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message: unknown }).message)
        : '';
  return message.toLowerCase().includes('duplicate column');
}
