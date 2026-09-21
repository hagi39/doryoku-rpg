/* 起動口 */
(function (global) {
  'use strict';

  function start() {
    try {
      global.App.boot();
    } catch (e) {
      console.error(e);
      const msg = document.getElementById('boot-msg');
      if (msg) msg.textContent = '起動できませんでした:\n' + e.message;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(typeof window !== 'undefined' ? window : globalThis);
