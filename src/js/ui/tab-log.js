/* 記録: スキル・種類・使ったスキルを選んで記録する */
(function (global) {
  'use strict';

  const U = global.U;
  const R = global.Rules;

  // 画面を作り直しても選択が消えないように、タブの中に覚えておく
  const draft = { treeId: '', skillId: '', kindId: '', usesIds: [], note: '' };

  function render(root, app) {
    const now = Date.now();
    const unlocked = app.unlockedSkills();

    // ツリータブの「これを記録する」から来たときは、そのスキルを選んでおく
    if (app.pendingLogSkill) {
      const target = app.skill(app.pendingLogSkill);
      if (target && app.isUnlocked(target.id)) {
        draft.treeId = target.tree;
        draft.skillId = target.id;
        draft.usesIds = [];
      }
      app.pendingLogSkill = null;
    }

    if (!unlocked.length) {
      root.appendChild(emptyGuide(app));
      root.appendChild(historyCard(app));
      return;
    }

    root.appendChild(formCard(app, unlocked, now));
    root.appendChild(historyCard(app));
  }

  function emptyGuide(app) {
    const card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card__head' }, [
      U.el('div', { class: 'card__title', text: 'まだ記録できるスキルがありません' }),
    ]));
    card.appendChild(U.el('p', { text: 'ツリータブでスキルを解放すると、ここから記録できるようになります。' }));
    const btn = U.el('button', { class: 'btn btn--primary btn--block', text: 'ツリーを見る' });
    btn.addEventListener('click', function () { app.go('tree'); });
    card.appendChild(btn);
    return card;
  }

  // ---------------- 入力フォーム ----------------

  function formCard(app, unlocked, now) {
    const card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card__head' }, [
      U.el('div', { class: 'card__title', text: '今日やったこと' }),
    ]));

    // 使えるツリーだけを出す
    const treeIds = new Set(unlocked.map(function (s) { return s.tree; }));
    const trees = app.treeData.trees.filter(function (t) { return treeIds.has(t.id); });

    if (!draft.treeId || !treeIds.has(draft.treeId)) draft.treeId = trees[0].id;

    const treeSelect = U.el('select', { class: 'select' });
    for (const t of trees) {
      treeSelect.appendChild(U.el('option', {
        value: t.id, text: t.name, selected: t.id === draft.treeId,
      }));
    }
    card.appendChild(U.el('label', { class: 'field' }, [
      U.el('span', { class: 'field__label', text: 'ツリー' }),
      treeSelect,
    ]));

    const skillSelect = U.el('select', { class: 'select' });
    const skillField = U.el('label', { class: 'field' }, [
      U.el('span', { class: 'field__label', text: 'スキル' }),
      skillSelect,
      U.el('span', { class: 'field__hint', id: 'skill-hint' }),
    ]);
    card.appendChild(skillField);

    // 種類
    const kindRow = U.el('div', { class: 'chip-row' });
    card.appendChild(U.el('div', { class: 'field' }, [
      U.el('span', { class: 'field__label', text: '内容の種類' }),
      kindRow,
    ]));

    // 使ったスキル
    const usesRow = U.el('div', { class: 'chip-row' });
    const usesField = U.el('div', { class: 'field' }, [
      U.el('span', { class: 'field__label', text: '使ったスキル(任意)' }),
      usesRow,
      U.el('span', { class: 'field__hint', text: '選んだスキルとその前提は、サビが7割ぶん落ちます' }),
    ]);
    card.appendChild(usesField);

    const noteInput = U.el('input', {
      class: 'input', type: 'text', maxlength: '200',
      placeholder: '解いた範囲やセット数など', value: draft.note,
    });
    noteInput.addEventListener('input', function () { draft.note = noteInput.value; });
    card.appendChild(U.el('label', { class: 'field' }, [
      U.el('span', { class: 'field__label', text: 'メモ(任意)' }),
      noteInput,
    ]));

    const preview = U.el('div', { class: 'notice', style: 'margin-bottom:10px' });
    card.appendChild(preview);

    const submit = U.el('button', { class: 'btn btn--primary btn--block', text: '記録する' });
    card.appendChild(submit);

    // ---- 描き直し ----

    function skillsOfTree() {
      return unlocked.filter(function (s) { return s.tree === draft.treeId; });
    }

    function fillSkills() {
      const list = skillsOfTree();
      if (!list.some(function (s) { return s.id === draft.skillId; })) {
        draft.skillId = list.length ? list[0].id : '';
        draft.usesIds = [];
      }
      skillSelect.innerHTML = '';
      for (const s of list) {
        const rust = app.rust(s.id, now);
        const mark = rust >= R.C.RUST_BONUS_LINE ? '  ⚠ サビ' + Math.round(rust * 100) + '%' : '';
        skillSelect.appendChild(U.el('option', {
          value: s.id, text: s.name + mark, selected: s.id === draft.skillId,
        }));
      }
    }

    function fillKinds() {
      if (!app.kindById.has(draft.kindId)) draft.kindId = app.treeData.kinds[0].id;
      kindRow.innerHTML = '';
      for (const kind of app.treeData.kinds) {
        const on = kind.id === draft.kindId;
        const chip = U.el('button', {
          class: 'chip' + (on ? ' chip--on' : ''),
          text: kind.name + ' ×' + kind.weight,
        });
        chip.addEventListener('click', function () {
          draft.kindId = kind.id;
          fillKinds();
          fillPreview();
        });
        kindRow.appendChild(chip);
      }
    }

    function usesCandidates() {
      const skill = app.skill(draft.skillId);
      if (!skill) return [];
      const ids = new Set([].concat(skill.uses || [], skill.requires || []));
      return Array.from(ids)
        .filter(function (id) { return id !== skill.id && app.isUnlocked(id); })
        .map(function (id) { return app.skill(id); })
        .filter(Boolean);
    }

    function fillUses() {
      const cands = usesCandidates();
      draft.usesIds = draft.usesIds.filter(function (id) {
        return cands.some(function (c) { return c.id === id; });
      });
      usesRow.innerHTML = '';
      if (!cands.length) {
        usesField.hidden = true;
        return;
      }
      usesField.hidden = false;
      for (const s of cands) {
        const on = draft.usesIds.indexOf(s.id) >= 0;
        const rust = app.rust(s.id, now);
        const chip = U.el('button', {
          class: 'chip' + (on ? ' chip--on' : ''),
          text: s.name + (rust > 0 ? ' ' + Math.round(rust * 100) + '%' : ''),
        });
        chip.addEventListener('click', function () {
          const i = draft.usesIds.indexOf(s.id);
          if (i >= 0) draft.usesIds.splice(i, 1);
          else draft.usesIds.push(s.id);
          fillUses();
        });
        usesRow.appendChild(chip);
      }
    }

    function fillPreview() {
      const skill = app.skill(draft.skillId);
      const kind = app.kindById.get(draft.kindId);
      if (!skill || !kind) { preview.textContent = ''; return; }
      const rust = app.rust(skill.id, now);
      const res = R.logXp({
        baseXp: skill.xp, kindWeight: kind.weight, rust: rust, hasChick: app.hasChick(),
      });
      const parts = ['基本 ' + skill.xp, '種類 ×' + kind.weight];
      for (const d of res.detail) parts.push(d.label + ' ×' + d.mult);
      preview.textContent = 'もらえる経験値 ' + res.xp + ' xp(' + parts.join(' / ') + ')';

      const hint = U.qs('#skill-hint');
      if (hint) {
        hint.textContent = rust > 0
          ? 'いまのサビ ' + Math.round(rust * 100) + '%'
          : 'サビはありません';
      }
    }

    treeSelect.addEventListener('change', function () {
      draft.treeId = treeSelect.value;
      fillSkills(); fillUses(); fillPreview();
    });
    skillSelect.addEventListener('change', function () {
      draft.skillId = skillSelect.value;
      fillUses(); fillPreview();
    });

    submit.addEventListener('click', function () {
      if (!draft.skillId) { app.toast('スキルを選んでください', 'bad'); return; }
      let res;
      try {
        res = global.Actions.recordLog(app, {
          skillId: draft.skillId,
          kindId: draft.kindId,
          usesIds: draft.usesIds,
          note: draft.note,
        });
      } catch (e) {
        app.toast(e.message, 'bad');
        return;
      }
      draft.note = '';
      draft.usesIds = [];
      showResult(app, res);
    });

    fillSkills();
    fillKinds();
    fillUses();
    fillPreview();
    return card;
  }

  // ---------------- 記録結果 ----------------

  function showResult(app, res) {
    const body = U.el('div');

    body.appendChild(U.el('div', {
      style: 'font-size:22px;text-align:center;margin:4px 0 10px',
      text: '+' + res.xp + ' xp' + (res.crit ? '  会心!' : ''),
    }));

    const chips = U.el('div', { class: 'chip-row', style: 'justify-content:center' });
    for (const stat of Object.keys(res.gains)) {
      const g = res.gains[stat];
      if (!g) continue;
      const meta = app.statById.get(stat);
      chips.appendChild(U.el('span', {
        class: 'chip chip--' + stat,
        text: (meta ? meta.name : stat) + ' +' + U.round1(g),
      }));
    }
    body.appendChild(chips);

    const lines = [];
    if (res.leveledUp) lines.push('レベルが ' + res.level + ' に上がった!');
    if (res.streakChanged) lines.push('連続 ' + res.streakCount + ' 日');
    if (res.recovered.length) {
      lines.push('サビが落ちたスキル: ' + res.recovered.map(function (r) {
        const s = app.skill(r.id);
        return (s ? s.name : r.id) + '(' + Math.round(r.before * 100) + '→' + Math.round(r.after * 100) + '%)';
      }).join('、'));
    }
    for (const bonus of res.bonusDetail) {
      lines.push(bonus.label + ' ×' + bonus.mult);
    }
    if (lines.length) {
      const ul = U.el('ul', { style: 'margin-top:12px' });
      for (const line of lines) ul.appendChild(U.el('li', { text: line }));
      body.appendChild(ul);
    }

    app.modal({
      title: '記録しました',
      body: body,
      actions: [{
        label: 'とじる',
        kind: 'primary',
        onClick: function () { app.render(); },
      }],
    });
  }

  // ---------------- 履歴 ----------------

  function historyCard(app) {
    const card = U.el('div', { class: 'card' });
    const logs = app.progress.logs || [];
    card.appendChild(U.el('div', { class: 'card__head' }, [
      U.el('div', { class: 'card__title', text: 'これまでの記録' }),
      U.el('div', { class: 'card__note', text: logs.length + ' 件' }),
    ]));

    if (!logs.length) {
      card.appendChild(U.el('div', { class: 'empty', text: 'まだ記録がありません。' }));
      return card;
    }

    const list = U.el('div', { class: 'list' });
    for (const log of logs.slice(0, 20)) {
      const skill = app.skill(log.skillId);
      const kind = app.kindById.get(log.kindId);
      const sub = [log.date, kind ? kind.name : log.kindId];
      if (log.note) sub.push(log.note);
      list.appendChild(U.el('div', { class: 'list-item' }, [
        U.el('span', { class: 'list-item__main' }, [
          U.el('div', { class: 'list-item__name', text: (skill ? skill.name : log.skillId) + (log.crit ? ' ★' : '') }),
          U.el('div', { class: 'list-item__sub', text: sub.join(' / ') }),
        ]),
        U.el('span', { class: 'list-item__side', text: '+' + log.xp }),
      ]));
    }
    card.appendChild(list);
    return card;
  }

  global.App.register('log', { render: render });
})(typeof window !== 'undefined' ? window : globalThis);
