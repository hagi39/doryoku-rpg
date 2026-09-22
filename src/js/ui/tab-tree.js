/* ツリー: 勉強/筋トレの切替、ツリーごとの開閉、次の一歩が光る盤面 */
(function (global) {
  'use strict';

  const U = global.U;
  const R = global.Rules;

  // タブを離れても開閉と選択を覚えておく
  const view = { category: '', open: {} };

  function render(root, app) {
    const cats = app.treeData.categories;
    if (!cats.some(function (c) { return c.id === view.category; })) {
      view.category = cats[0].id;
    }

    root.appendChild(categorySwitch(app, cats));

    const trees = app.treeData.trees.filter(function (t) { return t.category === view.category; });
    const now = Date.now();
    for (const tree of trees) {
      root.appendChild(treeCard(app, tree, now));
    }

    root.appendChild(legend());
  }

  function categorySwitch(app, cats) {
    const seg = U.el('div', { class: 'seg' });
    for (const cat of cats) {
      const btn = U.el('button', {
        class: 'seg__btn',
        text: cat.name,
        'aria-pressed': String(cat.id === view.category),
      });
      btn.addEventListener('click', function () {
        view.category = cat.id;
        app.render();
      });
      seg.appendChild(btn);
    }
    return seg;
  }

  function legend() {
    return U.el('div', { class: 'tree-legend' }, [
      U.el('span', { class: 'lg-open', text: '次の一歩' }),
      U.el('span', { class: 'lg-done', text: '解放済み' }),
      U.el('span', { class: 'lg-rust', text: 'サビている' }),
      U.el('span', { class: 'lg-lock', text: 'まだ' }),
      U.el('span', { style: 'color:var(--accent)', text: '◆ は他ツリーの前提' }),
    ]);
  }

  // ---------------- ツリー1つ ----------------

  function treeCard(app, tree, now) {
    const skills = app.treeData.skills.filter(function (s) { return s.tree === tree.id; });
    const unlocked = skills.filter(function (s) { return app.isUnlocked(s.id); }).length;
    const openable = skills.filter(function (s) {
      return R.isUnlockable(s, app.progress.skills);
    }).length;

    const card = U.el('div', { class: 'card tree-card' });
    const isOpen = !!view.open[tree.id];

    const head = U.el('button', {
      class: 'tree-card__head',
      'aria-expanded': String(isOpen),
    }, [
      U.el('span', { class: 'tree-card__caret', text: '▶' }),
      U.el('span', { class: 'tree-card__name', text: tree.name }),
      openable ? U.el('span', { class: 'badge badge--warn', text: '解放 ' + openable }) : null,
      U.el('span', { class: 'tree-card__count', text: unlocked + ' / ' + skills.length }),
    ]);
    head.addEventListener('click', function () {
      view.open[tree.id] = !view.open[tree.id];
      app.render();
    });
    card.appendChild(head);

    if (!isOpen) return card;

    const body = U.el('div', { class: 'tree-card__body' });

    if (app.needsTest({ tree: tree.id })) {
      const actions = U.el('div', { class: 'tree-card__actions' });
      const diag = U.el('button', { class: 'btn btn--sm', text: 'このツリーを診断する' });
      diag.addEventListener('click', function () { startDiagnosis(app, tree); });
      actions.appendChild(diag);
      body.appendChild(actions);
    }

    body.appendChild(board(app, tree, skills, now));
    card.appendChild(body);
    return card;
  }

  function board(app, tree, skills, now) {
    const wrap = U.el('div', { class: 'tree' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'tree__lines');
    wrap.appendChild(svg);

    const layout = global.Layout.treeLayout(app.treeData, tree.id, app.levels);
    const nodeEls = new Map();

    for (const row of layout.rows) {
      const level = U.el('div', { class: 'tree__level' });
      for (const id of row) {
        const skill = app.skill(id);
        if (!skill) continue;
        const node = nodeEl(app, skill, now);
        nodeEls.set(id, node);
        level.appendChild(node);
      }
      wrap.appendChild(level);
    }

    // 配置が決まってから線を引く
    const draw = function () { drawLines(app, tree, wrap, svg, nodeEls); };
    requestAnimationFrame(draw);
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(draw);
      ro.observe(wrap);
    }

    return wrap;
  }

  function nodeEl(app, skill, now) {
    const unlocked = app.isUnlocked(skill.id);
    const openable = R.isUnlockable(skill, app.progress.skills);
    const rust = unlocked ? app.rust(skill.id, now) : 0;
    const rusty = rust >= R.C.RUST_BONUS_LINE;

    const classes = ['node'];
    if (unlocked) classes.push('node--unlocked');
    else if (openable) classes.push('node--open');
    else classes.push('node--locked');
    if (rusty) classes.push('node--rusty');

    const cross = global.Layout.crossTreeParents(app.treeData, skill);

    const node = U.el('button', {
      class: classes.join(' '),
      dataset: { id: skill.id },
      'aria-label': skill.name,
    }, [
      U.el('span', { class: 'node__name', text: skill.name }),
      U.el('span', { class: 'node__meta' }, [
        cross.length ? U.el('span', { class: 'node__cross', text: '◆' + cross.length }) : null,
        U.el('span', { text: unlocked ? (rust > 0 ? 'サビ' + Math.round(rust * 100) + '%' : '◎') : (openable ? '解放できる' : '×') }),
      ]),
      unlocked && rust > 0
        ? U.el('span', { class: 'node__rust' }, [U.el('i', { style: 'width:' + Math.round(rust * 100) + '%' })])
        : null,
    ]);

    node.addEventListener('click', function () { showSkill(app, skill); });
    return node;
  }

  /** 同じツリー内の前提だけ線でつなぐ */
  function drawLines(app, tree, wrap, svg, nodeEls) {
    const base = wrap.getBoundingClientRect();
    if (!base.width) return;
    svg.setAttribute('viewBox', '0 0 ' + base.width + ' ' + base.height);
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    for (const [id, childEl] of nodeEls) {
      const skill = app.skill(id);
      const parents = global.Layout.sameTreeParents(app.treeData, skill);
      const cb = childEl.getBoundingClientRect();
      const cx = cb.left - base.left + cb.width / 2;
      const cy = cb.top - base.top;

      for (const pid of parents) {
        const parentEl = nodeEls.get(pid);
        if (!parentEl) continue;
        const pb = parentEl.getBoundingClientRect();
        const px = pb.left - base.left + pb.width / 2;
        const py = pb.bottom - base.top;
        if (py > cy) continue; // 親が下にあるときは引かない

        const mid = py + (cy - py) / 2;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d',
          'M' + px + ',' + py + ' L' + px + ',' + mid + ' L' + cx + ',' + mid + ' L' + cx + ',' + cy);

        const childUnlocked = app.isUnlocked(id);
        const parentUnlocked = app.isUnlocked(pid);
        path.setAttribute('class', 'tree__line' +
          (childUnlocked ? '' : parentUnlocked ? ' tree__line--open' : ' tree__line--locked'));
        svg.appendChild(path);
      }
    }
  }

  // ---------------- スキルの詳細 ----------------

  function showSkill(app, skill) {
    const now = Date.now();
    const unlocked = app.isUnlocked(skill.id);
    const openable = R.isUnlockable(skill, app.progress.skills);
    const rust = unlocked ? app.rust(skill.id, now) : 0;
    const needsTest = app.needsTest(skill);

    const body = U.el('div', { class: 'skill-detail' });
    if (skill.desc) body.appendChild(U.el('div', { class: 'skill-detail__desc', text: skill.desc }));

    body.appendChild(row('じょうたい', unlocked
      ? '解放済み' + (rust > 0 ? '(サビ ' + Math.round(rust * 100) + '%)' : '')
      : openable ? '解放できる' : '前提がまだ足りない'));

    const reqs = skill.requires || [];
    if (reqs.length) {
      const list = U.el('div');
      for (const id of reqs) {
        const parent = app.skill(id);
        if (!parent) continue;
        const isCross = parent.tree !== skill.tree;
        const mark = app.isUnlocked(id) ? '✓' : '×';
        const treeName = isCross ? '◆' + (app.tree(parent.tree) || {}).name + ' ' : '';
        list.appendChild(U.el('div', {
          style: 'font-size:12px' + (app.isUnlocked(id) ? '' : ';color:var(--text-dim)'),
          text: mark + ' ' + treeName + parent.name,
        }));
      }
      body.appendChild(row('ぜんてい', list));
    } else {
      body.appendChild(row('ぜんてい', 'なし(最初から挑戦できる)'));
    }

    body.appendChild(row('経験値', String(skill.xp) + ' xp / 1回'));

    const rewards = Object.keys(skill.reward || {}).map(function (k) {
      const meta = app.statById.get(k);
      return (meta ? meta.name : k) + ' +' + skill.reward[k];
    });
    if (rewards.length) body.appendChild(row('解放報酬', rewards.join(' / ')));

    if (unlocked) {
      const p = app.progress.skills[skill.id];
      body.appendChild(row('磨いた回数', (p.polishCount || 0) + ' 回(安全 ' +
        R.safeDays(p.polishCount) + ' 日 / 完全にサビるまで ' + R.fullDays(p.polishCount) + ' 日)'));
    }

    app.modal({
      title: skill.name,
      body: body,
      actions: buildActions(app, skill, { unlocked, openable, needsTest }),
    });
  }

  function row(key, val) {
    return U.el('div', { class: 'skill-detail__row' }, [
      U.el('span', { class: 'skill-detail__key', text: key }),
      typeof val === 'string'
        ? U.el('span', { class: 'skill-detail__val', text: val })
        : U.el('span', { class: 'skill-detail__val' }, [val]),
    ]);
  }

  function buildActions(app, skill, state) {
    if (state.unlocked) {
      return [
        { label: 'とじる', kind: 'ghost' },
        state.needsTest ? {
          label: '復習テスト',
          onClick: function () { global.Tests.review(app, skill); return false; },
        } : null,
        {
          label: 'これを記録する',
          kind: 'primary',
          onClick: function () {
            app.pendingLogSkill = skill.id;
            app.go('log');
          },
        },
      ];
    }

    if (!state.openable) {
      return [{ label: 'とじる', kind: 'ghost' }];
    }

    const selfReport = {
      label: state.needsTest ? '自己申告で解放' : 'できた!',
      kind: state.needsTest ? null : 'primary',
      onClick: function () { doUnlock(app, skill, 'self'); },
    };

    if (!state.needsTest) {
      return [{ label: 'とじる', kind: 'ghost' }, selfReport];
    }

    return [
      selfReport,
      {
        label: '解放テスト',
        kind: 'primary',
        onClick: function () { return startUnlockTest(app, skill); },
      },
    ];
  }

  function doUnlock(app, skill, how) {
    const res = global.Actions.unlockSkill(app, skill.id, how);
    if (res.already) { app.toast('もう解放しています'); return; }

    const gains = Object.keys(res.gains).map(function (k) {
      const meta = app.statById.get(k);
      return (meta ? meta.name : k) + ' +' + res.gains[k];
    });
    app.toast(skill.name + ' を解放!' + (gains.length ? ' ' + gains.join(' / ') : ''), 'good');
    app.render();
  }

  // ---------------- AIテストの入口 ----------------

  function startUnlockTest(app, skill) {
    global.Tests.unlock(app, skill, {
      onSelfUnlock: function (s) { doUnlock(app, s, 'self'); },
    });
    return false;
  }

  function startDiagnosis(app, tree) {
    global.Tests.diagnose(app, tree);
  }

  function notReady(app, message, skill) {
    app.modal({
      title: skill.name,
      body: U.el('p', { text: message }),
      actions: [
        { label: 'とじる', kind: 'ghost' },
        { label: '自己申告で解放', kind: 'primary', onClick: function () { doUnlock(app, skill, 'self'); } },
      ],
    });
  }

  global.App.register('tree', { render: render });
})(typeof window !== 'undefined' ? window : globalThis);
