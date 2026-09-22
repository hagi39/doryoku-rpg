/* ルールとデータの自動テスト。 node test/run-tests.mjs で実行する。 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

// localStorage の最小スタブ(store.js の検証用)
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
};
globalThis.Blob = class { constructor(parts) { this.size = Buffer.byteLength(parts.join(''), 'utf8'); } };

for (const rel of [
  'js/core/util.js',
  'js/data/tree-data.js',
  'js/core/validate.js',
  'js/core/layout.js',
  'js/core/rules.js',
  'js/core/store.js',
  'js/core/actions.js',
  'js/core/quiz.js',
  'js/api/claude.js',
  'js/api/quiz-gen.js',
]) {
  (0, eval)(readFileSync(join(SRC, rel), 'utf8'));
}

const { U, TreeData, Validate, Rules, Store, Actions, Layout, Quiz, Ai, QuizGen } = globalThis;

let pass = 0;
const failures = [];

// 非同期のテストは、モックの差し替えがぶつからないよう最後に1つずつ順に流す
const asyncTests = [];

function test(name, fn) {
  if (fn.constructor.name === 'AsyncFunction') { asyncTests.push([name, fn]); return; }
  try { fn(); pass++; }
  catch (e) { failures.push(`${name}\n    ${e.message}`); }
}

function eq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label || ''} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function near(actual, expected, tol, label) {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`${label || ''} expected ~${expected}, got ${actual}`);
  }
}

function ok(cond, label) {
  if (!cond) throw new Error(label || 'expected truthy');
}

const DAY = 24 * 60 * 60 * 1000;
const data = TreeData.buildDefaultData();

// ---------------- データ ----------------

test('スキルは全部で145個', () => eq(data.skills.length, 145));

test('ツリーごとのスキル数が設計書どおり', () => {
  const want = {
    math: 27, phys: 15, chem: 12, eng: 19, kobun: 12, kanbun: 9, geo: 16,
    up: 10, low: 9, core: 9, end: 7,
  };
  const got = {};
  for (const s of data.skills) got[s.tree] = (got[s.tree] || 0) + 1;
  for (const k of Object.keys(want)) eq(got[k], want[k], `ツリー ${k}:`);
  eq(Object.keys(got).length, Object.keys(want).length, 'ツリー数:');
});

test('勉強110 / 筋トレ35', () => {
  const treeCat = new Map(data.trees.map((t) => [t.id, t.category]));
  const counts = { study: 0, workout: 0 };
  for (const s of data.skills) counts[treeCat.get(s.tree)]++;
  eq(counts.study, 110, '勉強:');
  eq(counts.workout, 35, '筋トレ:');
});

test('検証でエラーが出ない', () => {
  const res = Validate.validate(data);
  eq(res.errors.length, 0, res.errors.join(' / '));
});

test('id重複を検出できる', () => {
  const bad = U.deepClone(data);
  bad.skills.push({ ...bad.skills[0] });
  ok(Validate.validate(bad).errors.some((m) => m.includes('重複')), '重複を検出できていない');
});

test('存在しない前提を検出できる', () => {
  const bad = U.deepClone(data);
  bad.skills[0].requires = ['math_99'];
  ok(Validate.validate(bad).errors.some((m) => m.includes('math_99')));
});

test('前提の循環を検出できる', () => {
  const bad = U.deepClone(data);
  const a = bad.skills.find((s) => s.id === 'math_01');
  const b = bad.skills.find((s) => s.id === 'math_03');
  a.requires = ['math_03'];
  b.requires = ['math_01'];
  ok(Validate.validate(bad).errors.some((m) => m.includes('循環')));
});

test('他ツリーの前提が正しく展開されている', () => {
  const phys4 = data.skills.find((s) => s.id === 'phys_04');
  ok(phys4.requires.includes('math_21'), '物理「運動方程式」が数学「微分法の基礎」を前提にしていない');
  const end6 = data.skills.find((s) => s.id === 'end_06');
  ok(end6.requires.includes('low_05'), 'バーピーが下半身の前提を持っていない');
});

test('すべての段は3列以内に収まるか、警告として出る', () => {
  const res = Validate.validate(data);
  const levels = Validate.computeLevels(data);
  let over = 0;
  for (const rows of levels.values()) {
    for (const row of rows) if (row.length > Validate.MAX_COLUMNS) over++;
  }
  eq(res.warnings.filter((w) => w.includes('段に')).length, over, '列数の警告件数:');
});

// ---------------- レベル ----------------

test('レベルの計算', () => {
  eq(Rules.levelOf(0), 1);
  eq(Rules.levelOf(39), 1);
  eq(Rules.levelOf(40), 2);
  eq(Rules.levelOf(159), 2);
  eq(Rules.levelOf(160), 3);
  eq(Rules.levelOf(360), 4);
});

test('レベルの進捗', () => {
  const p = Rules.levelProgress(100);
  eq(p.level, 2);
  eq(p.cur, 60);
  eq(p.need, 120);
});

// ---------------- サビ ----------------

test('安全な日数と完全にサビるまでの日数', () => {
  eq(Rules.safeDays(0), 2);
  eq(Rules.fullDays(0), 10);
  eq(Rules.safeDays(3), 8);
  eq(Rules.fullDays(3), 16);
  eq(Rules.safeDays(20), 22, '回数は10で頭打ち');
  eq(Rules.fullDays(20), 30, '回数は10で頭打ち');
});

test('サビは安全日数までは0、完全日数で1', () => {
  const now = Date.now();
  const p = { polishCount: 0, polishedAt: now - 2 * DAY };
  eq(Rules.rustOf(p, { now }), 0);
  eq(Rules.rustOf({ polishCount: 0, polishedAt: now - 6 * DAY }, { now }), 0.5);
  eq(Rules.rustOf({ polishCount: 0, polishedAt: now - 10 * DAY }, { now }), 1);
  eq(Rules.rustOf({ polishCount: 0, polishedAt: now - 30 * DAY }, { now }), 1);
});

test('ひよこがいるとサビが遅れる', () => {
  const now = Date.now();
  const p = { polishCount: 0, polishedAt: now - 6 * DAY };
  const plain = Rules.rustOf(p, { now });
  const withChick = Rules.rustOf(p, { now, hasChick: true });
  ok(withChick < plain, 'ひよこありのほうがサビが小さいはず');
  near(withChick, (6 * 0.85 - 2) / 8, 1e-9);
});

test('磨いた直後から安全な日数のあいだはサビない', () => {
  const now = Date.now();
  const p = { polishCount: 1, polishedAt: Rules.polishedAtForRust(0, 1, { now }) };
  eq(Rules.rustOf(p, { now: now + 3.9 * DAY }), 0, '安全な日数(4日)の内側:');
  ok(Rules.rustOf(p, { now: now + 5 * DAY }) > 0, '安全な日数を過ぎたらサビ始める');
});

test('使ったスキル経由の部分回復は7割落ちる', () => {
  const now = Date.now();
  const p = { polishCount: 0, polishedAt: now - 6 * DAY };
  const before = Rules.rustOf(p, { now });
  const next = { polishCount: 0, polishedAt: Rules.partialPolish(p, { now }) };
  near(Rules.rustOf(next, { now }), before * 0.3, 1e-9);
});

test('完全に磨くとサビが0になる', () => {
  const now = Date.now();
  const at = Rules.polishedAtForRust(0, 2, { now });
  eq(Rules.rustOf({ polishCount: 2, polishedAt: at }, { now }), 0);
});

// ---------------- 経験値 ----------------

test('記録の経験値 = 基本 × 種類の重み', () => {
  eq(Rules.logXp({ baseXp: 10, kindWeight: 1.5, rust: 0 }).xp, 15);
  eq(Rules.logXp({ baseXp: 10, kindWeight: 0.5, rust: 0 }).xp, 5);
});

test('サビ40%以上で補習ボーナス、ひよこでさらに1.1倍', () => {
  eq(Rules.logXp({ baseXp: 10, kindWeight: 1, rust: 0.4 }).xp, 13);
  eq(Rules.logXp({ baseXp: 10, kindWeight: 1, rust: 0.39 }).xp, 10);
  eq(Rules.logXp({ baseXp: 10, kindWeight: 1, rust: 0.4, hasChick: true }).xp, 14); // 10*1.3*1.1
});

test('パラメータの上昇は現在値が高いほど鈍る', () => {
  const low = Rules.statGains({ xp: 15, treeWeights: { int: 1 }, stats: { int: 0 }, rand: () => 0.9 });
  const high = Rules.statGains({ xp: 15, treeWeights: { int: 1 }, stats: { int: 25 }, rand: () => 0.9 });
  eq(low.crit, false);
  near(low.gains.int, 1, 1e-9);
  near(high.gains.int, 0.5, 1e-9);
});

test('12%未満の乱数で会心(2倍)', () => {
  const crit = Rules.statGains({ xp: 15, treeWeights: { int: 1 }, stats: { int: 0 }, rand: () => 0.05 });
  eq(crit.crit, true);
  near(crit.gains.int, 2, 1e-9);
});

// ---------------- 解放と冒険 ----------------

test('前提が揃うと解放できる', () => {
  const skill = data.skills.find((s) => s.id === 'math_03');
  eq(Rules.isUnlockable(skill, {}), false);
  eq(Rules.isUnlockable(skill, { math_01: { unlocked: true } }), true);
  eq(Rules.isUnlockable(skill, { math_01: { unlocked: true }, math_03: { unlocked: true } }), false);
});

test('草原の入場条件', () => {
  const okCase = Rules.grassCheck({ stats: { int: 6, str: 4, sta: 2 }, freshCount: 8 });
  eq(okCase.ok, true);
  const ng = Rules.grassCheck({ stats: { int: 5, str: 4, sta: 2 }, freshCount: 3 });
  eq(ng.ok, false);
  eq(ng.missing.length, 2);
});

// ---------------- 連続日数 ----------------

test('連続日数は翌日なら伸び、飛ぶと1に戻る', () => {
  eq(Rules.updateStreak({ count: 0, lastDate: null }, '2026-09-20').count, 1);
  eq(Rules.updateStreak({ count: 3, lastDate: '2026-09-19' }, '2026-09-20').count, 4);
  eq(Rules.updateStreak({ count: 3, lastDate: '2026-09-17' }, '2026-09-20').count, 1);
  eq(Rules.updateStreak({ count: 3, lastDate: '2026-09-20' }, '2026-09-20').count, 3);
  eq(Rules.updateStreak({ count: 3, lastDate: '2026-09-20' }, '2026-09-20').changed, false);
});

// ---------------- 保存 ----------------

test('ツリーデータは初回に保存され、次回はそれが読まれる', () => {
  mem.clear();
  const first = Store.loadTreeData();
  eq(first.replaced, false);
  eq(first.data.skills.length, 145);
  const second = Store.loadTreeData();
  eq(second.replaced, false);
});

test('verが上がると初期データに差し替わる', () => {
  mem.clear();
  const old = U.deepClone(data);
  old.ver = 0;
  old.skills = old.skills.slice(0, 5);
  mem.set('doryoku-rpg/treedata', JSON.stringify(old));
  const res = Store.loadTreeData();
  eq(res.replaced, true);
  eq(res.data.skills.length, 145);
});

test('存在しないスキルの進捗は退避される', () => {
  const progress = Store.emptyProgress();
  progress.skills = { math_01: { unlocked: true }, ghost_99: { unlocked: true } };
  const out = Store.reconcile(progress, data);
  ok(out.skills.math_01, '既知のスキルは残る');
  ok(!out.skills.ghost_99, '未知のスキルは外れる');
  ok(out._orphans.ghost_99, '退避されている');
});

test('バックアップの書き出しと読み込み', () => {
  const progress = Store.emptyProgress();
  progress.totalXp = 321;
  const backup = Store.exportBackup(progress, data, { apiKey: 'sk-secret', model: 'claude-haiku-4-5' }, {});
  eq(backup.settings.apiKey, undefined, 'APIキーは書き出しに含めない');
  const res = Store.importBackup(JSON.stringify(backup));
  eq(res.ok, true);
  eq(res.backup.progress.totalXp, 321);
});

test('壊れたバックアップは理由つきで拒否される', () => {
  eq(Store.importBackup('{').ok, false);
  eq(Store.importBackup('{"a":1}').ok, false);
  const bad = { progress: Store.emptyProgress(), treeData: { ...U.deepClone(data), skills: [{ id: 'x', tree: 'nope', name: 'x', xp: 1 }] } };
  eq(Store.importBackup(bad).ok, false);
});



// ---------------- ツリーの配置 ----------------

test('配置はどの段のスキルも落とさない', () => {
  for (const tree of data.trees) {
    const { rows } = Layout.treeLayout(data, tree.id);
    const flat = rows.flat();
    const expected = data.skills.filter((s) => s.tree === tree.id).map((s) => s.id);
    eq(flat.length, expected.length, `ツリー ${tree.id} のスキル数:`);
    eq(new Set(flat).size, flat.length, `ツリー ${tree.id} に重複:`);
    for (const id of expected) ok(flat.includes(id), `${id} が抜けている`);
  }
});

test('前提は必ず子より前の段にくる', () => {
  const byId = new Map(data.skills.map((s) => [s.id, s]));
  for (const tree of data.trees) {
    const { rows } = Layout.treeLayout(data, tree.id);
    const levelOf = new Map();
    rows.forEach((row, d) => row.forEach((id) => levelOf.set(id, d)));
    for (const id of levelOf.keys()) {
      for (const req of byId.get(id).requires || []) {
        const parent = byId.get(req);
        if (!parent || parent.tree !== tree.id) continue;
        ok(levelOf.get(req) < levelOf.get(id), `${req} が ${id} より後ろの段にある`);
      }
    }
  }
});

test('子は親の位置の平均順に並ぶ(交差を減らす)', () => {
  // 段0 が [a, b]、段1 は b の子 → a の子 の順で書いても、並べ替えで a の子が先にくる
  const mini = {
    ver: 1,
    stats: [{ id: 'int', name: '知力' }],
    kinds: [{ id: 'practice', name: '練習', weight: 1 }],
    categories: [{ id: 'study', name: '勉強', test: true }],
    trees: [{ id: 't', category: 'study', name: 'T', weights: { int: 1 }, hint: '' }],
    skills: [
      { id: 'a', tree: 't', name: 'a', requires: [], uses: [], xp: 1, reward: {} },
      { id: 'b', tree: 't', name: 'b', requires: [], uses: [], xp: 1, reward: {} },
      { id: 'child_of_b', tree: 't', name: 'cb', requires: ['b'], uses: [], xp: 1, reward: {} },
      { id: 'child_of_a', tree: 't', name: 'ca', requires: ['a'], uses: [], xp: 1, reward: {} },
    ],
  };
  eq(Validate.validate(mini).errors.length, 0);
  const { rows } = Layout.treeLayout(mini, 't');
  eq(rows[0].join(','), 'a,b');
  eq(rows[1].join(','), 'child_of_a,child_of_b', '親の並びに合わせて入れ替わる:');
});

test('他ツリーの前提は線を引く対象から外れる', () => {
  const phys4 = data.skills.find((s) => s.id === 'phys_04');
  const same = Layout.sameTreeParents(data, phys4);
  const cross = Layout.crossTreeParents(data, phys4);
  eq(cross.join(','), 'math_21', '他ツリーの前提:');
  ok(same.includes('phys_02') && same.includes('phys_03'), '同じツリーの前提が残る');
  ok(!same.includes('math_21'), '他ツリーが混ざっている');
});

// ---------------- 記録(actions) ----------------

/** shell.js の App のうち Actions が使う部分だけを作った検証用スタブ */
function makeApp(treeData) {
  const app = {
    treeData,
    progress: Store.emptyProgress(),
    skillById: U.byId(treeData.skills),
    treeById: U.byId(treeData.trees),
    kindById: U.byId(treeData.kinds),
    statById: U.byId(treeData.stats),
    saved: 0,
    skill: (id) => app.skillById.get(id),
    tree: (id) => app.treeById.get(id),
    hasChick: () => !!app.progress.companions.chick,
    save: () => { app.saved++; return true; },
    prog(id) {
      let p = app.progress.skills[id];
      if (!p) p = app.progress.skills[id] = { unlocked: false, unlockedAt: 0, polishCount: 0, polishedAt: 0 };
      return p;
    },
    rust(id, now) {
      const p = app.progress.skills[id];
      if (!p || !p.unlocked) return 0;
      return Rules.rustOf(p, { now, hasChick: app.hasChick() });
    },
    isUnlocked: (id) => !!(app.progress.skills[id] && app.progress.skills[id].unlocked),
    unlockedSkills: () => treeData.skills.filter((s) => app.isUnlocked(s.id)),
  };
  return app;
}

test('解放するとパラメーターが報酬ぶん増える', () => {
  const app = makeApp(U.deepClone(data));
  const res = Actions.unlockSkill(app, 'math_01', 'self', { now: Date.now() });
  eq(res.already, false);
  eq(app.progress.stats.int, 1);
  eq(app.isUnlocked('math_01'), true);
  eq(Actions.unlockSkill(app, 'math_01', 'self').already, true, '2回目は何も起きない');
  eq(app.progress.stats.int, 1, '報酬が二重取りされない');
});

test('記録すると経験値・パラメーター・連続日数・履歴が動く', () => {
  const app = makeApp(U.deepClone(data));
  const now = Date.now();
  Actions.unlockSkill(app, 'math_01', 'self', { now });
  const before = app.progress.stats.int;

  U.setRandom(() => 0.9); // 会心しない
  const res = Actions.recordLog(app, { skillId: 'math_01', kindId: 'practice', now });
  U.setRandom(null);

  eq(res.xp, 10, '基本10 × 練習1.0');
  eq(app.progress.totalXp, 10);
  ok(app.progress.stats.int > before, 'パラメーターが増える');
  eq(app.progress.logs.length, 1);
  eq(res.streakCount, 1);
  eq(app.progress.skills.math_01.polishCount, 2, '解放で1、記録で2');
  eq(app.rust('math_01', now), 0, '記録直後はサビ0');
});

test('未解放のスキルは記録できない', () => {
  const app = makeApp(U.deepClone(data));
  let threw = false;
  try { Actions.recordLog(app, { skillId: 'math_01', kindId: 'practice' }); }
  catch (e) { threw = true; }
  eq(threw, true);
});

test('サビたスキルを記録すると補習ボーナスが乗る', () => {
  const app = makeApp(U.deepClone(data));
  const now = Date.now();
  Actions.unlockSkill(app, 'math_01', 'self', { now });
  app.progress.skills.math_01.polishedAt = now - 30 * DAY; // 完全にサビた状態

  U.setRandom(() => 0.9);
  const res = Actions.recordLog(app, { skillId: 'math_01', kindId: 'practice', now });
  U.setRandom(null);

  eq(res.xp, 13, '10 × 1.0 × 1.3');
  ok(res.bonusDetail.some((d) => d.label === '補習ボーナス'));
});

test('使ったスキルとその前提のサビが7割落ちる', () => {
  const app = makeApp(U.deepClone(data));
  const now = Date.now();
  for (const id of ['math_01', 'math_04', 'math_05']) {
    Actions.unlockSkill(app, id, 'self', { now });
    app.progress.skills[id].polishedAt = now - 6 * DAY;
  }
  // 解放直後は polishCount = 1 なので安全4日・完全12日 → 6日経過でサビ25%
  const before = app.rust('math_01', now);
  near(before, 0.25, 1e-9);

  U.setRandom(() => 0.9);
  Actions.recordLog(app, { skillId: 'math_05', kindId: 'practice', usesIds: ['math_04'], now });
  U.setRandom(null);

  near(app.rust('math_04', now), 0.25 * 0.3, 1e-9, '選んだスキル:');
  near(app.rust('math_01', now), 0.25 * 0.3, 1e-9, 'その前提:');
  eq(app.rust('math_05', now), 0, '記録したスキル自身は完全回復:');
});

test('選ばなかったスキルのサビは動かない', () => {
  const app = makeApp(U.deepClone(data));
  const now = Date.now();
  for (const id of ['math_01', 'math_02', 'math_04']) {
    Actions.unlockSkill(app, id, 'self', { now });
    app.progress.skills[id].polishedAt = now - 6 * DAY;
  }
  U.setRandom(() => 0.9);
  Actions.recordLog(app, { skillId: 'math_04', kindId: 'practice', usesIds: [], now });
  U.setRandom(null);
  near(app.rust('math_02', now), 0.25, 1e-9);
});

test('草原の入場条件に使うスキル数はサビ50%未満だけ数える', () => {
  const app = makeApp(U.deepClone(data));
  const now = Date.now();
  const ids = ['math_01', 'math_02', 'eng_01', 'eng_14'];
  for (const id of ids) Actions.unlockSkill(app, id, 'self', { now });
  eq(Actions.freshSkillCount(app, now), 4);
  app.progress.skills.math_01.polishedAt = now - 30 * DAY;
  eq(Actions.freshSkillCount(app, now), 3);
});

// ---------------- AIテスト: 記述式の採点 ----------------

const W = (answer, accepts) => ({ type: 'written', answer, accepts: accepts || [] });

test('記述: 全角・半角と空白の違いを吸収する', () => {
  ok(Quiz.gradeWritten('１２', W('12')), '全角数字');
  ok(Quiz.gradeWritten(' Ｘ＝３ ', W('x=3')), '全角英字と空白');
  ok(Quiz.gradeWritten('「完了」', W('完了')), 'かぎかっこ');
  ok(Quiz.gradeWritten('完了。', W('完了')), '句点');
  ok(!Quiz.gradeWritten('', W('完了')), '空欄は不正解');
});

test('記述: 小数と分数を同じ値として扱う', () => {
  ok(Quiz.gradeWritten('0.5', W('1/2')), '0.5 = 1/2');
  ok(Quiz.gradeWritten('１／２', W('0.5')), '全角の分数');
  ok(Quiz.gradeWritten('2分の1', W('0.5')), '2分の1');
  ok(Quiz.gradeWritten('0.50', W('1/2')), '0.50');
  ok(Quiz.gradeWritten('-0.75', W('-3/4')), '負の数');
  ok(Quiz.gradeWritten('ー3/4', W('-0.75')), '長音記号のマイナス');
  ok(Quiz.gradeWritten('マイナス4分の3', W('-0.75')), 'マイナス4分の3');
  ok(Quiz.gradeWritten('x=1/2', W('0.5')), '変数名つき');
  ok(Quiz.gradeWritten('2.5×10^-3', W('0.0025')), '指数表記');
  ok(!Quiz.gradeWritten('0.6', W('1/2')), 'ちがう値は不正解');
});

test('記述: 割り切れない分数は、書いた桁で四捨五入して一致すれば正解', () => {
  ok(Quiz.gradeWritten('0.33', W('1/3')), '0.33');
  ok(Quiz.gradeWritten('0.667', W('2/3')), '0.667');
  ok(!Quiz.gradeWritten('0.3', W('1/3')), '小数第1位までは不正解');
  ok(!Quiz.gradeWritten('0.34', W('1/3')), '四捨五入がちがう');
});

test('記述: 別解(accepts)も正解にする。カタカナの長音は消さない', () => {
  ok(Quiz.gradeWritten('けり', W('完了', ['けり'])));
  ok(Quiz.gradeWritten('スーパー', W('スーパー')));
  ok(!Quiz.gradeWritten('スパ', W('スーパー')));
});

test('記述: 因数分解は因数の並びがちがっても正解', () => {
  ok(Quiz.gradeWritten('(2x+1)(x+3)', W('(x + 3)(2x + 1)')), '並びが逆');
  ok(Quiz.gradeWritten('2(x-1)(x+1)', W('2(x+1)(x-1)')), '係数つき');
  ok(Quiz.gradeWritten('(x+1)^2(x-2)', W('(x-2)(x+1)^2')), '累乗つき');
  ok(!Quiz.gradeWritten('(x+1)(x+3)', W('(x+3)(2x+1)')), 'ちがう因数は不正解');
});

// ---------------- AIテスト: 問題の検査と合否 ----------------

const rawQs = [
  { type: 'choice', skillId: 'math_01', question: 'Q1', choices: ['a', 'b', 'c', 'd'], answer: 2 },
  { type: 'choice', skillId: 'math_01', question: 'Q2', choices: ['a', 'b', 'c', 'd'], answer: 0 },
  { type: 'choice', skillId: 'math_01', question: 'Q3', choices: ['a', 'b', 'c', 'd'], answer: 3 },
  { type: 'written', skillId: 'math_01', question: 'Q4', answer: '1/2' },
];

test('問題の検査: 壊れた問題を捨て、正解の位置を保ったまま選択肢を混ぜる', () => {
  U.setRandom(() => 0.3);
  const got = Quiz.sanitizeQuestions({ questions: rawQs.concat([
    { type: 'choice', skillId: 'math_01', question: 'bad', choices: ['a', 'b'], answer: 5 },
    { type: 'choice', skillId: 'math_01', question: 'dup', choices: ['a', 'a', 'b', 'c'], answer: 0 },
    { type: 'written', skillId: 'math_01', question: 'noanswer', answer: '' },
    { type: 'choice', skillId: 'eng_01', question: 'other', choices: ['a', 'b', 'c', 'd'], answer: 0 },
    { type: 'choice', skillId: 'math_01', question: 'Ｑ１', choices: ['a', 'b', 'c', 'd'], answer: 0 },
  ]) }, { skillIds: ['math_01'] });
  U.setRandom(null);
  eq(got.length, 4, '残る問題数:');
  eq(got[0].choices[got[0].answer], 'c', '正解の選択肢:');
  eq(got[2].choices[got[2].answer], 'd', '正解の選択肢:');
  ok(Quiz.pickUnlockSet(got), '選択3+記述1がそろう');
  eq(Quiz.pickUnlockSet(got.slice(0, 3)), null, '記述がないとそろわない');
});

test('合否: 4問中3問で合格、2問は不合格', () => {
  const qs = Quiz.sanitizeQuestions(rawQs);
  const ans = (miss) => qs.map((q, i) => ({ q, given: i < miss ? '__' : (q.type === 'choice' ? q.answer : '0.5') }));
  eq(Quiz.judge(Quiz.scoreTest(ans(0))), 'pass');
  eq(Quiz.judge(Quiz.scoreTest(ans(1))), 'pass');
  eq(Quiz.judge(Quiz.scoreTest(ans(2))), 'fail');
});

test('合否: 「おかしい」で外した問題は数えず、外しても合格しやすくはならない', () => {
  const qs = Quiz.sanitizeQuestions(rawQs);
  const items = qs.map((q) => ({ q, given: q.type === 'choice' ? q.answer : '0.5' }));
  items[0].flagged = true;
  items[1].given = -1;
  const score = Quiz.scoreTest(items);
  eq(score.valid, 3, '有効:');
  eq(score.correct, 2, '正解:');
  eq(Quiz.judge(score), 'fail', '3問中2問は不合格:');
  items[2].flagged = true; items[3].flagged = true;
  eq(Quiz.judge(Quiz.scoreTest(items)), 'void', '有効1問では判定しない:');
});

// ---------------- AIテスト: 診断 ----------------

const skillById = U.byId(data.skills);
const mathSkills = data.skills.filter((s) => s.tree === 'math');

test('診断: 自己申告のスキルと前提から出題し、1つ先を1問足す(最大6問)', () => {
  U.setRandom(() => 0);
  const ids = Quiz.diagnosisTargets({ treeSkills: mathSkills, skillById, claimIds: ['math_26'] });
  U.setRandom(null);
  ok(ids.length <= 6, '6問以内: ' + ids.length);
  ok(ids.includes('math_26'), '自己申告したスキルを含む');
  eq(ids[ids.length - 1], 'math_27', '最後は1つ先:');
  const anc = Quiz.ancestorsOf('math_26', skillById);
  for (const id of ids.slice(0, -1)) ok(id === 'math_26' || anc.has(id), '前提以外が混ざった: ' + id);
  eq(new Set(ids).size, ids.length, '重複なし:');
});

test('診断: 何も選ばなければツリーの入口から出題する', () => {
  const ids = Quiz.diagnosisTargets({ treeSkills: mathSkills, skillById, claimIds: [] });
  ok(ids.length > 0 && ids.length <= 6);
  for (const id of ids) {
    ok(!skillById.get(id).requires.some((r) => r.startsWith('math_')), '入口でない: ' + id);
  }
});

test('診断: 正解したスキルと前提(他ツリー含む)を解放し、いちばん先を返す', () => {
  const physSkills = data.skills.filter((s) => s.tree === 'phys');
  const out = Quiz.diagnosisOutcome({
    treeSkills: physSkills, skillById,
    results: [{ skillId: 'phys_01', correct: true }, { skillId: 'phys_04', correct: true }, { skillId: 'phys_05', correct: false }],
  });
  eq(out.frontierId, 'phys_04', 'いちばん先:');
  ok(out.unlockIds.includes('math_21'), '他ツリーの前提も解放');
  ok(!out.unlockIds.includes('phys_05'), 'まちがえたスキルは解放しない');
  for (const id of out.unlockIds) {
    for (const r of skillById.get(id).requires) ok(out.unlockIds.includes(r), '前提が抜けた: ' + r);
  }
});

// ---------------- AIテスト: 復習リスト ----------------

test('復習リスト: 同じ問題はまとめ、2回連続正解で克服、まちがえると戻る', () => {
  const list = [];
  const q = { type: 'written', skillId: 'math_01', question: '問1', answer: '3' };
  Quiz.addMistake(list, q, 1);
  Quiz.addMistake(list, { ...q, question: '問１' }, 2);
  eq(list.length, 1, '件数:');
  eq(list[0].misses, 2, 'まちがい回数:');
  Quiz.recordReview(list[0], true, 3);
  ok(!list[0].cleared, '1回では克服しない');
  Quiz.recordReview(list[0], false, 4);
  Quiz.recordReview(list[0], true, 5);
  ok(!list[0].cleared, '連続でないと克服しない');
  Quiz.recordReview(list[0], true, 6);
  ok(list[0].cleared, '2回連続で克服');
});

test('復習リスト: 300問を超えたら克服済みの古いものから捨てる', () => {
  const list = [];
  for (let i = 0; i < 300; i++) Quiz.addMistake(list, { skillId: 's', question: 'q' + i }, i);
  list[5].cleared = true;
  Quiz.addMistake(list, { skillId: 's', question: 'new' }, 1000);
  eq(list.length, 300, '件数:');
  ok(!list.some((it) => it.q.question === 'q5'), '克服済みが消える');
  Quiz.addMistake(list, { skillId: 's', question: 'new2' }, 1001);
  ok(!list.some((it) => it.q.question === 'q0'), '次はいちばん古いものが消える');
});

test('解放テスト: 合格で解放、まちがいは復習リストへ、外した問題は入れない', () => {
  const app = makeApp(U.deepClone(data));
  const qs = Quiz.sanitizeQuestions(rawQs);
  const items = qs.map((q) => ({ q, given: q.type === 'choice' ? q.answer : '0.5' }));
  items[0].given = -1;
  items[1].flagged = true;
  items[1].given = -1;
  let res = Actions.finishUnlockTest(app, 'math_01', items, { now: 10 });
  eq(res.verdict, 'fail', '3問中2問:');
  ok(!app.isUnlocked('math_01'), '不合格では解放しない');
  eq(app.progress.reviewList.length, 1, '復習リスト:');
  eq(app.progress.reviewList[0].q.question, 'Q1', 'まちがえた問題だけ:');

  items[0].given = items[0].q.answer;
  res = Actions.finishUnlockTest(app, 'math_01', items, { now: 20 });
  eq(res.verdict, 'pass');
  ok(app.isUnlocked('math_01'), '合格で解放');
  eq(app.progress.skills.math_01.unlockedBy, 'test');
  eq(app.progress.testLog.length, 2, 'テストの履歴:');
});

test('復習テスト: 3問中2問で合格し、「復習のみ」の記録としてサビが0に戻る', () => {
  const app = makeApp(U.deepClone(data));
  const now = Date.now();
  Actions.unlockSkill(app, 'math_01', 'self', { now: now - 30 * DAY });
  near(app.rust('math_01', now), 1, 1e-9, '30日後:');
  const qs = Quiz.pickReviewSet(Quiz.sanitizeQuestions(rawQs));
  eq(qs.length, 3, '選択2+記述1:');
  const items = qs.map((q) => ({ q, given: q.type === 'choice' ? q.answer : '0.5' }));
  items[0].given = -1;
  const xpBefore = app.progress.totalXp;
  const res = Actions.finishReviewTest(app, 'math_01', items, { now });
  eq(res.verdict, 'pass', '2/3:');
  eq(app.rust('math_01', now), 0, 'サビ:');
  eq(app.progress.skills.math_01.polishCount, 2, '磨いた回数:');
  eq(app.progress.logs[0].kindId, 'review', '記録の種類:');
  ok(app.progress.totalXp > xpBefore, '経験値が入る');
  eq(app.progress.reviewList.length, 1, 'まちがいは復習リストへ:');

  items[1].given = -1;
  const res2 = Actions.finishReviewTest(app, 'math_01', items, { now });
  eq(res2.verdict, 'fail', '1/3:');
  eq(app.progress.logs.length, 1, '不合格では記録しない:');
});

test('診断: 正解したスキルと前提をまとめて解放し、結果をツリーごとに残す', () => {
  const app = makeApp(U.deepClone(data));
  const mk = (skillId, question) => ({ type: 'choice', skillId, question, choices: ['a', 'b'], answer: 0 });
  const items = [
    { q: mk('phys_01', 'p1'), given: 0 },
    { q: mk('phys_04', 'p4'), given: 0 },
    { q: mk('phys_05', 'p5'), given: 1 },
    { q: mk('phys_06', 'p6'), given: 1, flagged: true },
  ];
  const res = Actions.finishDiagnosis(app, 'phys', items, { claimId: 'phys_05', memo: 'メモ' });
  eq(res.outcome.frontierId, 'phys_04', 'いちばん先:');
  ok(app.isUnlocked('phys_04') && app.isUnlocked('math_21'), '他ツリーの前提ごと解放');
  eq(app.progress.skills.phys_04.unlockedBy, 'diagnosis');
  ok(!app.isUnlocked('phys_05'), 'まちがえたスキルは解放しない');
  eq(app.progress.reviewList.length, 1, 'まちがいだけ復習リストへ(外した問題は入れない):');
  const rec = app.progress.diagnoses.phys;
  eq(rec.claimId, 'phys_05'); eq(rec.valid, 3); eq(rec.correct, 2);
  eq(rec.unlocked.length, res.unlocked.length);
  ok(app.progress.stats.int > 0, '解放報酬が入る');
});

// ---------------- AIモックでの通し動作 ----------------

const ch = (skillId, question, answer = 0) =>
  ({ type: 'choice', skillId, question, choices: ['ア', 'イ', 'ウ', 'エ'], answer, explanation: '解説' });
const wr = (skillId, question, answer) => ({ type: 'written', skillId, question, answer, explanation: '解説' });

/** 正解をそのまま答える */
const answerAll = (qs) => qs.map((q) => ({ q, given: q.type === 'choice' ? q.answer : q.answer }));

test('通し: 解放テスト(AIの返事を検査 → 解答 → 合格で解放)', async () => {
  const app = makeApp(U.deepClone(data));
  const calls = [];
  Ai.setMock(async (params) => {
    calls.push(params);
    // コードフェンスつき・壊れた問題まじりで返す
    return { text: '```json\n' + JSON.stringify({ questions: [
      ch('math_01', `展開${calls.length}-1`), ch('math_01', `展開${calls.length}-2`, 3),
      { type: 'choice', skillId: 'math_01', question: '壊れ', choices: ['a'], answer: 0 },
      ch('math_01', `展開${calls.length}-3`, 1), ch('math_01', `展開${calls.length}-4`),
      wr('math_01', `定数項${calls.length}`, '10'), wr('math_01', `係数${calls.length}`, '-2'),
    ] }) + '\n```' };
  });
  try {
    const qs = await QuizGen.unlockQuestions(app, app.skill('math_01'), { level: 'low' });
    eq(qs.length, 4, '4問:');
    eq(qs.filter((q) => q.type === 'written').length, 1, '記述1問:');
    ok(calls[0].system.includes('高校数学'), '出題方針(hint)をAIに渡す');
    ok(calls[0].messages[0].content.includes('式の展開と因数分解'), 'スキル名をAIに渡す');
    ok(calls[0].messages[0].content.includes('基本レベル'), '自信に合わせた難しさを渡す');

    await QuizGen.unlockQuestions(app, app.skill('math_01'), { level: 'mid', avoid: qs.map((q) => q.question) });
    ok(calls[1].messages[0].content.includes('展開1-1'), '再挑戦では前の問題を避けるよう伝える');

    const res = Actions.finishUnlockTest(app, 'math_01', answerAll(qs));
    eq(res.verdict, 'pass');
    ok(app.isUnlocked('math_01'));
  } finally { Ai.setMock(null); }
});

test('通し: AIの問題が足りない・JSONでないときは bad-response で自己申告に回せる', async () => {
  const app = makeApp(U.deepClone(data));
  try {
    Ai.setMock(async () => ({ text: JSON.stringify({ questions: [ch('math_01', 'Q')] }) }));
    let err = null;
    try { await QuizGen.unlockQuestions(app, app.skill('math_01'), { level: 'mid' }); } catch (e) { err = e; }
    eq(err && err.kind, 'bad-response', '問題不足:');

    Ai.setMock(async () => ({ text: 'すみません、作れませんでした' }));
    err = null;
    try { await QuizGen.reviewQuestions(app, app.skill('math_01'), {}); } catch (e) { err = e; }
    eq(err && err.kind, 'bad-response', 'JSONでない:');
  } finally { Ai.setMock(null); }
});

test('通し: APIキーがなければ no-key で止まる(自己申告の動線に切り替わる)', async () => {
  eq(Ai.available(), false, 'キーなしでは使えない:');
  let err = null;
  try { await Ai.call({ messages: [{ role: 'user', content: 'x' }] }); } catch (e) { err = e; }
  eq(err && err.kind, 'no-key');
});

test('通し: 復習テスト(まちがいをAIに伝える → 合格でサビが0)', async () => {
  const app = makeApp(U.deepClone(data));
  const now = Date.now();
  Actions.unlockSkill(app, 'eng_01', 'self', { now: now - 20 * DAY });
  Quiz.addMistake(app.progress.reviewList, ch('eng_01', '前にまちがえた問題'), now - DAY);
  let prompt = '';
  Ai.setMock(async (params) => {
    prompt = params.messages[0].content;
    return { text: JSON.stringify({ questions: [
      ch('eng_01', 'R1'), ch('eng_01', 'R2'), ch('eng_01', 'R3'), wr('eng_01', 'R4', 'went'), wr('eng_01', 'R5', 'gone'),
    ] }) };
  });
  try {
    const mistakes = app.progress.reviewList.map((it) => it.q.question);
    const qs = await QuizGen.reviewQuestions(app, app.skill('eng_01'), { mistakes });
    eq(qs.length, 3, '選択2+記述1:');
    ok(prompt.includes('前にまちがえた問題'), '復習リストのまちがいをAIに伝える');
    ok(app.rust('eng_01', now) > 0.9, 'サビている');
    const res = Actions.finishReviewTest(app, 'eng_01', answerAll(qs), { now });
    eq(res.verdict, 'pass');
    eq(app.rust('eng_01', now), 0, 'サビ:');
  } finally { Ai.setMock(null); }
});

test('通し: 診断(出題先を選ぶ → 1スキル1問 → 前提ごと解放 → 講評)', async () => {
  const app = makeApp(U.deepClone(data));
  const tree = app.tree('phys');
  const treeSkills = data.skills.filter((s) => s.tree === 'phys');
  U.setRandom(() => 0);
  const targets = Quiz.diagnosisTargets({ treeSkills, skillById: app.skillById, claimIds: ['phys_04'] });
  U.setRandom(null);
  const calls = [];
  Ai.setMock(async (params) => {
    calls.push(params);
    if (calls.length === 2) return { text: '# 講評\n\n**よくできました**。次は運動量です。' };
    // 頼まれたスキルに1問ずつ + 余計な問題(別スキル・同じスキルの2問目)
    const ids = [...params.messages[0].content.matchAll(/skillId "([a-z]+_\d+)"/g)].map((m) => m[1]);
    return { text: JSON.stringify({ questions: ids.map((id) => ch(id, 'D-' + id))
      .concat([ch('math_01', 'よそのスキル'), ch(ids[0], '2問目')]) }) };
  });
  try {
    const qs = await QuizGen.diagnosisQuestions(app, tree, targets, { claimName: '運動方程式', memo: 'メモ' });
    eq(qs.length, targets.length, '1スキル1問:');
    eq(qs.map((q) => q.skillId).join(), targets.join(), '出題順:');
    ok(calls[0].messages[0].content.includes('メモ'), 'メモをAIに渡す');

    // 1つ先(最後の問題)だけまちがえる
    const items = answerAll(qs);
    items[items.length - 1].given = 9;
    const res = Actions.finishDiagnosis(app, 'phys', items, { claimId: 'phys_04' });
    eq(res.outcome.frontierId, 'phys_04', 'いちばん先:');
    ok(app.isUnlocked('phys_04') && app.isUnlocked('math_21'), '前提(他ツリー含む)ごと解放');
    ok(!app.isUnlocked(targets[targets.length - 1]), '1つ先は解放しない');

    const comment = await QuizGen.diagnosisComment(app, tree, {
      claimName: '運動方程式', frontierName: '運動方程式',
      results: res.record.results.map((r) => ({ skill: r.skillId, correct: r.correct })),
    });
    eq(comment, 'よくできました。次は運動量です。', '講評の飾りを外す:');
  } finally { Ai.setMock(null); }
});

for (const [name, fn] of asyncTests) {
  try { await fn(); pass++; }
  catch (e) { failures.push(`${name}\n    ${e.message}`); }
}

// ---------------- 結果 ----------------

console.log(`\n  ${pass} 件成功 / ${failures.length} 件失敗\n`);
if (failures.length) {
  for (const f of failures) console.error('  ✘ ' + f);
  process.exit(1);
}
console.log('  すべて成功\n');
