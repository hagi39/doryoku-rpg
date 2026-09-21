/* ツリーデータの検証。設定タブのJSON編集と起動時の両方から使う。 */
(function (global) {
  'use strict';

  const MAX_COLUMNS = 3;

  /**
   * @returns {{errors: string[], warnings: string[]}}
   */
  function validate(data) {
    const errors = [];
    const warnings = [];

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { errors: ['データがオブジェクトではありません'], warnings: [] };
    }

    for (const key of ['stats', 'kinds', 'categories', 'trees', 'skills']) {
      if (!Array.isArray(data[key])) errors.push(`"${key}" が配列ではありません`);
    }
    if (errors.length) return { errors, warnings };

    if (typeof data.ver !== 'number' || !Number.isFinite(data.ver)) {
      errors.push('"ver" は数値で指定してください');
    }

    // --- id の重複 ---
    const statIds = collectIds(data.stats, 'stats', errors);
    const kindIds = collectIds(data.kinds, 'kinds', errors);
    const catIds = collectIds(data.categories, 'categories', errors);
    const treeIds = collectIds(data.trees, 'trees', errors);
    const skillIds = collectIds(data.skills, 'skills', errors);

    // --- kinds ---
    for (const kind of data.kinds) {
      if (typeof kind.weight !== 'number' || !Number.isFinite(kind.weight) || kind.weight < 0) {
        errors.push(`kinds「${kind.id}」の weight が不正です`);
      }
    }

    // --- trees ---
    for (const tree of data.trees) {
      if (!catIds.has(tree.category)) {
        errors.push(`trees「${tree.id}」の category「${tree.category}」が存在しません`);
      }
      const w = tree.weights;
      if (!w || typeof w !== 'object') {
        errors.push(`trees「${tree.id}」に weights がありません`);
      } else {
        for (const k of Object.keys(w)) {
          if (!statIds.has(k)) errors.push(`trees「${tree.id}」の weights に未知のパラメーター「${k}」があります`);
          if (typeof w[k] !== 'number') errors.push(`trees「${tree.id}」の weights.${k} が数値ではありません`);
        }
      }
    }

    // --- skills ---
    for (const skill of data.skills) {
      const label = `skills「${skill.id}」`;
      if (!treeIds.has(skill.tree)) {
        errors.push(`${label} の tree「${skill.tree}」が存在しません`);
      }
      if (!skill.name) errors.push(`${label} に name がありません`);
      if (typeof skill.xp !== 'number' || !(skill.xp > 0)) {
        errors.push(`${label} の xp が正の数ではありません`);
      }
      for (const ref of asArray(skill.requires)) {
        if (ref === skill.id) errors.push(`${label} が自分自身を前提にしています`);
        else if (!skillIds.has(ref)) errors.push(`${label} の requires「${ref}」が存在しません`);
      }
      for (const ref of asArray(skill.uses)) {
        if (!skillIds.has(ref)) errors.push(`${label} の uses「${ref}」が存在しません`);
      }
      for (const k of Object.keys(skill.reward || {})) {
        if (!statIds.has(k)) errors.push(`${label} の reward に未知のパラメーター「${k}」があります`);
      }
    }

    // --- 前提の循環 ---
    for (const cycle of findCycles(data.skills)) {
      errors.push(`前提が循環しています: ${cycle.join(' → ')}`);
    }

    // --- 表示列数 ---
    if (!errors.length) {
      const levels = computeLevels(data);
      for (const tree of data.trees) {
        const rows = levels.get(tree.id);
        if (!rows) continue;
        for (let i = 0; i < rows.length; i++) {
          if (rows[i].length > MAX_COLUMNS) {
            warnings.push(
              `ツリー「${tree.name}」の第${i + 1}段に${rows[i].length}個あります(${MAX_COLUMNS}列を超えるぶんは折り返して表示します)`
            );
          }
        }
      }
      const counts = {};
      for (const skill of data.skills) counts[skill.tree] = (counts[skill.tree] || 0) + 1;
      for (const tree of data.trees) {
        if (!counts[tree.id]) warnings.push(`ツリー「${tree.name}」にスキルが1つもありません`);
      }
    }

    return { errors, warnings };
  }

  function asArray(v) {
    return Array.isArray(v) ? v : [];
  }

  function collectIds(list, label, errors) {
    const seen = new Set();
    for (const item of list) {
      if (!item || typeof item !== 'object') {
        errors.push(`${label} に不正な要素があります`);
        continue;
      }
      if (!item.id) {
        errors.push(`${label} に id のない要素があります`);
        continue;
      }
      if (seen.has(item.id)) errors.push(`${label} の id「${item.id}」が重複しています`);
      seen.add(item.id);
    }
    return seen;
  }

  /** requires の有向グラフから循環を検出する(検出した循環ごとに経路を返す) */
  function findCycles(skills) {
    const map = new Map();
    for (const s of skills) map.set(s.id, asArray(s.requires));

    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map();
    const found = [];
    const stack = [];

    function visit(id) {
      const state = color.get(id) || WHITE;
      if (state === BLACK) return;
      if (state === GRAY) {
        const from = stack.indexOf(id);
        if (from >= 0) found.push(stack.slice(from).concat(id));
        return;
      }
      color.set(id, GRAY);
      stack.push(id);
      for (const next of map.get(id) || []) {
        if (map.has(next)) visit(next);
      }
      stack.pop();
      color.set(id, BLACK);
    }

    for (const id of map.keys()) visit(id);
    return found;
  }

  /**
   * ツリーごとに「段(depth)」を計算する。
   * 同じツリー内の requires だけを深さに数え、他ツリーの前提は◆表示に回す。
   * @returns {Map<string, string[][]>} treeId → 段ごとの skillId 配列
   */
  function computeLevels(data) {
    const byId = new Map();
    for (const s of data.skills) byId.set(s.id, s);

    const depth = new Map();
    const visiting = new Set();

    function depthOf(id) {
      if (depth.has(id)) return depth.get(id);
      if (visiting.has(id)) return 0; // 循環時の保険
      visiting.add(id);
      const skill = byId.get(id);
      let d = 0;
      for (const ref of asArray(skill && skill.requires)) {
        const parent = byId.get(ref);
        if (parent && parent.tree === skill.tree) {
          d = Math.max(d, depthOf(ref) + 1);
        }
      }
      visiting.delete(id);
      depth.set(id, d);
      return d;
    }

    const result = new Map();
    for (const tree of data.trees) result.set(tree.id, []);

    for (const skill of data.skills) {
      const rows = result.get(skill.tree);
      if (!rows) continue;
      const d = depthOf(skill.id);
      while (rows.length <= d) rows.push([]);
      rows[d].push(skill.id);
    }

    return result;
  }

  global.Validate = { validate, computeLevels, MAX_COLUMNS };
})(typeof window !== 'undefined' ? window : globalThis);
