/* 設定: APIキー / モデル / 見た目 / ツリーのJSON編集 / バックアップ / 容量 / テスト用操作 */
(function (global) {
  'use strict';

  const U = global.U;

  function render(root, app) {
    root.appendChild(aiCard(app));
    root.appendChild(lookCard(app));
    root.appendChild(backupCard(app));
    root.appendChild(treeJsonCard(app));
    root.appendChild(storageCard(app));
    root.appendChild(devCard(app));
    root.appendChild(aboutCard(app));
  }

  // ---------------- AI ----------------

  function aiCard(app) {
    const card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card__head' }, [
      U.el('div', { class: 'card__title', text: 'AI(Anthropic API)' }),
    ]));

    card.appendChild(U.el('div', { class: 'notice' },
      'APIキーはこの端末のブラウザにだけ保存され、HTMLファイルには書き込まれません。このファイルを誰かに渡してもキーは渡りませんが、端末は他の人と共有しないでください。'));

    const keyInput = U.el('input', {
      class: 'input',
      type: 'password',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: 'sk-ant-...',
      value: app.settings.apiKey || '',
    });

    const keyField = U.el('label', { class: 'field' }, [
      U.el('span', { class: 'field__label', text: 'APIキー' }),
      keyInput,
      U.el('span', { class: 'field__hint', text: 'console.anthropic.com で発行したキーを貼り付けます' }),
    ]);
    card.appendChild(keyField);

    const modelSelect = U.el('select', { class: 'select' });
    for (const m of global.Ai.MODELS) {
      modelSelect.appendChild(U.el('option', {
        value: m.id,
        text: m.name,
        selected: app.settings.model === m.id,
      }));
    }
    card.appendChild(U.el('label', { class: 'field' }, [
      U.el('span', { class: 'field__label', text: 'モデル' }),
      modelSelect,
      U.el('span', { class: 'field__hint', id: 'model-note', text: modelNote(app.settings.model) }),
    ]));

    modelSelect.addEventListener('change', function () {
      const note = U.qs('#model-note');
      if (note) note.textContent = modelNote(modelSelect.value);
    });

    const aiToggle = U.el('input', {
      type: 'checkbox',
      checked: app.settings.aiEnabled !== false,
    });
    card.appendChild(U.el('label', { class: 'field', style: 'display:flex;align-items:center;gap:8px' }, [
      aiToggle,
      U.el('span', { text: 'AI機能を使う(オフにすると全部「自己申告」になります)' }),
    ]));

    const result = U.el('div', { style: 'margin-top:8px' });

    const saveBtn = U.el('button', { class: 'btn btn--primary', text: 'AI設定を保存' });
    saveBtn.addEventListener('click', function () {
      app.settings.apiKey = keyInput.value.trim();
      app.settings.model = modelSelect.value;
      app.settings.aiEnabled = aiToggle.checked;
      app.saveSettings();
      app.toast('設定を保存しました', 'good');
    });

    const testBtn = U.el('button', { class: 'btn', text: '接続テスト' });
    testBtn.addEventListener('click', async function () {
      app.settings.apiKey = keyInput.value.trim();
      app.settings.model = modelSelect.value;
      app.settings.aiEnabled = aiToggle.checked;
      app.saveSettings();

      testBtn.disabled = true;
      result.innerHTML = '';
      result.appendChild(U.el('div', { class: 'notice', text: '接続中…' }));

      const res = await global.Ai.testConnection();
      result.innerHTML = '';
      if (res.ok) {
        result.appendChild(U.el('div', { class: 'notice' },
          '接続できました(' + res.ms + 'ms / ' + res.model + ')。返事: ' + res.text));
      } else {
        result.appendChild(U.el('div', { class: 'notice notice--bad' }, [
          U.el('div', { text: '接続できませんでした: ' + res.message }),
          U.el('div', { style: 'margin-top:6px;font-size:11px', text: hintFor(res.kind) }),
        ]));
      }
      testBtn.disabled = false;
    });

    card.appendChild(U.el('div', { class: 'btn-row' }, [saveBtn, testBtn]));
    card.appendChild(result);
    return card;
  }

  function modelNote(id) {
    const m = global.Ai.MODELS.find(function (x) { return x.id === id; });
    return m ? m.note : '';
  }

  function hintFor(kind) {
    switch (kind) {
      case 'no-key': return 'APIキーを入力してから、もう一度ためしてください。';
      case 'auth': return 'キーの文字列が正しいか、期限切れでないか確認してください。';
      case 'network':
        return 'ブラウザから直接APIを呼べていません。ファイルを直接開いている(file://)場合に起きやすいので、https で配信する方法も試してください。';
      case 'rate-limit': return '少し待つと通ります。';
      case 'disabled': return 'AI機能のチェックを入れてください。';
      default: return 'しばらく待ってからもう一度ためしてください。';
    }
  }

  // ---------------- 見た目 ----------------

  function lookCard(app) {
    const card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card__head' }, [
      U.el('div', { class: 'card__title', text: '見た目' }),
    ]));

    const row = U.el('div', { class: 'btn-row' });
    const themes = [
      { id: 'auto', label: '端末に合わせる' },
      { id: 'light', label: 'ライト' },
      { id: 'dark', label: 'ダーク' },
    ];
    for (const t of themes) {
      const btn = U.el('button', {
        class: 'btn' + (app.settings.theme === t.id ? ' btn--primary' : ''),
        text: t.label,
      });
      btn.addEventListener('click', function () {
        app.settings.theme = t.id;
        app.saveSettings();
        app.render();
      });
      row.appendChild(btn);
    }
    card.appendChild(row);
    return card;
  }

  // ---------------- バックアップ ----------------

  function backupCard(app) {
    const card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card__head' }, [
      U.el('div', { class: 'card__title', text: '進捗のバックアップ' }),
    ]));
    card.appendChild(U.el('div', { class: 'notice notice--warn' },
      'アプリの新しいファイルを受け取る前に、必ず書き出しておいてください。開き方によっては保存データが引き継がれないことがあります。'));

    const area = U.el('textarea', { class: 'textarea', spellcheck: 'false', placeholder: '書き出したJSONがここに出ます。読み込むときはここに貼り付けます。' });

    const exportBtn = U.el('button', { class: 'btn btn--primary', text: '書き出す' });
    exportBtn.addEventListener('click', function () {
      const backup = global.Store.exportBackup(app.progress, app.treeData, app.settings, {});
      const text = JSON.stringify(backup, null, 2);
      area.value = text;
      downloadJson(text, '努力RPG-backup-' + U.dateKey() + '.json', app);
    });

    const copyBtn = U.el('button', { class: 'btn', text: 'コピー' });
    copyBtn.addEventListener('click', async function () {
      if (!area.value) { app.toast('先に書き出してください'); return; }
      try {
        await navigator.clipboard.writeText(area.value);
        app.toast('コピーしました', 'good');
      } catch (e) {
        area.select();
        app.toast('選択しました。長押しでコピーしてください');
      }
    });

    const importBtn = U.el('button', { class: 'btn', text: '読み込む' });
    importBtn.addEventListener('click', function () {
      const res = global.Store.importBackup(area.value);
      if (!res.ok) { app.toast(res.error, 'bad'); return; }
      app.confirm('バックアップを読み込む', 'いまの進捗は上書きされます。よろしいですか?', function () {
        global.Store.applyBackup(res.backup);
        app.boot();
        app.go('settings');
        app.toast('読み込みました', 'good');
      });
    });

    const fileInput = U.el('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
    fileInput.addEventListener('change', function () {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () { area.value = String(reader.result); app.toast('ファイルを読みました。「読み込む」を押してください'); };
      reader.readAsText(file);
    });
    const fileBtn = U.el('button', { class: 'btn', text: 'ファイルを選ぶ' });
    fileBtn.addEventListener('click', function () { fileInput.click(); });

    card.appendChild(U.el('div', { class: 'btn-row' }, [exportBtn, copyBtn]));
    card.appendChild(U.el('div', { class: 'btn-row', style: 'margin-top:8px' }, [fileBtn, importBtn]));
    card.appendChild(fileInput);
    card.appendChild(U.el('div', { style: 'margin-top:10px' }, [area]));
    return card;
  }

  function downloadJson(text, filename, app) {
    try {
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = U.el('a', { href: url, download: filename });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      app.toast('書き出しました', 'good');
    } catch (e) {
      app.toast('ファイルにできませんでした。下の文字をコピーして保存してください', 'bad');
    }
  }

  // ---------------- ツリーJSON ----------------

  function treeJsonCard(app) {
    const card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card__head' }, [
      U.el('div', { class: 'card__title', text: 'ツリーのJSON編集' }),
      U.el('div', { class: 'card__note', text: 'ver ' + app.treeData.ver }),
    ]));

    const area = U.el('textarea', {
      class: 'textarea',
      spellcheck: 'false',
      style: 'min-height:220px',
      value: JSON.stringify(app.treeData, null, 2),
    });
    const report = U.el('div', { style: 'margin-top:8px' });

    function runCheck(silent) {
      report.innerHTML = '';
      let parsed;
      try {
        parsed = JSON.parse(area.value);
      } catch (e) {
        report.appendChild(U.el('div', { class: 'notice notice--bad', text: 'JSONとして読めません: ' + e.message }));
        return null;
      }
      const res = global.Validate.validate(parsed);
      if (res.errors.length) {
        report.appendChild(U.el('div', { class: 'notice notice--bad' }, [
          U.el('div', { text: 'エラー ' + res.errors.length + '件' }),
          U.el('ul', {}, res.errors.slice(0, 10).map(function (m) { return U.el('li', { text: m }); })),
        ]));
        return null;
      }
      if (res.warnings.length) {
        report.appendChild(U.el('div', { class: 'notice notice--warn' }, [
          U.el('div', { text: '注意 ' + res.warnings.length + '件' }),
          U.el('ul', {}, res.warnings.slice(0, 10).map(function (m) { return U.el('li', { text: m }); })),
        ]));
      } else if (!silent) {
        report.appendChild(U.el('div', { class: 'notice', text: '問題は見つかりませんでした(スキル ' + parsed.skills.length + '個)' }));
      }
      return parsed;
    }

    const checkBtn = U.el('button', { class: 'btn', text: '検証' });
    checkBtn.addEventListener('click', function () { runCheck(false); });

    const saveBtn = U.el('button', { class: 'btn btn--primary', text: 'ツリーを保存' });
    saveBtn.addEventListener('click', function () {
      const parsed = runCheck(true);
      if (!parsed) { app.toast('エラーがあるので保存しませんでした', 'bad'); return; }
      global.Store.saveTreeData(parsed);
      app.treeData = parsed;
      app.progress = global.Store.reconcile(app.progress, parsed);
      app.reindex();
      app.save();
      app.render();
      app.toast('ツリーを保存しました', 'good');
    });

    const resetBtn = U.el('button', { class: 'btn btn--danger', text: '初期データに戻す' });
    resetBtn.addEventListener('click', function () {
      app.confirm('初期データに戻す', '編集した内容は消えます。進捗(解放したスキル)は同じidなら残ります。', function () {
        const fresh = global.Store.resetTreeData();
        app.treeData = fresh;
        app.progress = global.Store.reconcile(app.progress, fresh);
        app.reindex();
        app.save();
        app.render();
        app.toast('初期データに戻しました', 'good');
      });
    });

    card.appendChild(area);
    card.appendChild(U.el('div', { class: 'btn-row', style: 'margin-top:8px' }, [checkBtn, saveBtn]));
    card.appendChild(U.el('div', { class: 'btn-row', style: 'margin-top:8px' }, [resetBtn]));
    card.appendChild(report);
    return card;
  }

  // ---------------- 容量 ----------------

  function storageCard(app) {
    const u = global.Store.usage();
    const card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card__head' }, [
      U.el('div', { class: 'card__title', text: '保存の状態' }),
      U.el('div', { class: 'card__note', text: (u.bytes / 1024).toFixed(1) + ' KB' }),
    ]));

    const LIMIT = 5 * 1024 * 1024;
    card.appendChild(U.el('div', { class: 'meter' }, [
      U.el('div', { class: 'meter__fill', style: 'width:' + Math.min(100, (u.bytes / LIMIT) * 100).toFixed(2) + '%' }),
    ]));
    card.appendChild(U.el('div', { class: 'card__note', style: 'margin-top:6px',
      text: '目安の上限は約5MB。教材と復習リストが増えるとここが伸びます。' }));

    if (!u.storageOk) {
      card.appendChild(U.el('div', { class: 'notice notice--bad', style: 'margin-top:8px' },
        'このブラウザでは保存ができていません。プライベートモードを解除するか、バックアップを手動で管理してください。'));
    }
    return card;
  }

  // ---------------- テスト用 ----------------

  function devCard(app) {
    const card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card__head' }, [
      U.el('div', { class: 'card__title', text: 'テスト用の操作' }),
      U.el('div', { class: 'card__note', text: '動作確認のため' }),
    ]));

    const row = U.el('div', { class: 'btn-row' });

    row.appendChild(button('経験値+100', function () {
      app.progress.totalXp += 100;
      app.save();
      app.render();
    }));

    row.appendChild(button('ひよこ切替', function () {
      app.progress.companions.chick = !app.progress.companions.chick;
      app.save();
      app.render();
      app.toast(app.progress.companions.chick ? 'ひよこが仲間になった' : 'ひよこが離れた');
    }));

    row.appendChild(button('最初の1段を解放', function () {
      const now = Date.now();
      let n = 0;
      for (const skill of app.treeData.skills) {
        if ((skill.requires || []).length) continue;
        const p = app.prog(skill.id);
        if (p.unlocked) continue;
        p.unlocked = true;
        p.unlockedAt = now;
        p.polishCount = 1;
        p.polishedAt = now;
        n++;
      }
      app.save();
      app.render();
      app.toast(n + '個を解放しました');
    }));

    row.appendChild(button('サビを進める(-7日)', function () {
      for (const id of Object.keys(app.progress.skills)) {
        const p = app.progress.skills[id];
        if (p.polishedAt) p.polishedAt -= 7 * U.DAY_MS;
      }
      app.save();
      app.render();
      app.toast('7日ぶんサビを進めました');
    }));

    card.appendChild(row);

    const danger = U.el('button', { class: 'btn btn--danger btn--block', style: 'margin-top:8px', text: '進捗をすべて消す' });
    danger.addEventListener('click', function () {
      app.confirm('進捗をすべて消す', 'もとに戻せません。先にバックアップを書き出しましたか?', function () {
        global.Store.clearAll();
        app.boot();
        app.go('settings');
        app.toast('消しました');
      });
    });
    card.appendChild(danger);
    return card;
  }

  function button(label, onClick) {
    const btn = U.el('button', { class: 'btn', text: label });
    btn.addEventListener('click', onClick);
    return btn;
  }

  // ---------------- このアプリについて ----------------

  function aboutCard(app) {
    const card = U.el('div', { class: 'card card--flat' });
    card.appendChild(U.el('div', { class: 'card__head' }, [
      U.el('div', { class: 'card__title', text: 'このアプリについて' }),
    ]));

    const meta = document.querySelector('meta[name="built-at"]');
    const rows = [
      ['ビルド', meta ? meta.content : '不明'],
      ['開き方', location.protocol === 'file:' ? 'file://(ファイルを直接)' : location.origin],
      ['保存先', location.protocol === 'file:' ? 'このファイルの置き場所ごと' : location.origin],
      ['スキル数', String(app.treeData.skills.length)],
    ];

    const wrap = U.el('div', { class: 'table-wrap' });
    const table = U.el('table', { class: 'table' });
    const tbody = U.el('tbody');
    for (const [k, v] of rows) {
      tbody.appendChild(U.el('tr', {}, [U.el('th', { text: k }), U.el('td', { text: v })]));
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    card.appendChild(wrap);

    if (location.protocol === 'file:') {
      card.appendChild(U.el('div', { class: 'notice notice--warn', style: 'margin-top:8px' },
        'ファイルを直接開いています。新しいファイルを別の場所に置くと進捗が引き継がれないことがあります。更新前にバックアップを書き出してください。'));
    }
    return card;
  }

  global.App.register('settings', { render: render });
})(typeof window !== 'undefined' ? window : globalThis);
