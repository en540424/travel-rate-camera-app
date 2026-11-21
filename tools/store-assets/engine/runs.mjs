// runディレクトリ・撮影記録・git の共通の手続き（cli.mjs と job-commands.mjs が使う）。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { sha256 } from './pipeline.mjs';
import { readPngInfo } from './png.mjs';

export function gitInfo(root) {
  try {
    const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).toString().trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root }).toString().trim().length > 0;
    return { commit, dirty };
  } catch {
    return { commit: 'unknown', dirty: null };
  }
}

export function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
}

export function projectRootOf(profile) {
  return path.resolve(profile._dir, profile.capture?.projectRoot ?? '.');
}

export function defaultRunDir(profile) {
  const outRoot = path.resolve(profile._dir, profile.outDir ?? '../../out');
  return path.join(outRoot, profile.app.id, `${stamp()}-${gitInfo(projectRootOf(profile)).commit}`);
}

export function readCaptures(runDir) {
  const f = path.join(runDir, 'captures.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
}

/** 撮影記録を保存する。同じ画面・言語・撮影元の記録は新しいもので置き換える。ファイル名はrunDirからの相対。 */
export function writeCaptures(runDir, added) {
  const prev = readCaptures(runDir);
  const keyOf = (c) => `${c.screen}|${c.locale}|${c.source}`;
  const map = new Map(prev.map((c) => [keyOf(c), c]));
  for (const c of added) {
    const buf = fs.readFileSync(c.file);
    const info = readPngInfo(buf);
    map.set(keyOf(c), {
      ...c, file: path.relative(runDir, c.file), width: info.width, height: info.height,
      sha256: sha256(buf), capturedAt: new Date().toISOString(),
    });
  }
  const list = [...map.values()];
  fs.writeFileSync(path.join(runDir, 'captures.json'), JSON.stringify(list, null, 2));
  return list;
}
