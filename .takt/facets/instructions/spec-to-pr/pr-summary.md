push 前に、下記に全文添付された最新レポート群から、PR 本文の正本となる `pr-summary.md` を作成してください。

必須条件:
- 実装やレビュー判断は行わない。確認済みの事実と意見（完了判断）を分けて整理する。
- 一次情報は下記添付の `plan.md` / `ai-antipattern-review.md` / `architecture-review.md` / `readme-sync.md` / `self-review.md` の5つに限る。run ディレクトリやレポートパスを探索しない。
- `self-review.md` の仕様書完全実装判定を読み取り、`## 関連仕様書` に転記する（実装やレビュー判断はしない、転記のみ）。
- `pr-summary.md` は GitHub PR 本文としてそのまま使える Markdown にする。先頭に PR タイトル案を1行（`# ` 見出し）で書き、続けて本文セクションを書く。
- PR タイトル形式（必須）:
  - 日本語・1行・50字以内（`# ` を除く本文）。
  - What/Why が一覧で分かる内容にする（例: `コンテンツ注釈の保存APIを仕様どおり実装する`）。
  - 禁止: `[Auto]` 接頭辞、ブランチ名だけのタイトル、`実装完了` / `対応完了` などの自己申告、英語のみ、conventional commits 接頭辞（`feat:` 等）。
- 必須セクション（この順）:
  1. `## 概要` — 何を・なぜ変えたか（仕様起点、2〜4文）
  2. `## 関連仕様書` — `docs/plans/` のパス。`self-review.md` が完全実装と判定した場合は「本PR完了後 `docs/plans/xxx.md` → `docs/specs/xxx.md` へ移動」と明記する。部分実装の場合は「`docs/plans/` に残置（未実装: ○○）」と明記する
  3. `## 変更要点` — 主要変更のみ（ファイル一覧の羅列は禁止。カテゴリ単位で3〜7点）
  4. `## レビュー結果` — ai-antipattern / architecture-review / self-review の結論（approved / open findings 数）
  5. `## 完了判断` — 事実（verify 成功、open findings 0、仕様要件充足など）と、それに基づく完了判断を分けて書く
  6. `## 検証` — `npm run verify` 等の結果（手動ブラウザ確認は無人のため未実施が既定）
  7. `## 未確認事項` — UI 変更時は「手動ブラウザ確認未実施」を含める。`src/types/database.types.pending.ts` を追加している場合は「管理者によるマイグレーション適用・`npm run supabase:types` 実行・pendingファイル削除が必要」を含める。添付レポート間に食い違いがある場合は、その内容を含める（新規セクションは作らない）。その他あれば列挙。なければ「なし」
  8. `## コミットメッセージ案` — 日本語1行
- 変更ファイルの詳細表は作らない。

## plan.md（全文）
{report:plan.md}

## ai-antipattern-review.md（全文）
{report:ai-antipattern-review.md}

## architecture-review.md（全文）
{report:architecture-review.md}

## readme-sync.md（全文）
{report:readme-sync.md}

## self-review.md（全文）
{report:self-review.md}
