/* ツリーの並べ方。親の位置の平均で子を並べ替えて、線の交差を減らす。 */
(function (global) {
  'use strict';

  const MAX_COLUMNS = 3;

  /**
   * ツリー1つぶんの段を、並び順を決めた状態で返す。
   * @returns {{rows: string[][], pos: Map<string, number>}} pos は 0〜1 の横位置
   */
  function treeLayout(data, treeId, levelsMap) {
    const levels = levelsMap || global.Validate.computeLevels(data);
    const raw = levels.get(treeId) || [];
    const byId = new Map(data.skills.map(function (s) { return [s.id, s]; }));

    const rows = [];
    const pos = new Map();

    for (let d = 0; d < raw.length; d++) {
      let items;
      if (d === 0) {
        items = raw[d].slice();
      } else {
        items = raw[d]
          .map(function (id) {
            const skill = byId.get(id);
            const xs = (skill.requires || [])
              .filter(function (r) {
                const parent = byId.get(r);
                return parent && parent.tree === treeId && pos.has(r);
              })
              .map(function (r) { return pos.get(r); });
            const bary = xs.length
              ? xs.reduce(function (a, b) { return a + b; }, 0) / xs.length
              : 0.5;
            return { id: id, bary: bary };
          })
          .sort(function (a, b) {
            return a.bary - b.bary || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
          })
          .map(function (o) { return o.id; });
      }

      rows.push(items);
      for (let i = 0; i < items.length; i++) {
        pos.set(items[i], items.length === 1 ? 0.5 : i / (items.length - 1));
      }
    }

    return { rows: rows, pos: pos };
  }

  /** 同じツリー内の前提だけを返す(他ツリーは◆表示に回す) */
  function sameTreeParents(data, skill) {
    const byId = new Map(data.skills.map(function (s) { return [s.id, s]; }));
    return (skill.requires || []).filter(function (r) {
      const p = byId.get(r);
      return p && p.tree === skill.tree;
    });
  }

  function crossTreeParents(data, skill) {
    const byId = new Map(data.skills.map(function (s) { return [s.id, s]; }));
    return (skill.requires || []).filter(function (r) {
      const p = byId.get(r);
      return p && p.tree !== skill.tree;
    });
  }

  global.Layout = { treeLayout, sameTreeParents, crossTreeParents, MAX_COLUMNS };
})(typeof window !== 'undefined' ? window : globalThis);
