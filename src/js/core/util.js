/* 共通ユーティリティ。全モジュールから window.U で参照する。 */
(function (global) {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;

  /** 日付を YYYY-MM-DD 文字列に(端末のローカル時刻基準) */
  function dateKey(ts) {
    const d = ts == null ? new Date() : new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** YYYY-MM-DD 同士の日数差(a - b) */
  function dayDiff(aKey, bKey) {
    const a = new Date(`${aKey}T00:00:00`);
    const b = new Date(`${bKey}T00:00:00`);
    return Math.round((a - b) / DAY_MS);
  }

  /** ミリ秒差を「日」で返す(小数) */
  function daysSince(ts, now) {
    if (!ts) return Infinity;
    return ((now == null ? Date.now() : now) - ts) / DAY_MS;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function round1(v) {
    return Math.round(v * 10) / 10;
  }

  /** 安全なHTMLエスケープ */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 要素生成ヘルパ */
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'dataset') Object.assign(node.dataset, v);
        // textarea は value 属性を無視するので、プロパティに入れる
        else if (k === 'value') node.value = v;
        else if (k.startsWith('on') && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else node.setAttribute(k, v === true ? '' : v);
      }
    }
    if (children != null) {
      const arr = Array.isArray(children) ? children : [children];
      for (const c of arr) {
        if (c == null || c === false) continue;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
    }
    return node;
  }

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  /** 決定的でない乱数。テストから差し替えられるよう1箇所に集約する。 */
  let rng = Math.random;
  function random() { return rng(); }
  function setRandom(fn) { rng = fn || Math.random; }

  function deepClone(v) {
    return typeof structuredClone === 'function'
      ? structuredClone(v)
      : JSON.parse(JSON.stringify(v));
  }

  /** 配列を指定件数だけランダムに取り出す(非破壊) */
  function sample(arr, n) {
    const copy = arr.slice();
    const out = [];
    while (out.length < n && copy.length) {
      out.push(copy.splice(Math.floor(random() * copy.length), 1)[0]);
    }
    return out;
  }

  function byId(arr) {
    const map = new Map();
    for (const item of arr) map.set(item.id, item);
    return map;
  }

  global.U = {
    DAY_MS, dateKey, dayDiff, daysSince, clamp, round1,
    esc, el, qs, qsa, random, setRandom, deepClone, sample, byId,
  };
})(typeof window !== 'undefined' ? window : globalThis);
