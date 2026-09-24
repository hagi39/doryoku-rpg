/* 教材(要点・例題・つまずきやすい点)と、その確認問題をAIに作らせる。
 * 教材は progress.materials[skillId] に1件だけ保存する(作り直すと上書き)。
 * 確認問題は、保存した教材の中身に合わせて作らせる(読んだ内容がそのまま出る)。 */
(function (global) {
  'use strict';

  const Q = global.Quiz;

  /** 画面に必ず出す注意書き(設計書9章) */
  const DISCLAIMER = 'AIが作った解説です。教科書と違うことが書いてあったら、教科書を優先してください。';

  const MAX = {
    POINTS: 4,       // 要点
    EXAMPLES: 2,     // 例題
    PITFALLS: 3,     // つまずきやすい点
    TITLE: 40,
    BODY: 400,
  };

  const TEXT_RULES = [
    'すべて日本語で書く。高校生が一人で読んで分かる言葉にする。',
    '数式はプレーンテキストで書く(例: x^2 + 3x, √2, 1/2, sin30°)。LaTeX や $、Markdown の記号は使わない。',
    '上線・ベクトルの矢印など、プレーンテキストで書けない記号は言葉で書く(例: 「z の共役複素数」「ベクトル AB」)。',
    '数列の添字が式になるときは a_(n+1) のようにかっこで囲む。a_n+1 と書くと「a_n + 1」と読めてしまう。',
    '定数に、数列の項の記法(a_0 など)を流用しない。項の番号と紛らわしいので、定数には α や c のような別の文字を使う。',
    '一つの説明や例題の中で使う文字(x, a, n など)は、最初から最後まで同じものを使う。途中で別の文字に変えたり、「読み替えてください」と言い直したりしない。',
    '高校の範囲を超える知識は使わない。',
    '教科書に載っている標準的な内容だけを書く。あいまいなことや、自信のないことは書かない。',
  ];

  function baseSystem(app, skill) {
    const tree = app.tree(skill.tree) || { name: '', hint: '' };
    return [
      'あなたは高校生の学習アプリで使う教材を書く先生です。',
      '教科: ' + tree.name + (tree.hint ? '。方針: ' + tree.hint : ''),
      '',
      '守ること:',
      TEXT_RULES.map(function (r) { return '- ' + r; }).join('\n'),
    ].join('\n');
  }

  function str(v, max) {
    const t = typeof v === 'string' ? v.trim() : '';
    return max && t.length > max ? t.slice(0, max) : t;
  }

  /**
   * AIが返した教材を検査し、保存できる形にそろえる。
   * 壊れた項目は捨てる。要点が1つもなければ null(作り直させる)。
   */
  function sanitizeMaterial(raw, skill) {
    const src = raw && typeof raw === 'object' ? raw : {};

    const points = (Array.isArray(src.points) ? src.points : [])
      .map(function (p) {
        if (!p || typeof p !== 'object') return null;
        const title = str(p.title, MAX.TITLE);
        const body = str(p.body, MAX.BODY);
        return title && body ? { title: title, body: body } : null;
      })
      .filter(Boolean)
      .slice(0, MAX.POINTS);
    if (!points.length) return null;

    const examples = (Array.isArray(src.examples) ? src.examples : [])
      .map(function (e) {
        if (!e || typeof e !== 'object') return null;
        const question = str(e.question, MAX.BODY);
        const solution = str(e.solution, MAX.BODY);
        return question && solution ? { question: question, solution: solution } : null;
      })
      .filter(Boolean)
      .slice(0, MAX.EXAMPLES);

    const pitfalls = (Array.isArray(src.pitfalls) ? src.pitfalls : [])
      .map(function (p) { return str(p, MAX.BODY); })
      .filter(Boolean)
      .slice(0, MAX.PITFALLS);

    return {
      skillId: skill.id,
      summary: str(src.summary, MAX.BODY),
      points: points,
      examples: examples,
      pitfalls: pitfalls,
    };
  }

  function formatSpec() {
    return '出力の形:\n{' +
      '"summary":"このスキルが何をするものかを1〜2文で",' +
      '"points":[{"title":"要点の見出し","body":"定義・定理・公式と、その意味"}],' +
      '"examples":[{"question":"例題","solution":"答えまでの手順"}],' +
      '"pitfalls":["つまずきやすい点"]' +
      '}';
  }

  /**
   * 教材を作る。
   * @param {{signal?:AbortSignal}} opts
   * @returns {Promise<object>} progress.materials に入れる形(at/model は Actions で付ける)
   */
  async function generate(app, skill, opts) {
    const o = opts || {};
    const reqs = (skill.requires || [])
      .map(function (id) { const s = app.skill(id); return s ? s.name : null; })
      .filter(Boolean);

    const user = [
      '次のスキルの教材を作ってください。',
      '- スキル: ' + skill.name + (skill.desc ? '(' + skill.desc + ')' : ''),
      reqs.length ? '- すでに身につけていること: ' + reqs.join('、') : '- 前提となるスキルはありません',
      '',
      '中身:',
      '- summary: このスキルで何ができるようになるかを1〜2文で。',
      '- points: 要点を2〜' + MAX.POINTS + '個。定義・定理・公式などを、使い方が分かるように書く。',
      '- examples: 例題を1〜' + MAX.EXAMPLES + '問。答えだけでなく、途中の考え方も書く。',
      '- pitfalls: つまずきやすい点を2〜' + MAX.PITFALLS + '個。よくあるまちがいと、どうすれば防げるかを書く。',
      '',
      '前提として身につけていることの説明は繰り返さず、このスキルの中身に集中してください。',
      formatSpec(),
    ].join('\n');

    const res = await global.Ai.callJson({
      system: baseSystem(app, skill),
      messages: [{ role: 'user', content: user }],
      maxTokens: 2500,
      signal: o.signal,
    });

    const material = sanitizeMaterial(res.data, skill);
    if (!material) {
      throw global.Ai.error('bad-response', '教材をうまく作れませんでした。もう一度ためしてください。', res.raw);
    }
    return material;
  }

  /** 教材の中身をAIに読ませるための短いテキストにする */
  function materialDigest(material) {
    if (!material) return '';
    return [
      material.summary ? '概要: ' + material.summary : '',
      material.points.map(function (p) { return '要点「' + p.title + '」: ' + p.body; }).join('\n'),
      material.pitfalls.length ? 'つまずきやすい点: ' + material.pitfalls.join(' / ') : '',
    ].filter(Boolean).join('\n');
  }

  /**
   * 教材の確認問題を作る(選択2+記述1)。合否はなく、まちがいが復習リストに入る。
   * @param {{avoid?:string[], signal?:AbortSignal}} opts
   */
  async function checkQuestions(app, skill, material, opts) {
    const o = opts || {};
    const tree = app.tree(skill.tree) || { name: '', hint: '' };
    const user = [
      '次の教材を読んだ人が、中身を分かったかどうかを確かめる確認問題を作ってください。',
      global.QuizGen._skillLine(app, skill),
      '',
      '読んだ教材:',
      materialDigest(material),
      '',
      '難しさ: 教材に書いてあることを読めていれば解ける問題。ひねった応用問題は出さない。',
      '例題とまったく同じ問題は出さず、数値や設定を変えるか、別の角度から確かめる。',
      '問題数: 選択問題を3問、記述問題を2問(すべて skillId "' + skill.id + '")。',
      '問題どうしで同じことを問わないようにしてください。',
      global.QuizGen._formatSpec(),
    ].join('\n') + global.QuizGen._avoidBlock(o.avoid);

    const res = await global.Ai.callJson({
      system: global.QuizGen._baseSystem(app, tree),
      messages: [{ role: 'user', content: user }],
      maxTokens: 2500,
      signal: o.signal,
    });

    const set = Q.pickCheckSet(Q.sanitizeQuestions(res.data, { skillIds: [skill.id] }));
    if (!set) {
      throw global.Ai.error('bad-response', 'AIの問題がそろいませんでした。もう一度ためしてください。', res.raw);
    }
    return set;
  }

  global.MaterialGen = {
    DISCLAIMER, MAX,
    generate, sanitizeMaterial, checkQuestions, materialDigest,
  };
})(typeof window !== 'undefined' ? window : globalThis);
