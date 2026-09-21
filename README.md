# 努力RPG

設計書『努力RPG_設計書_ClaudeCode実装用.md』の実装。
`src/` を編集し、ビルドで単一HTML `dist/努力RPG.html` を作る。配布物はこの1ファイルだけ。

## 使い方

```sh
npm run build   # src/ → dist/努力RPG.html
npm test        # ルールとデータの自動テスト
npm run check   # ビルド + テスト + 成果物の構文/自己完結チェック
```

## 決まっていること

- **配布**: 単一HTMLのまま、`file://` でも https 配信でも動くようにする(両対応)
- **AI**: Anthropic Messages API を fetch で直接呼ぶ。ヘッダ `anthropic-dangerous-direct-browser-access: true` が必須
- **既定モデル**: `claude-haiku-4-5`(設定タブで Sonnet 5 / Opus 5 に変更可)
- **APIキー**: 設定タブで入力し localStorage に保存。HTMLファイルには焼き込まない

### `file://` で使うときの注意

localStorage はオリジン単位で保存されるため、更新版のHTMLを別の場所に置くと進捗が読めなくなることがある。
設定タブのバックアップ(書き出し/読み込み)を必ず経由すること。この点は設定タブにも警告を出している。

## ディレクトリ

```
build.mjs              ビルド(連結して1枚のHTMLにする)
src/index.html         テンプレート(<!--@CSS--> / <!--@JS--> を差し替える)
src/css/               base(トークン・リセット) / layout(枠) / components(部品)
src/js/core/           util, rules(ゲームのルール), validate, layout, store, actions
src/js/data/           tree-data(145スキル)
src/js/api/claude.js   Anthropic API クライアント + 接続テスト + モック
src/js/ui/             shell(土台) と tab-*(6タブ)
test/run-tests.mjs     ルール・データ・保存の検証
test/check-bundle.mjs  成果物の構文と自己完結の検証
```

ビルドに新しいJS/CSSを足すときは `build.mjs` の `JS_FILES` / `CSS_FILES` に順番どおり追加する
(ES modules は `file://` で読めないため、すべて classic script として連結している)。

## 実装フェーズ

| | 内容 | 状態 |
|---|---|---|
| P0 | 基盤(ビルド・6タブ・テーマ・セーフエリア・フォント) | 済 |
| P1 | データ層(145スキル・検証・保存・バックアップ・設定タブ) | 済 |
| P2 | コアルール(経験値/パラメータ/サビ)・記録タブ・ホーム | 済 |
| P3 | ツリー表示(3列・◆他ツリー前提・自己申告解放) | 済 |
| P4 | AIテスト(診断・解放・復習)・記述採点・自己申告フォールバック | これから |
| P5 | 学ぶ(教材・復習リスト) | これから |
| P6 | 冒険(草原・世界地図62か国) | これから |
| P7 | 通し検証(AIモック・容量・実機受け渡し) | これから |

## 設計書で未確定だった点の判断

1. **サビの再計算**: 状態として持たず、表示のたびに `polishedAt` からの経過日数で計算する(`rules.js`)
2. **「使ったスキル」の回復**: タグを付けたスキルとその直接の前提を、サビ 0.7 ぶん回復させる
2b. **ツリーの並べ方**: 段ごとに親の位置の平均(重心)で子を並べ替えて線の交差を減らす(`layout.js`)。1段が3個を超えると折り返す
3. **世界地図**: 国ごとの輪郭SVGではなく、大陸の簡略輪郭 + 代表点(経緯度→正距円筒図法)の丸印で描く予定(P6)
4. **localStorage 容量**: 目安5MB。設定タブに使用量を表示。復習リストは300問、教材はスキルごと1件に制限する
