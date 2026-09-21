/* 状態を書き換える操作をここに集める(UIからは呼ぶだけにする)。 */
(function (global) {
  'use strict';

  const R = global.Rules;
  const U = global.U;

  const MAX_LOGS = 500;

  /**
   * 記録を1件つける。
   * @param {object} app
   * @param {{skillId:string, kindId:string, usesIds?:string[], note?:string, now?:number}} input
   */
  function recordLog(app, input) {
    const now = input.now == null ? Date.now() : input.now;
    const skill = app.skill(input.skillId);
    if (!skill) throw new Error('スキルが見つかりません: ' + input.skillId);

    const prog = app.prog(skill.id);
    if (!prog.unlocked) throw new Error('まだ解放していないスキルです');

    const kind = app.kindById.get(input.kindId);
    if (!kind) throw new Error('記録の種類が不正です: ' + input.kindId);

    const tree = app.tree(skill.tree);
    const hasChick = app.hasChick();
    const rust = app.rust(skill.id, now);

    // --- 経験値 ---
    const xpRes = R.logXp({
      baseXp: skill.xp,
      kindWeight: kind.weight,
      rust: rust,
      hasChick: hasChick,
    });

    const beforeLevel = R.levelOf(app.progress.totalXp);
    app.progress.totalXp += xpRes.xp;
    const afterLevel = R.levelOf(app.progress.totalXp);

    // --- パラメーター ---
    const gainRes = R.statGains({
      xp: xpRes.xp,
      treeWeights: tree ? tree.weights : {},
      stats: app.progress.stats,
      rand: U.random,
    });
    for (const stat of Object.keys(gainRes.gains)) {
      app.progress.stats[stat] = U.round1(
        (app.progress.stats[stat] || 0) + gainRes.gains[stat]
      ) ;
    }

    // --- サビの回復 ---
    prog.polishCount = (prog.polishCount || 0) + 1;
    prog.polishedAt = R.polishedAtForRust(0, prog.polishCount, { now: now, hasChick: hasChick });

    const recovered = applyPartialRecovery(app, input.usesIds || [], skill.id, now, hasChick);

    // --- 連続日数 ---
    const todayKey = U.dateKey(now);
    const streak = R.updateStreak(app.progress.streak || { count: 0, lastDate: null }, todayKey);
    app.progress.streak = { count: streak.count, lastDate: streak.lastDate };

    // --- ログ ---
    const entry = {
      id: 'log_' + now + '_' + Math.floor(U.random() * 1000),
      at: now,
      date: todayKey,
      skillId: skill.id,
      treeId: skill.tree,
      kindId: kind.id,
      usesIds: (input.usesIds || []).slice(),
      note: (input.note || '').slice(0, 200),
      xp: xpRes.xp,
      crit: gainRes.crit,
      gains: gainRes.gains,
      rustBefore: Math.round(rust * 100) / 100,
    };
    app.progress.logs.unshift(entry);
    if (app.progress.logs.length > MAX_LOGS) app.progress.logs.length = MAX_LOGS;

    app.save();

    return {
      entry: entry,
      xp: xpRes.xp,
      bonusDetail: xpRes.detail,
      gains: gainRes.gains,
      crit: gainRes.crit,
      leveledUp: afterLevel > beforeLevel,
      level: afterLevel,
      streakCount: streak.count,
      streakChanged: streak.changed,
      recovered: recovered,
    };
  }

  /**
   * 「使ったスキル」とその前提をサビ回復させる(係数0.7)。
   * 記録したスキル自身はすでに完全回復しているので対象外。
   */
  function applyPartialRecovery(app, usesIds, selfId, now, hasChick) {
    const targets = new Set();
    for (const id of usesIds) {
      if (id === selfId) continue;
      targets.add(id);
      const used = app.skill(id);
      for (const req of (used && used.requires) || []) {
        if (req !== selfId) targets.add(req);
      }
    }

    const done = [];
    for (const id of targets) {
      const p = app.progress.skills[id];
      if (!p || !p.unlocked) continue;
      const before = R.rustOf(p, { now: now, hasChick: hasChick });
      if (before <= 0) continue;
      p.polishedAt = R.partialPolish(p, { now: now, hasChick: hasChick });
      done.push({ id: id, before: before, after: R.rustOf(p, { now: now, hasChick: hasChick }) });
    }
    return done;
  }

  /**
   * スキルを解放する。
   * @param {'self'|'test'|'diagnosis'} how 自己申告 / 解放テスト / 診断
   */
  function unlockSkill(app, skillId, how, opts) {
    const skill = app.skill(skillId);
    if (!skill) throw new Error('スキルが見つかりません: ' + skillId);

    const now = (opts && opts.now) || Date.now();
    const prog = app.prog(skillId);
    if (prog.unlocked) return { already: true, gains: {} };

    prog.unlocked = true;
    prog.unlockedAt = now;
    prog.unlockedBy = how;
    prog.polishCount = Math.max(1, prog.polishCount || 0);
    prog.polishedAt = R.polishedAtForRust(0, prog.polishCount, { now: now, hasChick: app.hasChick() });

    const gains = {};
    for (const stat of Object.keys(skill.reward || {})) {
      const v = skill.reward[stat];
      if (!v) continue;
      app.progress.stats[stat] = U.round1((app.progress.stats[stat] || 0) + v);
      gains[stat] = v;
    }

    if (!opts || opts.save !== false) app.save();
    return { already: false, gains: gains, skill: skill };
  }

  /** サビ50%未満の解放済みスキル数(草原の入場条件に使う) */
  function freshSkillCount(app, now) {
    const t = now == null ? Date.now() : now;
    return app.unlockedSkills().filter(function (s) {
      return app.rust(s.id, t) < R.C.GRASS_FRESH_RUST;
    }).length;
  }

  global.Actions = {
    MAX_LOGS,
    recordLog, unlockSkill, freshSkillCount, applyPartialRecovery,
  };
})(typeof window !== 'undefined' ? window : globalThis);
