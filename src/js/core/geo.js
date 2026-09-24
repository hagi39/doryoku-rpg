/* 世界地図ステージのルール。副作用のない純粋関数だけを置く(Nodeから直接テストできる)。
 * 出題は内蔵データだけで作るので、APIキーがなくても遊べる。 */
(function (global) {
  'use strict';

  const C = {
    QUIZ_LEN: 5,            // 1回の出題数
    FIXED_STREAK: 3,        // 連続3回正解で「定着」(緑)
    AREA_CLEAR_STREAK: 2,   // エリアクリアに必要な連続正解
    AREA_CLEAR_FREQ: 2,     // ★2以上の国が対象
    CHOICES: 4,
  };

  /** 出題タイプ。capital と capitalRev は首都があいまいな国では使わない。 */
  const TYPES = [
    { id: 'pos',        name: '位置',           needsCapital: false },
    { id: 'capital',    name: '首都',           needsCapital: true },
    { id: 'capitalRev', name: '首都から国あて', needsCapital: true },
    { id: 'export',     name: '輸出品',         needsCapital: false },
    { id: 'exportRev',  name: '輸出品から国あて', needsCapital: false },
    { id: 'feature',    name: '特徴',           needsCapital: false },
  ];

  const TYPE_BY_ID = new Map(TYPES.map(function (t) { return [t.id, t]; }));

  // ---------------- 投影(正距円筒図法) ----------------

  const WORLD_VIEW = { lon: [-170, 180], lat: [-58, 80] };

  /**
   * 表示範囲を描画領域に「縦横比を保ったまま」収める変換を作る。
   * 経度1度と緯度1度を同じ長さで描くので、エリアを拡大しても形がゆがまない。
   */
  function fitTransform(view, w, h) {
    const v = view || WORLD_VIEW;
    const lonSpan = v.lon[1] - v.lon[0];
    const latSpan = v.lat[1] - v.lat[0];
    const scale = Math.min(w / lonSpan, h / latSpan);
    return {
      scale: scale,
      lonMin: v.lon[0],
      latMax: v.lat[1],
      dx: (w - lonSpan * scale) / 2,
      dy: (h - latSpan * scale) / 2,
    };
  }

  /**
   * 経緯度を描画座標に変換する(正距円筒図法)。国の丸印と大陸の輪郭で同じものを使う。
   * @param {object} tr fitTransform が返す変換
   */
  function project(tr, lon, lat) {
    return {
      x: (lon - tr.lonMin) * tr.scale + tr.dx,
      y: (tr.latMax - lat) * tr.scale + tr.dy,
    };
  }

  // ---------------- 国ごとの記録 ----------------

  function emptyRecord() {
    return { asked: 0, wrong: 0, streak: 0, byType: {} };
  }

  /** progress.geo.countries[id] を必ず返す(無ければ作る) */
  function recordOf(geo, countryId) {
    if (!geo.countries) geo.countries = {};
    let r = geo.countries[countryId];
    if (!r) r = geo.countries[countryId] = emptyRecord();
    if (!r.byType) r.byType = {};
    return r;
  }

  /** 読むだけ(記録を作らない) */
  function peek(geo, countryId) {
    return (geo && geo.countries && geo.countries[countryId]) || emptyRecord();
  }

  /**
   * 印の色。白=未挑戦 / 赤=苦手 / 黄=練習中 / 緑=定着
   */
  function markState(rec) {
    const r = rec || emptyRecord();
    if (!r.asked) return 'new';
    if (r.streak >= C.FIXED_STREAK) return 'fixed';
    if (r.streak === 0) return 'weak';
    return 'practice';
  }

  /** 印の大きさ(頻出度★1〜3) */
  function markRadius(freq) {
    return 3 + (Math.max(1, Math.min(3, freq || 1)) - 1) * 1.6;
  }

  // ---------------- 出題する国を選ぶ ----------------

  /**
   * 出題の重み。mode で重点を切り替える。
   * freq: 頻出優先 / weak: 苦手優先
   */
  function weightOf(country, geo, mode) {
    const r = peek(geo, country.id);
    if (mode === 'weak') {
      let w = 1;
      w += r.wrong * 2;
      if (r.asked && r.streak === 0) w += 3;   // 直近でまちがえた
      if (!r.asked) w += 1;                     // 未挑戦も拾う
      if (r.streak >= C.FIXED_STREAK) w *= 0.3; // 定着済みは控えめ
      return Math.max(0.2, w);
    }
    // 頻出優先: ★の二乗。定着済みは控えめ。
    let w = Math.pow(Math.max(1, country.freq || 1), 2);
    if (r.streak >= C.FIXED_STREAK) w *= 0.4;
    return w;
  }

  /** 重み付きで1つ引く */
  function weightedPick(items, weights, rand) {
    const total = weights.reduce(function (a, b) { return a + b; }, 0);
    if (total <= 0) return items[0];
    let t = rand() * total;
    for (let i = 0; i < items.length; i++) {
      t -= weights[i];
      if (t <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  /**
   * 出題する国を重複なく選ぶ。
   * @param {Array} pool 対象の国(エリアで絞ったもの)
   */
  function pickCountries(pool, geo, mode, count, rand) {
    const r = rand || Math.random;
    const left = pool.slice();
    const out = [];
    const n = Math.min(count, left.length);
    while (out.length < n) {
      const weights = left.map(function (c) { return weightOf(c, geo, mode); });
      const picked = weightedPick(left, weights, r);
      out.push(picked);
      left.splice(left.indexOf(picked), 1);
    }
    return out;
  }

  /** その国で出せる出題タイプ */
  function typesFor(country) {
    return TYPES.filter(function (t) { return !t.needsCapital || !!country.capital; });
  }

  /**
   * 出題タイプを選ぶ。その国でまちがえたことのあるタイプを優先する。
   */
  function pickType(country, geo, rand) {
    const r = rand || Math.random;
    const usable = typesFor(country);
    const rec = peek(geo, country.id);
    const weights = usable.map(function (t) {
      const wrong = (rec.byType && rec.byType[t.id]) || 0;
      return 1 + wrong * 2;
    });
    return weightedPick(usable, weights, r);
  }

  // ---------------- 問題を作る ----------------

  function valueFor(country, typeId) {
    switch (typeId) {
      case 'capital': return country.capital;
      case 'export': return country.exports;
      default: return country.name;
    }
  }

  /**
   * まぎらわしい選択肢を作る。同じエリアの国を優先し、足りなければ全体から補う。
   * 同じ文字列になる国は除く。
   */
  function distractors(country, pool, typeId, count, rand) {
    const r = rand || Math.random;
    const answer = valueFor(country, typeId);
    const seen = new Set([answer]);
    const ok = function (c) {
      if (c.id === country.id) return false;
      if (typeId === 'capital' && !c.capital) return false;
      const v = valueFor(c, typeId);
      if (!v || seen.has(v)) return false;
      return true;
    };
    const near = pool.filter(function (c) { return c.area === country.area && ok(c); });
    const far = pool.filter(function (c) { return c.area !== country.area && ok(c); });

    const out = [];
    const take = function (arr) {
      const copy = arr.slice();
      while (out.length < count && copy.length) {
        const c = copy.splice(Math.floor(r() * copy.length), 1)[0];
        const v = valueFor(c, typeId);
        if (seen.has(v)) continue;
        seen.add(v);
        out.push(c);
      }
    };
    take(near);
    take(far);
    return out;
  }

  function shuffle(arr, rand) {
    const r = rand || Math.random;
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /**
   * 1問を組み立てる。
   * @returns {{type, countryId, question, choices:string[], answer:number, showMark:boolean, explanation:string}}
   */
  function makeQuestion(country, typeId, pool, rand) {
    const r = rand || Math.random;
    // 選択肢の中身は、タイプによって「国名」か「首都」か「輸出品」
    const valueType = (typeId === 'capital' || typeId === 'export') ? typeId : 'name';
    const others = distractors(country, pool, valueType, C.CHOICES - 1, r);
    const answerValue = valueFor(country, valueType);
    const values = shuffle([answerValue].concat(others.map(function (c) {
      return valueFor(c, valueType);
    })), r);

    let question = '';
    let showMark = false;
    switch (typeId) {
      case 'pos':
        question = '地図の光っている印は、どの国ですか。';
        showMark = true;
        break;
      case 'capital':
        question = country.name + ' の首都はどこですか。';
        break;
      case 'capitalRev':
        question = '「' + country.capital + '」が首都の国はどこですか。';
        break;
      case 'export':
        question = country.name + ' の輸出品の上位にあたるものはどれですか。';
        break;
      case 'exportRev':
        question = '輸出品の上位が「' + country.exports + '」である国はどこですか。';
        break;
      case 'feature':
        question = '次の特徴にあてはまる国はどこですか。\n「' + country.feature + '」';
        break;
    }

    return {
      type: typeId,
      typeName: (TYPE_BY_ID.get(typeId) || {}).name || typeId,
      countryId: country.id,
      question: question,
      choices: values,
      answer: values.indexOf(answerValue),
      showMark: showMark,
      explanation: country.name + ' / 首都: ' + (country.capital || '(出題対象外)') +
        ' / 輸出品: ' + country.exports + '\n' + country.feature,
    };
  }

  /**
   * 1回ぶんの問題を作る。
   * @param {{pool:Array, geo:object, mode:string, count?:number, rand?:function}} opts
   */
  function buildQuiz(opts) {
    const r = opts.rand || Math.random;
    const count = opts.count || C.QUIZ_LEN;
    // 出題する国はエリアで絞れるが、選択肢は全体から作る(まぎらわしさを保つため)
    const targetPool = opts.targets && opts.targets.length ? opts.targets : opts.pool;
    const targets = pickCountries(targetPool, opts.geo, opts.mode, count, r);
    return targets.map(function (c) {
      return makeQuestion(c, pickType(c, opts.geo, r).id, opts.pool, r);
    });
  }

  // ---------------- answers ----------------

  /**
   * 1問ぶんの結果を記録に反映する。
   * 連続正解は正解で+1、まちがいで0に戻す。
   */
  function applyAnswer(geo, countryId, typeId, correct) {
    const rec = recordOf(geo, countryId);
    rec.asked += 1;
    if (correct) {
      rec.streak += 1;
    } else {
      rec.wrong += 1;
      rec.streak = 0;
      rec.byType[typeId] = (rec.byType[typeId] || 0) + 1;
    }
    return rec;
  }

  // ---------------- エリアクリア ----------------

  /** エリアクリアの対象(★2以上の国) */
  function areaTargets(countries, areaId) {
    return countries.filter(function (c) {
      return c.area === areaId && (c.freq || 1) >= C.AREA_CLEAR_FREQ;
    });
  }

  /**
   * エリアの進み具合。対象の国すべてで連続2回以上正解ならクリア。
   */
  function areaProgress(geo, countries, areaId) {
    const targets = areaTargets(countries, areaId);
    const done = targets.filter(function (c) {
      return peek(geo, c.id).streak >= C.AREA_CLEAR_STREAK;
    });
    return {
      total: targets.length,
      done: done.length,
      cleared: targets.length > 0 && done.length === targets.length,
    };
  }

  /**
   * まだボーナスを出していないクリア済みエリアを返す。
   * 呼び出し側が areasCleared に足して経験値を配る。
   */
  function newlyCleared(geo, countries, areas) {
    const already = new Set(geo.areasCleared || []);
    const out = [];
    for (const a of areas) {
      if (already.has(a.id)) continue;
      if (areaProgress(geo, countries, a.id).cleared) out.push(a.id);
    }
    return out;
  }

  // ---------------- まとめ ----------------

  /** 国ごとの状態をまとめて数える(画面の見出し用) */
  function summary(geo, countries) {
    const out = { new: 0, weak: 0, practice: 0, fixed: 0 };
    for (const c of countries) out[markState(peek(geo, c.id))] += 1;
    return out;
  }

  global.Geo = {
    C, TYPES, WORLD_VIEW,
    fitTransform, project, emptyRecord, recordOf, peek, markState, markRadius,
    weightOf, pickCountries, typesFor, pickType, distractors, makeQuestion, buildQuiz,
    applyAnswer, areaTargets, areaProgress, newlyCleared, summary,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.Geo;
})(typeof window !== 'undefined' ? window : globalThis);
