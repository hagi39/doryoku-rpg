/* 冒険: ステージ(草原→海→砂漠→雪山→火山の敵との戦い) / 世界地図(国のクイズ)
 * 世界地図の出題は内蔵データだけで作るので、APIキーがなくても遊べる。 */
(function (global) {
  'use strict';

  const U = global.U;
  const R = global.Rules;
  const A = global.Actions;

  const MAP_W = 640;
  const MAP_H = 330;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const STATE_LABEL = {
    new: '未挑戦', weak: '苦手', practice: '練習中', fixed: '定着',
  };

  /** タブを描き直しても残る画面の状態 */
  const state = {
    screen: 'menu',   // menu | battle | map
    stage: null,      // メニューで選んでいるステージ
    area: 'all',
    mode: 'freq',     // freq(頻出優先) | weak(苦手優先)
    quiz: null,       // {items, index, results, picked}
    battle: null,
    result: null,
  };

  function go(app, screen) {
    state.screen = screen;
    state.quiz = null;
    state.result = null;
    app.render();
  }

  /** SVG は createElement では作れないので名前空間つきで作る */
  function sv(tag, attrs, children) {
    const node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        node.setAttribute(k, v === true ? '' : String(v));
      }
    }
    if (children) for (const c of [].concat(children)) if (c) node.appendChild(c);
    return node;
  }

  // ---------------- 地図 ----------------

  function viewOf(areaId) {
    const Geo = global.Geo;
    if (areaId === 'all') return Geo.WORLD_VIEW;
    const a = global.GeoData.AREAS.find(function (x) { return x.id === areaId; });
    return a ? a.view : Geo.WORLD_VIEW;
  }

  /**
   * 地図を描く。
   * @param {{area:string, highlight?:string, onPick?:function}} opts
   */
  function drawMap(app, opts) {
    const Geo = global.Geo;
    const GD = global.GeoData;
    const geo = A.geoState(app);
    const tr = Geo.fitTransform(viewOf(opts.area), MAP_W, MAP_H);

    const svg = sv('svg', {
      class: 'geomap', viewBox: '0 0 ' + MAP_W + ' ' + MAP_H,
      role: 'img', 'aria-label': '世界地図',
    });
    svg.appendChild(sv('rect', { class: 'geomap__sea', x: 0, y: 0, width: MAP_W, height: MAP_H }));

    for (const outline of GD.OUTLINES) {
      const pts = outline.points.map(function (p) {
        const q = Geo.project(tr, p[0], p[1]);
        return Math.round(q.x * 10) / 10 + ',' + Math.round(q.y * 10) / 10;
      }).join(' ');
      svg.appendChild(sv('polygon', { class: 'geomap__land', points: pts }));
    }

    const visible = [];
    for (const c of GD.countries) {
      const p = Geo.project(tr, c.lon, c.lat);
      if (p.x < -20 || p.x > MAP_W + 20 || p.y < -20 || p.y > MAP_H + 20) continue;
      visible.push(c);
      const st = Geo.markState(Geo.peek(geo, c.id));
      const isTarget = opts.highlight === c.id;
      if (isTarget) {
        svg.appendChild(sv('circle', {
          class: 'geomap__halo', cx: p.x, cy: p.y, r: Geo.markRadius(c.freq) + 7,
        }));
      }
      const dot = sv('circle', {
        class: 'geomap__mark geomap__mark--' + st + (isTarget ? ' is-target' : ''),
        cx: p.x, cy: p.y, r: Geo.markRadius(c.freq),
      });
      const label = c.name + '(' + STATE_LABEL[st] + '・★' + c.freq + ')';
      dot.appendChild(sv('title', null, [document.createTextNode(label)]));
      svg.appendChild(dot);
    }

    // 印そのものではなく地図全体で受けて、いちばん近い国を選ぶ。
    // 印を大きくしても、ヨーロッパのように密集した場所では指で狙えないため。
    if (opts.onPick) {
      svg.classList.add('is-pickable');
      svg.addEventListener('click', function (e) {
        const rect = svg.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const x = ((e.clientX - rect.left) / rect.width) * MAP_W;
        const y = ((e.clientY - rect.top) / rect.height) * MAP_H;
        const hit = Geo.resolveTap(tr, visible, x, y);
        if (hit) opts.onPick(hit);
      });
    }
    return svg;
  }

  function legend() {
    const row = U.el('div', { class: 'geolegend' });
    for (const key of ['new', 'weak', 'practice', 'fixed']) {
      row.appendChild(U.el('span', { class: 'geolegend__item' }, [
        U.el('i', { class: 'geolegend__dot geolegend__dot--' + key }),
        U.el('span', { text: STATE_LABEL[key] }),
      ]));
    }
    row.appendChild(U.el('span', { class: 'geolegend__note', text: '印の大きさ=入試の頻出度(★)' }));
    return row;
  }

  // ---------------- メニュー ----------------

  /** 最初に開くステージ: まだクリアしていない遊べるステージのうち、いちばん手前 */
  function defaultStage(app) {
    for (const st of R.STAGES) {
      if (st.ready && !A.stageCleared(app, st.id)) return st.id;
    }
    const ready = R.STAGES.filter(function (st) { return st.ready; });
    return ready[ready.length - 1].id;
  }

  /** タブの下に出す状態 */
  function stageLabel(app, st, now) {
    if (!st.ready) return '準備中';
    if (A.stageCleared(app, st.id)) return 'クリア済み';
    return A.stageStatus(app, st.id, now).ok ? '挑戦可' : '未開放';
  }

  function petOf(id) {
    return R.PETS.find(function (p) { return p.id === id; });
  }

  function renderMenu(root, app) {
    const now = Date.now();
    if (!state.stage) state.stage = defaultStage(app);

    const tabs = U.el('div', { class: 'stage-tabs' });
    for (const st of R.STAGES) {
      tabs.appendChild(U.el('button', {
        class: 'stage-tab' + (state.stage === st.id ? ' is-on' : ''),
        onclick: function () { state.stage = st.id; app.render(); },
      }, [
        U.el('span', { class: 'stage-tab__name', text: st.name }),
        U.el('span', { class: 'stage-tab__state', text: stageLabel(app, st, now) }),
      ]));
    }
    root.appendChild(tabs);
    root.appendChild(stageCard(app, R.stageById(state.stage), now));
    root.appendChild(petCard(app));

    const geo = A.geoState(app);
    const sum = global.Geo.summary(geo, global.GeoData.countries);
    const map = U.el('div', { class: 'card' });
    map.appendChild(U.el('div', { class: 'card__head' }, [
      U.el('div', { class: 'card__title', text: '世界地図' }),
      U.el('div', {
        class: 'card__note',
        text: '定着 ' + sum.fixed + ' / ' + global.GeoData.countries.length + 'か国',
      }),
    ]));
    map.appendChild(U.el('p', { text: '62か国の位置・首都・輸出品・特徴のクイズです。APIキーがなくても遊べます。' }));
    map.appendChild(U.el('button', {
      class: 'btn btn--primary', text: '世界地図へ行く',
      onclick: function () { go(app, 'map'); },
    }));
    root.appendChild(map);
  }

  /** ステージの欄。敵・前のステージ・4つの条件・ボタン */
  function stageCard(app, st, now) {
    const cleared = A.stageCleared(app, st.id);
    const check = A.stageStatus(app, st.id, now);
    const prev = R.prevStage(st.id);
    const pet = petOf(st.pet);

    const card = U.el('div', { class: 'card stage stage--' + st.id });
    card.appendChild(U.el('div', { class: 'stage__enemy', text: st.icon }));
    card.appendChild(U.el('div', { class: 'card__title', text: st.name + ' ' + st.enemy }));

    if (cleared) {
      card.appendChild(U.el('p', { text: st.enemy + 'を倒して、' + pet.name + 'が仲間になっています。' + pet.icon }));
    } else {
      card.appendChild(U.el('p', { class: 'quiz-note', text: prev
        ? '前のステージ「' + prev.name + '」' + (check.prevOk ? 'はクリア済み。' : 'をクリアすると挑戦できる。')
        : '最初のステージ。' }));
      card.appendChild(U.el('p', { class: 'quiz-note', text: '倒すと「' + pet.name + '」が仲間になる。' }));
    }

    // クリアしたあとは条件を出さない(仲間の補正で数字だけ変わって紛らわしいため)
    for (const it of cleared ? [] : check.items) {
      const name = it.type === 'stat'
        ? (app.statById.get(it.stat) || { name: it.stat }).name
        : 'サビていないスキルの数';
      const have = it.type === 'stat' ? (Math.floor(it.have * 10) / 10).toFixed(1) : String(it.have);
      card.appendChild(U.el('div', { class: 'stage-req' }, [
        U.el('span', { class: 'stage-req__name', text: name }),
        U.el('span', { class: 'stage-req__num', text: have + ' / ' + it.need }),
        U.el('span', {
          class: 'stage-req__mark ' + (it.met ? 'is-met' : 'is-short'),
          text: it.met ? '達成' : '足りない',
        }),
      ]));
      card.appendChild(U.el('div', { class: 'meter' + (it.type === 'stat' ? ' meter--' + it.stat : '') }, [
        U.el('div', { class: 'meter__fill', style: 'width:' + Math.min(100, (it.have / it.need) * 100).toFixed(1) + '%' }),
      ]));
    }
    const notes = cleared ? [] : ['サビていないスキル = サビが50%未満の解放済みスキル'];
    if (check.ease && !cleared) notes.push('仲間のおかげで、必要条件が' + (check.ease === 1 ? '8%' : check.ease + '回ぶん8%ずつ') + 'やさしくなっています。');
    for (const n of notes) card.appendChild(U.el('p', { class: 'quiz-note stage__note', text: n }));

    let label = '挑む';
    if (!st.ready) label = '準備中';
    else if (cleared) label = 'クリア済み';
    else if (!check.ok) label = 'まだ開いていない';
    card.appendChild(U.el('button', {
      class: 'btn btn--primary', text: label,
      disabled: !st.ready || cleared || !check.ok,
      onclick: function () { state.battle = newBattle(app, st); go(app, 'battle'); },
    }));
    if (!st.ready) {
      card.appendChild(U.el('p', { class: 'quiz-note stage__note', text: 'このステージは、これからの更新で遊べるようになります。' }));
    }
    return card;
  }

  /** 仲間の欄 */
  function petCard(app) {
    const pets = app.progress.companions || {};
    const card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card__title', text: '仲間' }));
    const owned = R.PETS.filter(function (p) { return pets[p.id]; });
    if (!owned.length) {
      card.appendChild(U.el('p', { class: 'quiz-note', text: 'まだ仲間はいません。ステージをクリアすると仲間になります。' }));
      return card;
    }
    const list = U.el('ul', { class: 'pet-list' });
    for (const p of owned) {
      list.appendChild(U.el('li', null, [
        U.el('div', { class: 'pet-list__name', text: p.icon + ' ' + p.name }),
        U.el('div', { class: 'quiz-note', text: p.text }),
      ]));
    }
    card.appendChild(list);
    return card;
  }

  // ---------------- 戦い ----------------

  function newBattle(app, st) {
    const setup = R.battleSetup(app.progress.stats, st);
    return {
      stage: st.id,
      playerMax: setup.playerMax,
      playerHp: setup.playerMax,
      enemyMax: setup.enemyMax,
      enemyHp: setup.enemyMax,
      atk: setup.atk,
      log: [st.enemy + 'が あらわれた!'],
      over: false,
      won: false,
    };
  }

  function attack(app) {
    const b = state.battle;
    if (!b || b.over) return;
    const st = R.stageById(b.stage);
    const hit = R.battleHit(b.atk, U.random);
    b.enemyHp = Math.max(0, b.enemyHp - hit.dmg);
    b.log.push((hit.crit ? '会心の一撃! ' : '') + st.enemy + 'に ' + hit.dmg + ' のダメージ');

    if (b.enemyHp <= 0) {
      b.over = true;
      b.won = true;
      b.log.push(st.enemy + 'を たおした!');
      b.reward = A.winStage(app, st.id);
      app.render();
      return;
    }

    const back = R.enemyHit(U.random, st);
    b.playerHp = Math.max(0, b.playerHp - back);
    b.log.push(st.enemy + 'の こうげき! ' + back + ' のダメージ');
    if (b.playerHp <= 0) {
      b.over = true;
      b.won = false;
      b.log.push('たいりょくが つきた…… ' + st.name + 'から にげかえった。');
    }
    app.render();
  }

  function bar(cls, cur, max) {
    const wrap = U.el('div', { class: 'hpbar' });
    wrap.appendChild(U.el('div', {
      class: 'hpbar__fill hpbar__fill--' + cls,
      style: 'width:' + Math.round((cur / Math.max(1, max)) * 100) + '%',
    }));
    return wrap;
  }

  function renderBattle(root, app) {
    const b = state.battle;
    if (!b) { go(app, 'menu'); return; }
    const st = R.stageById(b.stage);

    if (!b.over) {
      root.appendChild(U.el('button', {
        class: 'btn btn--ghost', text: '← 冒険にもどる',
        onclick: function () { state.battle = null; go(app, 'menu'); },
      }));
    }

    const card = U.el('div', { class: 'card battle stage--' + st.id });
    card.appendChild(U.el('div', { class: 'card__title', text: st.name + ' ' + st.enemy }));
    card.appendChild(U.el('div', { class: 'battle__slime', text: b.won ? '💨' : st.icon }));
    card.appendChild(bar('slime', b.enemyHp, b.enemyMax));
    card.appendChild(U.el('div', { class: 'quiz-note', text: st.enemy + ' ' + b.enemyHp + ' / ' + b.enemyMax }));

    card.appendChild(U.el('div', { class: 'battle__you', text: 'じぶん ' + b.playerHp + ' / ' + b.playerMax }));
    card.appendChild(bar('you', b.playerHp, b.playerMax));

    const log = U.el('div', { class: 'battle__log' });
    for (const line of b.log.slice(-6)) log.appendChild(U.el('div', { text: line }));
    card.appendChild(log);

    if (!b.over) {
      card.appendChild(U.el('button', {
        class: 'btn btn--primary', text: 'たたかう',
        onclick: function () { attack(app); },
      }));
    } else if (b.won) {
      const pet = petOf(st.pet);
      const r = b.reward || {};
      card.appendChild(U.el('div', { class: 'notice notice--good' },
        r.first
          ? st.enemy + 'を倒した! 「' + pet.name + '」が仲間になった。' + pet.icon + ' 経験値 +' + r.xp +
            (r.leveledUp ? ' レベルアップ! Lv.' + r.level : '')
          : pet.name + 'はもう仲間です。'));
      card.appendChild(U.el('p', { class: 'quiz-note', text: pet.name + ': ' + pet.text }));
      card.appendChild(U.el('button', {
        class: 'btn', text: '冒険にもどる',
        onclick: function () { state.battle = null; state.stage = defaultStage(app); go(app, 'menu'); },
      }));
    } else {
      card.appendChild(U.el('button', {
        class: 'btn btn--primary', text: 'もう一度いどむ',
        onclick: function () { state.battle = newBattle(app, st); app.render(); },
      }));
      card.appendChild(U.el('button', {
        class: 'btn', text: '冒険にもどる',
        onclick: function () { state.battle = null; go(app, 'menu'); },
      }));
    }
    root.appendChild(card);
  }

  // ---------------- 世界地図 ----------------

  function poolOf() {
    const all = global.GeoData.countries;
    if (state.area === 'all') return all;
    return all.filter(function (c) { return c.area === state.area; });
  }

  function startQuiz(app) {
    const pool = poolOf();
    const items = global.Geo.buildQuiz({
      pool: global.GeoData.countries,   // 選択肢は全体から作る(まぎらわしさを保つ)
      geo: A.geoState(app),
      mode: state.mode,
      count: Math.min(global.Geo.C.QUIZ_LEN, pool.length),
      rand: U.random,
      // 出題する国だけエリアで絞る
      targets: pool,
    });
    state.quiz = { items: items, index: 0, results: [], picked: null };
    state.result = null;
    app.render();
  }

  function answer(app, idx) {
    const q = state.quiz;
    if (!q || q.picked != null) return;
    q.picked = idx;
    app.render();
  }

  function next(app) {
    const q = state.quiz;
    const item = q.items[q.index];
    q.results.push({
      countryId: item.countryId, type: item.type,
      correct: q.picked === item.answer,
    });
    q.picked = null;
    q.index += 1;
    if (q.index >= q.items.length) {
      state.result = A.finishGeoQuiz(app, q.results);
      state.quiz = null;
    }
    app.render();
  }

  function renderQuiz(root, app) {
    const q = state.quiz;
    const item = q.items[q.index];
    const answered = q.picked != null;

    root.appendChild(U.el('div', { class: 'quiz-head' }, [
      U.el('span', { text: '問題 ' + (q.index + 1) + ' / ' + q.items.length }),
      U.el('span', { class: 'quiz-note', text: item.typeName }),
    ]));

    if (item.showMark) {
      root.appendChild(drawMap(app, { area: state.area, highlight: item.countryId }));
    }

    const card = U.el('div', { class: 'card' });
    card.appendChild(U.el('p', { class: 'quiz-q', text: item.question }));

    for (let i = 0; i < item.choices.length; i++) {
      const isAnswer = i === item.answer;
      const picked = q.picked === i;
      let cls = 'quiz-choice';
      if (answered && isAnswer) cls += ' quiz-choice--correct';
      else if (answered && picked) cls += ' quiz-choice--wrong';
      card.appendChild(U.el('button', {
        class: cls, text: item.choices[i], disabled: answered,
        onclick: function () { answer(app, i); },
      }));
    }

    if (answered) {
      const ok = q.picked === item.answer;
      card.appendChild(U.el('div', {
        class: 'notice ' + (ok ? 'notice--good' : 'notice--bad'),
        text: ok ? '正解!' : 'ざんねん',
      }));
      card.appendChild(U.el('p', { class: 'quiz-line geo-exp', text: item.explanation }));
      card.appendChild(U.el('button', {
        class: 'btn btn--primary',
        text: q.index + 1 >= q.items.length ? '結果を見る' : 'つぎへ',
        onclick: function () { next(app); },
      }));
    }
    root.appendChild(card);
  }

  function renderResult(root, app) {
    const r = state.result;
    const card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card__title', text: '結果' }));
    card.appendChild(U.el('p', { text: r.total + '問中 ' + r.correct + '問 正解' }));
    card.appendChild(U.el('p', { text: '経験値 +' + r.xp + (r.leveledUp ? '(レベルが ' + r.level + ' に上がった!)' : '') }));
    for (const id of r.cleared) {
      const area = global.GeoData.AREAS.find(function (a) { return a.id === id; });
      card.appendChild(U.el('div', { class: 'notice notice--good' },
        (area ? area.name : id) + ' のエリアクリア! ボーナス経験値 +' + R.C.AREA_CLEAR_XP));
    }
    card.appendChild(U.el('button', {
      class: 'btn btn--primary', text: 'もう一度',
      onclick: function () { startQuiz(app); },
    }));
    card.appendChild(U.el('button', {
      class: 'btn', text: '地図にもどる',
      onclick: function () { state.result = null; app.render(); },
    }));
    root.appendChild(card);
  }

  function renderMap(root, app) {
    root.appendChild(U.el('button', {
      class: 'btn btn--ghost', text: '← 冒険にもどる',
      onclick: function () { go(app, 'menu'); },
    }));

    if (state.quiz) { renderQuiz(root, app); return; }
    if (state.result) { renderResult(root, app); return; }

    const tabs = U.el('div', { class: 'chip-row geo-tabs' });
    const areas = [{ id: 'all', name: '世界全体' }].concat(global.GeoData.AREAS);
    for (const a of areas) {
      tabs.appendChild(U.el('button', {
        class: 'chip' + (state.area === a.id ? ' chip--on' : ''),
        text: a.name,
        onclick: function () { state.area = a.id; app.render(); },
      }));
    }
    root.appendChild(tabs);

    root.appendChild(drawMap(app, {
      area: state.area,
      onPick: function (hit) { pickCountry(app, hit); },
    }));
    root.appendChild(legend());

    const modes = U.el('div', { class: 'chip-row geo-tabs' });
    for (const m of [{ id: 'freq', name: '頻出優先' }, { id: 'weak', name: '苦手優先' }]) {
      modes.appendChild(U.el('button', {
        class: 'chip' + (state.mode === m.id ? ' chip--on' : ''),
        text: m.name,
        onclick: function () { state.mode = m.id; app.render(); },
      }));
    }
    root.appendChild(U.el('div', { class: 'geo-row' }, [
      U.el('span', { class: 'quiz-note', text: '出題の重点:' }), modes,
    ]));

    root.appendChild(U.el('button', {
      class: 'btn btn--primary btn--block',
      text: 'クイズをはじめる(' + Math.min(global.Geo.C.QUIZ_LEN, poolOf().length) + '問)',
      onclick: function () { startQuiz(app); },
    }));

    root.appendChild(areaCard(app));
  }

  function areaCard(app) {
    const Geo = global.Geo;
    const geo = A.geoState(app);
    const card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card__title', text: 'エリアクリア' }));
    card.appendChild(U.el('p', { class: 'quiz-note', text: '★2以上の国すべてで2回続けて正解するとクリア。ボーナス経験値 ' + R.C.AREA_CLEAR_XP + '。' }));
    const list = U.el('ul', { class: 'geo-arealist' });
    for (const a of global.GeoData.AREAS) {
      const p = Geo.areaProgress(geo, global.GeoData.countries, a.id);
      const done = (geo.areasCleared || []).indexOf(a.id) >= 0;
      list.appendChild(U.el('li', {
        class: done ? 'is-cleared' : '',
        text: a.name + ' ' + p.done + ' / ' + p.total + (done ? ' ✔ クリア' : ''),
      }));
    }
    card.appendChild(list);
    return card;
  }

  /**
   * タップの近くにある国。1つなら直接開き、複数なら選ばせる。
   * 世界全体の表示だとヨーロッパは指で狙い分けられないため。
   */
  function pickCountry(app, hit) {
    if (hit.country) return showCountry(app, hit.country);
    const list = hit.candidates;
    if (list.length === 1) return showCountry(app, list[0]);
    const Geo = global.Geo;
    const geo = A.geoState(app);
    const body = U.el('div');
    body.appendChild(U.el('p', { class: 'quiz-note', text: 'このあたりにある国です。' }));
    const box = U.el('div', { class: 'geo-picker' });
    for (const c of list) {
      box.appendChild(U.el('button', {
        class: 'btn geo-picker__item',
        onclick: function () { app.closeModal(); showCountry(app, c); },
      }, [
        U.el('i', { class: 'geolegend__dot geolegend__dot--' + Geo.markState(Geo.peek(geo, c.id)) }),
        U.el('span', { text: c.name }),
        U.el('span', { class: 'geo-picker__star', text: '★' + c.freq }),
      ]));
    }
    body.appendChild(box);
    app.modal({ title: 'どの国を見ますか', body: body, actions: [{ label: '閉じる', kind: 'ghost' }] });
  }

  function showCountry(app, c) {
    const Geo = global.Geo;
    const rec = Geo.peek(A.geoState(app), c.id);
    const body = U.el('div');
    body.appendChild(U.el('p', { text: '首都: ' + (c.capital || '(首都の問題は出しません)') }));
    body.appendChild(U.el('p', { text: '輸出品: ' + c.exports }));
    body.appendChild(U.el('p', { text: c.feature }));
    body.appendChild(U.el('p', {
      class: 'quiz-note',
      text: '頻出度 ★' + c.freq + ' / 出題 ' + rec.asked + '回・まちがい ' + rec.wrong +
        '回・連続正解 ' + rec.streak + ' (' + STATE_LABEL[Geo.markState(rec)] + ')',
    }));
    app.modal({ title: c.name, body: body, actions: [{ label: '閉じる', kind: 'ghost' }] });
  }

  // ---------------- 入口 ----------------

  function render(root, app) {
    if (state.screen === 'battle') return renderBattle(root, app);
    if (state.screen === 'map') return renderMap(root, app);
    return renderMenu(root, app);
  }

  global.App.register('quest', { render: render });
})(typeof window !== 'undefined' ? window : globalThis);
