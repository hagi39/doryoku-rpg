#!/usr/bin/env node
// 努力RPG ビルドスクリプト
// src/ 以下の HTML / CSS / JS を1枚の自己完結HTMLに束ねて dist/ に出力する。
// ES modules は file:// で読めないため、すべて classic script として直列に埋め込む。

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');
const OUT_NAME = '努力RPG.html';

// 読み込み順 = 依存順。上から順に評価される。
const CSS_FILES = [
  'css/base.css',
  'css/layout.css',
  'css/components.css',
  'css/tree.css',
];

const JS_FILES = [
  'js/core/util.js',
  'js/data/tree-data.js',
  'js/core/validate.js',
  'js/core/layout.js',
  'js/core/rules.js',
  'js/core/store.js',
  'js/core/actions.js',
  'js/api/claude.js',
  'js/ui/shell.js',
  'js/ui/tab-home.js',
  'js/ui/tab-tree.js',
  'js/ui/tab-learn.js',
  'js/ui/tab-log.js',
  'js/ui/tab-quest.js',
  'js/ui/tab-settings.js',
  'js/main.js',
];

async function readAll(files) {
  const parts = [];
  for (const rel of files) {
    const text = await readFile(join(SRC, rel), 'utf8');
    parts.push(`/* ===== ${rel} ===== */\n${text}`);
  }
  return parts.join('\n\n');
}

function escapeForScript(js) {
  // 文字列リテラル中の </script> がタグを閉じてしまうのを防ぐ
  return js.replace(/<\/script/gi, '<\\/script');
}

async function build() {
  const template = await readFile(join(SRC, 'index.html'), 'utf8');
  const css = await readAll(CSS_FILES);
  const js = await readAll(JS_FILES);

  if (!template.includes('<!--@CSS-->') || !template.includes('<!--@JS-->')) {
    throw new Error('src/index.html に <!--@CSS--> / <!--@JS--> のプレースホルダがありません');
  }

  const html = template
    .replace('<!--@CSS-->', `<style>\n${css}\n</style>`)
    .replace('<!--@JS-->', `<script>\n${escapeForScript(js)}\n</script>`)
    .replace('<!--@BUILT_AT-->', new Date().toISOString());

  await mkdir(DIST, { recursive: true });
  const outPath = join(DIST, OUT_NAME);
  await writeFile(outPath, html, 'utf8');

  const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  console.log(`✔ ${outPath}  (${kb} KB)`);
}

build().catch((err) => {
  console.error('✘ ビルド失敗:', err.message);
  process.exit(1);
});
