/* 保存と読み込み。localStorage が使えない環境ではメモリ上だけで動く。 */
(function (global) {
  'use strict';

  const KEY_PROGRESS = 'doryoku-rpg/progress';
  const KEY_SETTINGS = 'doryoku-rpg/settings';
  const KEY_TREEDATA = 'doryoku-rpg/treedata';
  const PROGRESS_VER = 1;

  const memory = {};
  let storageOk = true;

  function rawGet(key) {
    try {
      const v = global.localStorage.getItem(key);
      return v == null ? (key in memory ? memory[key] : null) : v;
    } catch (e) {
      storageOk = false;
      return key in memory ? memory[key] : null;
    }
  }

  function rawSet(key, value) {
    memory[key] = value;
    try {
      global.localStorage.setItem(key, value);
      return true;
    } catch (e) {
      storageOk = false;
      return false;
    }
  }

  function rawRemove(key) {
    delete memory[key];
    try { global.localStorage.removeItem(key); } catch (e) { /* noop */ }
  }

  function readJson(key, fallback) {
    const raw = rawGet(key);
    if (raw == null) return fallback;
    try {
      const parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (e) {
      console.warn('保存データを読めませんでした:', key, e);
      return fallback;
    }
  }

  function writeJson(key, value) {
    return rawSet(key, JSON.stringify(value));
  }

  // ---------------- 初期値 ----------------

  function emptyProgress() {
    const now = Date.now();
    return {
      ver: PROGRESS_VER,
      dataVer: 0,
      totalXp: 0,
      stats: { int: 0, str: 0, sta: 0 },
      streak: { count: 0, lastDate: null },
      skills: {},          // skillId → {unlocked, unlockedAt, polishCount, polishedAt}
      logs: [],            // 記録の履歴(新しい順)
      reviewList: [],      // 復習リスト(最大300)
      materials: {},       // skillId → 教材
      geo: { countries: {}, areasCleared: [] },
      companions: { chick: false },
      daily: {},           // 「1日1回だけ経験値」の判定用
      createdAt: now,
      updatedAt: now,
    };
  }

  function defaultSettings() {
    return {
      apiKey: '',
      model: 'claude-haiku-4-5',
      theme: 'auto',       // auto | light | dark
      aiEnabled: true,
    };
  }

  // ---------------- ツリーデータ ----------------

  /**
   * 保存済みツリーデータを読む。
   * 初期データの ver のほうが新しければ差し替える(同じ id の進捗はそのまま残る)。
   */
  function loadTreeData() {
    const fresh = global.TreeData.buildDefaultData();
    const saved = readJson(KEY_TREEDATA, null);

    if (!saved || typeof saved.ver !== 'number') {
      writeJson(KEY_TREEDATA, fresh);
      return { data: fresh, replaced: false };
    }
    if (saved.ver < fresh.ver) {
      writeJson(KEY_TREEDATA, fresh);
      return { data: fresh, replaced: true, from: saved.ver, to: fresh.ver };
    }

    const check = global.Validate.validate(saved);
    if (check.errors.length) {
      console.warn('保存済みツリーデータが不正なため初期データに戻します:', check.errors);
      writeJson(KEY_TREEDATA, fresh);
      return { data: fresh, replaced: true, invalid: check.errors };
    }
    return { data: saved, replaced: false };
  }

  function saveTreeData(data) {
    return writeJson(KEY_TREEDATA, data);
  }

  function resetTreeData() {
    const fresh = global.TreeData.buildDefaultData();
    writeJson(KEY_TREEDATA, fresh);
    return fresh;
  }

  // ---------------- 進捗 ----------------

  function loadProgress(treeData) {
    const saved = readJson(KEY_PROGRESS, null);
    const progress = saved ? migrateProgress(saved) : emptyProgress();
    return reconcile(progress, treeData);
  }

  function migrateProgress(saved) {
    const base = emptyProgress();
    const out = Object.assign(base, saved);
    out.stats = Object.assign({ int: 0, str: 0, sta: 0 }, saved.stats || {});
    out.streak = Object.assign({ count: 0, lastDate: null }, saved.streak || {});
    out.geo = Object.assign({ countries: {}, areasCleared: [] }, saved.geo || {});
    out.companions = Object.assign({ chick: false }, saved.companions || {});
    out.skills = saved.skills && typeof saved.skills === 'object' ? saved.skills : {};
    out.logs = Array.isArray(saved.logs) ? saved.logs : [];
    out.reviewList = Array.isArray(saved.reviewList) ? saved.reviewList : [];
    out.materials = saved.materials && typeof saved.materials === 'object' ? saved.materials : {};
    out.daily = saved.daily && typeof saved.daily === 'object' ? saved.daily : {};
    out.ver = PROGRESS_VER;
    return out;
  }

  /** ツリーデータに存在しないスキルの進捗を切り離す(消さずに退避しておく) */
  function reconcile(progress, treeData) {
    const known = new Set(treeData.skills.map(function (s) { return s.id; }));
    const orphans = {};
    for (const id of Object.keys(progress.skills)) {
      if (!known.has(id)) {
        orphans[id] = progress.skills[id];
        delete progress.skills[id];
      }
    }
    progress.dataVer = treeData.ver;
    if (Object.keys(orphans).length) {
      progress._orphans = Object.assign(progress._orphans || {}, orphans);
    }
    return progress;
  }

  function saveProgress(progress) {
    progress.updatedAt = Date.now();
    return writeJson(KEY_PROGRESS, progress);
  }

  // ---------------- 設定 ----------------

  function loadSettings() {
    return Object.assign(defaultSettings(), readJson(KEY_SETTINGS, {}));
  }

  function saveSettings(settings) {
    return writeJson(KEY_SETTINGS, settings);
  }

  // ---------------- バックアップ ----------------

  function exportBackup(progress, treeData, settings, opts) {
    const includeKey = opts && opts.includeApiKey;
    const safeSettings = Object.assign({}, settings);
    if (!includeKey) delete safeSettings.apiKey;
    return {
      app: '努力RPG',
      backupVer: 1,
      exportedAt: new Date().toISOString(),
      progress: progress,
      treeData: treeData,
      settings: safeSettings,
    };
  }

  /**
   * バックアップJSONを読み込む。壊れていれば理由つきで失敗を返す。
   */
  function importBackup(json) {
    let obj;
    try {
      obj = typeof json === 'string' ? JSON.parse(json) : json;
    } catch (e) {
      return { ok: false, error: 'JSONとして読めませんでした: ' + e.message };
    }
    if (!obj || typeof obj !== 'object') return { ok: false, error: '中身が空です' };
    if (!obj.progress || typeof obj.progress !== 'object') {
      return { ok: false, error: '"progress" が見つかりません' };
    }
    if (obj.treeData) {
      const check = global.Validate.validate(obj.treeData);
      if (check.errors.length) {
        return { ok: false, error: 'ツリーデータが不正です:\n' + check.errors.slice(0, 5).join('\n') };
      }
    }
    return { ok: true, backup: obj };
  }

  function applyBackup(backup) {
    if (backup.treeData) writeJson(KEY_TREEDATA, backup.treeData);
    writeJson(KEY_PROGRESS, migrateProgress(backup.progress));
    if (backup.settings) {
      const current = loadSettings();
      const next = Object.assign({}, current, backup.settings);
      // APIキーはバックアップに含まれていなければ今の端末の値を残す
      if (!backup.settings.apiKey) next.apiKey = current.apiKey;
      writeJson(KEY_SETTINGS, next);
    }
  }

  function clearAll() {
    rawRemove(KEY_PROGRESS);
    rawRemove(KEY_TREEDATA);
  }

  // ---------------- 容量 ----------------

  function usage() {
    let bytes = 0;
    const detail = {};
    for (const key of [KEY_PROGRESS, KEY_TREEDATA, KEY_SETTINGS]) {
      const raw = rawGet(key);
      const size = raw ? new Blob([raw]).size : 0;
      detail[key] = size;
      bytes += size;
    }
    return { bytes: bytes, detail: detail, storageOk: storageOk };
  }

  global.Store = {
    PROGRESS_VER,
    emptyProgress, defaultSettings,
    loadTreeData, saveTreeData, resetTreeData,
    loadProgress, saveProgress, reconcile,
    loadSettings, saveSettings,
    exportBackup, importBackup, applyBackup,
    clearAll, usage,
    isStorageOk: function () { return storageOk; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
