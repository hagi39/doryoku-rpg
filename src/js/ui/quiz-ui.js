/* テストの画面部品。1問ずつ出して答えを集め、結果を一覧にする。
 * 採点や保存はしない(呼び出し側が Actions で行う)。 */
(function (global) {
  'use strict';

  const U = global.U;

  /** 「作っています…」の画面。onCancel を渡すと「やめる」が出る。 */
  function loading(app, opts) {
    app.modal({
      title: opts.title,
      dismissable: false,
      body: U.el('div', { class: 'quiz-loading' }, [
        U.el('div', { class: 'quiz-loading__dots', 'aria-hidden': 'true', text: '・・・' }),
        U.el('p', { text: opts.message || 'AIが問題を作っています…' }),
        U.el('p', { class: 'quiz-note', text: '10〜30秒ほどかかります' }),
      ]),
      actions: opts.onCancel ? [{ label: 'やめる', kind: 'ghost', onClick: opts.onCancel }] : [],
    });
  }

  /**
   * 問題を1問ずつ出す。
   * @param {{title:string, questions:Array, skillName?:function(q):string, onDone:function(items), onQuit?:function}} opts
   */
  function run(app, opts) {
    const items = opts.questions.map(function (q) { return { q: q, given: null, flagged: false }; });
    let idx = 0;

    function answered(it) {
      if (it.flagged) return true;
      if (it.q.type === 'choice') return it.given != null;
      return typeof it.given === 'string' && it.given.trim() !== '';
    }

    function show() {
      const it = items[idx];
      const q = it.q;
      const last = idx === items.length - 1;
      const body = U.el('div', { class: 'quiz' + (it.flagged ? ' quiz--flagged' : '') });

      body.appendChild(U.el('div', { class: 'quiz-head' }, [
        U.el('span', { text: '問 ' + (idx + 1) + ' / ' + items.length }),
        U.el('span', { class: 'quiz-note', text: (q.type === 'choice' ? '選択' : '記述') +
          (opts.skillName ? ' ・ ' + opts.skillName(q) : '') }),
      ]));
      body.appendChild(U.el('div', { class: 'quiz-q', text: q.question }));

      const next = U.el('button', {
        class: 'btn btn--primary',
        text: last ? '採点する' : '次へ',
        disabled: !answered(it),
      });
      const refresh = function () { next.disabled = !answered(it); };

      if (q.type === 'choice') {
        const list = U.el('div', { class: 'quiz-choices' });
        q.choices.forEach(function (c, i) {
          const btn = U.el('button', {
            class: 'quiz-choice',
            'aria-pressed': String(it.given === i),
            disabled: it.flagged,
          }, [U.el('span', { class: 'quiz-choice__no', text: String(i + 1) }), U.el('span', { text: c })]);
          btn.addEventListener('click', function () {
            it.given = i;
            U.qsa('.quiz-choice', list).forEach(function (b, j) { b.setAttribute('aria-pressed', String(j === i)); });
            refresh();
          });
          list.appendChild(btn);
        });
        body.appendChild(list);
      } else {
        const input = U.el('input', {
          class: 'input',
          type: 'text',
          autocomplete: 'off',
          autocapitalize: 'off',
          spellcheck: 'false',
          placeholder: '答え',
          value: it.given || '',
          disabled: it.flagged,
        });
        input.addEventListener('input', function () { it.given = input.value; refresh(); });
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && !e.isComposing && answered(it)) next.click();
        });
        body.appendChild(input);
        body.appendChild(U.el('div', { class: 'quiz-note', style: 'margin-top:4px',
          text: '全角・半角はどちらでも。分数は 1/2、小数は 0.5 のように書けます' }));
        if (!it.flagged) setTimeout(function () { input.focus(); }, 0);
      }

      const flag = U.el('button', {
        class: 'btn btn--sm btn--ghost quiz-flag',
        text: it.flagged ? '外すのをやめる' : 'この問題がおかしい',
      });
      flag.addEventListener('click', function () { it.flagged = !it.flagged; show(); });
      body.appendChild(U.el('div', { class: 'quiz-flag-row' }, [
        flag,
        it.flagged ? U.el('span', { class: 'quiz-note', text: 'この問題は採点せず、保存もしません' }) : null,
      ]));

      const quit = U.el('button', { class: 'btn btn--ghost', text: 'やめる' });
      // 押しまちがい防止: 1回目で確認の表示に変え、2回目でやめる
      quit.addEventListener('click', function () {
        if (quit.dataset.armed) {
          app.closeModal();
          if (opts.onQuit) opts.onQuit();
          return;
        }
        quit.dataset.armed = '1';
        quit.textContent = '本当にやめる?';
        quit.classList.add('btn--danger');
      });

      const prev = idx > 0 ? U.el('button', { class: 'btn', text: '戻る' }) : null;
      if (prev) prev.addEventListener('click', function () { idx--; show(); });

      next.addEventListener('click', function () {
        if (!answered(it)) return;
        if (last) opts.onDone(items);
        else { idx++; show(); }
      });

      body.appendChild(U.el('div', { class: 'modal__actions' }, [quit, prev, next]));
      app.modal({ title: opts.title, body: body, dismissable: false });
    }

    show();
  }

  function givenText(r) {
    if (r.given == null || r.given === '') return '(無回答)';
    if (r.q.type === 'choice') return r.q.choices[r.given] != null ? r.q.choices[r.given] : '(無回答)';
    return String(r.given);
  }

  function answerText(q) {
    return q.type === 'choice' ? q.choices[q.answer] : q.answer;
  }

  /** 採点結果の一覧 */
  function resultList(score) {
    const list = U.el('div', { class: 'quiz-results' });
    score.results.forEach(function (r, i) {
      const mark = r.flagged ? '−' : r.correct ? '○' : '×';
      const kind = r.flagged ? 'skip' : r.correct ? 'ok' : 'ng';
      const item = U.el('div', { class: 'quiz-result quiz-result--' + kind }, [
        U.el('div', { class: 'quiz-result__head' }, [
          U.el('span', { class: 'quiz-result__mark', text: mark }),
          U.el('span', { text: '問' + (i + 1) + (r.flagged ? '(外した問題)' : '') }),
        ]),
        U.el('div', { class: 'quiz-result__q', text: r.q.question }),
        r.flagged ? null : U.el('div', { class: 'quiz-result__row', text: 'あなた: ' + givenText(r) }),
        U.el('div', { class: 'quiz-result__row', text: '正解: ' + answerText(r.q) }),
        r.q.explanation ? U.el('div', { class: 'quiz-result__exp', text: r.q.explanation }) : null,
      ]);
      list.appendChild(item);
    });
    return list;
  }

  /**
   * 結果画面。
   * @param {{title:string, headline:string, kind:'good'|'bad'|'warn', lines?:string[], score?:object, extra?:Node, actions:Array}} opts
   */
  function result(app, opts) {
    const body = U.el('div', { class: 'quiz' });
    body.appendChild(U.el('div', { class: 'quiz-verdict quiz-verdict--' + opts.kind, text: opts.headline }));
    for (const line of opts.lines || []) body.appendChild(U.el('p', { class: 'quiz-line', text: line }));
    if (opts.extra) body.appendChild(opts.extra);
    if (opts.score) body.appendChild(resultList(opts.score));
    app.modal({ title: opts.title, body: body, actions: opts.actions, dismissable: false });
  }

  /** AIが使えなかったときの画面。自己申告の動線をここで必ず出す。 */
  function aiError(app, opts) {
    const err = opts.error || {};
    const body = U.el('div', { class: 'quiz' }, [
      U.el('div', { class: 'notice notice--bad', text: err.message || String(err) }),
      U.el('p', { class: 'quiz-line', text: opts.fallbackText ||
        'AIが使えないときは、自分でできると思ったら自己申告で進められます。' }),
    ]);
    app.modal({ title: opts.title, body: body, actions: opts.actions, dismissable: false });
  }

  global.QuizUI = { loading, run, result, resultList, aiError };
})(typeof window !== 'undefined' ? window : globalThis);
