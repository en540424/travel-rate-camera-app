/**
 * `lib/csv-export-core.ts`の検証（`node --test src/lib/csv-export-core.test.mjs`）。
 *
 * カテゴリーラベル変換は**本物の`config/categories.ts`の`getCategoryLabel`を注入して**検証する
 * （テスト用に別のcategory mapを作ると、本番と食い違っても気づけないため）。
 * テストファイル(.mjs)からは`.ts`拡張子付きの相対importが使えるので、
 * 本体側が拡張子無しimportを持てない制約をここで回避している。
 */
import { deepEqual, equal, ok } from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';

import { getCategoryLabel } from '../config/categories.ts';
import {
  CSV_HEADERS,
  UTF8_BOM,
  buildCsvFilename,
  buildHistoryCsv,
  escapeCsvField,
  formatNumberCell,
  sanitizeFilenamePart,
  withUtf8Bom,
} from './csv-export-core.ts';

/** テスト用の1件。個別テストで必要な項目だけ上書きする */
function row(overrides = {}) {
  return {
    createdAt: '2026-08-28 10:30:00',
    entryDate: '2026-08-28',
    category: 'food',
    memo: 'キムチ',
    isPurchased: true,
    currency: 'KRW',
    foreignAmount: 12000,
    jpyAmount: 1320,
    rateUsed: 0.11,
    ...overrides,
  };
}

const OPTS = { tripName: '韓国旅行', categoryLabelOf: getCategoryLabel };

// ── escaping ────────────────────────────────────────────────

test('escapeCsvField: 特殊文字が無ければそのまま', () => {
  equal(escapeCsvField('キムチ'), 'キムチ');
  equal(escapeCsvField('plain'), 'plain');
});

test('escapeCsvField: commaを含むと全体を引用符で囲む', () => {
  equal(escapeCsvField('a,b'), '"a,b"');
});

test('escapeCsvField: double quoteは""へエスケープし全体を囲む', () => {
  equal(escapeCsvField('say "hi"'), '"say ""hi"""');
});

test('escapeCsvField: 改行(LF/CRLF)を含むと引用符で囲む', () => {
  equal(escapeCsvField('a\nb'), '"a\nb"');
  // 先頭文字が`a`なので数式ガードは付かず、改行のため引用符で囲まれるだけ
  equal(escapeCsvField('a\r\nb'), '"a\r\nb"');
});

test('escapeCsvField: null / undefined は空セル（"null"を書き出さない）', () => {
  equal(escapeCsvField(null), '');
  equal(escapeCsvField(undefined), '');
  equal(escapeCsvField(''), '');
});

test('escapeCsvField: 日本語・emoji・Unicodeをそのまま通す', () => {
  equal(escapeCsvField('お土産🎁'), 'お土産🎁');
  equal(escapeCsvField('café ñ 한국어'), 'café ñ 한국어');
});

// ── CSV injection ───────────────────────────────────────────

test('escapeCsvField: 数式として解釈されうる先頭文字に\'を前置する', () => {
  equal(escapeCsvField('=SUM(A1:A9)'), "'=SUM(A1:A9)"); // commaを含まないので囲みは不要
  equal(escapeCsvField('=SUM(A1,A9)'), '"\'=SUM(A1,A9)"'); // commaを含む場合は囲みも付く
  equal(escapeCsvField('=1+1'), "'=1+1");
  equal(escapeCsvField('+1'), "'+1");
  equal(escapeCsvField('-abc'), "'-abc");
  equal(escapeCsvField('@import'), "'@import");
});

test('escapeCsvField: 先頭以外の=や+はガードしない（実データを壊さない）', () => {
  equal(escapeCsvField('a=b'), 'a=b');
  equal(escapeCsvField('1+1'), '1+1');
});

test('formatNumberCell: 数値セルには数式ガードを付けない（負数を数値のまま保つ）', () => {
  equal(formatNumberCell(-500), '-500');
  equal(formatNumberCell(0), '0');
  equal(formatNumberCell(0.11), '0.11');
});

test('formatNumberCell: null / NaN / Infinity は空セル', () => {
  equal(formatNumberCell(null), '');
  equal(formatNumberCell(undefined), '');
  equal(formatNumberCell(Number.NaN), '');
  equal(formatNumberCell(Number.POSITIVE_INFINITY), '');
});

// ── header / 本文 ───────────────────────────────────────────

test('buildHistoryCsv: 見出し行が定義どおり', () => {
  const csv = buildHistoryCsv([], OPTS);
  equal(csv.split('\r\n')[0], '保存日時,記録日,旅行名,カテゴリー,メモ,状態,元通貨,元金額,換算金額(円),レート');
  equal(CSV_HEADERS.length, 10);
});

test('buildHistoryCsv: 0件でも見出し行だけのCSVを返す', () => {
  const csv = buildHistoryCsv([], OPTS);
  equal(csv.split('\r\n').filter((l) => l !== '').length, 1);
});

test('buildHistoryCsv: 行はCRLF区切りで末尾にも改行が付く', () => {
  const csv = buildHistoryCsv([row()], OPTS);
  ok(csv.endsWith('\r\n'));
  equal(csv.split('\r\n').filter((l) => l !== '').length, 2);
});

test('buildHistoryCsv: 1件の全列が期待どおり並ぶ', () => {
  const csv = buildHistoryCsv([row()], OPTS);
  const cells = csv.split('\r\n')[1].split(',');
  deepEqual(cells, [
    '2026-08-28 10:30:00',
    '2026-08-28',
    '韓国旅行',
    '食事',
    'キムチ',
    '購入済み',
    'KRW',
    '12000',
    '1320',
    '0.11',
  ]);
});

test('buildHistoryCsv: 候補/購入済みが状態列に出る（分析の絞り込みは流用しない＝全件出す）', () => {
  const csv = buildHistoryCsv([row({ isPurchased: true }), row({ isPurchased: false })], OPTS);
  const lines = csv.split('\r\n').filter((l) => l !== '');
  equal(lines.length, 3); // header + 2件（候補も除外しない）
  ok(lines[1].includes('購入済み'));
  ok(lines[2].includes('候補'));
});

// ── category（本物のgetCategoryLabelを注入） ────────────────

test('buildHistoryCsv: categoryのslugを日本語ラベルへ変換する', () => {
  const slugs = ['food', 'souvenir', 'clothing', 'transport', 'entertainment', 'other'];
  const expected = ['食事', 'お土産', '衣類', '交通', '娯楽', 'その他'];
  const csv = buildHistoryCsv(slugs.map((category) => row({ category })), OPTS);
  const lines = csv.split('\r\n').filter((l) => l !== '').slice(1);
  deepEqual(lines.map((l) => l.split(',')[3]), expected);
});

test('buildHistoryCsv: category未設定(null)は「未分類」', () => {
  const csv = buildHistoryCsv([row({ category: null })], OPTS);
  equal(csv.split('\r\n')[1].split(',')[3], '未分類');
});

test('buildHistoryCsv: 未知のcategory値も「未分類」へ寄せる', () => {
  const csv = buildHistoryCsv([row({ category: 'legacy_removed' })], OPTS);
  equal(csv.split('\r\n')[1].split(',')[3], '未分類');
});

// ── 実データの揺れ ──────────────────────────────────────────

test('buildHistoryCsv: memoのcomma・改行・引用符でも列がずれない', () => {
  const csv = buildHistoryCsv([row({ memo: 'a,b\n"c"' })], OPTS);
  ok(csv.includes('"a,b\n""c"""'));
});

test('buildHistoryCsv: memoがnullでも空セルとして出る', () => {
  const csv = buildHistoryCsv([row({ memo: null })], OPTS);
  const cells = csv.split('\r\n')[1].split(',');
  equal(cells[4], '');
});

test('buildHistoryCsv: entry_date未設定でも空セルとして出る', () => {
  const csv = buildHistoryCsv([row({ entryDate: null })], OPTS);
  equal(csv.split('\r\n')[1].split(',')[1], '');
});

test('buildHistoryCsv: 旅行名のcommaでも列がずれない', () => {
  const csv = buildHistoryCsv([row()], { ...OPTS, tripName: '韓国,ソウル' });
  ok(csv.includes('"韓国,ソウル"'));
});

// ── BOM ─────────────────────────────────────────────────────

test('withUtf8Bom: 先頭にBOMを付ける', () => {
  const csv = withUtf8Bom('a,b\r\n');
  ok(csv.startsWith(UTF8_BOM));
  equal(csv, `${UTF8_BOM}a,b\r\n`);
});

test('withUtf8Bom: 二重に付けない', () => {
  equal(withUtf8Bom(withUtf8Bom('a')), `${UTF8_BOM}a`);
});

test('UTF8_BOM: UTF-8へエンコードするとEF BB BFの3バイトになる', () => {
  deepEqual(Array.from(Buffer.from(UTF8_BOM, 'utf8')), [0xef, 0xbb, 0xbf]);
});

test('BOM付きCSVをUTF-8で書き出すと日本語が壊れない', () => {
  const csv = withUtf8Bom(buildHistoryCsv([row()], OPTS));
  const bytes = Buffer.from(csv, 'utf8');
  deepEqual(Array.from(bytes.subarray(0, 3)), [0xef, 0xbb, 0xbf]);
  ok(bytes.toString('utf8').includes('キムチ'));
  ok(bytes.toString('utf8').includes('食事'));
});

// ── filename ────────────────────────────────────────────────

test('sanitizeFilenamePart: OSで使えない文字を_へ置換する', () => {
  equal(sanitizeFilenamePart('a/b\\c:d*e?f"g<h>i|j'), 'a_b_c_d_e_f_g_h_i_j');
});

test('sanitizeFilenamePart: ハイフンと半角スペースは壊さない', () => {
  equal(sanitizeFilenamePart('2026-08-28'), '2026-08-28');
  equal(sanitizeFilenamePart('Seoul Trip'), 'Seoul Trip');
});

test('sanitizeFilenamePart: 制御文字を除去する', () => {
  equal(sanitizeFilenamePart('a bc'), 'a_b_c');
});

test('sanitizeFilenamePart: 前後の空白と.を落とす（隠しファイル化を防ぐ）', () => {
  equal(sanitizeFilenamePart('  trip  '), 'trip');
  equal(sanitizeFilenamePart('...trip...'), 'trip');
});

test('sanitizeFilenamePart: 空白の連続を1つへまとめる', () => {
  equal(sanitizeFilenamePart('a    b'), 'a b');
});

test('sanitizeFilenamePart: 長すぎる名前を切り詰める', () => {
  equal(sanitizeFilenamePart('あ'.repeat(100)).length, 40);
});

test('sanitizeFilenamePart: null / undefined / 空は空文字', () => {
  equal(sanitizeFilenamePart(null), '');
  equal(sanitizeFilenamePart(undefined), '');
  equal(sanitizeFilenamePart('///'), '___');
});

test('buildCsvFilename: 旅行名と日付を含む読めるファイル名になる', () => {
  equal(buildCsvFilename('韓国旅行', '2026-08-28'), 'travel-rate-camera_韓国旅行_2026-08-28.csv');
});

test('buildCsvFilename: 旅行名が空/nullなら旅行名部分を省く（二重区切りを作らない）', () => {
  equal(buildCsvFilename(null, '2026-08-28'), 'travel-rate-camera_2026-08-28.csv');
  equal(buildCsvFilename('   ', '2026-08-28'), 'travel-rate-camera_2026-08-28.csv');
});

test('buildCsvFilename: 旅行名にパス区切りが入っても安全な名前になる', () => {
  const name = buildCsvFilename('a/b:c', '2026-08-28');
  equal(name, 'travel-rate-camera_a_b_c_2026-08-28.csv');
  ok(!name.includes('/'));
  ok(!name.includes(':'));
});

test('buildCsvFilename: 必ず.csvで終わる', () => {
  ok(buildCsvFilename('韓国旅行', '2026-08-28').endsWith('.csv'));
  ok(buildCsvFilename('', '').endsWith('.csv'));
});
