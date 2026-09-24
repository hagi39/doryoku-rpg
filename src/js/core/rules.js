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
  };

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

  // ---------------- 冒険(草原) ----------------

  function grassCheck(params) {
    const stats = params.stats || {};
    const missing = [];
    for (const key of Object.keys(C.GRASS_REQ)) {
      const need = C.GRASS_REQ[key];
      const have = Math.floor(stats[key] || 0);
      if (have < need) missing.push({ type: 'stat', stat: key, need: need, have: have });
    }
    const fresh = params.freshCount || 0;
    if (fresh < C.GRASS_FRESH_COUNT) {
      missing.push({ type: 'fresh', need: C.GRASS_FRESH_COUNT, have: fresh });
    }
    return { ok: missing.length === 0, missing: missing };
  }

  /**
   * 草原の戦いの初期値。
   * スライムのHPを固定にすると、パラメーターが上がるほど1〜2回で終わってしまい
   * 戦いにならない(実機で「連打する前に終わる」と指摘された)。
   * 攻撃力に合わせてHPを決めることで、強くなってもターン数が保たれる。
   */
  function battleSetup(stats) {
    const s = stats || {};
    const atk = Math.floor(((s.int || 0) + (s.str || 0) + (s.sta || 0)) / 3) + C.GRASS_ATK_BASE;
    return {
      atk: atk,
      slimeMax: C.GRASS_SLIME_BASE + atk * C.GRASS_SLIME_PER,
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

  /** スライムの反撃 */
  function slimeHit(rand) {
    const r = rand || Math.random;
    return C.GRASS_BACK_MIN + Math.floor(r() * C.GRASS_BACK_SPREAD);
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
    logXp, statGains, isUnlockable, grassCheck, updateStreak,
    battleSetup, battleHit, slimeHit,
    dailyKey, dailyDone, reviewXp,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.Rules;
})(typeof window !== 'undefined' ? window : globalThis);
