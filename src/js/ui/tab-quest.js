/* 冒険: 草原(スライム戦)/ 世界地図(国のクイズ)
 * P6 で本実装。いまは草原の入場条件だけ判定できる。 */
(function (global) {
  'use strict';

  const U = global.U;
  const R = global.Rules;

  function render(root, app) {
    root.appendChild(U.el('div', { class: 'notice' },
      '草原と世界地図は P6 で作ります。下は入場条件の判定だけ先に動かしています。'));

    const now = Date.now();
    const fresh = app.unlockedSkills().filter(function (s) {
      return app.rust(s.id, now) < R.C.GRASS_FRESH_RUST;
    }).length;
    const check = R.grassCheck({ stats: app.progress.stats, freshCount: fresh });

    const card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card__head' }, [
      U.el('div', { class: 'card__title', text: '草原' }),
      U.el('div', { class: 'card__note', text: check.ok ? '挑戦できる' : 'まだ早い' }),
    ]));

    if (check.ok) {
      card.appendChild(U.el('p', { text: 'スライムに挑戦できます。倒すとひよこが仲間になります。' }));
    } else {
      const list = U.el('ul');
      for (const m of check.missing) {
        const text = m.type === 'stat'
          ? (app.statById.get(m.stat) || { name: m.stat }).name + ' が ' + m.have + ' / ' + m.need
          : 'サビ50%未満のスキルが ' + m.have + ' / ' + m.need + ' 個';
        list.appendChild(U.el('li', { text: text }));
      }
      card.appendChild(U.el('p', { text: '足りないもの:' }));
      card.appendChild(list);
    }
    root.appendChild(card);
  }

  global.App.register('quest', { render: render });
})(typeof window !== 'undefined' ? window : globalThis);
