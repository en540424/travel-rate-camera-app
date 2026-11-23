#!/usr/bin/env node
// Expo の「事前にコンパイルされたモジュール」（node_modules/<pkg>/prebuilds/output/<構成>/xcframeworks/*.tar.gz）どうしの
// 記号の参照の整合を、Mach-O の記号表（参照先ライブラリの序数）と export trie を直接読んで確かめる（どのOSでも動く。外部の tar は使わず、メモリ上で読む）。
// 範囲は事前コンパイル版どうしだけ。ソースから build する Pod・React Native 本体・システムへの参照は件数だけ出す。
//
// 2026-11-23 の4回目の iOS 自動撮影で、アプリが起動の直後に dyld の「Symbol missing」で終了した：
//   ExpoLocation 56.0.26 の事前コンパイル版が ExpoModulesCore 56.0.26 の記号を参照していたが、入っていたのは ExpoModulesCore 56.0.13。
// build は通り（参照は実行時に解決される）、シミュレーターでも実機でも起動の瞬間に落ちる。ここで build の前に止める。
//
// 使い方：node tools/native-check/expo-prebuilt-abi.mjs [--root <repo>] [--config release|debug]
// 終了コード：0 整合／1 参照先に無い記号がある／2 確かめられない（記号を読めない等。黙って通さない）
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const MH_MAGIC_64 = 0xfeedfacf;
const FAT_MAGIC = 0xcafebabe;
const FAT_MAGIC_64 = 0xcafebabf;
const LC_SYMTAB = 0x2;
const N_STAB = 0xe0;
const N_TYPE = 0x0e;
const N_EXT = 0x01;
const N_UNDF = 0x0;
const N_SECT = 0xe;
const N_INDR = 0xa;
const N_ABS = 0x2;
const LC_DYLD_INFO = 0x22;
const LC_DYLD_INFO_ONLY = 0x80000022;
const LC_DYLD_EXPORTS_TRIE = 0x80000033;
const N_WEAK_REF = 0x40;
// 参照先のライブラリを並べるロードコマンド（LC_LOAD_DYLIB・LC_LOAD_WEAK_DYLIB・LC_REEXPORT_DYLIB・LC_LAZY_LOAD_DYLIB・LC_LOAD_UPWARD_DYLIB）
const DYLIB_CMDS = new Set([0xc, 0x80000018, 0x8000001f, 0x20, 0x80000023]);

function uleb(buf, pos) {
  let result = 0n;
  let shift = 0n;
  for (;;) {
    const b = buf.readUInt8(pos++);
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7n;
  }
  return { value: Number(result), pos };
}

/** dyld の export trie（公開する記号の木）から記号名を集める。 */
export function readExportTrie(buf, start, size) {
  const names = [];
  const end = start + size;
  const stack = [{ node: start, prefix: '' }];
  const seen = new Set();
  while (stack.length) {
    const { node, prefix } = stack.pop();
    if (node < start || node >= end || seen.has(node)) throw new Error('export trie が壊れている');
    seen.add(node);
    let { value: termSize, pos } = uleb(buf, node);
    if (termSize > 0) names.push(prefix);
    pos += termSize;
    const children = buf.readUInt8(pos++);
    for (let i = 0; i < children; i++) {
      const z = buf.indexOf(0, pos);
      if (z < 0 || z >= end) throw new Error('export trie が壊れている');
      const edge = buf.toString('latin1', pos, z);
      const r = uleb(buf, z + 1);
      pos = r.pos;
      stack.push({ node: start + r.value, prefix: prefix + edge });
    }
  }
  return names;
}

/** 64bit の Mach-O 1つ分から、外部の記号（定義・未定義）と、未定義の記号の参照先ライブラリ（序数）を読む。 */
function readThin(buf, base) {
  if (buf.readUInt32LE(base) !== MH_MAGIC_64) throw new Error('64bit の Mach-O ではない');
  const cputype = buf.readUInt32LE(base + 4);
  const ncmds = buf.readUInt32LE(base + 16);
  let off = base + 32;
  const defined = new Set();
  const undefinedSyms = new Map(); // 名前 → { lib: 参照先のライブラリ名（install name の末尾）|null, weak }
  const dylibs = []; // LC_LOAD_DYLIB 等の順（序数は1始まり）
  const pending = [];
  let sawSymtab = false;
  for (let i = 0; i < ncmds; i++) {
    const cmd = buf.readUInt32LE(off);
    const size = buf.readUInt32LE(off + 4);
    if (size < 8) throw new Error('ロードコマンドが壊れている');
    if (DYLIB_CMDS.has(cmd)) {
      const nameOff = buf.readUInt32LE(off + 8);
      const z = buf.indexOf(0, off + nameOff);
      const install = buf.toString('latin1', off + nameOff, z < 0 || z > off + size ? off + size : z);
      dylibs.push(path.posix.basename(install));
    } else if (cmd === LC_DYLD_EXPORTS_TRIE) {
      for (const n of readExportTrie(buf, base + buf.readUInt32LE(off + 8), buf.readUInt32LE(off + 12))) defined.add(n);
    } else if (cmd === LC_DYLD_INFO || cmd === LC_DYLD_INFO_ONLY) {
      const exportSize = buf.readUInt32LE(off + 44);
      if (exportSize) for (const n of readExportTrie(buf, base + buf.readUInt32LE(off + 40), exportSize)) defined.add(n);
    } else if (cmd === LC_SYMTAB) {
      sawSymtab = true;
      const symoff = buf.readUInt32LE(off + 8);
      const nsyms = buf.readUInt32LE(off + 12);
      const stroff = buf.readUInt32LE(off + 16);
      const strsize = buf.readUInt32LE(off + 20);
      for (let s = 0; s < nsyms; s++) {
        const p = base + symoff + s * 16;
        const strx = buf.readUInt32LE(p);
        const type = buf.readUInt8(p + 4);
        const desc = buf.readUInt16LE(p + 6);
        if (type & N_STAB) continue;
        if (!(type & N_EXT)) continue;
        if (strx >= strsize) continue;
        const start = base + stroff + strx;
        const end = buf.indexOf(0, start);
        const name = buf.toString('latin1', start, end < 0 ? base + stroff + strsize : end);
        const t = type & N_TYPE;
        if (t === N_UNDF) pending.push({ name, ordinal: (desc >> 8) & 0xff, weak: (desc & N_WEAK_REF) !== 0 });
        else if (t === N_SECT || t === N_INDR || t === N_ABS) defined.add(name);
      }
    }
    off += size;
  }
  if (!sawSymtab) throw new Error('記号表（LC_SYMTAB）が無い');
  // 序数：0＝自身（SELF_LIBRARY）・0xfe＝実行時に探す（DYNAMIC_LOOKUP）・0xff＝実行ファイル（EXECUTABLE）。どれも参照先のライブラリを決められない → lib は null
  for (const u of pending) undefinedSyms.set(u.name, { lib: u.ordinal >= 1 && u.ordinal <= dylibs.length ? dylibs[u.ordinal - 1] : null, weak: u.weak });
  return { cputype, defined, undefined: undefinedSyms, dylibs };
}

/** Mach-O（fat を含む）の各アーキテクチャの記号を返す。 */
export function readMachOSymbols(buf) {
  const be = buf.readUInt32BE(0);
  if (be === FAT_MAGIC || be === FAT_MAGIC_64) {
    const n = buf.readUInt32BE(4);
    const out = [];
    for (let i = 0; i < n; i++) {
      const offset = be === FAT_MAGIC ? buf.readUInt32BE(8 + i * 20 + 8) : Number(buf.readBigUInt64BE(8 + i * 32 + 8));
      out.push(readThin(buf, offset));
    }
    return out;
  }
  return [readThin(buf, 0)];
}

/** Swift の記号（_$s<長さ><モジュール名>…）のモジュール名。Swift 以外は null（表示用）。 */
export function swiftModuleOf(sym) {
  const m = /^_?\$s(\d+)/.exec(sym);
  if (!m) return null;
  const len = Number(m[1]);
  const start = m[0].length;
  const name = sym.slice(start, start + len);
  return name.length === len ? name : null;
}

/**
 * 事前コンパイル版の集まり（{ name, slices: { sliceId: [{ cputype, defined, undefined: Map }] } }）を突き合わせる。
 * 参照先は記号の名前ではなく、Mach-O に記録された参照先ライブラリ（序数）で決める（Swift 以外の記号・名前の接頭辞が違う記号も漏らさない）。
 * 返り値：
 *   missing    参照先の事前コンパイル版に無い記号（弱参照は dyld が無くても起動するので除く）
 *   unverified 参照先が事前コンパイル版の外（ソースから build・React 等）で、ここでは確かめられない参照の件数（参照先ごと）
 *   noSlice    参照先の事前コンパイル版に、同じスライス・アーキテクチャが無い（確かめられない）
 */
export function findMissing(frameworks) {
  const byName = new Map(frameworks.map((f) => [f.name, f]));
  const missing = [];
  const unverified = new Map();
  const noSlice = [];
  const unresolved = [];
  for (const client of frameworks) {
    for (const [slice, archs] of Object.entries(client.slices)) {
      for (const arch of archs) {
        for (const [sym, ref] of arch.undefined) {
          const lib = ref.lib;
          if (lib === client.name) continue;
          // 参照先を決められない（flat namespace・実行時に探す等）。欠けていても見逃すので「確かめられない」として返す
          if (!lib) { unresolved.push({ client: client.name, slice, cputype: arch.cputype, symbol: sym }); continue; }
          if (!byName.has(lib)) {
            unverified.set(lib, (unverified.get(lib) ?? 0) + 1);
            continue;
          }
          const provider = byName.get(lib).slices[slice]?.find((a) => a.cputype === arch.cputype);
          if (!provider) { noSlice.push({ client: client.name, provider: lib, slice, cputype: arch.cputype }); continue; }
          if (!provider.defined.has(sym) && !ref.weak) missing.push({ client: client.name, provider: lib, slice, cputype: arch.cputype, symbol: sym });
        }
      }
    }
  }
  return { missing, unverified, noSlice, unresolved };
}

/** node_modules から事前コンパイル版の tar.gz を探す（@scope も見る）。 */
export function findPrebuiltTarballs(root, config = 'release') {
  const nm = path.join(root, 'node_modules');
  const pkgDirs = [];
  for (const e of fs.readdirSync(nm, { withFileTypes: true })) {
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    if (e.name.startsWith('@')) {
      for (const s of fs.readdirSync(path.join(nm, e.name), { withFileTypes: true })) pkgDirs.push(path.join(nm, e.name, s.name));
    } else pkgDirs.push(path.join(nm, e.name));
  }
  const out = [];
  for (const dir of pkgDirs) {
    const x = path.join(dir, 'prebuilds', 'output', config, 'xcframeworks');
    if (!fs.existsSync(x)) continue;
    let version = '?';
    try { version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version; } catch { /* 版は表示用 */ }
    for (const f of fs.readdirSync(x)) if (f.endsWith('.tar.gz')) out.push({ pkg: path.basename(dir), version, file: path.join(x, f) });
  }
  return out;
}

/** tar（gzip 済み）をメモリ上で読み、通常のファイルを Map<名前, 中身> で返す（pax の path・GNU の長い名前に対応）。 */
export function readTarGz(buf) {
  const tar = zlib.gunzipSync(buf);
  const files = new Map();
  const str = (a, b) => { const z = tar.indexOf(0, a); return tar.toString('utf8', a, z >= 0 && z < b ? z : b); };
  let off = 0;
  let longName = null;
  while (off + 512 <= tar.length) {
    const header = tar.subarray(off, off + 512);
    if (header.every((x) => x === 0)) break;
    let name = str(off, off + 100);
    const size = parseInt(str(off + 124, off + 136).trim() || '0', 8);
    if (!Number.isFinite(size) || size < 0) throw new Error('tar の見出しが壊れている');
    const typeByte = tar.readUInt8(off + 156);
    const type = typeByte === 0 ? '0' : String.fromCharCode(typeByte);
    if (tar.toString('latin1', off + 257, off + 262) === 'ustar') {
      const prefix = str(off + 345, off + 500);
      if (prefix) name = `${prefix}/${name}`;
    }
    const body = tar.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') { const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString('utf8')); if (m) longName = m[1]; continue; }
    if (type === 'L') { longName = body.toString('utf8').replace(/\0+$/, ''); continue; }
    if (type === 'g') continue;
    if (longName) { name = longName; longName = null; }
    if (type === '0') files.set(name.replace(/^\.\//, ''), body);
  }
  return files;
}

/** tar の中の xcframework（<名前>.xcframework/<スライス>/<名前>.framework/<名前>）の記号を読む。 */
export function frameworksInTar(files) {
  const out = new Map();
  for (const [name, body] of files) {
    const m = /(?:^|\/)([^/]+)\.xcframework\/([^/]+)\/\1\.framework\/\1$/.exec(name);
    if (!m) continue;
    const [, fw, slice] = m;
    if (!out.has(fw)) out.set(fw, { name: fw, slices: {} });
    out.get(fw).slices[slice] = readMachOSymbols(body);
  }
  return [...out.values()];
}

export function main(argv = process.argv.slice(2), log = console.log) {
  try {
    return run(argv, log);
  } catch (e) {
    log(`[native-abi] 読み取りに失敗した（${e.message}）。確かめられないので止める`);
    return 2;
  }
}

function run(argv, log) {
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const root = path.resolve(arg('--root', path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')));
  const config = arg('--config', 'release');
  const tarballs = findPrebuiltTarballs(root, config);
  if (!tarballs.some((t) => /ExpoModulesCore\.tar\.gz$/.test(t.file))) {
    log('[native-abi] ExpoModulesCore の事前コンパイル版が見つからない（確かめられない）');
    return 2;
  }
  const frameworks = [];
  for (const t of tarballs) {
    const fws = frameworksInTar(readTarGz(fs.readFileSync(t.file)));
    if (fws.length === 0) {
      log(`[native-abi] ${path.basename(t.file)}（${t.pkg} ${t.version}）に xcframework のバイナリが無い。確かめられないので止める`);
      return 2;
    }
    for (const fw of fws) {
      if (frameworks.some((f) => f.name === fw.name)) {
        log(`[native-abi] ${fw.name} の事前コンパイル版が複数ある（${t.pkg}）。どれが使われるか決められないので止める`);
        return 2;
      }
      const archs = Object.values(fw.slices).flat();
      const nDef = archs.reduce((a, s) => a + s.defined.size, 0);
      const nUndef = archs.reduce((a, s) => a + s.undefined.size, 0);
      // 参照（未定義の記号）の無い動的ライブラリは無い。0件なら読み方が誤っているので止める（黙って通さない）
      if (archs.length === 0 || nUndef === 0) {
        log(`[native-abi] ${fw.name}（${t.pkg} ${t.version}）の記号を読めない（アーキテクチャ ${archs.length}・定義 ${nDef}・未定義 ${nUndef}）。確かめられないので止める`);
        return 2;
      }
      // 公開する記号が0件のものはある（ObjC のランタイムで登録されるだけのモジュール。例：ExpoCameraBarcodeScanning）
      log(`[native-abi] ${fw.name}（${t.pkg} ${t.version}）：${Object.keys(fw.slices).join(', ')}・定義 ${nDef}・未定義 ${nUndef}`);
      frameworks.push(fw);
    }
  }
  // 参照される側が公開する記号を読めていなければ、照合は意味をなさない
  const referenced = new Set(frameworks.flatMap((c) => Object.values(c.slices).flat().flatMap((a) => [...a.undefined.values()].map((r) => r.lib))));
  for (const fw of frameworks) {
    if (!referenced.has(fw.name)) continue;
    for (const [slice, archs] of Object.entries(fw.slices)) {
      if (archs.some((a) => a.defined.size === 0)) {
        log(`[native-abi] ${fw.name}（${slice}）は他から参照されているのに、公開する記号を読めない。確かめられないので止める`);
        return 2;
      }
    }
  }
  const { missing, unverified, noSlice, unresolved } = findMissing(frameworks);
  if (unresolved.length) {
    const u = unresolved[0];
    log(`[native-abi] ${u.client}（${u.slice}）の参照 ${u.symbol} は参照先のライブラリを決められない（flat namespace・実行時に探す等。他 ${unresolved.length - 1}件）。確かめられないので止める`);
    return 2;
  }
  if (noSlice.length) {
    const n = noSlice[0];
    log(`[native-abi] ${n.client}（${n.slice}）が参照する ${n.provider} に、同じスライス・アーキテクチャが無い（他 ${noSlice.length - 1}件）。確かめられないので止める`);
    return 2;
  }
  // 事前コンパイル版の外（ソースから build する Pod・React Native 本体・システム）への参照は、ここでは確かめられない
  const outside = [...unverified].sort((a, b) => b[1] - a[1]);
  if (outside.length) log(`[native-abi] 範囲外（事前コンパイル版の外への参照・ここでは確かめない）：${outside.slice(0, 12).map(([k, n]) => `${k} ${n}`).join('・')}${outside.length > 12 ? `・他 ${outside.length - 12}` : ''}`);
  if (missing.length === 0) {
    log(`[native-abi] OK：事前コンパイル版 ${frameworks.length}個どうしの記号の参照は、すべて参照先にある（${config}。範囲外の参照は実機・シミュレーターでの起動で確かめる）`);
    return 0;
  }
  const groups = new Map();
  for (const m of missing) {
    const k = `${m.client} → ${m.provider}`;
    if (!groups.has(k)) groups.set(k, new Set());
    groups.get(k).add(m.symbol);
  }
  log('[native-abi] NG：事前コンパイル版の参照する記号が、参照先の事前コンパイル版に無い（アプリは起動の瞬間に dyld で終了する）');
  for (const [k, syms] of groups) {
    log(`  ${k}：${syms.size}件`);
    for (const s of [...syms].slice(0, 5)) log(`    ${s}`);
  }
  const versions = [...new Set(tarballs.map((t) => `${t.pkg}@${t.version}`))].join(', ');
  log(`[native-abi] 入っている版：${versions}`);
  log('[native-abi] 対処：参照している側のパッケージを、参照先（多くは expo-modules-core）と同じ時期の版へそろえる（SDK の bundledNativeModules.json を参照）');
  return 1;
}

const isMain = (() => {
  try { return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isMain) process.exitCode = main();
