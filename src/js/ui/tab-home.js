/* ホーム: レベル・経験値・連続日数・パラメーター・今日のクエスト */
(function (global) {
  'use strict';

  const U = global.U;
  const R = global.Rules;

  function render(root, app) {
    const now = Date.now();
    root.appendChild(statusCard(app));
    root.appendChild(paramCard(app));
    root.appendChild(questCard(app, now));
  }

  function statusCard(app) {
    const p = R.levelProgress(app.progress.totalXp);
    const streak = app.progress.streak || { count: 0 };
    const card = U.el('div', { class: 'card' });

    card.appendChild(U.el('div', { class: 'card__head' }, [
      U.el('div', { class: 'card__title', text: 'レベル ' + p.level }),
      U.el('div', { class: 'card__note', text: '通算 ' + Math.round(app.progress.totalXp) + ' xp' }),
    ]));

    const meter = U.el('div', { class: 'meter' }, [
      U.el('div', { class: 'meter__fill', style: 'width:' + Math.round(p.ratio * 100) + '%' }),
    ]);
    card.appendChild(meter);
    card.appendChild(U.el('div', {
      class: 'card__note',
      style: 'margin-top:6px',
      text: '次のレベルまで ' + Math.max(0, Math.ceil(p.need - p.cur)) + ' xp',
    }));

    const unlocked = app.unlockedSkills().length;
    card.appendChild(U.el('div', { class: 'chip-row', style: 'margin-top:10px' }, [
      U.el('span', { class: 'chip', text: '連続 ' + (streak.count || 0) + ' 日' }),
      U.el('span', { class: 'chip', text: '解放 ' + unlocked + ' / ' + app.treeData.skills.length }),
      app.hasChick() ? U.el('span', { class: 'chip chip--on', text: '🐤 ひよこ' }) : null,
    ]));

    return card;
  }

  function paramCard(app) {
    const card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card__head' }, [
      U.el('div', { class: 'card__title', text: 'パラメーター' }),
    ]));

    const max = Math.max(10, ...app.treeData.stats.map(function (s) {
      return app.progress.stats[s.id] || 0;
    }));

    for (const stat of app.treeData.stats) {
      const val = app.progress.stats[stat.id] || 0;
      card.appendChild(U.el('div', { class: 'stat-row' }, [
        U.el('span', { text: stat.name }),
        U.el('div', { class: 'meter meter--' + stat.id }, [
          U.el('div', {
            class: 'meter__fill',
            style: 'width:' + Math.round(U.clamp(val / max, 0, 1) * 100) + '%',
          }),
        ]),
        U.el('span', { class: 'stat-row__val', text: U.round1(val).toFixed(1) }),
      ]));
    }
    return card;
  }

  function questCard(app, now) {
    const card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card__head' }, [
      U.el('div', { class: 'card__title', text: '今日のクエスト' }),
    ]));

    const quests = buildQuests(app, now);
    if (!quests.length) {
      card.appendChild(U.el('div', { class: 'empty', text: 'いまは急ぎの用はありません。記録タブから今日の努力を残そう。' }));
      return card;
    }

    const list = U.el('div', { class: 'list' });
    for (const q of quests) {
      list.appendChild(U.el('button', {
        class: 'list-item',
        onclick: function () { app.go(q.tab); },
      }, [
        U.el('span', { class: 'badge badge--' + q.badgeKind, text: q.badge }),
        U.el('span', { class: 'list-item__main' }, [
          U.el('div', { class: 'list-item__name', text: q.title }),
          U.el('div', { class: 'list-item__sub', text: q.sub }),
        ]),
        U.el('span', { class: 'list-item__side', text: '›' }),
      ]));
    }
    card.appendChild(list);
    return card;
  }

  /** 診断・復習待ち・サビ・解放できるスキル の4種を並べる */
  function buildQuests(app, now) {
    const out = [];

    // 1. まだ一度も診断していないツリー
    const untested = app.treeData.trees.filter(function (tree) {
      if (!isTestTree(app, tree)) return false;
      if ((app.progress.diagnoses || {})[tree.id]) return false;
      return !app.treeData.skills.some(function (s) {
        return s.tree === tree.id && app.isUnlocked(s.id);
      });
    });
    if (untested.length) {
      out.push({
        tab: 'tree',
        badge: '診断',
        badgeKind: 'warn',
        title: untested.map(function (t) { return t.name; }).slice(0, 3).join('・') +
               (untested.length > 3 ? ' ほか' : ''),
        sub: 'まだ診断していないツリーがあります',
      });
    }

    // 2. 復習リストに溜まった問題
    const pending = (app.progress.reviewList || []).filter(function (q) { return !q.cleared; });
    if (pending.length) {
      out.push({
        tab: 'learn',
        badge: '復習',
        badgeKind: 'warn',
        title: '復習リストに ' + pending.length + ' 問',
        sub: '最大10問ずつ、1問正解で ' + R.C.REVIEW_XP + ' xp',
      });
    }

    // 3. サビの進んだスキル
    const rusty = app.unlockedSkills()
      .map(function (s) { return { skill: s, rust: app.rust(s.id, now) }; })
      .filter(function (r) { return r.rust >= R.C.RUST_BONUS_LINE; })
      .sort(function (a, b) { return b.rust - a.rust; });
    if (rusty.length) {
      out.push({
        tab: 'log',
        badge: '補習',
        badgeKind: 'bad',
        title: rusty[0].skill.name + (rusty.length > 1 ? ' ほか' + (rusty.length - 1) + '件' : ''),
        sub: 'サビ ' + Math.round(rusty[0].rust * 100) + '% — いま磨くと経験値 ×' + R.C.RUST_BONUS_MULT,
      });
    }

    // 4. 解放できるスキル
    const ready = app.unlockableSkills();
    if (ready.length) {
      out.push({
        tab: 'tree',
        badge: '解放',
        badgeKind: 'ok',
        title: ready[0].name + (ready.length > 1 ? ' ほか' + (ready.length - 1) + '件' : ''),
        sub: '前提を満たしています',
      });
    }

    return out;
  }

  function isTestTree(app, tree) {
    const cat = app.treeData.categories.find(function (c) { return c.id === tree.category; });
    return !!(cat && cat.test);
  }

  global.App.register('home', { render: render });
})(typeof window !== 'undefined' ? window : globalThis);
