/**
 * `utils/resolve-image-uri-core.ts`の検証（`node --test src/utils/resolve-image-uri-core.test.mjs`）。
 *
 * 最重要：iOSでアプリコンテナUUIDが変わった後、DBに残る旧コンテナのURIを
 * 現在の documentDirectory 基準へ組み直せること。表示だけでなく写真fileの削除も
 * この結果を使う（生URIのまま`deleteAsync`へ渡すと到達できず孤児fileが残る）。
 */
import { equal } from 'node:assert/strict';
import { test } from 'node:test';

import { resolveImageUriWith } from './resolve-image-uri-core.ts';

const OLD = 'file:///var/mobile/Containers/Data/Application/0B4A2C3D-OLD0-4000-8000-000000000001/Documents/';
const NEW = 'file:///var/mobile/Containers/Data/Application/7E6F5A4B-NEW0-4000-8000-000000000002/Documents/';

test('現在コンテナ配下のURIはそのまま返す（新規保存分・同セッションの下書き）', () => {
  const uri = `${NEW}photos/1758100000000.jpg`;
  equal(resolveImageUriWith(uri, NEW, false), uri);
});

test('旧コンテナUUIDのURIは現在の documentDirectory 基準へ組み直す（生URIとは別の値になる）', () => {
  const stored = `${OLD}photos/1758100000000.jpg`;
  const resolved = resolveImageUriWith(stored, NEW, false);
  equal(resolved, `${NEW}photos/1758100000000.jpg`);
  // 生URIをそのまま削除対象にすると旧pathのまま＝到達不能。resolverを通すと現在側になることを固定
  equal(resolved === stored, false);
});

test('UUIDだけが変わり、Documents配下の相対位置（サブdir・ファイル名）は維持される', () => {
  equal(
    resolveImageUriWith(`${OLD}photos/sub/dir/abc-123.jpg`, NEW, false),
    `${NEW}photos/sub/dir/abc-123.jpg`,
  );
});

test('null / undefined / 空文字は null（呼び出し側は削除・表示をスキップする契約）', () => {
  equal(resolveImageUriWith(null, NEW, false), null);
  equal(resolveImageUriWith(undefined, NEW, false), null);
  equal(resolveImageUriWith('', NEW, false), null);
});

test('webでは変換せず入力をそのまま返す', () => {
  const uri = 'blob:http://localhost/abc';
  equal(resolveImageUriWith(uri, NEW, true), uri);
  equal(resolveImageUriWith(`${OLD}photos/a.jpg`, NEW, true), `${OLD}photos/a.jpg`);
});

test('documentDirectory が不明なら変換せず入力をそのまま返す', () => {
  const uri = `${OLD}photos/a.jpg`;
  equal(resolveImageUriWith(uri, null, false), uri);
  equal(resolveImageUriWith(uri, undefined, false), uri);
  equal(resolveImageUriWith(uri, '', false), uri);
});

test('`/Documents/`を含まないURI（content:// / ph:// 等）は書き換えず、ローカルfileへ変換しない', () => {
  const content = 'content://media/external/images/media/42';
  const ph = 'ph://ABCDEF-1234/L0/001';
  equal(resolveImageUriWith(content, NEW, false), content);
  equal(resolveImageUriWith(ph, NEW, false), ph);
});

test('`/Documents/`直後が空（dirそのもの）のURIは書き換えない', () => {
  equal(resolveImageUriWith(OLD, NEW, false), OLD);
});
