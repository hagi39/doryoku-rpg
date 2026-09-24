/* ビルド成果物の構文チェックと基本的な作りの確認 */
import { readFileSync } from 'node:fs';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const html = readFileSync('dist/努力RPG.html', 'utf8');
const problems = [];

function want(cond, msg) { if (!cond) problems.push(msg); }

// 単一ファイルとして自己完結しているか(外部JS/CSSはフォントだけ)
const externalScripts = [...html.matchAll(/<script[^>]*\ssrc=/gi)];
want(externalScripts.length === 0, `外部スクリプトが ${externalScripts.length} 件あります`);

const links = [...html.matchAll(/<link[^>]*href="([^"]+)"/gi)].map((m) => m[1]);
for (const href of links) {
  want(/^https:\/\/fonts\.(googleapis|gstatic)\.com/.test(href), `想定外の外部リンク: ${href}`);
}

// 埋め込みJSの構文チェック
const script = /<script>([\s\S]*?)<\/script>/i.exec(html);
want(!!script, '<script> が見つかりません');
if (script) {
  const dir = mkdtempSync(join(tmpdir(), 'doryoku-'));
  const file = join(dir, 'bundle.js');
  writeFileSync(file, script[1], 'utf8');
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (e) {
    problems.push('埋め込みJSに構文エラー:\n' + String(e.stderr || e.message));
  }
}

// 必須の作り
want(/viewport-fit=cover/.test(html), 'セーフエリア対応の viewport-fit=cover がありません');
want(/env\(safe-area-inset-bottom/.test(html), '下タブのセーフエリア対応がありません');
want(/prefers-color-scheme: dark/.test(html), 'ダークテーマの指定がありません');
want(/prefers-reduced-motion/.test(html), 'モーション低減の配慮がありません');
want(/DotGothic16/.test(html), 'DotGothic16 の指定がありません');
want(/"DotGothic16",\s*"Hiragino/.test(html), 'フォントのフォールバックがありません');
want(/anthropic-dangerous-direct-browser-access/.test(html), 'ブラウザ直接呼び出しのヘッダがありません');
want(!/sk-ant-[A-Za-z0-9]{10,}/.test(html), 'APIキーらしき文字列が埋め込まれています');

// 受け渡し(P7): 他人の端末で file:// から開いても困らないか
want(!/\/Users\/|\/home\/|[A-Za-z]:\\\\/.test(html), '作った人の端末のパスが残っています');
want(!/localhost|127\.0\.0\.1/.test(html), 'localhost への参照が残っています');
want(!/<!--@(CSS|JS|BUILT_AT)-->/.test(html), 'テンプレートのプレースホルダが残っています');
want(/<html[^>]*\slang="ja"/i.test(html), 'lang="ja" がありません');

// 6タブと、各フェーズの中身が入っているか
for (const tab of ['home', 'tree', 'learn', 'log', 'quest', 'settings']) {
  want(html.includes(`App.register('${tab}'`), `${tab} タブが入っていません`);
}
want(/global\.GeoData\s*=/.test(html), '世界地図のデータが入っていません');
want(/ALL_CAPITALS_EXCLUDED/.test(html), '首都を出さない国の指定が入っていません');
for (const country of ['日本', 'パプアニューギニア', 'コートジボワール', 'ジャマイカ', 'カザフスタン']) {
  want(html.includes(country), `世界地図の国データが欠けています: ${country}`);
}
want(/doryoku-rpg\/progress/.test(html), '保存キーが入っていません');

const kb = Buffer.byteLength(html, 'utf8') / 1024;
// 単一HTMLで配って開いてもらう前提なので、大きくなりすぎていないか見る
want(kb < 600, `成果物が大きすぎます: ${kb.toFixed(1)} KB`);
console.log(`\n  dist/努力RPG.html: ${kb.toFixed(1)} KB`);
if (problems.length) {
  console.error('\n  ✘ 問題あり');
  for (const p of problems) console.error('   - ' + p);
  process.exit(1);
}
console.log('  ✔ 構文チェックと自己完結の確認は通りました\n');
