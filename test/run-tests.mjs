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
]) {
  (0, eval)(readFileSync(join(SRC, rel), 'utf8'));
}

const { U, TreeData, Validate, Rules, Store, Actions, Layout } = globalThis;

let pass = 0;
const failures = [];

function test(name, fn) {
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

// ---------------- 結果 ----------------

console.log(`\n  ${pass} 件成功 / ${failures.length} 件失敗\n`);
if (failures.length) {
  for (const f of failures) console.error('  ✘ ' + f);
  process.exit(1);
}
console.log('  すべて成功\n');
