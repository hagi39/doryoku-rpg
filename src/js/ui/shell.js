/* 画面の土台。タブ切替・共有状態・トースト・モーダルをまとめる。 */
(function (global) {
  'use strict';

  const U = global.U;

  const TAB_TITLES = {
    home: 'ホーム', tree: 'ツリー', learn: '学ぶ',
    log: '記録', quest: '冒険', settings: '設定',
  };

  const App = {
    treeData: null,
    progress: null,
    settings: null,
    tab: 'home',
    tabs: {},           // name → {render(container)}
    skillById: new Map(),
    treeById: new Map(),
    kindById: new Map(),
    statById: new Map(),

    // ---------------- 起動 ----------------

    boot: function () {
      const loaded = global.Store.loadTreeData();
      this.treeData = loaded.data;
      this.progress = global.Store.loadProgress(this.treeData);
      this.settings = global.Store.loadSettings();
      this.reindex();
      this.applyTheme();

      if (loaded.replaced) {
        this.toast(
          loaded.invalid
            ? 'ツリーデータが読めなかったので初期データに戻しました'
            : 'ツリーが新しい内容に更新されました(進捗はそのままです)'
        );
      }
      if (!global.Store.isStorageOk()) {
        this.toast('このブラウザでは保存ができません。設定タブからバックアップを取ってください', 'bad');
      }

      this.bindTabs();
      this.go(this.tab);

      U.qs('#boot').hidden = true;
      U.qs('#app').hidden = false;
    },

    reindex: function () {
      this.skillById = U.byId(this.treeData.skills);
      this.treeById = U.byId(this.treeData.trees);
      this.kindById = U.byId(this.treeData.kinds);
      this.statById = U.byId(this.treeData.stats);
      this.levels = global.Validate.computeLevels(this.treeData);
    },

    // ---------------- 保存 ----------------

    save: function () {
      const ok = global.Store.saveProgress(this.progress);
      if (!ok) this.toast('保存できませんでした。容量がいっぱいかもしれません', 'bad');
      return ok;
    },

    saveSettings: function () {
      global.Store.saveSettings(this.settings);
      this.applyTheme();
    },

    applyTheme: function () {
      const theme = (this.settings && this.settings.theme) || 'auto';
      const root = document.documentElement;
      if (theme === 'auto') root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', theme);
    },

    // ---------------- タブ ----------------

    register: function (name, tab) {
      this.tabs[name] = tab;
    },

    bindTabs: function () {
      const self = this;
      U.qsa('#tabbar .tabbar__btn').forEach(function (btn) {
        btn.addEventListener('click', function () { self.go(btn.dataset.tab); });
      });
    },

    go: function (name) {
      if (!this.tabs[name]) name = 'home';
      this.tab = name;
      U.qsa('#tabbar .tabbar__btn').forEach(function (btn) {
        btn.setAttribute('aria-selected', String(btn.dataset.tab === name));
      });
      U.qs('#topbar-title').textContent = TAB_TITLES[name] || '努力RPG';
      this.render();
    },

    render: function () {
      const screen = U.qs('#screen');
      screen.innerHTML = '';
      const tab = this.tabs[this.tab];
      if (!tab) return;
      try {
        tab.render(screen, this);
      } catch (e) {
        console.error(e);
        screen.appendChild(U.el('div', { class: 'notice notice--bad' },
          '画面の表示でエラーが出ました: ' + e.message));
      }
      screen.scrollTop = 0;
      this.renderTopRight();
    },

    renderTopRight: function () {
      const host = U.qs('#topbar-right');
      host.innerHTML = '';
      const p = global.Rules.levelProgress(this.progress.totalXp);
      host.appendChild(U.el('span', { text: 'Lv.' + p.level }));
      if (this.progress.companions && this.progress.companions.chick) {
        host.appendChild(U.el('span', { title: 'ひよこが仲間にいる', text: '🐤' }));
      }
    },

    // ---------------- 便利メソッド ----------------

    skill: function (id) { return this.skillById.get(id); },
    tree: function (id) { return this.treeById.get(id); },

    prog: function (skillId) {
      let p = this.progress.skills[skillId];
      if (!p) {
        p = { unlocked: false, unlockedAt: 0, polishCount: 0, polishedAt: 0 };
        this.progress.skills[skillId] = p;
      }
      return p;
    },

    hasChick: function () {
      return !!(this.progress.companions && this.progress.companions.chick);
    },

    rust: function (skillId, now) {
      const p = this.progress.skills[skillId];
      if (!p || !p.unlocked) return 0;
      return global.Rules.rustOf(p, { now: now, hasChick: this.hasChick() });
    },

    isUnlocked: function (skillId) {
      const p = this.progress.skills[skillId];
      return !!(p && p.unlocked);
    },

    unlockedSkills: function () {
      const self = this;
      return this.treeData.skills.filter(function (s) { return self.isUnlocked(s.id); });
    },

    /** 解放条件を満たしていて、まだ解放していないスキル */
    unlockableSkills: function () {
      const self = this;
      return this.treeData.skills.filter(function (s) {
        return global.Rules.isUnlockable(s, self.progress.skills);
      });
    },

    categoryOfSkill: function (skill) {
      const tree = this.treeById.get(skill.tree);
      return tree ? tree.category : null;
    },

    /** そのスキルの解放にAIテストが要るか(categories の test: true) */
    needsTest: function (skill) {
      const cat = this.treeData.categories.find(
        (c) => c.id === this.categoryOfSkill(skill)
      );
      return !!(cat && cat.test);
    },

    // ---------------- トースト / モーダル ----------------

    toast: function (message, kind) {
      const host = U.qs('#toast-host');
      const node = U.el('div', {
        class: 'toast' + (kind ? ' toast--' + kind : ''),
        text: message,
      });
      host.appendChild(node);
      setTimeout(function () { node.remove(); }, kind === 'bad' ? 5200 : 2800);
    },

    /**
     * @param {{title:string, body:Node|string, actions?:Array<{label,kind,onClick}>, dismissable?:boolean}} opts
     */
    modal: function (opts) {
      const host = U.qs('#modal-host');
      host.innerHTML = '';
      host.hidden = false;

      const box = U.el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' });
      box.appendChild(U.el('div', { class: 'modal__title', text: opts.title }));

      const body = U.el('div', { class: 'modal__body' });
      if (typeof opts.body === 'string') body.innerHTML = opts.body;
      else if (opts.body) body.appendChild(opts.body);
      box.appendChild(body);

      const close = function () { host.hidden = true; host.innerHTML = ''; };

      if (opts.actions && opts.actions.length) {
        const row = U.el('div', { class: 'modal__actions' });
        for (const action of opts.actions.filter(Boolean)) {
          row.appendChild(U.el('button', {
            class: 'btn' + (action.kind ? ' btn--' + action.kind : ''),
            text: action.label,
            onclick: function () {
              if (!action.onClick || action.onClick() !== false) close();
            },
          }));
        }
        box.appendChild(row);
      }

      host.appendChild(box);
      // 前のモーダルの設定が残らないよう、毎回付け替える(テスト中は背景を押しても閉じない)
      host.onclick = opts.dismissable === false ? null : function (e) {
        if (e.target === host) close();
      };
      return { close: close, body: body };
    },

    closeModal: function () {
      const host = U.qs('#modal-host');
      host.hidden = true;
      host.innerHTML = '';
      host.onclick = null;
    },

    confirm: function (title, message, onYes) {
      this.modal({
        title: title,
        body: U.el('p', { text: message }),
        actions: [
          { label: 'やめる', kind: 'ghost' },
          { label: 'すすむ', kind: 'primary', onClick: onYes },
        ],
      });
    },
  };

  global.App = App;
})(typeof window !== 'undefined' ? window : globalThis);
