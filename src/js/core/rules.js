/* ゲームのルール。副作用のない純粋関数だけを置く(Nodeから直接テストできる)。 */
(function (global) {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;

  const C = {
    LEVEL_DIV: 40,          // レベル = 1 + floor(√(経験値 ÷ 40))
    STAT_DIV: 15,           // パラメータ上昇 = 経験値 ÷ 15 × ツリー重み ÷ (1 + 現在値/25)
    STAT_SOFT_CAP: 25,
    CRIT_RATE: 0.12,        // 会心の確率
    CRIT_MULT: 2,
    RUST_BONUS_LINE: 0.4,   // サビ40%以上で補習ボーナス
    RUST_BONUS_MULT: 1.3,
    CHICK_XP_MULT: 1.1,     // ひよこがいると経験値 ×1.1
    CHICK_RUST_MULT: 0.85,  // ひよこがいるとサビの進みが 0.85倍
    POLISH_CAP: 10,         // 磨いた回数の上限(サビ計算上)
    SAFE_BASE: 2,           // 安全な日数 = 2 + 2×回数
    SAFE_PER: 2,
    FULL_BASE: 10,          // 完全にサビるまで = 10 + 2×回数
    FULL_PER: 2,
    USES_RECOVER: 0.7,      // 「使ったスキル」経由の回復係数
    GRASS_REQ: { int: 6, str: 4, sta: 2 },
    GRASS_FRESH_RUST: 0.5,  // サビ50%未満
    GRASS_FRESH_COUNT: 8,   // が8個以上
    REVIEW_XP: 4,           // 復習1問正解あたりの経験値
    AREA_CLEAR_XP: 100,     // 世界地図のエリアクリア
    GRASS_CLEAR_XP: 60,     // 草原でスライムを倒したとき
    // 草原の戦い。スライムのHPを攻撃力に合わせて決めるので、
    // パラメーターがいくら上がっても6〜8回くらいの戦いになる。
    GRASS_ATK_BASE: 3,      // 攻撃力 = (知力+筋力+体力)÷3 + 3
    GRASS_SLIME_BASE: 20,   // スライムのHP = 20 + 攻撃力×6
    GRASS_SLIME_PER: 6,
    GRASS_HP_BASE: 24,      // 自分のHP = 24 + 筋力×3
    GRASS_HP_PER: 3,
    GRASS_BACK_MIN: 1,      // スライムの反撃は 1〜4
    GRASS_BACK_SPREAD: 4,
    STAGE_EASE: 0.92,       // カメ・ユキウサギ1匹ごとに、冒険の必要条件 ×0.92(切り上げ)
  };

  // ---------------- 冒険のステージ ----------------
  // 遊んでいる人の Artifact 版に合わせた 草原→海→砂漠→雪山→火山。
  // 倒すと pet が必ず仲間になる。ready:false のステージは「準備中」として見せるだけ。
  // 敵のHP = enemyBase + 攻撃力×enemyPer、反撃 = backMin 〜 backMin+backSpread-1
  // coins: 初めてクリアしたときのコイン(Artifact 版で分かっているのは火山の200だけ。ほかはそこから決めた)
  const STAGES = [
    { id: 'grass', name: '草原', enemy: 'スライム', icon: '🟢', pet: 'chick', ready: true,
      req: C.GRASS_REQ, fresh: C.GRASS_FRESH_COUNT, xp: C.GRASS_CLEAR_XP, coins: 20,
      enemyBase: C.GRASS_SLIME_BASE, enemyPer: C.GRASS_SLIME_PER,
      backMin: C.GRASS_BACK_MIN, backSpread: C.GRASS_BACK_SPREAD },
    // 条件ぴったりで勝率約8割・残りHP約15%。少し育てるとほぼ確実に勝てる
    { id: 'sea', name: '海', enemy: 'ビリビリクラゲ', icon: '🪼', pet: 'turtle', ready: true,
      req: { int: 15, str: 7, sta: 5 }, fresh: 16, xp: 120, coins: 40,
      enemyBase: 30, enemyPer: 8, backMin: 3, backSpread: 4 },
    { id: 'desert', name: '砂漠', enemy: 'デスストーカー', icon: '🦂', pet: 'fennec', ready: false,
      req: { int: 30, str: 13, sta: 10 }, fresh: 30, coins: 70 },
    { id: 'snow', name: '雪山', enemy: 'アイスゴーレム', icon: '🗿', pet: 'snowhare', ready: false,
      req: { int: 50, str: 20, sta: 16 }, fresh: 48, coins: 120 },
    { id: 'volcano', name: '火山', enemy: 'ドラゴン', icon: '🐲', pet: 'minidragon', ready: false,
      req: { int: 75, str: 28, sta: 24 }, fresh: 70, coins: 200 },
  ];

  // ease: 冒険の必要条件を STAGE_EASE ぶんやさしくするペット
  // (フェネック・ユキウサギ・ミニドラゴンの経験値やサビの効果は、そのステージを作るときに入れる)
  const PETS = [
    { id: 'chick',      name: 'ひよこ',       icon: '🐤', text: '経験値+10%、スキルのサビがゆっくり進む' },
    { id: 'turtle',     name: 'カメ',         icon: '🐢', text: '冒険の必要条件が8%やさしくなる', ease: true },
    { id: 'fennec',     name: 'フェネック',   icon: '🦊', text: '経験値がさらに+10%' },
    { id: 'snowhare',   name: 'ユキウサギ',   icon: '🐇', text: '冒険の必要条件が8%やさしくなり、サビも遅くなる', ease: true },
    { id: 'minidragon', name: 'ミニドラゴン', icon: '🐉', text: '経験値がさらに+15%' },
  ];

  // ---------------- レベル ----------------

  function levelOf(totalXp) {
    return 1 + Math.floor(Math.sqrt(Math.max(0, totalXp) / C.LEVEL_DIV));
  }

  function xpForLevel(level) {
    return Math.pow(Math.max(0, level - 1), 2) * C.LEVEL_DIV;
  }

  function levelProgress(totalXp) {
    const level = levelOf(totalXp);
    const base = xpForLevel(level);
    const next = xpForLevel(level + 1);
    return {
      level: level,
      cur: totalXp - base,
      need: next - base,
      ratio: next > base ? (totalXp - base) / (next - base) : 0,
    };
  }

  // ---------------- サビ(忘却) ----------------

  function safeDays(polishCount) {
    return C.SAFE_BASE + C.SAFE_PER * Math.min(polishCount || 0, C.POLISH_CAP);
  }

  function fullDays(polishCount) {
    return C.FULL_BASE + C.FULL_PER * Math.min(polishCount || 0, C.POLISH_CAP);
  }

  /**
   * スキルのサビ(0〜1)。開いた瞬間に経過日数から計算する(状態として持たない)。
   * @param {{polishCount:number, polishedAt:number}} prog
   */
  function rustOf(prog, opts) {
    if (!prog || !prog.polishedAt) return 0;
    const o = opts || {};
    const now = o.now == null ? Date.now() : o.now;
    const factor = o.hasChick ? C.CHICK_RUST_MULT : 1;
    const elapsed = ((now - prog.polishedAt) / DAY_MS) * factor;
    const safe = safeDays(prog.polishCount);
    const full = fullDays(prog.polishCount);
    if (elapsed <= safe) return 0;
    if (elapsed >= full) return 1;
    return (elapsed - safe) / (full - safe);
  }

  /**
   * 目標のサビ値になる polishedAt を逆算する。
   * 完全回復は targetRust = 0、「使ったスキル」経由は現在値 × (1 - 0.7)。
   */
  function polishedAtForRust(targetRust, polishCount, opts) {
    const o = opts || {};
    const now = o.now == null ? Date.now() : o.now;
    const factor = o.hasChick ? C.CHICK_RUST_MULT : 1;
    const r = Math.max(0, Math.min(1, targetRust));
    // サビ0は「磨いた直後」。安全な日数をまるごと残す(safe の端に置くとすぐサビ始めてしまう)
    if (r === 0) return now;
    const safe = safeDays(polishCount);
    const full = fullDays(polishCount);
    const effElapsed = safe + r * (full - safe);
    return now - (effElapsed / factor) * DAY_MS;
  }

  /** 前提や uses 経由でスキルが部分回復したときの新しい polishedAt */
  function partialPolish(prog, opts) {
    const cur = rustOf(prog, opts);
    const next = cur * (1 - C.USES_RECOVER);
    return polishedAtForRust(next, prog ? prog.polishCount : 0, opts);
  }

  // ---------------- 経験値 ----------------

  /**
   * 記録1件の経験値。
   * 経験値 = スキルの基本経験値 × 種類の重み × ボーナス
   */
  function logXp(params) {
    const base = params.baseXp;
    const kind = params.kindWeight == null ? 1 : params.kindWeight;
    let bonus = 1;
    const detail = [];
    if (params.rust >= C.RUST_BONUS_LINE) {
      bonus *= C.RUST_BONUS_MULT;
      detail.push({ label: '補習ボーナス', mult: C.RUST_BONUS_MULT });
    }
    if (params.hasChick) {
      bonus *= C.CHICK_XP_MULT;
      detail.push({ label: 'ひよこ', mult: C.CHICK_XP_MULT });
    }
    return {
      xp: Math.max(1, Math.round(base * kind * bonus)),
      bonus: bonus,
      detail: detail,
    };
  }

  /**
   * パラメータの上昇量。
   * 上昇 = 経験値 ÷ 15 × ツリー重み ÷ (1 + 現在値 ÷ 25)、12%で会心(2倍)
   */
  function statGains(params) {
    const rand = params.rand || Math.random;
    const crit = rand() < C.CRIT_RATE;
    const mult = crit ? C.CRIT_MULT : 1;
    const gains = {};
    const weights = params.treeWeights || {};
    for (const stat of Object.keys(weights)) {
      const w = weights[stat];
      if (!w) continue;
      const cur = (params.stats && params.stats[stat]) || 0;
      const raw = (params.xp / C.STAT_DIV) * w / (1 + cur / C.STAT_SOFT_CAP) * mult;
      gains[stat] = Math.round(raw * 100) / 100;
    }
    return { gains: gains, crit: crit };
  }

  // ---------------- 解放判定 ----------------

  /** requires をすべて解放済みなら true */
  function isUnlockable(skill, progSkills) {
    if (!skill) return false;
    if (progSkills[skill.id] && progSkills[skill.id].unlocked) return false;
    const reqs = skill.requires || [];
    for (const r of reqs) {
      if (!progSkills[r] || !progSkills[r].unlocked) return false;
    }
    return true;
  }

  // ---------------- 冒険(ステージ) ----------------

  function stageById(id) {
    return STAGES.find(function (st) { return st.id === id; }) || null;
  }

  /** 前のステージ(草原なら null) */
  function prevStage(id) {
    const i = STAGES.findIndex(function (st) { return st.id === id; });
    return i > 0 ? STAGES[i - 1] : null;
  }

  /**
   * ペットの補正をかけた必要な値。×0.92 を1匹ごとにかけて切り上げる
   * (Artifact 版で、火山のスキル数70がカメ+ユキウサギで60になっていたのと同じ計算)。
   * 25×0.92 が 23.000000000000004 になるような誤差で1増えないよう、少しだけ引いてから切り上げる。
   */
  function easedNeed(base, easeCount) {
    const v = base * Math.pow(C.STAGE_EASE, easeCount || 0);
    return Math.ceil(v - 1e-9);
  }

  /** 持っているペットのうち、必要条件をやさしくするものの数 */
  function easeCount(companions) {
    const c = companions || {};
    return PETS.filter(function (p) { return p.ease && c[p.id]; }).length;
  }

  /**
   * ステージに挑めるか。items は画面に並べる4つの条件(足りていてもすべて入る)。
   * @param {{stats, freshCount:number, prevCleared:boolean, companions}} params
   */
  function stageCheck(stage, params) {
    const stats = params.stats || {};
    const ease = easeCount(params.companions);
    const items = [];
    for (const key of Object.keys(stage.req)) {
      const need = easedNeed(stage.req[key], ease);
      const have = stats[key] || 0;
      items.push({ type: 'stat', stat: key, need: need, have: have, met: Math.floor(have) >= need });
    }
    const freshNeed = easedNeed(stage.fresh, ease);
    const fresh = params.freshCount || 0;
    items.push({ type: 'fresh', need: freshNeed, have: fresh, met: fresh >= freshNeed });
    const prevOk = !prevStage(stage.id) || !!params.prevCleared;
    const statsOk = items.every(function (it) { return it.met; });
    return { ok: prevOk && statsOk, prevOk: prevOk, items: items, ease: ease };
  }

  /**
   * 草原の戦いの初期値。
   * スライムのHPを固定にすると、パラメーターが上がるほど1〜2回で終わってしまい
   * 戦いにならない(実機で「連打する前に終わる」と指摘された)。
   * 攻撃力に合わせてHPを決めることで、強くなってもターン数が保たれる。
   */
  function battleSetup(stats, stage) {
    const s = stats || {};
    const st = stage || STAGES[0];
    const atk = Math.floor(((s.int || 0) + (s.str || 0) + (s.sta || 0)) / 3) + C.GRASS_ATK_BASE;
    return {
      atk: atk,
      enemyMax: st.enemyBase + atk * st.enemyPer,
      playerMax: C.GRASS_HP_BASE + Math.floor(s.str || 0) * C.GRASS_HP_PER,
    };
  }

  /** こちらの一撃。12%で会心(2倍)。 */
  function battleHit(atk, rand) {
    const r = rand || Math.random;
    const crit = r() < C.CRIT_RATE;
    const dmg = Math.max(1, Math.round(atk * (0.8 + r() * 0.4)) * (crit ? C.CRIT_MULT : 1));
    return { dmg: dmg, crit: crit };
  }

  /** 敵の反撃(stage を省くとスライム) */
  function enemyHit(rand, stage) {
    const r = rand || Math.random;
    const st = stage || STAGES[0];
    return st.backMin + Math.floor(r() * st.backSpread);
  }

  // ---------------- 連続日数 ----------------

  /**
   * 記録した日付キーから連続日数を更新する。
   * @param {{count:number, lastDate:string}} streak
   */
  function updateStreak(streak, todayKey) {
    const prev = streak && streak.lastDate;
    if (prev === todayKey) return { count: streak.count, lastDate: prev, changed: false };
    if (!prev) return { count: 1, lastDate: todayKey, changed: true };
    const diff = Math.round(
      (new Date(todayKey + 'T00:00:00') - new Date(prev + 'T00:00:00')) / DAY_MS
    );
    const count = diff === 1 ? (streak.count || 0) + 1 : 1;
    return { count: count, lastDate: todayKey, changed: true };
  }

  // ---------------- 1日1回だけ ----------------

  /**
   * 「1日1スキル1回だけ経験値」の台帳キー。
   * progress.daily に key → 最後に経験値を取った日付(YYYY-MM-DD)で入れる。
   */
  function dailyKey(kind, id) {
    return kind + ':' + id;
  }

  /** その key の経験値を、その日もう取っているか */
  function dailyDone(daily, key, todayKey) {
    return !!(daily && daily[key] === todayKey);
  }

  /** 復習・確認問題の経験値。1問正解につき REVIEW_XP。 */
  function reviewXp(correctCount) {
    return Math.max(0, correctCount) * C.REVIEW_XP;
  }

  global.Rules = {
    C: C,
    levelOf, xpForLevel, levelProgress,
    safeDays, fullDays, rustOf, polishedAtForRust, partialPolish,
    logXp, statGains, isUnlockable, updateStreak,
    STAGES, PETS, stageById, prevStage, easedNeed, easeCount, stageCheck,
    battleSetup, battleHit, enemyHit,
    dailyKey, dailyDone, reviewXp,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.Rules;
})(typeof window !== 'undefined' ? window : globalThis);
