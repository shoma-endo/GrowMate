push 前に、下記に全文添付された最新レポート群から、PR 本文の正本となる `pr-summary.md` を作成してください。

必須条件:
- 実装やレビュー判断は行わない。確認済みの事実と意見（完了判断）を分けて整理する。
- 一次情報は下記添付の `plan.md` / `implement-report.md` / `fix-result.md` / `ai-antipattern-review.md` / `architecture-review.md` / `readme-sync.md` / `self-review.md` に限る。`fix-result.md` は fix 工程が一度も走らなかった run では欠落文になるが、正常であり ABORT 理由にしない。run ディレクトリやレポートパスを探索しない。**例外:** `plan.md` ヘッダの `UIモック:` が `対象外` 以外のときだけ、キャプチャ有無の確認のため `.takt/artifacts/pr-screenshots/` を列挙してよい（スクショの新規撮影・生成はしない）。
- `self-review.md` の仕様書完全実装判定を読み取り、`## 関連仕様書` に転記する（実装やレビュー判断はしない、転記のみ）。
- `pr-summary.md` は GitHub PR 本文としてそのまま使える Markdown にする。先頭に PR タイトル案を1行（`# ` 見出し）で書き、続けて本文セクションを書く。
- PR タイトル形式（必須）:
  - 日本語・1行・50字以内（`# ` を除く本文）。
  - What/Why が一覧で分かる内容にする（例: `コンテンツ注釈の保存APIを仕様どおり実装する`）。
  - 禁止: `[Auto]` 接頭辞、ブランチ名だけのタイトル、`実装完了` / `対応完了` などの自己申告、英語のみ、conventional commits 接頭辞（`feat:` 等）。
- 必須セクション（この順）:
  1. `## 概要` — 何を・なぜ変えたか（仕様起点、2〜4文）
  2. `## 全体像` — 変更の全体像を Mermaid 図（` ```mermaid ` フェンス）で示す。GitHub 上で図として描画される前提で書く。
     - 図は `flowchart LR`（縦長なら `flowchart TD`）を1枚だけ。変更が載る経路（画面 → Server Action / Route Handler → サービス → DB / 外部API など）をノードと矢印で描く。本PRで追加・変更した要素に `:::changed` を付け、既存のまま使う要素は無印にする。ノードは15個以内。
     - 根拠: 実装の実体は `implement-report.md`（実装箇所と影響経路）と `fix-result.md`（その後の修正）から取る。`plan.md` は変更候補にすぎないため、実装レポートに無い要素を plan だけを根拠に描かない。推測でノードや矢印を足さない。読み取れない部分は描かずに省く。plan と実装レポートが食い違う場合は実装レポート側を描き、食い違いを `## 未確認事項` に書く。
     - 記法（描画エラー防止）:
       - ノード ID は `n1`〜`n15` の連番、subgraph ID は `g1` からの連番にする（予約語との衝突を避けるため）。
       - ノードは `n1["..."]`、エッジラベルは `-->|"..."|`、subgraph は `subgraph g1["..."]` と、ラベルは必ず `"` で囲む。
       - ラベル内に `"` とバッククォートを書かない（識別子もそのまま書く）。改行は `<br/>`。
       - 図の末尾に `classDef changed stroke:#f08c00,stroke-width:3px` を置く（`fill` は指定しない。ダークテーマで文字が読めなくなるため）。`%%{init}%%`・`click`・`style` は使わない。
     - 図の直後に凡例を1行書く: `太枠（橙）= 本PRで追加・変更`。
     - 変更が docs・設定のみで描く経路が無い場合は、図と凡例を書かず「図示対象なし（理由）」の1行にする。
  3. `## 関連仕様書` — `plan.md` の `# タスク計画` 直後の `対象仕様書:` パス（なければ `self-review.md` の記載）。`self-review.md` が完全実装と判定した場合は「本PR完了後 `docs/plans/xxx.md` → `docs/specs/xxx.md` へ移動（create_pr が git mv・当該 slug の参照パス置換・ステータスを `implemented` に更新まで実施）」と明記する。部分実装の場合は「`docs/plans/` に残置（未実装: ○○）」と明記する（移動指示を書かない）
  4. `## 変更要点` — 主要変更のみ（ファイル一覧の羅列は禁止。カテゴリ単位で3〜7点）
  5. `## レビュー結果` — ai-antipattern / architecture-review / self-review の結論（approved / open findings 数）
  6. `## 完了判断` — 事実（verify 成功、open findings 0、仕様要件充足など）と、それに基づく完了判断を分けて書く
  7. `## 検証` — `npm run verify` 等の結果（手動ブラウザ確認は無人のため未実施が既定）
  8. `## 画面キャプチャ` — `plan.md` の `UIモック:` が `対象外` なら「対象外」1行のみ。UI 対象（`なし` / `あり(...)`）なら `.takt/artifacts/pr-screenshots/` を列挙し、許可拡張子（`.png` `.jpg` `.jpeg` `.webp` `.gif` `.mp4` `.webm`）のファイルだけを `![alt](.takt/artifacts/pr-screenshots/NN-short-slug.ext)` で書く（alt は拡張子を除いたファイル名。create_pr が `--attach` で URL に書き換える）。0件なら「なし（ローカルキャプチャ未配置）」。モック HTML・図解バンドルへのリンクは書かない。スクショを新規に撮らない。
  9. `## 未確認事項` — UI 変更時は「手動ブラウザ確認未実施」を含める（キャプチャ 0 件でも同様）。`src/types/database.types.pending.ts` を追加している場合は「管理者によるマイグレーション適用・`npm run supabase:types` 実行・pendingファイル削除が必要」を含める。添付レポート間に食い違いがある場合は、その内容を含める（新規セクションは作らない）。その他あれば列挙。なければ「なし」
  10. `## コミットメッセージ案` — 日本語1行
- 変更ファイルの詳細表は作らない。

## plan.md（全文）
{report:plan.md}

## implement-report.md（全文）
{report:implement-report.md}

## fix-result.md（最新・全文）
{report:fix-result.md}

## ai-antipattern-review.md（全文）
{report:ai-antipattern-review.md}

## architecture-review.md（全文）
{report:architecture-review.md}

## readme-sync.md（全文）
{report:readme-sync.md}

## self-review.md（全文）
{report:self-review.md}
