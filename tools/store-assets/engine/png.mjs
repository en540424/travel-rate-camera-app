// 依存なしのPNG読み書き（8bit・非インターレースのRGB/RGBAのみ）。
// 目的：Playwrightが出すRGBAのPNGから、ストアが拒否するアルファチャネルを除いたRGBのPNGを作ること、
// および出力の寸法・アルファ有無を検証すること。汎用のPNGライブラリではない。
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** チャンクを列挙する。署名が違えば例外。 */
function* chunks(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('PNGではありません');
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    yield { type, data };
    off += 12 + len;
    if (type === 'IEND') return;
  }
}

const COLOR_TYPES = { 0: 'gray', 2: 'rgb', 3: 'indexed', 4: 'gray-alpha', 6: 'rgba' };

/** IHDRだけを読む（高速）。hasAlphaChannelは色型によるアルファの有無（tRNSは別途）。 */
export function readPngInfo(buf) {
  for (const { type, data } of chunks(buf)) {
    if (type === 'IHDR') {
      const colorType = data[9];
      return {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: COLOR_TYPES[colorType] ?? `unknown(${colorType})`,
        interlace: data[12],
        hasAlphaChannel: colorType === 4 || colorType === 6,
      };
    }
  }
  throw new Error('IHDRがありません');
}

/** tRNSチャンク（パレット等の透過指定）があるか。 */
export function hasTransparencyChunk(buf) {
  for (const { type } of chunks(buf)) if (type === 'tRNS') return true;
  return false;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** 8bit・非インターレースのRGB/RGBAを、RGBAの生画素へ展開する。 */
export function decodePng(buf) {
  const info = readPngInfo(buf);
  if (info.bitDepth !== 8 || info.interlace !== 0 || !['rgb', 'rgba'].includes(info.colorType)) {
    throw new Error(`未対応のPNGです（${info.colorType}/${info.bitDepth}bit/interlace=${info.interlace}）`);
  }
  const idat = [];
  for (const { type, data } of chunks(buf)) if (type === 'IDAT') idat.push(data);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = info.colorType === 'rgba' ? 4 : 3;
  const stride = info.width * bpp;
  const pixels = Buffer.alloc(info.width * info.height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < info.height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      switch (filter) {
        case 0: break;
        case 1: line[x] = (line[x] + a) & 0xff; break;
        case 2: line[x] = (line[x] + b) & 0xff; break;
        case 3: line[x] = (line[x] + ((a + b) >> 1)) & 0xff; break;
        case 4: line[x] = (line[x] + paeth(a, b, c)) & 0xff; break;
        default: throw new Error(`不正なフィルタ ${filter}`);
      }
    }
    for (let x = 0; x < info.width; x++) {
      const o = (y * info.width + x) * 4;
      line.copy(pixels, o, x * bpp, x * bpp + 3);
      pixels[o + 3] = bpp === 4 ? line[x * bpp + 3] : 255;
    }
    prev = line;
  }
  return { width: info.width, height: info.height, pixels };
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * RGBAの生画素を、アルファの無いRGBのPNG（色型2）へ書き出す。
 * 半透明の画素は背景色（既定は白）へ合成する。ストアの「アルファ不可」を満たすための処理。
 */
export function encodeRgbPng({ width, height, pixels }, background = [255, 255, 255]) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const o = y * (stride + 1) + 1 + x * 3;
      const alpha = pixels[i + 3] / 255;
      for (let k = 0; k < 3; k++) {
        raw[o + k] = Math.round(pixels[i + k] * alpha + background[k] * (1 - alpha));
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** PNGのアルファを除いてRGBへ平坦化する（既にRGBならそのまま返す）。 */
export function flattenPng(buf, background) {
  const info = readPngInfo(buf);
  if (!info.hasAlphaChannel && !hasTransparencyChunk(buf)) return buf;
  return encodeRgbPng(decodePng(buf), background);
}
