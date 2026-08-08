---
name: spec-to-html
description: docs/plansの仕様書を単一HTMLの「見る地図」に変換・更新するときだけ使う正本。core.yamlからステータス・設計判断・クイズの再構成ビューを作り、原本Markdownから全文ビューを生成する。TAKT spec-reviewのvisualize、仕様書の図解HTML生成・再生成・陳腐化確認で使う。仕様書本文のレビュー・修正（spec-review）やリポジトリ全体のキャッチアップには使わない。
---

# 仕様書の図解化（SSoT）

`docs/plans/` の仕様書を、**数週間ぶりに戻ってきた開発者**が 30 分で開発再開できる単一 HTML に変換する。

## 設計原則

**変換ではなく再構成である。** Markdown を HTML に整形しても認知負荷は下がらない。下がるのは、仕様書を「意味の単位」に圧縮し、実装ステータス軸で並べ替えたときだけ。したがって本スキルの中核は `core.yaml` の執筆であり、HTML 生成はその副産物として自動化する。

- **形が先、文字が後**: 状態・依存・比較はステータスボード / バッジ / 色で先に掴ませ、文章は判断点に絞る。**構造化されたテキストは図解ではない。** カードや箇条書きだけで済ませると、原本 Markdown に対する優位が「折りたたみと絞り込み」しか残らない。次項の図版を必ず入れること。
- **例外ファースト**: 読者が今日見るべきなのは「正常なもの」ではなく **未決事項・リスク・着手前ゲート**。それらをビュー先頭の1ブロックに集約し、決着済み・実装済みのパネルは **畳んで**出す。開いているものが多いビューは、何も強調していないのと同じ。
- **色は意味にのみ使う**: 緑=実装済み ／ amber=実装中・要確認 ／ 灰=凍結・未着手 ／ 赤=リスク ／ 青=次の一手。装飾目的の色は使わない。**構造を示す色と異常を示す色を混ぜない** — フェーズやレイヤの区別に赤や amber を使うと、本物のリスクが埋もれる。構造は枠線の種類・塗り分け・番号で示す。
- **1ビューのブロックは 7 個まで**（ワーキングメモリ 7±2）。超えるなら `① 構造 / ② 数値 / ③ 判断材料` のような**群見出しで 3〜5 チャンクに束ねる**。並べる数を減らすのではなく、階層を1つ増やして数える単位を減らす。
- **再構成ビュー（01〜03）は原本を丸写ししない**: DDL 全文・プロンプト本文・長大な表は入れない。行番号で原本に辿れれば足りる。
- **全文は別タブに隔離する（04）**: 原文が必要な場面（実装時）は必ずあるので捨てない。ただし再構成ビューに混ぜると圧縮の意味が消えるため、独立したタブに置く。**再構成ビューから全文の該当章へはジャンプボタンで飛ばす**（後述の `data-goto`）。
- **削る勇気**: ステータスは 1 画面に収める。強調が増えすぎたらそれも情報過多の再発。

## 二層構造

| 層 | ビュー | 誰が作るか | 用途 |
|---|---|---|---|
| 再構成 | 01 ステータス / 02 設計判断 / 03 クイズ | **LLM**（core.yaml 経由） | 状況把握・次の一手の判断・設計判断の再確認 |
| 全文 | 04 全文 | **スクリプト**（`spec-html.py fulltext`） | 実装（DDL を書く・プロンプトを直す・型を定義する） |

全文ビューは原本と1文字も乖離してはいけないので **LLM に書かせない**。機械変換にすることで、生成のたびに解釈が入る余地を消し、トークンも消費せず常に同期する。

## 図版（必須）

**再構成ビュー（`01-status.html` と `02-decisions.html`）のそれぞれに最低3点**、意味のある図版を入れる。入れられる図が無いなら、その仕様書はそもそも図解する価値が薄い。

### 図にするもの / しないもの

図にする価値があるのは**構造があるもの**だけ — 順序・配置・経路・時間軸・グラフ。

**図にしない**: トレードオフの受け入れ、コスト比較、「別課題に切り出す」といった**論証**。構造が無いものを図にすると意味が薄まる。設計判断ビューでは「✕不採用 / ✓採用」の論証は文章のまま残し、**両案の構造が違う場合だけ比較図を挟む**。

### 型カタログ — 何を図にするか

| 型 | 使いどころ | 実装 |
|---|---|---|
| **依存図** | フェーズ / タスクの順序と、何が何をブロックしているか。カードを並べただけでは「並列に見えて依存が見えない」 | SVG |
| **比較図** | 採用案と不採用案の**構造が違う**とき（何がどこに置かれるか / どの順で書き込むか）。左右に並べて ✕ / ✓ を付ける | SVG（2パネル） |
| **判断連鎖マップ** | 「この決定が何に波及したか」の因果。決定を左、波及した結果を右に置き、関係の種類を矢印ラベルにする | SVG（2列 + 横矢印） |
| **アクセス経路図** | 誰がどの経路で読み書きできるか。「その経路は存在しない」を ✕ で示せる | SVG |
| **シーケンス図** | 複数の主体（ブラウザ / サーバー / 外部 API）をまたぐ流れ。番号付き箇条書きでは主体の切り替わりが見えない | SVG（レーン矩形 + 横矢印） |
| **寿命バー** | 時間軸の区間と閾値（トークン有効期間、リテンション、猶予期間）。散文では「どの区間で何が起きるか」が掴めない | CSS（flex の比率で区間幅） |
| **状態マッピング** | 戻り値の型と UI 表示の対応（3状態など）。取り違えが事故になる箇所 | CSS（グリッド + 左ボーダー色） |
| **ER 図 + 削除順序** | テーブル間の FK の**向き**。「FK が users を指すので credential 削除では連鎖しない」のような、文章だと読み飛ばす事実が一目で分かる | SVG（矩形 + 矢印 + 丸数字） |
| **フローチャート** | 分岐のある処理。特に「正常動作としてのスキップ / 打ち切り」と「本当の失敗」の区別 | SVG（縦の主線 + 右への分岐） |

### まずジェネレータで書けないか確かめる

**`flow` / `compare` / `causemap` / `er` の4型はスクリプトが生成する。座標を手で書かない。**

JSON を `docs/plans/_html/<slug>/diagrams/<name>.json` に置き、ビューには1行だけ書く:

```html
<div class="dg" data-dg-type="flow" data-dg-src="../diagrams/sync-flow.json"></div>
```

`spec-html.py build` がこれを SVG に展開する（`caption` も JSON 側に持たせる。HTML タグ可）。

| type | 用途 | 主なキー |
|---|---|---|
| `flow` | 縦フロー ＋ 右レーンへの分岐 | `steps[{text,sub,style,next_label}]` / `branches[{from,label,style,lines}]` / `result{lines}` |
| `compare` | ✕不採用 / ✓採用 の2列比較 | `left{head,style,blocks[{text,sub,style}],notes}` / `right{...}` |
| `causemap` | 決定 → 波及の因果マップ | `rows[{from,rel,to,style}]` / `left_head` / `right_head` / `note` |
| `er` | ER ＋ 削除順序 | `root{name,sub}` / `tables[{name,lines,order,style}]` / `extra_edges` / `callout{lines}` |

`style` は `plain` / `key` / `warn` / `ok` / `okbg` / `ng` / `later` / `done`。共通キーは `title`（図の名前）/ `desc`（読み上げ用の説明）/ `caption`（読み取り）。

**各型が表せないもの**（ここに当たったら手書きに逃がす。無理に寄せると意味が壊れる）:

| type | 表せないもの |
|---|---|
| `flow` | **1ステップから複数の分岐**。`branches` は `from` のステップに縦中央合わせで置くので、同じ `from` を2つ書くと重なる。4分岐のファンアウトは手書き |
| `compare` | パネル内の**入れ子構造**と**横方向の時系列**。ブロックは1列に縦積みされる |
| `causemap` | **3ノード以上の連鎖**（A→B→C）と**行のグループ分け**。1行1関係の2列固定 |
| `er` | 参照先が2つ以上ある構成。全テーブルが1段に並び、`root` へ向かう FK 線だけを描く |

**なぜ手で書かないか**: 手書きだと線がボックスを貫通する・矢印が交差する・日本語がはみ出す、が繰り返し起きる。ジェネレータは `_text_width()`（CJK 1.0em / ASCII 0.55em）で**中身から箱の幅を決め**、レイアウトが固定なので**交差と貫通が構造的に発生しない**。ワークフローの `visualize` は無人実行で誰も目視できないため、これは特に重要。

この4型で表せないときだけ手書き SVG にする（依存図・シーケンス図・アクセス経路図など）。

### 実装の約束（手書きする場合）

- **SVG はインライン**。`viewBox` で座標系を決め、CSS で `width:100%; height:auto; min-width:640px`、親を `overflow-x:auto` にする。Mermaid を**ランタイムで描画する**（`mermaid.js` を読み込んで `<pre class="mermaid">` を変換する）形は inline 化できないので使わない。`mmdc` でレンダリング済みの静的 SVG を貼るのは技術的には可能だが、色がレンダリング時に焼き込まれて**テーマトグルに追従しなくなる**ため現状は採用していない。
- **配色は CSS 変数**。`class` を付けて `<style>` 側で `fill:var(--card)` / `stroke:var(--border)` を当てる。属性に色を直書きするとダークテーマで破綻する。
- **矢じりは `<marker>` 内で `currentColor` が効かない**（参照元の色を継承しない）。色ごとにマーカーを定義し、その中の `<path>` に class を付けて CSS 変数で塗る。
- **アクセシビリティ**: `role="img"` + `aria-labelledby` で `<title>`（図の名前）と `<desc>`（図が示す内容の文章化）を必ず付ける。
- **日本語テキストの幅に注意**。SVG の `<text>` は折り返さない。ラベルは短く保ち、長い補足は図の外の「読み取り」キャプションに逃がす。線とテキストが重なっていないか、必ず描画して目視する。
- **図には必ず「読み取り」を添える**（`.dg-cap`）。図が何を主張しているかを1〜2文で書く。図だけでは「で、何が言いたいのか」が伝わらない。

### 検算

描画後に必ず目視し、**線がボックスを貫通していないか / テキストがはみ出していないか / 矢じりの色がテーマに追従するか**を確認する。交差したら経路を変えるかノードを再配置する。

## タブ間ジャンプ（`data-goto`）

再構成ビューから全文タブの該当章へ飛ばすには、ボタンに `data-goto` を付ける。結合後のシェル JS が **タブ切り替え → 章を開く → スクロール** までやる。

```html
<button type="button" class="jump" data-goto="ft-s4">→ 全文 4章</button>
```

- 章 ID は**見出しから決まる**。`## 4. フェーズ分け` → `ft-s4`、`## 4.2 …` → `ft-s4-2`、番号が無い見出し → `ft-h<ハッシュ8桁>`。
- 連番（`ft-sec-1`, `ft-sec-2`, …）ではないのは、**章を1つ挿入しただけで以降の ID が全部ずれてジャンプが静かに壊れる**のを防ぐため。章を移動しても番号が同じなら ID は変わらない。
- 存在しない ID を指してもエラーにはならず**何も起きない**（静かに死ぬ）。書いたら必ずクリックして確認する。

## 整合性チェックと前回比 diff（`build` が自動実行）

再構成ビューは LLM が「そのときの原本」から書く。原本が改訂されてもビューは黙って古いままになり、`core.yaml` の `source_refs`（行番号）は静かにズレる。これを検知するため、`build` は毎回 **宣言（core.yaml）と実体（原本 Markdown）を突合**し、結果を成果物の先頭バーとコンソールに自己申告する。基準は `docs/plans/_html/<slug>/.snapshot.json`（`build` が毎回更新）。

| レベル | 何を意味するか | 対処 |
|---|---|---|
| `fail` 参照の指す章が変わった | 行番号が完全にズレて別の章を指している | `core.yaml` の該当 `source_refs` を貼り直す |
| `fail` 章の内容は変わっていないのに参照先本文が変わった | 上流の章で行が増減し、以降が全部ズレた | 同上（まとめて1行に集約される） |
| `fail` 行範囲が原本の範囲外 | 仕様書が短くなった／参照が古い | 同上 |
| `warn` 参照先の章が改訂された | 原本が本当に変わった。ビューの記述が古い可能性 | 該当 concept を更新モードで直す |
| `info` どの `source_ref` でも触れていない章 | 再構成ビューから章が抜けている可能性 | 拾うべき章なら concept を追加。意図的な非対象なら放置してよい |

- **fail が出てもビルドは落ちない。** レビューの commit を妨げないため、自己申告に留める。落ちるのは安全検査（外部依存）だけ。
- 前回生成からの **章の追加 / 削除 / 変更** も同じバーに出る。各章名はジャンプボタンになっていて、クリックすると全文タブの該当章が開く。
- **fail を放置しない。** 参照が壊れた状態で更新モードを続けると、LLM が「ズレた行」を根拠に書き足していく。

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

発火経路は2つ:

| 経路 | 定義 | 拾えるもの |
|---|---|---|
| Claude Code の `PostToolUse` フック | `.claude/settings.json` → `scripts/spec-html-hook.sh` | エージェントによる `Edit` / `Write`。更新があったときだけ結果をエージェントに差し戻す |
| husky `pre-commit` | `.husky/pre-commit` | エディタでの手編集など、フックが拾えない経路の取りこぼし |

どちらも失敗しても編集・commit を止めない。

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
docs/plans/_html/<slug>.html                ← 成果物（単一ファイル・これを開く）
```

- `<slug>` は仕様書のファイル名から `.md` を除いたもの。
- `docs/plans/_html/` は `.gitignore` 済み。**成果物も中間ファイルも commit しない**。意味の正本は常に `docs/plans/<slug>.md` 側にある。
- **対象は `docs/plans/` 直下の仕様書だけ**。`refresh` は `docs/plans/` 直下以外のパスを黙って捨てる（`scripts/spec-html.py` の `refresh` 分岐）ため、実装完了時に `docs/specs/` へ移動した仕様書はバンドルの更新対象外になる。移動時は古いバンドル（`docs/plans/_html/<slug>/` と `docs/plans/_html/<slug>.html`）を消す。残すと**中身が更新されないまま開ける状態**になり、古い仕様を最新と誤読する。
- 単一ファイルなのでダブルクリックで開ける（`file://` で動く）。サーバ不要。

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

### 5. 再構成ビュー3種を書く

各ファイルは `<!DOCTYPE html>` から始まる完結した HTML document。inline CSS / inline JS のみ。

| ファイル | 内容 |
|---|---|
| `01-status.html` | **要注意（未決事項・リスク・着手前ゲートを冒頭に集約）** → ステータスボード → 次の一手 → 重要概念（絞り込み付き）→ 依存関係 → 読む順 → 次の質問 → 出典 |
| `02-decisions.html` | 設計判断ごとに **狙い / ✕不採用案 / ✓採用理由 / △受け入れたトレードオフ** の4点セット。ブロック別の絞り込み付き |
| `03-quiz.html` | `quiz.yaml` を出題。即時採点 → 正誤表示（色だけに頼らずアイコンと文字も）→ 解説・関連概念・出典を開示 → 採点後は入力をロック。末尾にスコア集計と「もう一度」 |

`04-fulltext.html` は **手で書かない**。次項のコマンドで生成する。

**必須の実装約束**:

- ライトを既定にし、`:root` と `:root[data-theme="dark"]` を CSS 変数で両方持つ。
- 自分の `location.hash` を読んで `theme=dark` なら `document.documentElement` に `data-theme="dark"` を付ける。`hashchange` も listen する（結合後のテーマトグルがこの hash を切り替える）。
- `@media (prefers-reduced-motion:reduce)` でアニメーションを無効化する。
- JS は IIFE で包む（結合時にパネル単位へスコープされる）。
- **禁止**: 外部スクリプト / 外部CSS / iframe / `fetch` / `XMLHttpRequest` / `WebSocket` / `localStorage` / `sessionStorage` / `document.cookie` / 親フレームアクセス / `http(s)://` を含む文字列。結合時の安全検査で落ちる。

### 6. 全文ビューを生成する

```bash
python3 scripts/spec-html.py fulltext \
  --spec docs/plans/<slug>.md \
  --out docs/plans/_html/<slug>/views/04-fulltext.html
```

原本 Markdown を機械変換する。目次（クリックで該当セクションを展開してスクロール）、セクション単位の折りたたみ、「すべて開く / 閉じる」が付く。DDL・プロンプト本文・表・入れ子フェンス（```` で ``` を包む形）はすべて逐語で保持される。

- **原本は一切変更しない。** 正本は常に `docs/plans/<slug>.md`。
- 目次のジャンプは `href="#..."` ではなくスクロールで行う。`location.hash` はテーマ状態（`#theme=dark`）に使っているため。
- 原本に含まれる URL は **スキームを除いた平文**になる（オフライン自己完結の制約）。この旨はビュー冒頭に明記される。

### 7. 結合して安全検査する

```bash
python3 scripts/spec-html.py build \
  --out docs/plans/_html/<slug>.html \
  --title "<仕様書名> — 図解" \
  --source docs/plans/<slug>.md \
  --view "ステータスと次の一手=docs/plans/_html/<slug>/views/01-status.html" \
  --view "設計判断=docs/plans/_html/<slug>/views/02-decisions.html" \
  --view "クイズ=docs/plans/_html/<slug>/views/03-quiz.html" \
  --view "全文=docs/plans/_html/<slug>/views/04-fulltext.html"
```

`build` は結合後に安全検査を自動実行し、違反があれば **exit 1** で落ちる。検査だけしたいときは `python3 scripts/spec-html.py check <path>`。

`--source` を渡すと前節の**整合性チェックと前回比 diff** も走る（省略すると `core.yaml` の参照突合が行われず、ズレを検知できない。必ず渡すこと）。こちらは fail が出ても exit 1 にはならないので、**コンソール出力を必ず読む**。

スクリプトがやること: 各ビューの `<style>` を連結、`<body>` を `.panel` として並べ、`<script>` の `document.querySelector` 系を自パネルのルートに差し替える（ビュー間で DOM 探索が衝突しないようにするため）。タブバーとテーマトグルはスクリプトが付与する。**ビューの中身は書き換えない。**

安全検査は2段構え。マークアップとして書かれた時点で外部依存になるもの（外部スクリプト / 外部CSS / iframe / `http(s)://` 等）は**文書全体**、JS API（`localStorage` / `fetch` 等）は **`<script>` 本文と `on*` 属性だけ**を見る。全文ビューは仕様書の地の文に「localStorage に保持する」のような記述をそのまま含むが、テキストノードは何も実行しないため検査対象外。

### 8. 動作を確認する

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
  --virtual-time-budget=3000 --dump-dom "file://$PWD/docs/plans/_html/<slug>.html" | \
  grep -c 'class="panel"'
```

`<html data-theme=...>` が付いていれば JS が動いている。パネル数がビュー数と一致し、`hidden` が (ビュー数 - 1) 個あればタブ制御も動いている。

`data-goto` を書いたら、**参照先 ID が実在するか**も確認する（存在しなくてもエラーは出ない）:

```bash
python3 - <<'PY'
import re; from pathlib import Path
t = Path("docs/plans/_html/<slug>.html").read_text()
ids = set(re.findall(r'id="(ft-[\w-]+)"', t))
print("dangling:", sorted({g for g in re.findall(r'data-goto="([^"]+)"', t) if g not in ids}))
PY
```

### 更新モードで fail が出たときの手順

1. コンソールの fail 行が指す参照 id（`r_xxx`）を控える。
2. 原本の該当章を読み、`core.yaml` の `source_refs` の `lines` を実際の行番号に直す。
3. その参照を根拠にしている concept の記述が古くなっていないかを確認する。
4. `build` を再実行し、fail が消えることを確認する（消えなければ 2 に戻る）。

## やらないこと

- 仕様書本文の修正（`spec-review` スキルの担当）。
- `docs/plans/_html/` の commit。
- 全仕様書の一括生成。図解が効くのは行数が多く、かつ実装ステータスが分裂している仕様書。短い仕様書は原本のほうが速い。
