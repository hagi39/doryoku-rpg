/* 学ぶ: 教材(解説と確認問題)/ 復習リスト
 *
 * 教材はAIが作って progress.materials に残す(スキルごと1件)。
 * 復習リストは保存済みの問題を出し直すだけなので、APIキーがなくても解ける。 */
(function (global) {
  'use strict';

  const U = global.U;
  const R = global.Rules;
  const Q = global.Quiz;
  const MG = global.MaterialGen;

  // タブを離れても、開いている場所を覚えておく
  const view = { mode: 'material', skillId: '', openTrees: {}, openSkills: {} };

  // 再挑戦で同じ確認問題が出ないよう、このセッションで出た問題文を覚えておく
  const seen = {};

  function render(root, app) {
    // ツリーの「教材を見る」から来たとき
    if (app.pendingLearnSkill) {
      view.mode = 'material';
      view.skillId = app.pendingLearnSkill;
      app.pendingLearnSkill = null;
    }

    root.appendChild(modeSwitch(app));
    if (view.mode === 'material') {
      if (view.skillId && app.skill(view.skillId)) materialPage(root, app, app.skill(view.skillId));
      else materialIndex(root, app);
    } else {
      reviewPage(root, app);
    }
  }

  function modeSwitch(app) {
    const pending = pendingItems(app).length;
    const seg = U.el('div', { class: 'seg' });
    const modes = [
      { id: 'material', label: '教材' },
      { id: 'review', label: '復習リスト' + (pending ? ' ' + pending : '') },
    ];
    for (const m of modes) {
      const btn = U.el('button', {
        class: 'seg__btn',
        text: m.label,
        'aria-pressed': String(m.id === view.mode),
      });
      btn.addEventListener('click', function () {
        view.mode = m.id;
        view.skillId = '';
        app.render();
      });
      seg.appendChild(btn);
    }
    return seg;
  }

  function pendingItems(app) {
    return (app.progress.reviewList || []).filter(function (it) { return it && !it.cleared; });
  }

  function skillName(app, id) {
    const s = app.skill(id);
    return s ? s.name : id;
  }

  function isAbort(e) { return e && e.name === 'AbortError'; }

  // ---------------- 教材: スキルを選ぶ ----------------

  /** 教材の対象: 解放済み + 解放できる 勉強スキル(設計書9章) */
  function materialTargets(app) {
    return app.treeData.skills.filter(function (s) {
      if (!app.needsTest(s)) return false;
      return app.isUnlocked(s.id) || R.isUnlockable(s, app.progress.skills);
    });
  }

  function materialIndex(root, app) {
    const targets = materialTargets(app);
    root.appendChild(U.el('div', { class: 'notice' },
      '解放したスキルと、いま解放できるスキルの教材が読めます。' + MG.DISCLAIMER));

    if (!targets.length) {
      root.appendChild(U.el('div', { class: 'card' }, [
        U.el('div', { class: 'empty', text: 'まだ教材を読めるスキルがありません。ツリータブで診断か解放テストを受けると出てきます。' }),
      ]));
      return;
    }

    const made = app.progress.materials || {};
    for (const tree of app.treeData.trees) {
      const skills = targets.filter(function (s) { return s.tree === tree.id; });
      if (!skills.length) continue;

      const isOpen = !!view.openTrees[tree.id];
      const card = U.el('div', { class: 'card learn-group' });
      const head = U.el('button', { class: 'learn-group__head', 'aria-expanded': String(isOpen) }, [
        U.el('span', { class: 'learn-group__caret', text: '▶' }),
        U.el('span', { class: 'learn-group__name', text: tree.name }),
        U.el('span', { class: 'card__note',
          text: '教材 ' + skills.filter(function (s) { return made[s.id]; }).length + ' / ' + skills.length }),
      ]);
      head.addEventListener('click', function () {
        view.openTrees[tree.id] = !view.openTrees[tree.id];
        app.render();
      });
      card.appendChild(head);

      if (isOpen) {
        const list = U.el('div', { class: 'list', style: 'margin-top:10px' });
        for (const skill of skills) {
          const material = made[skill.id];
          const unlocked = app.isUnlocked(skill.id);
          list.appendChild(U.el('button', {
            class: 'list-item',
            onclick: function () { view.skillId = skill.id; app.render(); },
          }, [
            U.el('span', {
              class: 'badge badge--' + (material ? 'ok' : 'lock'),
              text: material ? '教材' : 'なし',
            }),
            U.el('span', { class: 'list-item__main' }, [
              U.el('div', { class: 'list-item__name', text: skill.name }),
              U.el('div', { class: 'list-item__sub',
                text: unlocked ? '解放済み' : 'いま解放できる' }),
            ]),
            U.el('span', { class: 'list-item__side', text: '›' }),
          ]));
        }
        card.appendChild(list);
      }
      root.appendChild(card);
    }
  }

  // ---------------- 教材: 1スキルの中身 ----------------

  function materialPage(root, app, skill) {
    const material = (app.progress.materials || {})[skill.id];

    const back = U.el('button', { class: 'btn btn--sm btn--ghost', text: '‹ 教材の一覧へ' });
    back.addEventListener('click', function () { view.skillId = ''; app.render(); });
    root.appendChild(U.el('div', { class: 'learn-back' }, [back]));

    const card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card__head' }, [
      U.el('div', { class: 'card__title', text: skill.name }),
      U.el('div', { class: 'card__note',
        text: (app.tree(skill.tree) || {}).name + (app.isUnlocked(skill.id) ? '' : ' ・ 未解放') }),
    ]));
    if (skill.desc) card.appendChild(U.el('p', { class: 'learn-desc', text: skill.desc }));

    if (!material) {
      card.appendChild(U.el('div', { class: 'empty', text: 'まだ教材がありません。AIに作ってもらいましょう。' }));
      card.appendChild(makeButton(app, skill, '教材を作ってもらう'));
      root.appendChild(card);
      return;
    }

    card.appendChild(U.el('div', { class: 'notice notice--warn', text: MG.DISCLAIMER }));
    if (material.summary) card.appendChild(U.el('p', { class: 'learn-summary', text: material.summary }));

    card.appendChild(section('要点', material.points.map(function (p) {
      return U.el('div', { class: 'learn-point' }, [
        U.el('div', { class: 'learn-point__title', text: p.title }),
        U.el('div', { class: 'learn-body', text: p.body }),
      ]);
    })));

    if (material.examples.length) {
      card.appendChild(section('例題', material.examples.map(function (e, i) {
        return U.el('div', { class: 'learn-example' }, [
          U.el('div', { class: 'learn-point__title', text: '例題 ' + (i + 1) }),
          U.el('div', { class: 'learn-body', text: e.question }),
          U.el('div', { class: 'learn-body learn-body--solution', text: e.solution }),
        ]);
      })));
    }

    if (material.pitfalls.length) {
      card.appendChild(section('つまずきやすい点', material.pitfalls.map(function (t) {
        return U.el('div', { class: 'learn-pitfall', text: t });
      })));
    }

    card.appendChild(U.el('div', { class: 'card__note', style: 'margin-top:12px',
      text: '作った日: ' + U.dateKey(material.at) + (material.model ? ' ・ ' + material.model : '') }));
    root.appendChild(card);

    root.appendChild(checkCard(app, skill, material));

    const redo = U.el('button', { class: 'btn btn--sm btn--ghost btn--block', text: '教材を作り直す' });
    redo.addEventListener('click', function () {
      app.confirm('教材を作り直す', 'いまの教材は消えて、新しい解説に入れかわります。', function () {
        generate(app, skill);
      });
    });
    root.appendChild(U.el('div', { style: 'margin-top:12px' }, [redo]));
  }

  function section(title, nodes) {
    return U.el('div', { class: 'learn-section' },
      [U.el('div', { class: 'section-title', text: title })].concat(nodes));
  }

  function makeButton(app, skill, label) {
    const btn = U.el('button', { class: 'btn btn--primary btn--block', text: label });
    btn.addEventListener('click', function () { generate(app, skill); });
    return btn;
  }

  /** 確認問題の入口。1日1回だけ経験値が出ることをここに書いておく。 */
  function checkCard(app, skill, material) {
    const done = R.dailyDone(app.progress.daily, R.dailyKey('check', skill.id), U.dateKey());
    const card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card__head' }, [
      U.el('div', { class: 'card__title', text: '確認問題' }),
      U.el('div', { class: 'card__note', text: '3問(選択2・記述1)' }),
    ]));
    card.appendChild(U.el('p', { class: 'learn-body',
      text: '読んだ内容が身についたか確かめます。合否はありません。まちがえた問題は復習リストに入ります。' }));
    card.appendChild(U.el('div', { class: 'card__note', style: 'margin-bottom:10px',
      text: done
        ? '今日はもう経験値を受け取りました。何回でも解けますが、経験値は明日また出ます。'
        : '1問正解につき ' + R.C.REVIEW_XP + ' xp(1日1スキル1回だけ)' }));

    const btn = U.el('button', { class: 'btn btn--block', text: '確認問題を解く' });
    btn.addEventListener('click', function () { startCheck(app, skill, material); });
    card.appendChild(btn);
    return card;
  }

  // ---------------- 教材を作る ----------------

  async function generate(app, skill) {
    const title = skill.name + ' の教材';
    if (!global.Ai.available()) {
      global.QuizUI.aiError(app, {
        title: title,
        error: { message: 'APIキーが設定されていないため、教材を作れません。' },
        fallbackText: '設定タブでキーを入れると、AIが要点・例題・つまずきやすい点をまとめてくれます。保存済みの教材は、キーがなくても読めます。',
        actions: [{ label: 'わかった', kind: 'primary' }],
      });
      return;
    }

    const ctrl = new AbortController();
    global.QuizUI.loading(app, {
      title: title,
      message: 'AIが教材を書いています…',
      onCancel: function () { ctrl.abort(); },
    });

    let material;
    try {
      material = await MG.generate(app, skill, { signal: ctrl.signal });
    } catch (e) {
      if (isAbort(e)) return;
      console.warn('教材を作れませんでした', e);
      global.QuizUI.aiError(app, {
        title: title, error: e,
        fallbackText: '時間をおいてもう一度ためしてください。',
        actions: [
          { label: 'とじる', kind: 'ghost' },
          { label: 'もう一度', kind: 'primary', onClick: function () { generate(app, skill); return false; } },
        ],
      });
      return;
    }
    if (ctrl.signal.aborted) return;

    global.Actions.saveMaterial(app, skill.id, material, { model: global.Ai.getConfig().model });
    app.closeModal();
    view.mode = 'material';
    view.skillId = skill.id;
    app.toast('教材ができました', 'good');
    app.render();
  }

  // ---------------- 確認問題 ----------------

  async function startCheck(app, skill, material) {
    const title = skill.name + ' の確認問題';
    if (!global.Ai.available()) {
      global.QuizUI.aiError(app, {
        title: title,
        error: { message: 'APIキーが設定されていないため、確認問題は作れません。' },
        fallbackText: '復習リストに問題が溜まっていれば、AIなしでも解けます。',
        actions: [{ label: 'わかった', kind: 'primary' }],
      });
      return;
    }

    const key = 'ck:' + skill.id;
    const ctrl = new AbortController();
    global.QuizUI.loading(app, { title: title, onCancel: function () { ctrl.abort(); } });

    let questions;
    try {
      questions = await MG.checkQuestions(app, skill, material, { avoid: seen[key], signal: ctrl.signal });
    } catch (e) {
      if (isAbort(e)) return;
      console.warn('確認問題を作れませんでした', e);
      global.QuizUI.aiError(app, {
        title: title, error: e,
        fallbackText: '時間をおいてもう一度ためしてください。',
        actions: [
          { label: 'とじる', kind: 'ghost' },
          { label: 'もう一度', kind: 'primary',
            onClick: function () { startCheck(app, skill, material); return false; } },
        ],
      });
      return;
    }
    if (ctrl.signal.aborted) return;

    const list = seen[key] || (seen[key] = []);
    for (const q of questions) list.push(q.question);

    global.QuizUI.run(app, {
      title: title,
      questions: questions,
      onDone: function (items) { finishCheck(app, skill, material, items); },
      onQuit: function () { app.render(); },
    });
  }

  function finishCheck(app, skill, material, items) {
    const res = global.Actions.finishMaterialCheck(app, skill.id, items);
    const s = res.score;
    const lines = [];
    if (res.xp) lines.push('+' + res.xp + ' xp');
    else if (!res.earnedToday) lines.push('今日はもう経験値を受け取っているので、経験値は出ません。');
    if (res.leveledUp) lines.push('レベルが ' + res.level + ' に上がった!');
    if (res.mistakes) lines.push('まちがえた ' + res.mistakes + ' 問を復習リストに入れました。');

    global.QuizUI.result(app, {
      title: skill.name + ' の確認問題',
      kind: s.valid && s.correct === s.valid ? 'good' : s.correct ? 'warn' : 'bad',
      headline: s.valid + ' 問中 ' + s.correct + ' 問正解',
      lines: lines,
      score: s,
      actions: [
        { label: 'とじる', kind: 'ghost', onClick: function () { app.render(); } },
        { label: '新しい問題でもう一度', kind: 'primary',
          onClick: function () { startCheck(app, skill, material); return false; } },
      ],
    });
  }

  // ---------------- 復習リスト ----------------

  function reviewPage(root, app) {
    const list = app.progress.reviewList || [];
    const pending = pendingItems(app);
    const cleared = list.length - pending.length;

    const head = U.el('div', { class: 'card' });
    head.appendChild(U.el('div', { class: 'card__head' }, [
      U.el('div', { class: 'card__title', text: '復習リスト' }),
      U.el('div', { class: 'card__note',
        text: '未克服 ' + pending.length + ' / 全 ' + list.length + ' 問(上限 ' + Q.C.REVIEW_LIST_MAX + ')' }),
    ]));
    head.appendChild(U.el('p', { class: 'learn-body',
      text: 'AIテストと確認問題でまちがえた問題が貯まります。保存した問題を出し直すので、APIキーがなくても解けます。' +
        '同じ問題に2回続けて正解すると克服です。' }));

    if (pending.length) {
      const btn = U.el('button', {
        class: 'btn btn--primary btn--block',
        text: 'まとめて復習する(' + Math.min(pending.length, Q.C.REVIEW_SESSION_MAX) + '問)',
      });
      btn.addEventListener('click', function () { startReview(app, {}); });
      head.appendChild(btn);
      head.appendChild(U.el('div', { class: 'card__note', style: 'margin-top:6px',
        text: '1問正解につき ' + R.C.REVIEW_XP + ' xp。忘れていそうな問題から出ます。' }));
    } else {
      head.appendChild(U.el('div', { class: 'empty',
        text: list.length ? 'ぜんぶ克服しました!' : 'まだ問題がありません。AIテストでまちがえた問題がここに貯まります。' }));
    }
    root.appendChild(head);

    if (!list.length) return;

    // スキルごとにまとめる(未克服が多い順)
    const groups = new Map();
    for (const it of list) {
      const g = groups.get(it.skillId) || { skillId: it.skillId, items: [], pending: 0 };
      g.items.push(it);
      if (!it.cleared) g.pending++;
      groups.set(it.skillId, g);
    }
    const sorted = Array.from(groups.values()).sort(function (a, b) {
      return b.pending - a.pending || b.items.length - a.items.length;
    });

    for (const g of sorted) root.appendChild(reviewGroup(app, g));

    if (cleared) {
      const wipe = U.el('button', { class: 'btn btn--sm btn--ghost btn--block',
        text: '克服した ' + cleared + ' 問を消す' });
      wipe.addEventListener('click', function () {
        app.confirm('克服した問題を消す', cleared + ' 問を消します。保存の容量を空けたいときに使ってください。', function () {
          const n = global.Actions.removeClearedReviewItems(app);
          app.toast(n + ' 問を消しました');
          app.render();
        });
      });
      root.appendChild(U.el('div', { style: 'margin-top:12px' }, [wipe]));
    }
  }

  function reviewGroup(app, g) {
    const isOpen = !!view.openSkills[g.skillId];
    const card = U.el('div', { class: 'card learn-group' });

    const head = U.el('button', { class: 'learn-group__head', 'aria-expanded': String(isOpen) }, [
      U.el('span', { class: 'learn-group__caret', text: '▶' }),
      U.el('span', { class: 'learn-group__name', text: skillName(app, g.skillId) }),
      U.el('span', { class: 'badge badge--' + (g.pending ? 'warn' : 'ok'),
        text: g.pending ? '未克服 ' + g.pending : '克服' }),
      U.el('span', { class: 'card__note', text: g.items.length + ' 問' }),
    ]);
    head.addEventListener('click', function () {
      view.openSkills[g.skillId] = !view.openSkills[g.skillId];
      app.render();
    });
    card.appendChild(head);

    if (!isOpen) return card;

    if (g.pending) {
      const only = U.el('button', { class: 'btn btn--sm btn--block', style: 'margin-top:10px',
        text: 'このスキルだけ復習する' });
      only.addEventListener('click', function () { startReview(app, { skillId: g.skillId }); });
      card.appendChild(only);
    }

    const items = g.items.slice().sort(function (a, b) {
      return (a.cleared ? 1 : 0) - (b.cleared ? 1 : 0) || (b.misses || 0) - (a.misses || 0);
    });
    const box = U.el('div', { class: 'learn-review-list' });
    for (const it of items) box.appendChild(reviewRow(app, it));
    card.appendChild(box);
    return card;
  }

  function reviewRow(app, it) {
    const row = U.el('div', { class: 'learn-review' + (it.cleared ? ' learn-review--cleared' : '') });
    row.appendChild(U.el('div', { class: 'learn-review__q', text: it.q.question }));
    row.appendChild(U.el('div', { class: 'learn-review__meta' }, [
      U.el('span', { text: it.cleared ? '克服' : 'まちがい ' + (it.misses || 0) + ' 回' }),
      U.el('span', { text: it.cleared ? '' : '連続正解 ' + (it.streak || 0) + ' / ' + Q.C.REVIEW_CLEAR_STREAK }),
      U.el('span', { text: '最後 ' + U.dateKey(it.lastAt) }),
    ]));

    const answer = U.el('button', { class: 'btn btn--sm btn--ghost', text: '答えを見る' });
    answer.addEventListener('click', function () {
      app.modal({
        title: '答え',
        body: U.el('div', { class: 'quiz' }, [
          U.el('div', { class: 'quiz-q', text: it.q.question }),
          U.el('p', { class: 'quiz-line',
            text: '正解: ' + (it.q.type === 'choice' ? it.q.choices[it.q.answer] : it.q.answer) }),
          it.q.explanation ? U.el('p', { class: 'quiz-note', text: it.q.explanation }) : null,
        ]),
        actions: [{ label: 'とじる', kind: 'primary' }],
      });
    });

    const del = U.el('button', { class: 'btn btn--sm btn--ghost btn--danger', text: '消す' });
    del.addEventListener('click', function () {
      global.Actions.removeReviewItem(app, it.id);
      app.toast('1問消しました');
      app.render();
    });

    row.appendChild(U.el('div', { class: 'learn-review__actions' }, [answer, del]));
    return row;
  }

  /** 保存済みの問題を出し直す。AIは使わない。 */
  function startReview(app, opts) {
    const picked = Q.pickReviewSession(app.progress.reviewList, opts);
    if (!picked.length) {
      app.toast('復習する問題がありません');
      return;
    }
    // 答えの位置を覚えてしまわないよう、選択肢は毎回並べ直す
    const questions = picked.map(function (it) { return Q.reshuffleChoices(it.q); });

    global.QuizUI.run(app, {
      title: '復習(' + questions.length + '問)',
      questions: questions,
      skillName: function (q) { return skillName(app, q.skillId); },
      onDone: function (items) { finishReview(app, items); },
      onQuit: function () { app.render(); },
    });
  }

  function finishReview(app, items) {
    const res = global.Actions.finishReviewSession(app, items);
    const s = res.score;
    const lines = ['+' + res.xp + ' xp'];
    if (res.leveledUp) lines.push('レベルが ' + res.level + ' に上がった!');
    if (res.cleared) lines.push(res.cleared + ' 問を克服しました!');
    const remain = pendingItems(app).length;
    lines.push(remain ? '復習リストに残り ' + remain + ' 問。' : '復習リストをぜんぶ克服しました!');

    global.QuizUI.result(app, {
      title: '復習の結果',
      kind: s.valid && s.correct === s.valid ? 'good' : s.correct ? 'warn' : 'bad',
      headline: s.valid + ' 問中 ' + s.correct + ' 問正解',
      lines: lines,
      score: s,
      actions: [
        { label: 'とじる', kind: 'ghost', onClick: function () { app.render(); } },
        remain ? { label: 'つづけて復習', kind: 'primary',
          onClick: function () { startReview(app, {}); return false; } } : null,
      ].filter(Boolean),
    });
  }

  global.App.register('learn', { render: render });
})(typeof window !== 'undefined' ? window : globalThis);
