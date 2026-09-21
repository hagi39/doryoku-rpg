/* 学ぶ: 教材(解説と確認問題)/ 復習リスト
 * P5 で本実装。 */
(function (global) {
  'use strict';

  const U = global.U;

  function render(root, app) {
    root.appendChild(U.el('div', { class: 'notice' },
      '教材と復習リストは P5 で作ります。'));

    const pending = (app.progress.reviewList || []).filter(function (q) { return !q.cleared; });
    const card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card__head' }, [
      U.el('div', { class: 'card__title', text: '復習リスト' }),
      U.el('div', { class: 'card__note', text: pending.length + ' / ' + (app.progress.reviewList || []).length + ' 問' }),
    ]));
    card.appendChild(U.el('div', { class: 'empty', text: 'まだ問題がありません。AIテストでまちがえた問題がここに貯まります。' }));
    root.appendChild(card);
  }

  global.App.register('learn', { render: render });
})(typeof window !== 'undefined' ? window : globalThis);
