---
name: spec-to-html
description: docs/plansの仕様書を単一HTMLの「見る地図」に変換・更新するときだけ使う正本。core.yamlからステータス・設計判断・クイズの再構成ビューを作り、原本Markdownから全文ビューを生成する。TAKT spec-reviewのvisualize、仕様書の図解HTML生成・再生成・陳腐化確認で使う。仕様書本文のレビュー・修正（spec-review）やリポジトリ全体のキャッチアップには使わない。
---

# 仕様書の図解化（SSoT）

`docs/plans/` の仕様書を、**数週間ぶりに戻ってきた開発者**が 30 分で開発再開できる単一 HTML に変換する。

## 設計原則

**変換ではなく再構成である。** Markdown を HTML に整形しても認知負荷は下がらない。下がるのは、仕様書を「意味の単位」に圧縮し、実装ステータス軸で並べ替えたときだけ。したがって本スキルの中核は `core.yaml` の執筆であり、HTML 生成はその副産物として自動化する。

ビュー執筆の設計原則（形が先・例外ファースト・色の規律・7ブロック上限・丸写し禁止・全文隔離・削る勇気）は `authoring-views.md` の「設計原則」が正本。ビューを書く手順5で読む。

## 二層構造

| 層 | ビュー | 誰が作るか | 用途 |
|---|---|---|---|
| 再構成 | 01 ステータス / 02 設計判断 / 03 クイズ | **LLM**（core.yaml 経由） | 状況把握・次の一手の判断・設計判断の再確認 |
| 全文 | 04 全文 | **スクリプト**（`spec-html.py fulltext`） | 実装（DDL を書く・プロンプトを直す・型を定義する） |

全文ビューは原本と1文字も乖離してはいけないので **LLM に書かせない**。機械変換にすることで、生成のたびに解釈が入る余地を消し、トークンも消費せず常に同期する。

**画面仕様を含む仕様書には `05-screens.html` を追加する。** 仕様書に画面一覧・画面遷移・状態別UI・UI用語・画面のGherkin受入条件のいずれかを含む章（`## 画面仕様` / `## 画面設計` 相当）が実在すれば、01〜03と同じ再構成ビューとして `views/05-screens.html` を作る。無ければ作らない（トリガーは「UI開発を伴うか」ではなく「原本に画面仕様の章が実在するか」）。ファイル名の連番と `build --view` のタブ表示順は無関係（指定順にタブが並ぶだけで、`build()` はファイル名を解釈しない）なので、既存ファイルのリネームは不要。タブ順は「ステータス→設計判断→画面仕様→クイズ→全文」を既定とする（クイズが画面仕様の理解度も問えるように、クイズの直前に置く）。

## 図版とビュー実装（正本: `authoring-views.md`）

**再構成ビュー（01 / 02）には各3点以上の図版が必須。** 型カタログ、ジェネレータ4型（`flow` / `compare` / `causemap` / `er`。座標を手で書かない）、手書き SVG の約束、タブ間ジャンプ（`data-goto`）、ビュー HTML の必須実装約束（テーマ変数・IIFE・外部依存の禁止リスト）はすべて同ディレクトリの `authoring-views.md` が正本。**ビューを書く・直す前に必ず読む。** 禁止リスト違反は `build` の安全検査が exit 1 で落とす。

## 整合性チェックと前回比 diff（`build` が自動実行）

再構成ビューは LLM が「そのときの原本」から書く。原本が改訂されてもビューは黙って古いままになり、`core.yaml` の `source_refs`（行番号）は静かにズレる。これを検知するため、`build` は毎回 **宣言（core.yaml）と実体（原本 Markdown）を突合**し、結果を成果物の先頭バーとコンソールに自己申告する。基準は `docs/plans/_html/<slug>/.snapshot.json`（`build` が毎回更新）。

- レベル別（`fail` / `warn` / `info`）の意味と対処、**更新モードで fail が出たときの手順**は同ディレクトリの `maintenance.md` が正本。fail / warn が出たら読む。
- **fail を放置しない。** 参照が壊れた状態で更新モードを続けると、LLM が「ズレた行」を根拠に書き足していく。fail が出てもビルド自体は落ちない（落ちるのは安全検査だけ）ので、コンソール出力を必ず読む。

## 自動追従（`refresh`）

仕様書が改訂されたら、**機械生成できる部分だけ**が自動で追いつく。手で回す必要はない。

```bash
python3 scripts/spec-html.py refresh --spec docs/plans/<slug>.md   # 1本
npm run spec-html:refresh                                          # docs/plans/*.md 全部
python3 scripts/spec-html.py refresh --all --check                 # 書かずに古いものを列挙（古ければ exit 1）
```

- 対象は `docs/plans/_html/<slug>/` が **既にある**仕様書だけ。バンドルが無ければ無言でスキップする（新規作成は下の「手順」でやること）。
- `.snapshot.json` の `spec_hash` と現物を突合し、**変わっていなければ何も出力せず終わる**（no-op）。
- 変わっていれば `views/*fulltext*.html` を再生成し、`.snapshot.json` の `manifest`（タイトル・出力先・ビューのラベルと並び）どおりに `build` を再実行する。
- **再構成ビュー（01〜03）には触らない。** `core.yaml` を LLM が解釈して書くものなので機械では直せない。代わりに整合性チェックが `fail`/`warn` を出したら「01〜03 が陳腐化している可能性がある」と明示的に警告する。**この警告が出たら更新モードで `core.yaml` を貼り直すこと。**
- 発火経路（Claude Code `PostToolUse` フック / husky `pre-commit`）の詳細は `maintenance.md`。どちらも失敗しても編集・commit を止めない。

## 出力先の規約

```
docs/plans/<slug>.md                        ← 入力（正本）
docs/plans/_html/<slug>/core.yaml           ← 意味の正本（reader 非依存）
docs/plans/_html/<slug>/.snapshot.json      ← 整合性チェックの基準 ＋ refresh 用の manifest（build が自動更新）
docs/plans/_html/<slug>/view.yaml           ← 見せ方の方針（reader 依存）
docs/plans/_html/<slug>/quiz.yaml           ← 理解度チェック
docs/plans/_html/<slug>/views/01-status.html      ← ステータスと次の一手
docs/plans/_html/<slug>/views/02-decisions.html   ← 設計判断
docs/plans/_html/<slug>/views/03-quiz.html        ← クイズ
docs/plans/_html/<slug>/views/04-fulltext.html    ← 全文（スクリプト生成・手で書かない）
docs/plans/_html/<slug>/views/05-screens.html     ← 画面仕様（画面仕様の章がある仕様書のみ・任意）
docs/plans/_html/<slug>.html                ← 成果物（単一ファイル・これを開く）
docs/plans/_html/<slug>.artifact.html       ← Artifact 版（build が同時生成・スマホ/クラウド閲覧用）
```

- `<slug>` は仕様書のファイル名から `.md` を除いたもの。
- `docs/plans/_html/` は `.gitignore` 済み。**成果物も中間ファイルも commit しない**。意味の正本は常に `docs/plans/<slug>.md` 側にある。
- **対象は `docs/plans/` 直下の仕様書だけ**。`refresh` は `docs/plans/` 直下以外のパスを黙って捨てる（`scripts/spec-html.py` の `refresh` 分岐）ため、実装完了時に `docs/specs/` へ移動した仕様書はバンドルの更新対象外になる。移動時は古いバンドル（`docs/plans/_html/<slug>/`、`docs/plans/_html/<slug>.html`、`docs/plans/_html/<slug>.artifact.html`）を消す。残すと**中身が更新されないまま開ける状態**になり、古い仕様を最新と誤読する。
- 単一ファイルなのでダブルクリックで開ける（`file://` で動く）。サーバ不要。
- `build` は同じ内容から `<slug>.artifact.html` も書き出す。claude.ai の Artifact は publish 時に `<!doctype html>…<head></head><body>` を被せるため、完結 HTML を渡すと文書が二重になる。Artifact 版は doctype / html / head / body を持たず、`<title>` + `<style>` + 本文 + `<script>` だけを持つ。安全検査は両方に対して実行される。
- **メインPC以外から仕様書を見るとき**は `<slug>.artifact.html` を Artifact として publish する。デフォルト非公開で、スマホのブラウザから URL を開ける。仕様書を更新したら `refresh` 後に**同じファイルパスで再 publish すれば同じ URL が更新される**（新しい URL にはならない）。

## 手順

### 1. 更新か新規かを判定する

`docs/plans/_html/<slug>/core.yaml` が存在するなら **更新モード**、無ければ **新規モード**。

- **更新モード**: 仕様書の差分（`git diff` / `git log -p` で直近の変更）を読み、`core.yaml` の該当する `concepts` / `relations` / `risks` / `questions` だけを直す。id は安定させる（relations・questions・risks・quiz が id を参照しているため）。全書き直しはしない。
- **新規モード**: 仕様書を通読して `core.yaml` を起案する。

### 2. core.yaml を書く（意味の層）

仕様書を以下に圧縮する。**原本を転記しない。**

| フィールド | 中身 |
|---|---|
| `concepts` | 理解すべき単位（モジュール / フロー / 決定 / リスク / 要件）。`importance` / `difficulty` / `confidence` を必ず付ける |
| `relations` | `depends_on` / `blocks` / `sequence_next` / `affects` / `supports` / `contains` など。`reason` に「なぜその関係が存在するか」を書く |
| `questions` | 読者が次に確認すべきこと。`why_it_matters` を必ず添える |
| `risks` | 着手前に踏む地雷。`severity` 付き |
| `source_refs` | `path` と行番号。**主張は必ず原本に辿れるようにする** |

**必ず拾うもの**（GrowMate の仕様書で最も価値が高い情報）:

- **実装ステータス**（実装済み / 実装中 / 凍結・未着手）と、その根拠となる行
- **次の一手** と、その **着手前ゲート**（スパイク・実測・前提確認など）
- **設計書と実物の乖離**（「本セクションは初期設計時の参考。最新は本番DBを参照」のような注記）
- **不採用案とトレードオフ**（改修判断のときに最初に読む情報）

確信が持てない箇所は `confidence` を下げ、`questions` に逃がす。**推測で断定しない。**

### 3. view.yaml を書く（見せ方の層）

読者は既定で「このリポジトリの開発者本人・数週間ぶりの復帰」。`emphasize` は `implementation_status` / `next_actions` / `risks` / `decision_rationale` / `dependencies` / `reading_order`。`de_emphasize` に `sql_ddl_verbatim` / `prompt_body_verbatim` を入れる。

読者が変わったら `core.yaml` はそのままに `view.yaml` だけ差し替えて再生成する。

### 4. quiz.yaml を書く（理解度チェック）

正解は **必ず `core.yaml` の事実に紐づける**。誤答選択肢は「斜め読みで実際に起きる誤読」から作る。`confidence` が低い事実は出題しない。エンジニア向けなので `relation` / `ordering` / 難易度高から並べ、易しい ○× は末尾に畳む。

### 5. 再構成ビュー3〜4種を書く

各ファイルは `<!DOCTYPE html>` から始まる完結した HTML document。inline CSS / inline JS のみ。

| ファイル | 内容 |
|---|---|
| `01-status.html` | **要注意（未決事項・リスク・着手前ゲートを冒頭に集約）** → ステータスボード → 次の一手 → 重要概念（絞り込み付き）→ 依存関係 → 読む順 → 次の質問 → 出典 |
| `02-decisions.html` | 設計判断ごとに **狙い / ✕不採用案 / ✓採用理由 / △受け入れたトレードオフ** の4点セット。ブロック別の絞り込み付き |
| `05-screens.html` | （画面仕様の章がある場合のみ）画面一覧 → 画面遷移図 → 記事詳細等の要素配置 → 状態別UI → UI用語 → 関連ACの順。**再構成ビューと同じ設計原則（例外ファースト・7ブロック上限・図版3点以上）に従う** |
| `03-quiz.html` | `quiz.yaml` を出題。即時採点 → 正誤表示（色だけに頼らずアイコンと文字も）→ 解説・関連概念・出典を開示 → 採点後は入力をロック。末尾にスコア集計と「もう一度」 |

`04-fulltext.html` は **手で書かない**。手順6（[`build-and-verify.md`](build-and-verify.md)）のコマンドで生成する。

**書く前に `authoring-views.md` を必ず読む**（図版の必須数と型、テーマ変数・hash 連動・IIFE・外部依存の禁止リストを含む必須実装約束の正本）。

### 6〜8. 全文生成 → 結合・安全検査 → 動作確認

**[`build-and-verify.md`](build-and-verify.md) を Read してから実行する**（fulltext 生成コマンド・`build` の引数と安全検査の仕組み・ヘッドレス Chrome での確認・`data-goto` の実在検証・更新モードで fail が出たときの導線の正本）。要点のみ:

- `04-fulltext.html` は `spec-html.py fulltext` で機械生成する。原本は一切変更しない
- `build` には必ず `--source` を渡す（省略すると整合性チェックが走らずズレを検知できない）。fail は exit 1 にならないので**コンソール出力を必ず読む**
- 結合後はヘッドレス Chrome でパネル数とタブ制御を確認し、`data-goto` の参照先 ID の実在を検証する

## やらないこと

- 仕様書本文の修正（`spec-review` スキルの担当）。
- `docs/plans/_html/` の commit。
- 全仕様書の一括生成。図解が効くのは行数が多く、かつ実装ステータスが分裂している仕様書。短い仕様書は原本のほうが速い。
