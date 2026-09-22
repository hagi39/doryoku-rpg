/* AIテストの流れ(解放テスト・復習テスト・診断)。
 * どの流れも、AIが使えないときは自己申告で進める道を必ず出す。 */
(function (global) {
  'use strict';

  const U = global.U;
  const Q = global.Quiz;

  // 再挑戦で同じ問題が出ないよう、このセッションで出た問題文を覚えておく
  const seen = {};
  function remember(key, questions) {
    const list = seen[key] || (seen[key] = []);
    for (const q of questions) list.push(q.question);
  }

  function gainsText(app, gains) {
    return Object.keys(gains || {}).map(function (k) {
      const meta = app.statById.get(k);
      return (meta ? meta.name : k) + ' +' + gains[k];
    }).join(' / ');
  }

  function isAbort(e) { return e && e.name === 'AbortError'; }

  // ---------------- 解放テスト ----------------

  /**
   * @param {{onSelfUnlock:function}} hooks 自己申告で解放するときの処理(ツリー側の表示ごと任せる)
   */
  function unlock(app, skill, hooks) {
    const title = skill.name + ' の解放テスト';
    const selfUnlock = {
      label: '自己申告で解放', kind: null,
      onClick: function () { hooks.onSelfUnlock(skill); },
    };

    if (!global.Ai.available()) {
      global.QuizUI.aiError(app, {
        title: title,
        error: { message: 'APIキーが設定されていないため、解放テストは受けられません。' },
        fallbackText: '設定タブでキーを入れるか、自己申告で解放してください。',
        actions: [{ label: 'とじる', kind: 'ghost' }, Object.assign({}, selfUnlock, { kind: 'primary' })],
      });
      return;
    }

    askLevel();

    function askLevel() {
      const body = U.el('div', { class: 'quiz' }, [
        U.el('p', { class: 'quiz-line', text: 'このスキルにどれくらい自信がありますか? 自信に合わせて難しさを変えます。' }),
        U.el('p', { class: 'quiz-note', text: '4問(選択3・記述1)のうち3問正解で解放。不合格でも、新しい問題で何度でも挑戦できます。' }),
      ]);
      const row = U.el('div', { class: 'quiz-levels' });
      for (const id of ['low', 'mid', 'high']) {
        const lv = global.QuizGen.LEVELS[id];
        const btn = U.el('button', { class: 'btn', text: lv.label });
        btn.addEventListener('click', function () { start(id); });
        row.appendChild(btn);
      }
      body.appendChild(row);
      app.modal({ title: title, body: body, actions: [{ label: 'やめる', kind: 'ghost' }] });
    }

    async function start(level) {
      const ctrl = new AbortController();
      global.QuizUI.loading(app, { title: title, onCancel: function () { ctrl.abort(); } });

      let questions;
      try {
        questions = await global.QuizGen.unlockQuestions(app, skill, {
          level: level, avoid: seen[skill.id], signal: ctrl.signal,
        });
      } catch (e) {
        if (isAbort(e)) return;
        console.warn('解放テストの問題を作れませんでした', e);
        global.QuizUI.aiError(app, {
          title: title, error: e,
          actions: [
            { label: 'とじる', kind: 'ghost' },
            selfUnlock,
            { label: 'もう一度', kind: 'primary', onClick: function () { start(level); return false; } },
          ],
        });
        return;
      }
      if (ctrl.signal.aborted) return;
      remember(skill.id, questions);

      global.QuizUI.run(app, {
        title: title,
        questions: questions,
        onDone: function (items) { finish(level, items); },
        onQuit: function () { app.render(); },
      });
    }

    function finish(level, items) {
      const res = global.Actions.finishUnlockTest(app, skill.id, items, { level: level });
      const s = res.score;
      const lines = [];
      if (res.mistakes) lines.push('まちがえた ' + res.mistakes + ' 問を復習リストに入れました。');

      const retry = { label: '新しい問題で再挑戦', kind: 'primary', onClick: function () { start(level); return false; } };
      const close = { label: 'とじる', kind: 'ghost', onClick: function () { app.render(); } };

      if (res.verdict === 'pass') {
        const g = gainsText(app, res.unlock && res.unlock.gains);
        global.QuizUI.result(app, {
          title: title, kind: 'good',
          headline: '合格!(' + s.correct + ' / ' + s.valid + ')' + skill.name + ' を解放しました',
          lines: (g ? [g] : []).concat(lines),
          score: s,
          actions: [{ label: 'とじる', kind: 'primary', onClick: function () { app.render(); } }],
        });
        app.toast(skill.name + ' を解放!' + (g ? ' ' + g : ''), 'good');
      } else if (res.verdict === 'fail') {
        global.QuizUI.result(app, {
          title: title, kind: 'bad',
          headline: '不合格(' + s.correct + ' / ' + s.valid + '、合格は ' + res.need + ' 問以上)',
          lines: lines.concat(['解説を読んでから、新しい問題でもう一度どうぞ。']),
          score: s,
          actions: [close, retry],
        });
      } else {
        global.QuizUI.result(app, {
          title: title, kind: 'warn',
          headline: '採点できる問題が少なかったので、判定しませんでした',
          lines: ['「おかしい」と外した問題が多いときは、新しい問題を作り直します。'],
          score: s,
          actions: [close, retry],
        });
      }
    }
  }

  // ---------------- 復習テスト ----------------

  /** 解放済みの勉強スキルで受ける。合格でサビが落ちる。 */
  function review(app, skill) {
    const title = skill.name + ' の復習テスト';
    const recordInstead = {
      label: '記録タブで記録する', kind: null,
      onClick: function () { app.pendingLogSkill = skill.id; app.go('log'); },
    };

    if (!global.Ai.available()) {
      global.QuizUI.aiError(app, {
        title: title,
        error: { message: 'APIキーが設定されていないため、復習テストは受けられません。' },
        fallbackText: '復習した内容は、記録タブで「復習のみ」として記録するとサビが落ちます。',
        actions: [{ label: 'とじる', kind: 'ghost' }, Object.assign({}, recordInstead, { kind: 'primary' })],
      });
      return;
    }

    const now = Date.now();
    const rust = app.rust(skill.id, now);
    const mistakes = (app.progress.reviewList || [])
      .filter(function (it) { return it.skillId === skill.id && !it.cleared; })
      .map(function (it) { return it.q.question; });

    const body = U.el('div', { class: 'quiz' }, [
      U.el('p', { class: 'quiz-line', text: '忘れていないかを確かめます。3問(選択2・記述1)のうち2問正解で合格。' }),
      U.el('p', { class: 'quiz-line', text: '合格すると「復習のみ」の記録になり、サビが0に戻ります。' +
        (Math.round(rust * 100) > 0 ? '(いまのサビ ' + Math.round(rust * 100) + '%)' : '') }),
      mistakes.length
        ? U.el('p', { class: 'quiz-note', text: '復習リストにあるこのスキルのまちがい ' + mistakes.length + ' 問に近い内容も出ます。' })
        : null,
    ]);
    app.modal({
      title: title,
      body: body,
      actions: [
        { label: 'やめる', kind: 'ghost' },
        { label: 'はじめる', kind: 'primary', onClick: function () { start(); return false; } },
      ],
    });

    async function start() {
      const ctrl = new AbortController();
      global.QuizUI.loading(app, { title: title, onCancel: function () { ctrl.abort(); } });

      let questions;
      try {
        questions = await global.QuizGen.reviewQuestions(app, skill, {
          mistakes: mistakes, avoid: seen['rv:' + skill.id], signal: ctrl.signal,
        });
      } catch (e) {
        if (isAbort(e)) return;
        console.warn('復習テストの問題を作れませんでした', e);
        global.QuizUI.aiError(app, {
          title: title, error: e,
          fallbackText: '復習した内容は、記録タブで「復習のみ」として記録するとサビが落ちます。',
          actions: [
            { label: 'とじる', kind: 'ghost' },
            recordInstead,
            { label: 'もう一度', kind: 'primary', onClick: function () { start(); return false; } },
          ],
        });
        return;
      }
      if (ctrl.signal.aborted) return;
      remember('rv:' + skill.id, questions);

      global.QuizUI.run(app, {
        title: title,
        questions: questions,
        onDone: finish,
        onQuit: function () { app.render(); },
      });
    }

    function finish(items) {
      const res = global.Actions.finishReviewTest(app, skill.id, items);
      const s = res.score;
      const lines = [];
      if (res.mistakes) lines.push('まちがえた ' + res.mistakes + ' 問を復習リストに入れました。');
      const close = { label: 'とじる', kind: 'ghost', onClick: function () { app.render(); } };
      const retry = { label: '新しい問題で再挑戦', kind: 'primary', onClick: function () { start(); return false; } };

      if (res.verdict === 'pass') {
        const log = res.log;
        const g = gainsText(app, log && log.gains);
        global.QuizUI.result(app, {
          title: title, kind: 'good',
          headline: '合格!(' + s.correct + ' / ' + s.valid + ')' +
            (Math.round(res.rustBefore * 100) > 0
              ? 'サビ ' + Math.round(res.rustBefore * 100) + '% → 0%'
              : 'サビなしを保っています'),
          lines: ['+' + (log ? log.xp : 0) + ' xp' + (log && log.crit ? ' 会心!' : '') + (g ? ' / ' + g : '')]
            .concat(log && log.leveledUp ? ['レベルが ' + log.level + ' に上がった!'] : [])
            .concat(lines),
          score: s,
          actions: [{ label: 'とじる', kind: 'primary', onClick: function () { app.render(); } }],
        });
      } else if (res.verdict === 'fail') {
        global.QuizUI.result(app, {
          title: title, kind: 'bad',
          headline: '不合格(' + s.correct + ' / ' + s.valid + '、合格は ' + res.need + ' 問以上)',
          lines: lines.concat(['解説を読んで、忘れていたところを確かめましょう。']),
          score: s,
          actions: [close, retry],
        });
      } else {
        global.QuizUI.result(app, {
          title: title, kind: 'warn',
          headline: '採点できる問題が少なかったので、判定しませんでした',
          score: s,
          actions: [close, retry],
        });
      }
    }
  }

  // ---------------- 診断 ----------------

  function skillNames(app, ids) {
    return ids.map(function (id) { const s = app.skill(id); return s ? s.name : id; });
  }

  /**
   * ツリー単位の診断。「ここまでできる」スキルとメモを聞き、最大6問で確かめる。
   * 正解したスキルとその前提を解放し、自己認識と「確認できたいちばん先」を並べて見せる。
   */
  function diagnose(app, tree) {
    const title = tree.name + ' の診断';
    const treeSkills = app.treeData.skills.filter(function (s) { return s.tree === tree.id; });

    if (!global.Ai.available()) {
      global.QuizUI.aiError(app, {
        title: title,
        error: { message: 'APIキーが設定されていないため、診断は使えません。' },
        fallbackText: '設定タブでキーを入れるか、ツリーでできるスキルを押して自己申告で解放してください。',
        actions: [{ label: 'わかった', kind: 'primary' }],
      });
      return;
    }

    const depth = Q.depthMap(treeSkills);
    const ordered = treeSkills.slice().sort(function (a, b) {
      return depth.get(a.id) - depth.get(b.id) || treeSkills.indexOf(a) - treeSkills.indexOf(b);
    });
    const last = (app.progress.diagnoses || {})[tree.id];
    const form = { claimId: last ? last.claimId || '' : '', memo: '' };

    ask();

    function ask() {
      const body = U.el('div', { class: 'quiz' });
      body.appendChild(U.el('p', { class: 'quiz-line',
        text: 'どこまでできると思いますか? 選んだスキルとその前提から、最大6問出題します。正解したスキルは前提ごと解放されます。' }));

      const select = U.el('select', { class: 'select' });
      select.appendChild(U.el('option', { value: '', text: 'まだ何もできない(入口から確かめる)' }));
      for (const s of ordered) {
        select.appendChild(U.el('option', {
          value: s.id,
          text: '段' + (depth.get(s.id) + 1) + ' ' + s.name + (app.isUnlocked(s.id) ? ' ✓' : ''),
          selected: s.id === form.claimId,
        }));
      }
      select.addEventListener('change', function () { form.claimId = select.value; });
      body.appendChild(U.el('label', { class: 'field' }, [
        U.el('span', { class: 'field__label', text: 'ここまでできると思う' }),
        select,
      ]));

      const memo = U.el('textarea', {
        class: 'textarea quiz-memo',
        rows: '3',
        placeholder: '例: 教科書の例題なら解ける / 公式は覚えたけど使い方があやしい',
        value: form.memo,
      });
      memo.addEventListener('input', function () { form.memo = memo.value; });
      body.appendChild(U.el('label', { class: 'field' }, [
        U.el('span', { class: 'field__label', text: 'メモ(なくてもよい)' }),
        memo,
        U.el('span', { class: 'field__hint', text: 'AIが出題と講評の参考にします' }),
      ]));

      if (last) {
        body.appendChild(U.el('div', { class: 'notice' },
          '前回(' + U.dateKey(last.at) + '): ' + last.correct + ' / ' + last.valid + ' 問正解、確認できたいちばん先は「' +
          (last.frontierId ? skillNames(app, [last.frontierId])[0] : 'なし') + '」'));
      }

      app.modal({
        title: title,
        body: body,
        actions: [
          { label: 'やめる', kind: 'ghost' },
          { label: '診断をはじめる', kind: 'primary', onClick: function () { start(); return false; } },
        ],
      });
    }

    async function start() {
      const targets = Q.diagnosisTargets({
        treeSkills: treeSkills,
        skillById: app.skillById,
        claimIds: form.claimId ? [form.claimId] : [],
      });
      const claim = form.claimId ? app.skill(form.claimId) : null;

      const ctrl = new AbortController();
      global.QuizUI.loading(app, {
        title: title,
        message: 'AIが ' + targets.length + ' 問の診断を作っています…',
        onCancel: function () { ctrl.abort(); },
      });

      let questions;
      try {
        questions = await global.QuizGen.diagnosisQuestions(app, tree, targets, {
          claimName: claim ? claim.name : '', memo: form.memo, signal: ctrl.signal,
        });
      } catch (e) {
        if (isAbort(e)) return;
        console.warn('診断の問題を作れませんでした', e);
        global.QuizUI.aiError(app, {
          title: title, error: e,
          fallbackText: 'AIが使えないときは、ツリーでできるスキルを押して自己申告で解放できます。',
          actions: [
            { label: 'とじる', kind: 'ghost' },
            { label: 'もう一度', kind: 'primary', onClick: function () { start(); return false; } },
          ],
        });
        return;
      }
      if (ctrl.signal.aborted) return;

      global.QuizUI.run(app, {
        title: title,
        questions: questions,
        skillName: function (q) { return skillNames(app, [q.skillId])[0]; },
        onDone: function (items) { finish(items, claim); },
        onQuit: function () { app.render(); },
      });
    }

    function finish(items, claim) {
      const res = global.Actions.finishDiagnosis(app, tree.id, items, {
        claimId: claim ? claim.id : null, memo: form.memo,
      });
      const s = res.score;
      const frontier = res.outcome.frontierId ? app.skill(res.outcome.frontierId) : null;

      const extra = U.el('div', { class: 'quiz' });
      extra.appendChild(U.el('div', { class: 'diag-compare' }, [
        U.el('div', { class: 'diag-compare__cell' }, [
          U.el('div', { class: 'quiz-note', text: '自己認識' }),
          U.el('div', { class: 'diag-compare__val', text: claim ? claim.name : 'まだ何もできない' }),
        ]),
        U.el('div', { class: 'diag-compare__cell' }, [
          U.el('div', { class: 'quiz-note', text: '確認できたいちばん先' }),
          U.el('div', { class: 'diag-compare__val', text: frontier ? frontier.name : 'なし' }),
        ]),
      ]));

      if (res.unlocked.length) {
        extra.appendChild(U.el('p', { class: 'quiz-line',
          text: '解放したスキル(' + res.unlocked.length + '): ' + skillNames(app, res.unlocked).join('、') }));
        const g = gainsText(app, res.gains);
        if (g) extra.appendChild(U.el('p', { class: 'quiz-line', text: g }));
      } else if (res.outcome.unlockIds.length) {
        extra.appendChild(U.el('p', { class: 'quiz-line', text: '正解したスキルは、すでに解放済みでした。' }));
      } else {
        extra.appendChild(U.el('p', { class: 'quiz-line', text: '今回は解放できるスキルがありませんでした。入口のスキルから解放テストで少しずつ進めましょう。' }));
      }
      if (res.mistakes) {
        extra.appendChild(U.el('p', { class: 'quiz-note', text: 'まちがえた ' + res.mistakes + ' 問を復習リストに入れました。' }));
      }

      extra.appendChild(commentBox(app, tree, res.record, claim, frontier));

      global.QuizUI.result(app, {
        title: title,
        kind: s.correct ? 'good' : 'warn',
        headline: s.valid + ' 問中 ' + s.correct + ' 問正解',
        extra: extra,
        score: s,
        actions: [{ label: 'とじる', kind: 'primary', onClick: function () { app.render(); } }],
      });
      if (res.unlocked.length) app.toast(res.unlocked.length + ' 個のスキルを解放!', 'good');
    }
  }

  /** 「AIの講評を見る」。押したときだけ呼び、結果は診断の記録に残す。 */
  function commentBox(app, tree, record, claim, frontier) {
    const box = U.el('div', { class: 'diag-comment' });
    const btn = U.el('button', { class: 'btn btn--block', text: 'AIの講評を見る' });
    const text = U.el('p', { class: 'quiz-line diag-comment__text' });
    box.appendChild(btn);

    btn.addEventListener('click', async function () {
      btn.disabled = true;
      btn.textContent = '講評を書いています…';
      try {
        const comment = await global.QuizGen.diagnosisComment(app, tree, {
          claimName: claim ? claim.name : '',
          frontierName: frontier ? frontier.name : '',
          memo: record.memo,
          results: record.results.map(function (r) {
            return { skill: skillNames(app, [r.skillId])[0], correct: r.correct };
          }),
        });
        record.comment = comment;
        app.save();
        btn.remove();
        text.textContent = comment;
        box.appendChild(text);
      } catch (e) {
        console.warn('講評を作れませんでした', e);
        btn.disabled = false;
        btn.textContent = '講評を作れませんでした。もう一度';
      }
    });
    return box;
  }

  global.Tests = { unlock: unlock, review: review, diagnose: diagnose };
})(typeof window !== 'undefined' ? window : globalThis);
