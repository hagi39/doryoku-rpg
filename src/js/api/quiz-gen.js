/* AIに問題を作らせる。返ってきた問題は Quiz.sanitizeQuestions で検査してから使う。 */
(function (global) {
  'use strict';

  const Q = global.Quiz;

  const LEVELS = {
    low:  { label: '不安',       text: '基本レベル。定義の確認や、公式・用語をそのまま使えば解ける問題。' },
    mid:  { label: 'だいたい',   text: '標準レベル。教科書の例題・章末問題くらいの問題。' },
    high: { label: '自信あり',   text: '応用レベル。大学入試の標準問題くらいで、考え方の理解を確かめる問題。' },
  };

  const FORMAT_RULES = [
    '問題文・選択肢・解説はすべて日本語で書く。',
    '数式はプレーンテキストで書く(例: x^2 + 3x, √2, 1/2, sin30°)。LaTeX や $ は使わない。',
    '上線・ベクトルの矢印など、プレーンテキストで書けない記号は言葉で書く(例: 「z の共役複素数」「ベクトル AB」)。',
    '選択問題(type "choice")は選択肢4つ、正解はちょうど1つ。answer は正解の番号(0始まり)。「すべて正しい」のような選択肢は使わない。',
    '選択問題を出す前に、正解以外の3つの選択肢を1つずつ確かめ、どれも誤りであることを確認する。正しい選択肢が2つ以上になる問い方(「一つとして正しいもの」など)はしない。',
    '記述問題(type "written")の答えは、数値か短い語句(20字以内)で一つに決まるものにする。文章で説明させる問題は出さない。',
    '記述問題で別の正しい書き方があれば accepts に入れる(例: 答え "1/2" なら accepts ["0.5"]、語句なら漢字とひらがなの両方)。',
    '問題文の中で答えや選択肢の正誤が分からないようにする。',
    'explanation は正解の理由を1〜2文で書く。',
    '高校の範囲を超える知識は使わない。',
  ];

  function treeOf(app, skill) {
    return app.tree(skill.tree) || { name: '', hint: '' };
  }

  function skillLine(app, skill) {
    const reqs = (skill.requires || []).map(function (id) {
      const s = app.skill(id);
      return s ? s.name : id;
    });
    return '- skillId "' + skill.id + '": ' + skill.name +
      (skill.desc ? '(' + skill.desc + ')' : '') +
      (reqs.length ? ' / 前提: ' + reqs.join('、') : '');
  }

  function baseSystem(app, tree) {
    return [
      'あなたは高校生の学習アプリで使う確認テストの出題者です。',
      '教科: ' + tree.name + (tree.hint ? '。出題方針: ' + tree.hint : ''),
      '',
      '守ること:',
      FORMAT_RULES.map(function (r) { return '- ' + r; }).join('\n'),
    ].join('\n');
  }

  function formatSpec() {
    return '出力の形:\n{"questions":[' +
      '{"type":"choice","skillId":"...","question":"...","choices":["...","...","...","..."],"answer":0,"explanation":"..."},' +
      '{"type":"written","skillId":"...","question":"...","answer":"...","accepts":["..."],"explanation":"..."}' +
      ']}';
  }

  function avoidBlock(avoid) {
    if (!avoid || !avoid.length) return '';
    return '\n\n次の問題とは別の問題にすること(前回と同じ問題は出さない):\n' +
      avoid.slice(-12).map(function (q) { return '- ' + q; }).join('\n');
  }

  /**
   * 解放テストの問題を作る(選択3+記述1)。
   * 検査で落ちる問題があっても4問そろうよう、少し多めに作らせる。
   * @param {{level:'low'|'mid'|'high', avoid?:string[], signal?:AbortSignal}} opts
   */
  async function unlockQuestions(app, skill, opts) {
    const tree = treeOf(app, skill);
    const level = LEVELS[opts.level] || LEVELS.mid;
    const user = [
      '次のスキルの解放テストを作ってください。',
      skillLine(app, skill),
      '',
      '難しさ: ' + level.text,
      '問題数: 選択問題を4問、記述問題を2問(すべて skillId "' + skill.id + '")。',
      '問題どうしで同じことを問わないようにしてください。',
      formatSpec(),
    ].join('\n') + avoidBlock(opts.avoid);

    const res = await global.Ai.callJson({
      system: baseSystem(app, tree),
      messages: [{ role: 'user', content: user }],
      maxTokens: 3000,
      signal: opts.signal,
    });

    const qs = Q.sanitizeQuestions(res.data, { skillIds: [skill.id] });
    const set = Q.pickUnlockSet(qs);
    if (!set) {
      throw global.Ai.error('bad-response', 'AIの問題がそろいませんでした。もう一度ためしてください。', res.raw);
    }
    return set;
  }

  /**
   * 復習テストの問題を作る(選択2+記述1)。
   * 復習リストに残っているそのスキルのまちがいを伝え、近い内容を混ぜさせる。
   * @param {{mistakes?:string[], avoid?:string[], signal?:AbortSignal}} opts
   */
  async function reviewQuestions(app, skill, opts) {
    const tree = treeOf(app, skill);
    const mistakes = (opts.mistakes || []).slice(0, 5);
    const user = [
      '次のスキルを以前に身につけた人向けの、復習テストを作ってください。忘れていないかを確かめるのが目的です。',
      skillLine(app, skill),
      '',
      '難しさ: ' + LEVELS.mid.text + 'このスキルの大事なポイントを広く確かめる。',
      mistakes.length
        ? '本人が以前まちがえた問題(同じ問題は出さず、同じポイントを別の形で1問だけ確かめる):\n' +
          mistakes.map(function (q) { return '- ' + q; }).join('\n')
        : '',
      '問題数: 選択問題を3問、記述問題を2問(すべて skillId "' + skill.id + '")。',
      '問題どうしで同じことを問わないようにしてください。',
      formatSpec(),
    ].filter(Boolean).join('\n') + avoidBlock(opts.avoid);

    const res = await global.Ai.callJson({
      system: baseSystem(app, tree),
      messages: [{ role: 'user', content: user }],
      maxTokens: 2500,
      signal: opts.signal,
    });

    const set = Q.pickReviewSet(Q.sanitizeQuestions(res.data, { skillIds: [skill.id] }));
    if (!set) {
      throw global.Ai.error('bad-response', 'AIの問題がそろいませんでした。もう一度ためしてください。', res.raw);
    }
    return set;
  }

  /**
   * 診断の問題を作る。出題するスキル1つにつき1問。
   * @param {string[]} targetIds Quiz.diagnosisTargets で選んだスキル
   * @param {{claimName?:string, memo?:string, signal?:AbortSignal}} opts
   */
  async function diagnosisQuestions(app, tree, targetIds, opts) {
    const skills = targetIds.map(function (id) { return app.skill(id); }).filter(Boolean);
    const user = [
      '「' + tree.name + '」のどこまで理解しているかを確かめる診断テストを作ってください。',
      '本人の自己申告: ' + (opts.claimName ? '「' + opts.claimName + '」まではできると思う' : 'まだ何もできないと思う'),
      opts.memo ? '本人のメモ: ' + opts.memo : '',
      '',
      '次のスキルそれぞれについて、そのスキルの中心となる内容を確かめる問題を1問ずつ(skillId を必ず付ける):',
      skills.map(function (s) { return skillLine(app, s); }).join('\n'),
      '',
      '難しさ: 教科書の基本〜標準レベル。そのスキルができる人なら確実に解け、できない人は解けない問題にする。',
      '形式: 基本は選択問題。答えが数値や短い語句で一つに決まるなら記述問題にしてよい(記述は全体で2問まで)。',
      formatSpec(),
    ].filter(Boolean).join('\n');

    const res = await global.Ai.callJson({
      system: baseSystem(app, tree),
      messages: [{ role: 'user', content: user }],
      maxTokens: 4000,
      signal: opts.signal,
    });

    // 1スキル1問にそろえ、出題順(浅い順)に並べる
    const qs = Q.sanitizeQuestions(res.data, { skillIds: targetIds });
    const first = new Map();
    for (const q of qs) if (!first.has(q.skillId)) first.set(q.skillId, q);
    const set = targetIds.filter(function (id) { return first.has(id); })
      .map(function (id) { return first.get(id); });
    if (set.length < Math.min(Q.C.MIN_VALID + 1, targetIds.length)) {
      throw global.Ai.error('bad-response', 'AIの問題がそろいませんでした。もう一度ためしてください。', res.raw);
    }
    return set;
  }

  /**
   * 診断の講評。結果を渡して、次に何をすればいいかを短く書かせる。
   * @param {{claimName?:string, frontierName?:string, memo?:string, results:Array<{skill:string, correct:boolean|null}>}} summary
   */
  async function diagnosisComment(app, tree, summary, signal) {
    const lines = summary.results.map(function (r) {
      return '- ' + r.skill + ': ' + (r.correct == null ? '問題不備で除外' : r.correct ? '正解' : '不正解');
    });
    const res = await global.Ai.call({
      system: 'あなたは高校生の勉強を応援する先生です。やさしく、具体的に、日本語で答えてください。',
      messages: [{ role: 'user', content: [
        '「' + tree.name + '」の診断テストの結果です。',
        '自己申告: ' + (summary.claimName ? '「' + summary.claimName + '」までできると思う' : 'まだ何もできないと思う'),
        summary.memo ? '本人のメモ: ' + summary.memo : '',
        '確認できたいちばん先: ' + (summary.frontierName || 'なし'),
        '各問の結果:',
        lines.join('\n'),
        '',
        '200字くらいで講評してください。自己申告と結果のずれ、できていたこと、次に取り組むとよいスキルを1つ挙げる。見出しや箇条書きは使わない。',
      ].filter(Boolean).join('\n') }],
      maxTokens: 600,
      signal: signal,
    });
    return plainText(res.text);
  }

  /** 見出し記号や太字の ** など、Markdown の飾りを外す */
  function plainText(text) {
    return String(text || '')
      .replace(/^\s*#{1,6}\s+.*(\r?\n)+/, '')
      .replace(/^\s*#{1,6}\s+/gm, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .trim();
  }

  global.QuizGen = {
    LEVELS,
    unlockQuestions, reviewQuestions, diagnosisQuestions, diagnosisComment, plainText,
    // 診断・復習で使う部品
    _baseSystem: baseSystem, _skillLine: skillLine, _formatSpec: formatSpec, _avoidBlock: avoidBlock,
  };
})(typeof window !== 'undefined' ? window : globalThis);
