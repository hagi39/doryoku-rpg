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

  // ---------------- AIテスト ----------------

  const MAX_TEST_LOG = 200;

  /** まちがえた問題(外した問題を除く)を復習リストへ */
  function saveMistakes(app, score, now) {
    let n = 0;
    for (const r of score.results) {
      if (r.flagged || r.correct) continue;
      global.Quiz.addMistake(app.progress.reviewList, r.q, now);
      n++;
    }
    return n;
  }

  function pushTestLog(app, entry) {
    const log = app.progress.testLog || (app.progress.testLog = []);
    log.unshift(entry);
    if (log.length > MAX_TEST_LOG) log.length = MAX_TEST_LOG;
  }

  /**
   * 解放テストの答えを採点し、合格なら解放する。まちがいは復習リストへ。
   * @param {Array<{q, given, flagged}>} items
   */
  function finishUnlockTest(app, skillId, items, opts) {
    const now = (opts && opts.now) || Date.now();
    const score = global.Quiz.scoreTest(items);
    const verdict = global.Quiz.judge(score);
    const mistakes = saveMistakes(app, score, now);

    let unlock = null;
    if (verdict === 'pass') unlock = unlockSkill(app, skillId, 'test', { now: now, save: false });

    pushTestLog(app, {
      at: now, type: 'unlock', skillId: skillId, level: opts && opts.level,
      valid: score.valid, correct: score.correct, verdict: verdict,
    });
    app.save();
    return { score: score, verdict: verdict, unlock: unlock, mistakes: mistakes,
      need: global.Quiz.passLine(score.valid) };
  }

  /** 記録の種類から「復習のみ」を探す(JSONで消されていたら重みがいちばん小さいもの) */
  function reviewKind(app) {
    const kinds = app.treeData.kinds || [];
    return kinds.find(function (k) { return k.id === 'review'; }) ||
      kinds.slice().sort(function (a, b) { return a.weight - b.weight; })[0];
  }

  /**
   * 復習テストの答えを採点する。合格なら「復習のみ」の記録として扱う
   * (サビが0に戻り、磨いた回数+1、経験値とパラメーターも入る)。
   */
  function finishReviewTest(app, skillId, items, opts) {
    const now = (opts && opts.now) || Date.now();
    const Q = global.Quiz;
    const score = Q.scoreTest(items);
    const verdict = Q.judge(score, Q.C.REVIEW_PASS_RATIO);
    const rustBefore = app.rust(skillId, now);
    const mistakes = saveMistakes(app, score, now);

    let log = null;
    if (verdict === 'pass') {
      const kind = reviewKind(app);
      log = recordLog(app, {
        skillId: skillId,
        kindId: kind.id,
        note: 'AI復習テストに合格(' + score.correct + '/' + score.valid + ')',
        now: now,
      });
    }

    pushTestLog(app, {
      at: now, type: 'review', skillId: skillId,
      valid: score.valid, correct: score.correct, verdict: verdict,
    });
    app.save();
    return {
      score: score, verdict: verdict, mistakes: mistakes, log: log,
      rustBefore: rustBefore, need: Q.passLine(score.valid, Q.C.REVIEW_PASS_RATIO),
    };
  }

  /**
   * 診断の答えを採点し、正解したスキルとその前提をまとめて解放する。
   * @param {{claimId?:string, memo?:string, now?:number}} opts
   */
  function finishDiagnosis(app, treeId, items, opts) {
    const o = opts || {};
    const now = o.now || Date.now();
    const Q = global.Quiz;
    const score = Q.scoreTest(items);
    const treeSkills = app.treeData.skills.filter(function (s) { return s.tree === treeId; });
    const outcome = Q.diagnosisOutcome({
      treeSkills: treeSkills,
      skillById: app.skillById,
      results: score.results.map(function (r) { return { skillId: r.q.skillId, correct: r.correct }; }),
    });

    const unlocked = [];
    const gains = {};
    for (const id of outcome.unlockIds) {
      const res = unlockSkill(app, id, 'diagnosis', { now: now, save: false });
      if (res.already) continue;
      unlocked.push(id);
      for (const k of Object.keys(res.gains)) gains[k] = U.round1((gains[k] || 0) + res.gains[k]);
    }
    const mistakes = saveMistakes(app, score, now);

    const record = {
      at: now,
      claimId: o.claimId || null,
      memo: (o.memo || '').slice(0, 300),
      frontierId: outcome.frontierId,
      valid: score.valid,
      correct: score.correct,
      unlocked: unlocked,
      results: score.results.map(function (r) { return { skillId: r.q.skillId, correct: r.correct }; }),
      comment: null,
    };
    if (!app.progress.diagnoses) app.progress.diagnoses = {};
    app.progress.diagnoses[treeId] = record;

    pushTestLog(app, {
      at: now, type: 'diagnosis', treeId: treeId,
      valid: score.valid, correct: score.correct, unlocked: unlocked.length,
    });
    app.save();
    return { score: score, outcome: outcome, unlocked: unlocked, gains: gains, mistakes: mistakes, record: record };
  }

  // ---------------- 学ぶ(教材・復習リスト) ----------------

  /** 経験値だけを足す(パラメーターとサビは動かさない)。確認問題と復習リストで使う。 */
  function gainXp(app, xp) {
    const before = R.levelOf(app.progress.totalXp);
    app.progress.totalXp += xp;
    const after = R.levelOf(app.progress.totalXp);
    return { xp: xp, level: after, leveledUp: after > before };
  }

  /** 教材を保存する(スキルごと1件。作り直すと上書き)。 */
  function saveMaterial(app, skillId, material, opts) {
    const now = (opts && opts.now) || Date.now();
    if (!app.progress.materials) app.progress.materials = {};
    const entry = Object.assign({}, material, {
      skillId: skillId,
      at: now,
      model: (opts && opts.model) || null,
    });
    app.progress.materials[skillId] = entry;
    app.save();
    return entry;
  }

  function deleteMaterial(app, skillId) {
    if (app.progress.materials) delete app.progress.materials[skillId];
    app.save();
  }

  /**
   * 教材の確認問題を採点する。合否はなく、まちがいは復習リストへ。
   * 経験値は「1日1スキル1回だけ」。2回目からは0(まちがいの保存は毎回する)。
   */
  function finishMaterialCheck(app, skillId, items, opts) {
    const now = (opts && opts.now) || Date.now();
    const score = global.Quiz.scoreTest(items);
    const mistakes = saveMistakes(app, score, now);

    const todayKey = U.dateKey(now);
    const key = R.dailyKey('check', skillId);
    const already = R.dailyDone(app.progress.daily, key, todayKey);

    let gain = { xp: 0, level: R.levelOf(app.progress.totalXp), leveledUp: false };
    if (!already) {
      gain = gainXp(app, R.reviewXp(score.correct));
      if (!app.progress.daily) app.progress.daily = {};
      app.progress.daily[key] = todayKey;
    }

    pushTestLog(app, {
      at: now, type: 'check', skillId: skillId,
      valid: score.valid, correct: score.correct, xp: gain.xp,
    });
    app.save();
    return {
      score: score, mistakes: mistakes, earnedToday: !already,
      xp: gain.xp, level: gain.level, leveledUp: gain.leveledUp,
    };
  }

  /**
   * 復習リストを解いた結果を記録する。1問正解ごとに経験値、2回連続正解で克服。
   * 外した問題は、正解あつかいにも不正解あつかいにもしない。
   * @param {Array<{q, given, flagged}>} items QuizUI.run が返す形
   */
  function finishReviewSession(app, items, opts) {
    const now = (opts && opts.now) || Date.now();
    const Q = global.Quiz;
    const score = Q.scoreTest(items);
    const list = app.progress.reviewList || (app.progress.reviewList = []);
    const byKey = new Map(list.map(function (it) { return [it.key, it]; }));

    let cleared = 0;
    for (const r of score.results) {
      if (r.flagged) continue;
      const item = byKey.get(Q.reviewKey(r.q));
      if (!item) continue;
      const was = item.cleared;
      Q.recordReview(item, r.correct, now);
      if (!was && item.cleared) cleared++;
    }

    const gain = gainXp(app, R.reviewXp(score.correct));
    pushTestLog(app, {
      at: now, type: 'reviewList',
      valid: score.valid, correct: score.correct, cleared: cleared, xp: gain.xp,
    });
    app.save();
    return {
      score: score, cleared: cleared,
      xp: gain.xp, level: gain.level, leveledUp: gain.leveledUp,
    };
  }

  /** 復習リストから1問消す */
  function removeReviewItem(app, id) {
    const list = app.progress.reviewList || [];
    const idx = list.findIndex(function (it) { return it.id === id; });
    if (idx < 0) return 0;
    list.splice(idx, 1);
    app.save();
    return 1;
  }

  /** 克服した問題をまとめて消す(容量を空けるため) */
  function removeClearedReviewItems(app) {
    const list = app.progress.reviewList || [];
    const before = list.length;
    const kept = list.filter(function (it) { return !it.cleared; });
    list.length = 0;
    for (const it of kept) list.push(it);
    app.save();
    return before - list.length;
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
    finishUnlockTest, finishReviewTest, finishDiagnosis, saveMistakes,
    gainXp, saveMaterial, deleteMaterial, finishMaterialCheck,
    finishReviewSession, removeReviewItem, removeClearedReviewItems,
  };
})(typeof window !== 'undefined' ? window : globalThis);
