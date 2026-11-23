// expo-prebuilt-abi.mjs のテスト。合成した Mach-O・tar.gz で、記号の読み取りと突き合わせを確かめる。
// 実際の node_modules があれば、それも検査する（2026-11-23：expo-location 56.0.26 と expo-modules-core 56.0.13 の不整合で起動直後に終了した）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { readMachOSymbols, readExportTrie, swiftModuleOf, findMissing, readTarGz, frameworksInTar, main } from './expo-prebuilt-abi.mjs';

const ARM64 = 0x0100000c;
const X86_64 = 0x01000007;
const SYM_A = '_$s15ExpoModulesCore6RecordPAAE4from10dictionary10appContextxSDySSypG_AA03AppH0CtKFZ';
const SYM_B = '_$s15ExpoModulesCore9AppContextC7runtimeAA0aB7RuntimeCvg';

/** export trie（1段だけ：根から各記号への枝）を作る。 */
function trie(names) {
  // 根：終端なし(0)・子の数・[枝の文字列\0・子の位置(uleb)]／各子：終端の大きさ(2)・flags(0)・address(0)・子なし(0)
  const ulebEnc = (v) => { const o = []; do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; o.push(b); } while (v); return Buffer.from(o); };
  const childSize = 4;
  let rootSize = 0;
  for (let k = 0; k < 4; k++) {
    let s = 2;
    names.forEach((n, i) => { s += Buffer.byteLength(n, 'latin1') + 1 + ulebEnc(rootSize + i * childSize).length; });
    rootSize = s;
  }
  const parts = [Buffer.from([0, names.length])];
  names.forEach((n, i) => { parts.push(Buffer.from(`${n}\0`, 'latin1'), ulebEnc(rootSize + i * childSize)); });
  for (let i = 0; i < names.length; i++) parts.push(Buffer.from([2, 0, 0, 0]));
  return Buffer.concat(parts);
}

/**
 * 64bit の Mach-O（参照先のライブラリ・記号表・あれば export trie）を作る。
 * undefinedSyms の要素は 名前 か [名前, 参照先のライブラリ名, { weak }]。名前だけなら Swift のモジュール名（無ければ libSystem）を参照先にする。
 */
function macho({ cputype = ARM64, defined = [], undefinedSyms = [], exported = [], weakDylibs = [] } = {}) {
  const undef = undefinedSyms.map((u) => (Array.isArray(u) ? u : [u, swiftModuleOf(u) ?? 'libSystem.B.dylib', {}]));
  const libs = [...new Set(undef.map(([, lib]) => lib).filter(Boolean))];
  const libCmds = libs.map((lib) => {
    const install = Buffer.from(`@rpath/${lib}.framework/${lib}\0`, 'latin1');
    const size = Math.ceil((24 + install.length) / 8) * 8;
    const c = Buffer.alloc(size);
    c.writeUInt32LE(weakDylibs.includes(lib) ? 0x80000018 : 0xc, 0); c.writeUInt32LE(size, 4); c.writeUInt32LE(24, 8);
    install.copy(c, 24);
    return c;
  });
  const syms = [
    ...defined.map((n) => ({ n, type: 0x0f, desc: 0 })),
    ...undef.map(([n, lib, o = {}]) => ({ n, type: 0x01, desc: ((o.ordinal ?? libs.indexOf(lib) + 1) << 8) | (o.weak ? 0x40 : 0) })),
  ];
  const strs = [Buffer.from([0x20, 0])];
  const strx = [];
  let strLen = 2;
  for (const { n } of syms) { strx.push(strLen); const b = Buffer.from(`${n}\0`, 'latin1'); strs.push(b); strLen += b.length; }
  const strtab = Buffer.concat(strs);
  const trieBuf = exported.length ? trie(exported) : Buffer.alloc(0);
  const libBytes = libCmds.reduce((a, c) => a + c.length, 0);
  const ncmds = libCmds.length + 1 + (exported.length ? 1 : 0);
  const sizeofcmds = libBytes + 24 + (exported.length ? 16 : 0);
  const symoff = 32 + sizeofcmds;
  const stroff = symoff + syms.length * 16;
  const trieoff = stroff + strtab.length;
  const buf = Buffer.alloc(trieoff + trieBuf.length);
  buf.writeUInt32LE(0xfeedfacf, 0); buf.writeUInt32LE(cputype, 4); buf.writeUInt32LE(6, 12); buf.writeUInt32LE(ncmds, 16); buf.writeUInt32LE(sizeofcmds, 20);
  let off = 32;
  for (const c of libCmds) { c.copy(buf, off); off += c.length; }
  buf.writeUInt32LE(0x2, off); buf.writeUInt32LE(24, off + 4); buf.writeUInt32LE(symoff, off + 8); buf.writeUInt32LE(syms.length, off + 12); buf.writeUInt32LE(stroff, off + 16); buf.writeUInt32LE(strtab.length, off + 20);
  off += 24;
  if (exported.length) { buf.writeUInt32LE(0x80000033, off); buf.writeUInt32LE(16, off + 4); buf.writeUInt32LE(trieoff, off + 8); buf.writeUInt32LE(trieBuf.length, off + 12); }
  syms.forEach(({ type, desc }, i) => { const p = symoff + i * 16; buf.writeUInt32LE(strx[i], p); buf.writeUInt8(type, p + 4); buf.writeUInt8(type === 0x0f ? 1 : 0, p + 5); buf.writeUInt16LE(desc, p + 6); });
  strtab.copy(buf, stroff);
  trieBuf.copy(buf, trieoff);
  return buf;
}

/** fat（複数アーキテクチャ）にまとめる。 */
function fat(thins) {
  const head = Buffer.alloc(8 + thins.length * 20);
  head.writeUInt32BE(0xcafebabe, 0); head.writeUInt32BE(thins.length, 4);
  let off = 4096;
  const bodies = [];
  thins.forEach((t, i) => {
    head.writeUInt32BE(t.readUInt32LE(4), 8 + i * 20); head.writeUInt32BE(off, 8 + i * 20 + 8); head.writeUInt32BE(t.length, 8 + i * 20 + 12);
    bodies.push({ off, t }); off += Math.ceil(t.length / 4096) * 4096 + 4096;
  });
  const buf = Buffer.alloc(off);
  head.copy(buf, 0);
  for (const b of bodies) b.t.copy(buf, b.off);
  return buf;
}

/** ustar の tar.gz を作る（長い名前は pax の path で入れる）。 */
function tarGz(entries) {
  const blocks = [];
  const header = (name, size, type) => {
    const h = Buffer.alloc(512);
    h.write(name.slice(0, 99), 0, 'utf8');
    h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
    h.write(`${size.toString(8).padStart(11, '0')}\0`, 124); h.write('00000000000\0', 136);
    h.write(type, 156); h.write('ustar\0', 257); h.write('00', 263);
    return h;
  };
  const pad = (b) => Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512)]);
  for (const [name, body] of entries) {
    if (name.length > 99) {
      const rec = ` path=${name}\n`;
      let len = rec.length + 2; if (`${len}${rec}`.length !== len) len += 1;
      const pax = Buffer.from(`${len}${rec}`);
      blocks.push(header('PaxHeader', pax.length, 'x'), pad(pax));
    }
    blocks.push(header(name, body.length, '0'), pad(body));
  }
  blocks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocks));
}

const fw = (name, slice, bin) => [`${name}.xcframework/${slice}/${name}.framework/${name}`, bin];

test('Mach-O の記号表・export trie・fat を読む', () => {
  const thin = macho({ defined: ['_def1'], undefinedSyms: [SYM_A], exported: ['_exp1', SYM_B] });
  const [a] = readMachOSymbols(thin);
  assert.equal(a.cputype, ARM64);
  assert.ok(a.defined.has('_def1') && a.defined.has('_exp1') && a.defined.has(SYM_B));
  assert.ok(a.undefined.has(SYM_A));
  const both = readMachOSymbols(fat([macho({ undefinedSyms: ['_u'] }), macho({ cputype: X86_64, defined: ['_d'] })]));
  assert.deepEqual(both.map((x) => x.cputype), [ARM64, X86_64]);
  assert.ok(both[1].defined.has('_d'));
  assert.throws(() => readMachOSymbols(Buffer.alloc(64)), /Mach-O/);
  assert.deepEqual(readExportTrie(trie(['_a', '_bb']), 0, trie(['_a', '_bb']).length).sort(), ['_a', '_bb']);
});

test('Swift の記号のモジュール名', () => {
  assert.equal(swiftModuleOf(SYM_A), 'ExpoModulesCore');
  assert.equal(swiftModuleOf('_$s12ExpoLocation6ModuleC'), 'ExpoLocation');
  assert.equal(swiftModuleOf('_OBJC_CLASS_$_Foo'), null);
  assert.equal(swiftModuleOf('_$s99Short'), null);
});

test('参照先は記号の名前ではなく、記録された参照先ライブラリ（序数）で決める', () => {
  const OBJC = '_OBJC_CLASS_$_EXUtilities';
  const PROTO = '_$sSS15ExpoModulesCore11AnyArgumentAAWP'; // 名前の先頭が ExpoModulesCore ではない記号
  const [a] = readMachOSymbols(macho({ undefinedSyms: [[SYM_A, 'ExpoModulesCore'], [OBJC, 'ExpoModulesCore'], [PROTO, 'ExpoModulesCore'], ['_weakOne', 'ExpoModulesCore', { weak: true }], ['_objc_msgSend', 'libobjc.A.dylib']] }));
  assert.equal(a.undefined.get(OBJC).lib, 'ExpoModulesCore');
  assert.equal(a.undefined.get(PROTO).lib, 'ExpoModulesCore');
  assert.equal(a.undefined.get('_weakOne').weak, true);
  assert.equal(a.undefined.get('_objc_msgSend').lib, 'libobjc.A.dylib');

  const core = { name: 'ExpoModulesCore', slices: { 'ios-arm64': [{ cputype: ARM64, defined: new Set([SYM_A]), undefined: new Map() }] } };
  const loc = { name: 'ExpoLocation', slices: { 'ios-arm64': [a] } };
  const r = findMissing([core, loc]);
  assert.deepEqual(r.missing.map((m) => m.symbol).sort(), [OBJC, PROTO].sort(), 'Swift 以外・接頭辞の違う記号も照合し、弱参照は除く');
  assert.equal(r.unverified.get('libobjc.A.dylib'), 1, '事前コンパイル版の外への参照は件数だけ数える');
  assert.deepEqual(r.noSlice, []);

  core.slices['ios-arm64'][0].defined.add(OBJC).add(PROTO);
  assert.deepEqual(findMissing([core, loc]).missing, []);

  // 参照先に同じスライス・アーキテクチャが無ければ、照合できないとして返す（黙って飛ばさない）
  const coreSimOnly = { name: 'ExpoModulesCore', slices: { 'ios-arm64_x86_64-simulator': core.slices['ios-arm64'] } };
  assert.equal(findMissing([coreSimOnly, loc]).noSlice.length, 4);

  // 弱く読み込むライブラリ（LC_LOAD_WEAK_DYLIB）も序数の並びに入る（外すと序数がずれ、別のライブラリに結び付く）
  const [w] = readMachOSymbols(macho({ weakDylibs: ['ExpoModulesCore'], undefinedSyms: [[SYM_A, 'ExpoModulesCore'], ['_objc_msgSend', 'libobjc.A.dylib']] }));
  assert.equal(w.undefined.get(SYM_A).lib, 'ExpoModulesCore');
  assert.equal(w.undefined.get('_objc_msgSend').lib, 'libobjc.A.dylib');

  // 参照先を決められない序数（0xfe＝実行時に探す・0＝自身・0xff＝実行ファイル）は、範囲外に数えず「決められない」として返す
  const [d] = readMachOSymbols(macho({ undefinedSyms: [['_lookup', null, { ordinal: 0xfe }], ['_exe', null, { ordinal: 0xff }]] }));
  assert.equal(d.undefined.get('_lookup').lib, null);
  const ur = findMissing([core, { name: 'ExpoLocation', slices: { 'ios-arm64': [d] } }]);
  assert.equal(ur.unresolved.length, 2);
  assert.equal(ur.unverified.size, 0);
});

test('node_modules の事前コンパイル版を読み、不整合なら 1・整合なら 0・読めなければ 2', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'abi-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (pkg, version, file, entries) => {
    const d = path.join(root, 'node_modules', pkg);
    const x = path.join(d, 'prebuilds', 'output', 'release', 'xcframeworks');
    fs.mkdirSync(x, { recursive: true });
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ version }));
    fs.writeFileSync(path.join(x, file), tarGz(entries));
  };
  const sim = 'ios-arm64_x86_64-simulator';
  const coreBin = (syms) => fat([macho({ undefinedSyms: ['_objc_msgSend'], exported: syms }), macho({ cputype: X86_64, undefinedSyms: ['_objc_msgSend'], exported: syms })]);
  put('expo-modules-core', '56.0.13', 'ExpoModulesCore.tar.gz', [
    fw('ExpoModulesCore', 'ios-arm64', macho({ undefinedSyms: ['_objc_msgSend'], exported: [SYM_B] })),
    fw('ExpoModulesCore', sim, coreBin([SYM_B])),
    [`ExpoModulesCore.xcframework/${sim}/ExpoModulesCore.framework/._ExpoModulesCore`, Buffer.from('AppleDouble')],
  ]);
  const locBin = (cputype) => macho({ cputype, undefinedSyms: [SYM_A, SYM_B], exported: ['_$s12ExpoLocation6ModuleC'] });
  put('expo-location', '56.0.26', 'ExpoLocation.tar.gz', [
    fw('ExpoLocation', 'ios-arm64', locBin(ARM64)),
    fw('ExpoLocation', sim, fat([locBin(ARM64), locBin(X86_64)])),
  ]);
  const logs = [];
  assert.equal(main(['--root', root], (l) => logs.push(l)), 1, logs.join('\n'));
  const text = logs.join('\n');
  assert.ok(text.includes('ExpoLocation → ExpoModulesCore'), text);
  assert.ok(text.includes(SYM_A));
  assert.ok(text.includes('expo-location@56.0.26'));

  // 参照先にそろえた版（記号がある）なら通る。事前コンパイル版の外への参照は「範囲外」として件数を出す
  put('expo-modules-core', '56.0.26', 'ExpoModulesCore.tar.gz', [
    fw('ExpoModulesCore', 'ios-arm64', macho({ undefinedSyms: ['_objc_msgSend'], exported: [SYM_A, SYM_B] })),
    fw('ExpoModulesCore', sim, coreBin([SYM_A, SYM_B])),
  ]);
  const ok = [];
  assert.equal(main(['--root', root], (l) => ok.push(l)), 0, ok.join('\n'));
  assert.ok(ok.some((l) => l.includes('範囲外') && l.includes('libSystem.B.dylib')), ok.join('\n'));

  // 参照先に同じスライスが無い（シミュレーター版が無い）なら、黙って通さず 2
  put('expo-modules-core', '56.0.26', 'ExpoModulesCore.tar.gz', [
    fw('ExpoModulesCore', 'ios-arm64', macho({ undefinedSyms: ['_objc_msgSend'], exported: [SYM_A, SYM_B] })),
  ]);
  const ns = [];
  assert.equal(main(['--root', root], (l) => ns.push(l)), 2, ns.join('\n'));
  assert.ok(ns.some((l) => l.includes('同じスライス')), ns.join('\n'));

  // 参照先を決められない参照（flat namespace 等）があれば、欠けを見逃すので 2
  put('expo-modules-core', '56.0.26', 'ExpoModulesCore.tar.gz', [
    fw('ExpoModulesCore', 'ios-arm64', macho({ undefinedSyms: ['_objc_msgSend'], exported: [SYM_A, SYM_B] })),
    fw('ExpoModulesCore', sim, coreBin([SYM_A, SYM_B])),
  ]);
  put('expo-flat', '1.0.0', 'Flat.tar.gz', [fw('Flat', 'ios-arm64', macho({ undefinedSyms: [['_gone', null, { ordinal: 0xfe }]], exported: ['_f'] }))]);
  const ur = [];
  assert.equal(main(['--root', root], (l) => ur.push(l)), 2, ur.join('\n'));
  assert.ok(ur.some((l) => l.includes('決められない')), ur.join('\n'));
  fs.rmSync(path.join(root, 'node_modules', 'expo-flat'), { recursive: true });
  assert.equal(main(['--root', root], () => {}), 0);

  // 同じ名前の事前コンパイル版が2つのパッケージにあれば、どれが使われるか決められないので 2
  put('expo-dup', '1.0.0', 'ExpoModulesCore.tar.gz', [fw('ExpoModulesCore', 'ios-arm64', macho({ undefinedSyms: ['_objc_msgSend'], exported: [SYM_A, SYM_B] }))]);
  const dup = [];
  assert.equal(main(['--root', root], (l) => dup.push(l)), 2, dup.join('\n'));
  assert.ok(dup.some((l) => l.includes('複数')), dup.join('\n'));
  fs.rmSync(path.join(root, 'node_modules', 'expo-dup'), { recursive: true });

  // 壊れたバイナリ（読み取りの例外）も 2
  put('expo-modules-core', '56.0.26', 'ExpoModulesCore.tar.gz', [fw('ExpoModulesCore', 'ios-arm64', Buffer.alloc(64))]);
  assert.equal(main(['--root', root], () => {}), 2);

  // 参照されているのに公開の記号を読めない（定義0）なら、黙って通さず 2
  put('expo-modules-core', '56.0.13', 'ExpoModulesCore.tar.gz', [
    fw('ExpoModulesCore', 'ios-arm64', macho({ undefinedSyms: ['_objc_msgSend'] })),
    fw('ExpoModulesCore', sim, fat([macho({ undefinedSyms: ['_objc_msgSend'] }), macho({ cputype: X86_64, undefinedSyms: ['_objc_msgSend'] })])),
  ]);
  const l2 = [];
  assert.equal(main(['--root', root], (l) => l2.push(l)), 2, l2.join('\n'));

  // 参照（未定義）が0件のバイナリは読み方の誤りとして 2
  put('expo-location', '56.0.26', 'ExpoLocation.tar.gz', [fw('ExpoLocation', 'ios-arm64', macho({ exported: ['_x'] }))]);
  assert.equal(main(['--root', root], () => {}), 2);

  // xcframework の無い tar も 2
  put('expo-location', '56.0.26', 'ExpoLocation.tar.gz', [['README', Buffer.from('x')]]);
  assert.equal(main(['--root', root], () => {}), 2);

  // ExpoModulesCore の事前コンパイル版が無ければ 2
  fs.rmSync(path.join(root, 'node_modules', 'expo-modules-core'), { recursive: true });
  assert.equal(main(['--root', root], () => {}), 2);
});

test('tar：pax の長い名前・AppleDouble（._）を正しく扱う', () => {
  const long = `${'a/'.repeat(80)}X.xcframework/ios-arm64/X.framework/X`;
  const files = readTarGz(tarGz([[long, macho({ undefinedSyms: ['_u'] })], ['X.xcframework/ios-arm64/X.framework/._X', Buffer.from('z')]]));
  assert.ok(files.has(long));
  const fws = frameworksInTar(files);
  assert.equal(fws.length, 1);
  assert.deepEqual(Object.keys(fws[0].slices), ['ios-arm64']);
});

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
test('このrepoの node_modules：事前コンパイル版の記号の参照がそろっている', { skip: !fs.existsSync(path.join(repoRoot, 'node_modules', 'expo-modules-core', 'prebuilds')) && 'node_modules に事前コンパイル版が無い' }, () => {
  const logs = [];
  assert.equal(main(['--root', repoRoot], (l) => logs.push(l)), 0, logs.join('\n'));
});
