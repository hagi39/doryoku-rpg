/* AIテストの共通部分。問題の検査・採点・合否・診断の出題先・復習リスト。
 * 副作用のない関数だけを置く(Nodeから直接テストできる)。AIの呼び出しはここではしない。
 *
 * 問題の形(AIに返させる形をアプリ内でもそのまま使う):
 *   選択: { type:'choice',  skillId, question, choices:[4つ], answer:正解の番号(0始まり), explanation }
 *   記述: { type:'written', skillId, question, answer:'正答', accepts:['別の書き方'], explanation }
 */
(function (global) {
  'use strict';

  const U = global.U;

  const C = {
    UNLOCK_CHOICE: 3,          // 解放テスト: 選択3 + 記述1
    UNLOCK_WRITTEN: 1,
    UNLOCK_PASS_RATIO: 0.75,   // 4問中3問。「おかしい」で外した問題は分母から除く
    REVIEW_CHOICE: 2,          // 復習テスト: 選択2 + 記述1、3問中2問で合格
    REVIEW_WRITTEN: 1,
    REVIEW_PASS_RATIO: 2 / 3,
    CHECK_CHOICE: 2,           // 教材の確認問題: 選択2 + 記述1。合否はなく、まちがいが復習リストに入る
    CHECK_WRITTEN: 1,
    MIN_VALID: 2,              // 有効な問題がこれ未満なら判定しない(やり直し)
    DIAG_MAX: 6,               // 診断の最大出題数
    REVIEW_LIST_MAX: 300,      // 復習リストの上限
    REVIEW_CLEAR_STREAK: 2,    // 2回連続で正解したら克服
    REVIEW_SESSION_MAX: 10,    // 復習は1回最大10問
  };

  // ---------------- 記述式の採点 ----------------

  /**
   * 比較用に文字列をそろえる。
   * 全角→半角(NFKC)、大文字→小文字、空白の除去、マイナス記号の統一、
   * 前後のかっこ・句点の除去。
   */
  function normalize(s) {
    let t = String(s == null ? '' : s).normalize('NFKC').toLowerCase();
    t = t.replace(/[−‐‑‒–—―﹣]/g, '-');
    // 数字の前の長音記号「ー」はマイナスとみなす(カタカナ語の「ー」は残す)
    t = t.replace(/(^|[^ァ-ヺー])ー(?=[\d.])/g, '$1-');
    t = t.replace(/[\s　]+/g, '');
    // 丸かっこは式の一部((x+1)(x-2) など)なので外さない
    t = t.replace(/^[「『"'\[【]+|[」』"'\]】]+$/g, '');
    t = t.replace(/[。、.,]+$/g, '');
    return t;
  }

  /**
   * 数として読めれば値を返す。読めなければ null。
   * 読める形: 整数・小数・分数(a/b)・「b分のa」・指数表記(2.5e-3, 2.5×10^-3)。
   * 先頭の「x=」のような変数名は無視する。
   * @returns {{value:number, decimals:number|null}|null} decimals は小数で書かれたときの桁数
   */
  function parseNumber(s) {
    let t = normalize(s);
    if (!t) return null;
    t = t.replace(/^[a-z]=/, '');

    let m = /^([-+]?)(\d+(?:\.\d+)?)分の([-+]?\d+(?:\.\d+)?)$/.exec(t);
    if (m) {
      const den = Number(m[2]);
      if (!den) return null;
      const v = Number(m[3]) / den;
      return { value: m[1] === '-' ? -v : v, decimals: null };
    }
    m = /^(-?)マイナス/.exec(t);
    if (m) {
      const inner = parseNumber(t.replace(/^-?マイナス/, ''));
      return inner ? { value: -inner.value, decimals: inner.decimals } : null;
    }

    m = /^([-+]?\d+(?:\.\d+)?)\/([-+]?\d+(?:\.\d+)?)$/.exec(t);
    if (m) {
      const den = Number(m[2]);
      if (!den) return null;
      return { value: Number(m[1]) / den, decimals: null };
    }

    m = /^([-+]?\d+(?:\.\d+)?)(?:[x*×]10\^?|e)([-+]?\d+)$/.exec(t);
    if (m) return { value: Number(m[1]) * Math.pow(10, Number(m[2])), decimals: null };

    m = /^[-+]?\d+(?:\.(\d+))?$/.exec(t);
    if (m) return { value: Number(t), decimals: m[1] ? m[1].length : 0 };

    return null;
  }

  function sameNumber(a, b) {
    return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  }

  /**
   * 答えた数 given が正答 expected と同じとみなせるか。
   * - 値が等しければ正解(0.5 と 1/2、0.50 と 0.5 など)
   * - 小数第2位以上まで書いた答えは、正答をその桁で四捨五入した値と一致すれば正解(1/3 → 0.33)
   */
  function numberMatches(given, expected) {
    if (sameNumber(given.value, expected.value)) return true;
    if (given.decimals != null && given.decimals >= 2) {
      const p = Math.pow(10, given.decimals);
      return sameNumber(Math.round(expected.value * p) / p, given.value);
    }
    return false;
  }

  /**
   * かっこの積だけでできた式は、因数の並びをそろえる((2x+1)(x+3) と (x+3)(2x+1) を同じにする)。
   * 先頭の係数(2(x+1)(x-1) の 2)はそのまま前に残す。
   */
  function sortFactors(t) {
    const m = /^(-?\d*)((?:\([^()]+\)(?:\^\d+)?)+)$/.exec(t);
    if (!m) return t;
    const factors = m[2].match(/\([^()]+\)(?:\^\d+)?/g);
    if (!factors || factors.length < 2) return t;
    return m[1] + factors.sort().join('');
  }

  /** 記述式の答えを採点する */
  function gradeWritten(given, question) {
    const g = normalize(given);
    if (!g) return false;
    const expected = [question.answer].concat(question.accepts || [])
      .filter(function (a) { return a != null && String(a).trim() !== ''; });

    const gs = sortFactors(g);
    for (const a of expected) {
      const na = normalize(a);
      if (na === g || sortFactors(na) === gs) return true;
    }
    const gn = parseNumber(given);
    if (!gn) return false;
    for (const a of expected) {
      const an = parseNumber(a);
      if (an && numberMatches(gn, an)) return true;
    }
    return false;
  }

  /** 1問を採点する。given は選択なら番号、記述なら文字列。 */
  function gradeAnswer(question, given) {
    if (question.type === 'choice') return given != null && Number(given) === question.answer;
    return gradeWritten(given, question);
  }

  // ---------------- AIの問題を検査する ----------------

  function str(v) { return typeof v === 'string' ? v.trim() : ''; }

  /**
   * 選択肢を並べ直す(AIは正解を同じ位置に置きがち。復習では答えの位置を覚えてしまうのを防ぐ)。
   * 記述問題はそのまま返す。元の問題は書き換えない。
   */
  function reshuffleChoices(q) {
    if (!q || q.type !== 'choice' || !Array.isArray(q.choices) || q.choices.length < 2) return q;
    const order = U.sample(q.choices.map(function (_, i) { return i; }), q.choices.length);
    return Object.assign({}, q, {
      choices: order.map(function (i) { return q.choices[i]; }),
      answer: order.indexOf(q.answer),
    });
  }

  /**
   * AIが返した問題を検査し、使える形にそろえる。壊れた問題は捨てる。
   * 選択肢の並びはここで混ぜる(AIは正解を同じ位置に置きがちなため)。
   * @param {*} raw  AIの返事(配列、または {questions:[...]})
   * @param {{skillIds?:string[]}} opts  skillIds を渡すと、それ以外のスキルの問題を捨てる
   */
  function sanitizeQuestions(raw, opts) {
    const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.questions) ? raw.questions : []);
    const allowed = opts && opts.skillIds ? new Set(opts.skillIds) : null;
    const out = [];
    const seen = new Set();

    for (const r of list) {
      if (!r || typeof r !== 'object') continue;
      const question = str(r.question);
      const skillId = str(r.skillId);
      if (!question) continue;
      if (allowed && !allowed.has(skillId)) continue;
      const key = normalize(question);
      if (seen.has(key)) continue;

      if (r.type === 'choice') {
        const choices = Array.isArray(r.choices) ? r.choices.map(str) : [];
        const answer = Number(r.answer);
        if (choices.length < 2 || choices.length > 6 || choices.some(function (c) { return !c; })) continue;
        if (!Number.isInteger(answer) || answer < 0 || answer >= choices.length) continue;
        if (new Set(choices.map(normalize)).size !== choices.length) continue;
        out.push(reshuffleChoices({
          type: 'choice',
          skillId: skillId,
          question: question,
          choices: choices,
          answer: answer,
          explanation: str(r.explanation),
        }));
      } else if (r.type === 'written') {
        const answer = str(r.answer);
        if (!answer) continue;
        out.push({
          type: 'written',
          skillId: skillId,
          question: question,
          answer: answer,
          accepts: (Array.isArray(r.accepts) ? r.accepts : []).map(str).filter(Boolean),
          explanation: str(r.explanation),
        });
      } else {
        continue;
      }
      seen.add(key);
    }
    return out;
  }

  /** 選択 nChoice 問 + 記述 nWritten 問をそろえる。足りなければ null。 */
  function pickSet(questions, nChoice, nWritten) {
    const choice = questions.filter(function (q) { return q.type === 'choice'; }).slice(0, nChoice);
    const written = questions.filter(function (q) { return q.type === 'written'; }).slice(0, nWritten);
    if (choice.length < nChoice || written.length < nWritten) return null;
    return choice.concat(written);
  }

  /** 解放テスト用に「選択3+記述1」をそろえる */
  function pickUnlockSet(questions) { return pickSet(questions, C.UNLOCK_CHOICE, C.UNLOCK_WRITTEN); }

  /** 復習テスト用に「選択2+記述1」をそろえる */
  function pickReviewSet(questions) { return pickSet(questions, C.REVIEW_CHOICE, C.REVIEW_WRITTEN); }

  /** 教材の確認問題用に「選択2+記述1」をそろえる */
  function pickCheckSet(questions) { return pickSet(questions, C.CHECK_CHOICE, C.CHECK_WRITTEN); }

  // ---------------- 採点と合否 ----------------

  /**
   * テスト全体を採点する。「この問題がおかしい」で外した問題は数えない。
   * @param {Array<{q:object, given:*, flagged?:boolean}>} items
   */
  function scoreTest(items) {
    const results = items.map(function (it) {
      if (it.flagged) return { q: it.q, given: it.given, flagged: true, correct: null };
      return { q: it.q, given: it.given, flagged: false, correct: gradeAnswer(it.q, it.given) };
    });
    const valid = results.filter(function (r) { return !r.flagged; });
    return {
      results: results,
      valid: valid.length,
      correct: valid.filter(function (r) { return r.correct; }).length,
    };
  }

  /**
   * 合格に必要な正解数。4問なら3問、3問なら3問、2問なら2問。
   * 問題を外しても合格しやすくならないよう切り上げる。
   */
  function passLine(valid, ratio) {
    return Math.ceil(valid * (ratio == null ? C.UNLOCK_PASS_RATIO : ratio) - 1e-9);
  }

  /** @returns {'pass'|'fail'|'void'} void は有効な問題が少なすぎて判定できない */
  function judge(score, ratio) {
    if (score.valid < C.MIN_VALID) return 'void';
    return score.correct >= passLine(score.valid, ratio) ? 'pass' : 'fail';
  }

  // ---------------- 診断 ----------------

  /** skillId の前提をたどって全部返す(他ツリーも含む) */
  function ancestorsOf(skillId, skillById) {
    const out = new Set();
    const stack = [skillId];
    while (stack.length) {
      const s = skillById.get(stack.pop());
      for (const r of (s && s.requires) || []) {
        if (!out.has(r)) { out.add(r); stack.push(r); }
      }
    }
    return out;
  }

  /** ツリー内での深さ(同じツリーの前提だけを数える) */
  function depthMap(treeSkills) {
    const byId = U.byId(treeSkills);
    const memo = new Map();
    function depth(id, guard) {
      if (memo.has(id)) return memo.get(id);
      if (guard.has(id)) return 0;
      guard.add(id);
      const s = byId.get(id);
      let d = 0;
      for (const r of (s && s.requires) || []) {
        if (byId.has(r)) d = Math.max(d, depth(r, guard) + 1);
      }
      memo.set(id, d);
      return d;
    }
    for (const s of treeSkills) depth(s.id, new Set());
    return memo;
  }

  /** 配列から n 個を、端から端まで均等な間隔で選ぶ(両端を含む) */
  function spread(arr, n) {
    if (arr.length <= n) return arr.slice();
    if (n <= 1) return [arr[arr.length - 1]];
    const out = [];
    for (let i = 0; i < n; i++) out.push(arr[Math.round(i * (arr.length - 1) / (n - 1))]);
    return out;
  }

  /**
   * 診断で出題するスキルを選ぶ。
   * 「ここまでできる」スキルとその前提から均等に、さらに1つ先のスキルを1つ。
   * 何も選ばなかったときは、ツリーの入口(前提のないスキル)から出す。
   * @returns {string[]} 出題するスキルid(浅い順、1スキル1問)
   */
  function diagnosisTargets(params) {
    const treeSkills = params.treeSkills;
    const max = params.max || C.DIAG_MAX;
    const depth = depthMap(treeSkills);
    const inTree = new Set(treeSkills.map(function (s) { return s.id; }));
    const byDepth = function (a, b) { return depth.get(a) - depth.get(b) || (a < b ? -1 : 1); };

    const claims = (params.claimIds || []).filter(function (id) { return inTree.has(id); });
    if (!claims.length) {
      const roots = treeSkills
        .filter(function (s) { return !(s.requires || []).some(function (r) { return inTree.has(r); }); })
        .map(function (s) { return s.id; });
      return spread(roots.sort(byDepth), max);
    }

    const known = new Set(claims);
    for (const id of claims) {
      for (const a of ancestorsOf(id, params.skillById)) if (inTree.has(a)) known.add(a);
    }

    const next = treeSkills.filter(function (s) {
      return !known.has(s.id) && (s.requires || []).some(function (r) { return claims.includes(r); });
    }).map(function (s) { return s.id; });
    const ahead = next.length ? U.sample(next, 1) : [];

    // 自己申告したスキル自体は必ず出す。残りを前提から均等に。
    const room = Math.max(claims.length, max - ahead.length);
    const others = Array.from(known).filter(function (id) { return !claims.includes(id); }).sort(byDepth);
    const picked = claims.slice(0, room).concat(spread(others, room - Math.min(room, claims.length)));

    return picked.sort(byDepth).concat(ahead);
  }

  /**
   * 診断の結果から、解放するスキルと「確認できたいちばん先」を決める。
   * 正解したスキルとその前提(他ツリーも含む)をすべて解放する。
   * @param {{results:Array<{skillId:string, correct:boolean|null}>, skillById:Map, treeSkills:Array}} params
   */
  function diagnosisOutcome(params) {
    const depth = depthMap(params.treeSkills);
    const correct = params.results.filter(function (r) { return r.correct === true; })
      .map(function (r) { return r.skillId; });

    const unlock = new Set();
    for (const id of correct) {
      unlock.add(id);
      for (const a of ancestorsOf(id, params.skillById)) unlock.add(a);
    }

    let frontier = null;
    for (const id of correct) {
      if (frontier == null || (depth.get(id) || 0) > (depth.get(frontier) || 0)) frontier = id;
    }
    return { unlockIds: Array.from(unlock), frontierId: frontier, correctIds: correct };
  }

  // ---------------- 復習リスト ----------------

  function reviewKey(q) {
    return (q.skillId || '') + '|' + normalize(q.question);
  }

  /**
   * まちがえた問題を復習リストに入れる(同じ問題はまとめる)。list をその場で書き換える。
   * 上限を超えたら、克服済みの古いもの → 古いもの の順に捨てる。
   */
  function addMistake(list, q, now) {
    const t = now == null ? Date.now() : now;
    const key = reviewKey(q);
    const found = list.find(function (it) { return it.key === key; });
    if (found) {
      found.misses = (found.misses || 0) + 1;
      found.streak = 0;
      found.cleared = false;
      found.lastAt = t;
      return found;
    }
    const item = {
      id: 'rv_' + t + '_' + Math.floor(U.random() * 1e6),
      key: key,
      skillId: q.skillId,
      q: q,
      addedAt: t,
      lastAt: t,
      misses: 1,
      streak: 0,
      cleared: false,
    };
    list.push(item);
    trimReviewList(list);
    return item;
  }

  function trimReviewList(list) {
    while (list.length > C.REVIEW_LIST_MAX) {
      let idx = -1;
      for (let i = 0; i < list.length; i++) {
        if (list[i].cleared && (idx < 0 || list[i].addedAt < list[idx].addedAt)) idx = i;
      }
      if (idx < 0) {
        idx = 0;
        for (let i = 1; i < list.length; i++) if (list[i].addedAt < list[idx].addedAt) idx = i;
      }
      list.splice(idx, 1);
    }
  }

  /**
   * 復習で出す問題を選ぶ。克服済みは出さない。
   * 最後に解いた日が古い順、同じならまちがいが多い順(いちばん忘れていそうなものから)。
   * @param {Array} list progress.reviewList
   * @param {{max?:number, skillId?:string}} opts skillId を渡すとそのスキルだけに絞る
   * @returns {Array} 復習リストの項目そのもの(そのまま recordReview に渡せる)
   */
  function pickReviewSession(list, opts) {
    const o = opts || {};
    const max = o.max == null ? C.REVIEW_SESSION_MAX : o.max;
    return (list || [])
      .filter(function (it) {
        if (!it || !it.q || it.cleared) return false;
        return !o.skillId || it.skillId === o.skillId;
      })
      .sort(function (a, b) {
        return (a.lastAt || 0) - (b.lastAt || 0) ||
          (b.misses || 0) - (a.misses || 0) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      })
      .slice(0, max);
  }

  /** 復習で1問答えた結果を記録する。2回連続で正解したら克服。 */
  function recordReview(item, correct, now) {
    const t = now == null ? Date.now() : now;
    item.lastAt = t;
    if (correct) {
      item.streak = (item.streak || 0) + 1;
      if (item.streak >= C.REVIEW_CLEAR_STREAK && !item.cleared) {
        item.cleared = true;
        item.clearedAt = t;
      }
    } else {
      item.streak = 0;
      item.misses = (item.misses || 0) + 1;
      item.cleared = false;
    }
    return item;
  }

  global.Quiz = {
    C: C,
    normalize, parseNumber, gradeWritten, gradeAnswer,
    sanitizeQuestions, reshuffleChoices, pickSet, pickUnlockSet, pickReviewSet, pickCheckSet,
    scoreTest, passLine, judge,
    ancestorsOf, depthMap, diagnosisTargets, diagnosisOutcome,
    addMistake, recordReview, reviewKey, pickReviewSession,
  };
})(typeof window !== 'undefined' ? window : globalThis);
