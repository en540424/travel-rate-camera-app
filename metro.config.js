// Expo既定のMetro設定に、Web版のbundleでexpo-sqliteが参照する.wasmを資産として足すだけの設定。
// ネイティブ（iOS）のbundleは.wasmを参照しないため影響しない。
// 目的：ストア素材生成（tools/store-assets）のweb-preview撮影でWeb版をbundleできるようにする。
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

module.exports = config;
