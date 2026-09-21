/* Anthropic Messages API クライアント。
 * ブラウザから直接呼ぶため anthropic-dangerous-direct-browser-access が必須。
 * APIキー未設定・通信失敗時は例外を投げ、呼び出し側が自己申告の動線に切り替える。
 */
(function (global) {
  'use strict';

  const ENDPOINT = 'https://api.anthropic.com/v1/messages';
  const API_VERSION = '2023-06-01';

  const MODELS = [
    { id: 'claude-haiku-4-5', name: 'Haiku 4.5(安い・速い)', note: '1日30回の利用で月およそ800円' },
    { id: 'claude-sonnet-5',  name: 'Sonnet 5(精度重視)',    note: '同じ条件で月およそ1,600円' },
    { id: 'claude-opus-5',    name: 'Opus 5(最高精度)',      note: '同じ条件で月およそ4,000円' },
  ];

  /** 呼び出し側が種類を見分けられるエラー */
  function AiError(kind, message, detail) {
    const err = new Error(message);
    err.name = 'AiError';
    err.kind = kind; // no-key | disabled | network | auth | rate-limit | server | bad-response
    err.detail = detail;
    return err;
  }

  let mock = null;

  /** テスト用。fn(params) が {text} を返すとAPIを呼ばずにそれを使う。 */
  function setMock(fn) { mock = fn; }
  function isMocked() { return !!mock; }

  function getConfig() {
    const s = global.Store.loadSettings();
    return { apiKey: (s.apiKey || '').trim(), model: s.model, enabled: s.aiEnabled !== false };
  }

  function available() {
    if (mock) return true;
    const c = getConfig();
    return c.enabled && !!c.apiKey;
  }

  /**
   * Messages API を1回呼ぶ。
   * @param {{system?:string, messages:Array, maxTokens?:number, temperature?:number, signal?:AbortSignal}} params
   * @returns {Promise<{text:string, usage?:object}>}
   */
  async function call(params) {
    if (mock) return mock(params);

    const cfg = getConfig();
    if (!cfg.enabled) throw AiError('disabled', 'AI機能がオフになっています');
    if (!cfg.apiKey) throw AiError('no-key', 'APIキーが設定されていません');

    const body = {
      model: params.model || cfg.model,
      max_tokens: params.maxTokens || 2048,
      messages: params.messages,
    };
    if (params.system) body.system = params.system;
    if (params.temperature != null) body.temperature = params.temperature;

    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': cfg.apiKey,
          'anthropic-version': API_VERSION,
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
        signal: params.signal,
      });
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      throw AiError('network',
        'APIに接続できませんでした。通信状況か、ブラウザからの直接呼び出しがブロックされていないか確認してください。', e);
    }

    if (!res.ok) {
      const detail = await res.text().catch(function () { return ''; });
      if (res.status === 401 || res.status === 403) {
        throw AiError('auth', 'APIキーが正しくないようです（' + res.status + '）', detail);
      }
      if (res.status === 429) {
        throw AiError('rate-limit', '呼び出しが多すぎます。少し待ってからもう一度。', detail);
      }
      throw AiError('server', 'APIがエラーを返しました（' + res.status + '）', detail);
    }

    let json;
    try {
      json = await res.json();
    } catch (e) {
      throw AiError('bad-response', 'APIの返事を読めませんでした', e);
    }

    const text = (json.content || [])
      .filter(function (b) { return b.type === 'text'; })
      .map(function (b) { return b.text; })
      .join('');

    if (!text) throw AiError('bad-response', 'APIから中身のない返事が来ました', json);
    return { text: text, usage: json.usage, stopReason: json.stop_reason };
  }

  /**
   * JSONで答えさせる呼び出し。```json フェンスや前後の文章を取り除いて解釈する。
   */
  async function callJson(params) {
    const res = await call(Object.assign({}, params, {
      system: (params.system || '') +
        '\n\n必ずJSONだけを返してください。説明文やコードフェンスは付けないでください。',
    }));
    const parsed = extractJson(res.text);
    if (parsed == null) {
      throw AiError('bad-response', 'AIの返事をJSONとして読めませんでした', res.text);
    }
    return { data: parsed, usage: res.usage, raw: res.text };
  }

  /** 文章に混ざったJSONを取り出す */
  function extractJson(text) {
    if (!text) return null;
    let s = String(text).trim();

    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
    if (fence) s = fence[1].trim();

    try { return JSON.parse(s); } catch (e) { /* 続けて括弧を探す */ }

    const start = s.search(/[[{]/);
    if (start < 0) return null;
    const open = s[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inStr = false;
    let escape = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(s.slice(start, i + 1)); } catch (e) { return null; }
        }
      }
    }
    return null;
  }

  /**
   * 設定タブの「接続テスト」。file:// からのCORSが通るかをここで早期に確かめる。
   */
  async function testConnection() {
    const started = Date.now();
    try {
      const res = await call({
        maxTokens: 16,
        messages: [{ role: 'user', content: '「OK」とだけ返してください。' }],
      });
      return {
        ok: true,
        ms: Date.now() - started,
        text: res.text.trim(),
        model: getConfig().model,
        usage: res.usage,
      };
    } catch (e) {
      return { ok: false, kind: e.kind || 'unknown', message: e.message, detail: e.detail };
    }
  }

  global.Ai = {
    ENDPOINT, API_VERSION, MODELS,
    call, callJson, extractJson, testConnection,
    available, setMock, isMocked, getConfig,
    error: AiError,
  };
})(typeof window !== 'undefined' ? window : globalThis);
