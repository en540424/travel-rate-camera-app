/**
 * `utils/save-photo-state.ts`の検証（`node --test src/utils/save-photo-state.test.mjs`）。
 *
 * 再発防止（Build 004465f7のHuman実機確認）：撮り直して「この写真を使う」で選んだ写真ではなく、
 * 最初の写真が保存されていた。最後に「使う」と選んだ写真＝保存される写真、を操作の流れで確かめる。
 *
 * 下の`flow`は`(tabs)/index.tsx`のハンドラと同じ順で遷移関数を呼ぶ：
 *   読み取る（handlePhotoCapture→handleOcrResult）／新しい読み取りを使う（handleUseOcrResultCandidate）／
 *   前の読み取りを残す（handleKeepCurrentOcrResult）／商品写真を撮る（handleTakeProductPhoto）／
 *   ライブラリから選ぶ（handlePickPhotoFromLibrary）／シート・保存欄の各ボタン／保存（doSaveCandidate）
 */
import { deepEqual, equal } from 'node:assert/strict';
import { test } from 'node:test';

import {
  adoptChosenPhoto,
  adoptNewReadingPhoto,
  captureFirstScanPhoto,
  EMPTY_SAVE_PHOTO_STATE,
  hasComparableReading,
  isFirstScanCapture,
  keepCurrentPhoto,
  photoUriToSave,
  removeSavePhoto,
  selectNewPhotoCandidate,
  selectReadingPhoto,
  showReadingPhoto,
  toggleExcludePhoto,
} from './save-photo-state.ts';

function flow() {
  let state = EMPTY_SAVE_PHOTO_STATE;
  let hasOcrResult = false;
  let hasReadingCandidate = false; // 再読み取りの結果が「新しい読み取りを使う／前の読み取りを残す」待ち
  let readingCandidatePhoto = null; // その写真
  const api = {
    /**
     * 価格OCRの「読み取る」：撮影→読み取り完了。`uri`がnullなら撮影失敗（写真なしでエラー結果が届く）。
     * handlePhotoCapture・handleOcrResultは「読み取る」を押した時点の状態（before）で判定する。
     */
    scan(uri) {
      const before = state;
      const beforeHasResult = hasOcrResult;
      let lastScanned = null;
      if (uri != null) {
        if (isFirstScanCapture(before, beforeHasResult)) state = captureFirstScanPhoto(state, uri);
        else lastScanned = uri;
      }
      if (hasComparableReading(before, beforeHasResult)) {
        hasReadingCandidate = true; // 再読み取り：選ぶまで候補
        readingCandidatePhoto = lastScanned;
      } else {
        if (lastScanned != null) state = showReadingPhoto(state, lastScanned);
        hasOcrResult = true;
        hasReadingCandidate = false;
        readingCandidatePhoto = null;
      }
      return api;
    },
    scanFails() {
      return api.scan(null);
    },
    useNewReading() {
      state = adoptNewReadingPhoto(state, readingCandidatePhoto);
      hasReadingCandidate = false;
      readingCandidatePhoto = null;
      return api;
    },
    keepPreviousReading() {
      hasReadingCandidate = false;
      readingCandidatePhoto = null;
      return api;
    },
    /** 「新しい読み取りを使う／前の読み取りを残す」の案内が画面に出ているか（「読み取った値札」欄の中に出るため写真が要る） */
    get readingCandidateVisible() {
      return hasReadingCandidate && api.readingPreview != null;
    },
    get hasReadingCandidate() {
      return hasReadingCandidate;
    },
    takeProductPhoto(uri) {
      state = adoptChosenPhoto(state, uri, 'product');
      return api;
    },
    pickFromLibrary(uri) {
      state = adoptChosenPhoto(state, uri, 'library');
      return api;
    },
    sheetUseReadingPhoto() {
      state = selectReadingPhoto(state);
      return api;
    },
    useNewPhotoCandidate() {
      state = selectNewPhotoCandidate(state);
      return api;
    },
    keepCurrentPhoto() {
      state = keepCurrentPhoto(state);
      return api;
    },
    removePhoto() {
      state = removeSavePhoto(state);
      return api;
    },
    toggleExclude() {
      state = toggleExcludePhoto(state);
      return api;
    },
    get state() {
      return state;
    },
    /** 「履歴に残す写真」に表示される写真（写真なしならnull） */
    get shownSavePhoto() {
      return state.excludePhotoFromSave ? null : state.pendingPhotoUri;
    },
    /** 上部「読み取った値札」の写真 */
    get readingPreview() {
      return state.ocrPhotoUri ?? state.pendingPhotoUri;
    },
    /** 保存でコピーされる写真 */
    get saved() {
      return photoUriToSave(state);
    },
  };
  return api;
}

function assertShownEqualsSaved(f, label) {
  equal(f.shownSavePhoto, f.saved, `表示＝保存 ${label}`);
}

test('最初の写真のまま保存：最初の写真が保存される', () => {
  const f = flow().scan('shot1.jpg');
  equal(f.saved, 'shot1.jpg');
  assertShownEqualsSaved(f, '初回');
});

test('ケースA：1枚目→撮り直し2枚目→「新しい読み取りを使う」→2枚目が保存される（不具合の再現）', () => {
  const f = flow().scan('shot1.jpg').scan('shot2.jpg');
  // 選ぶ前は1枚目のまま（表示も保存も）
  equal(f.saved, 'shot1.jpg');
  f.useNewReading();
  equal(f.saved, 'shot2.jpg');
  equal(f.readingPreview, 'shot2.jpg', '上部の「読み取った値札」も同じ写真');
  equal(f.state.newPhotoCandidate, null, '保存欄でもう一度選ばせない');
  assertShownEqualsSaved(f, 'A');
});

test('ケースB：1枚目→2枚目→3枚目→3枚目で「新しい読み取りを使う」→3枚目が保存される', () => {
  // 2枚目を使ってから3枚目を使う
  const f = flow().scan('shot1.jpg').scan('shot2.jpg').useNewReading().scan('shot3.jpg').useNewReading();
  equal(f.saved, 'shot3.jpg');
  assertShownEqualsSaved(f, 'B-1');
  // 2枚目は選ばずに撮り直し、3枚目を使う
  const g = flow().scan('shot1.jpg').scan('shot2.jpg').scan('shot3.jpg').useNewReading();
  equal(g.saved, 'shot3.jpg');
  assertShownEqualsSaved(g, 'B-2');
});

test('2枚目を使った後、3枚目は「前の読み取りを残す」→2枚目が保存される（最後に選んだ写真）', () => {
  const f = flow().scan('shot1.jpg').scan('shot2.jpg').useNewReading().scan('shot3.jpg').keepPreviousReading();
  equal(f.saved, 'shot2.jpg');
  assertShownEqualsSaved(f, 'keep');
});

test('撮り直したが「前の読み取りを残す」→1枚目が保存される', () => {
  const f = flow().scan('shot1.jpg').scan('shot2.jpg').keepPreviousReading();
  equal(f.saved, 'shot1.jpg');
  equal(f.readingPreview, 'shot1.jpg');
});

test('写真なしで保存：撮り直して新しい読み取りを使っても写真は保存されない。「写真を残す」に戻すと最後の写真', () => {
  const f = flow().scan('shot1.jpg').toggleExclude().scan('shot2.jpg').useNewReading();
  equal(f.saved, null);
  assertShownEqualsSaved(f, 'exclude');
  f.toggleExclude();
  equal(f.saved, 'shot2.jpg');
});

test('写真を外した後の再読み取り：前の読み取りを残す→写真なし／新しい読み取りを使う→欄の候補（選ぶまで写真なし）', () => {
  const removed = flow().scan('shot1.jpg').removePhoto();
  equal(removed.saved, null);
  equal(removed.readingPreview, 'shot1.jpg', '「読み取った値札」には残る（見比べ・値札写真を使うで戻す）');
  removed.scan('shot2.jpg');
  equal(removed.readingCandidateVisible, true, '新しい読み取りの案内が画面に出る');
  removed.keepPreviousReading();
  equal(removed.saved, null, '旧実装はここで2枚目が保存対象になっていた');
  assertShownEqualsSaved(removed, 'remove-keep');

  const used = flow().scan('shot1.jpg').removePhoto().scan('shot2.jpg').useNewReading();
  equal(used.saved, null);
  deepEqual(used.state.newPhotoCandidate, { uri: 'shot2.jpg' });
  used.useNewPhotoCandidate();
  equal(used.saved, 'shot2.jpg');
  assertShownEqualsSaved(used, 'remove-use');

  // 外した値札写真はシートの「値札写真を使う」で戻せる
  const back = flow().scan('shot1.jpg').removePhoto().sheetUseReadingPhoto();
  equal(back.saved, 'shot1.jpg');
});

test('最初の撮影が失敗（写真なしのエラー結果）→次の読み取りはそのまま置き換え、その写真が保存対象', () => {
  const f = flow().scanFails();
  equal(f.saved, null);
  f.scan('shot2.jpg');
  equal(f.hasReadingCandidate, false, '見比べる写真が無いので候補にせず置き換える（案内が見えず止まらない）');
  equal(f.saved, 'shot2.jpg');
  equal(f.readingPreview, 'shot2.jpg');
  assertShownEqualsSaved(f, 'failed-first');
});

test('再読み取りの案内は、どの流れでも画面に出る（候補があるのに見えない状態を作らない）', () => {
  const flows = [
    flow().scan('a.jpg').scan('b.jpg'),
    flow().scan('a.jpg').removePhoto().scan('b.jpg'),
    flow().scan('a.jpg').toggleExclude().scan('b.jpg'),
    flow().scan('a.jpg').takeProductPhoto('p.jpg').scan('b.jpg'),
    flow().scan('a.jpg').takeProductPhoto('p.jpg').removePhoto().scan('b.jpg'),
    flow().scan('a.jpg').pickFromLibrary('l.jpg').scan('b.jpg'),
    flow().takeProductPhoto('p.jpg').scan('a.jpg').scan('b.jpg'),
    flow().scanFails().scanFails().scan('a.jpg').scan('b.jpg'),
  ];
  flows.forEach((f, i) => {
    if (f.hasReadingCandidate) equal(f.readingCandidateVisible, true, `flow ${i}`);
    assertShownEqualsSaved(f, `flow ${i}`);
  });
});

test('商品写真（カメラの再撮影→「写真を使用」）：最後に撮った商品写真がすぐ保存対象になる', () => {
  // カメラ画面内の再撮影はアプリへ返らない（最後に「写真を使用」した1枚だけが届く）
  const f = flow().scan('tag1.jpg').takeProductPhoto('product2.jpg');
  equal(f.saved, 'product2.jpg', '旧実装は保存欄でもう一度選ぶまで値札写真が保存されていた');
  equal(f.state.newPhotoCandidate, null);
  assertShownEqualsSaved(f, 'product');
  // もう一度撮れば、その写真
  f.takeProductPhoto('product3.jpg');
  equal(f.saved, 'product3.jpg');
  // 値札写真は「読み取った値札」とシートの「値札写真を使う」で戻せる
  equal(f.readingPreview, 'tag1.jpg');
  f.sheetUseReadingPhoto();
  equal(f.saved, 'tag1.jpg');
  assertShownEqualsSaved(f, 'back-to-tag');
});

test('商品写真は「写真なしで保存」中でも、撮って使えば写真ありに戻る', () => {
  const f = flow().scan('tag1.jpg').toggleExclude().takeProductPhoto('product2.jpg');
  equal(f.saved, 'product2.jpg');
});

test('商品写真を選んだ後の再読み取り：商品写真は黙って置き換えない（新しい値札写真は欄の候補）', () => {
  const f = flow().scan('tag1.jpg').takeProductPhoto('product2.jpg').scan('tag2.jpg').useNewReading();
  equal(f.saved, 'product2.jpg');
  equal(f.readingPreview, 'tag2.jpg', '上部は新しい値札');
  deepEqual(f.state.newPhotoCandidate, { uri: 'tag2.jpg' });
  assertShownEqualsSaved(f, 'product-reread');
  // 欄で「新しい写真を使う」→新しい値札写真
  f.useNewPhotoCandidate();
  equal(f.saved, 'tag2.jpg');
  // 「今の保存写真を使う」なら商品写真のまま
  const g = flow().scan('tag1.jpg').takeProductPhoto('product2.jpg').scan('tag2.jpg').useNewReading().keepCurrentPhoto();
  equal(g.saved, 'product2.jpg');
  equal(g.state.newPhotoCandidate, null);
});

test('商品写真を先に選んでから最初の読み取り：商品写真が保存対象のまま、値札は「読み取った値札」に出る（従来どおり）', () => {
  const f = flow().takeProductPhoto('product1.jpg').scan('tag1.jpg');
  equal(f.saved, 'product1.jpg');
  equal(f.readingPreview, 'tag1.jpg');
});

test('ライブラリから選ぶ：選んだ写真がすぐ保存対象。値札写真へ戻せる', () => {
  const f = flow().scan('tag1.jpg').pickFromLibrary('library2.jpg');
  equal(f.saved, 'library2.jpg');
  assertShownEqualsSaved(f, 'library');
  f.sheetUseReadingPhoto();
  equal(f.saved, 'tag1.jpg');
});

test('写真の遷移は写真の項目だけを変える（メモ・金額・カテゴリーは別stateで、ここでは扱わない）', () => {
  const keys = Object.keys(EMPTY_SAVE_PHOTO_STATE).sort();
  const f = flow().scan('shot1.jpg').scan('shot2.jpg').useNewReading().takeProductPhoto('p.jpg').toggleExclude();
  deepEqual(Object.keys(f.state).sort(), keys);
});

test('保存後のリセット相当（空の状態）は写真なし', () => {
  equal(photoUriToSave(EMPTY_SAVE_PHOTO_STATE), null);
});
