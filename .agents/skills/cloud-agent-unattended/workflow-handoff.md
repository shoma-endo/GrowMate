# Cloud 無人ループ: 工程 handoff 契約

親 Skill（オーケストレータ）と工程 subagent の **唯一の受け渡し正本**。`.takt/runs/` は使わない。

## ディレクトリ

```
docs/plans/.workflow/<slug>/
  review/
    01-scope.md
    02-audit.md          # 周回ごと上書き可。履歴は 02-audit-r2.md 等
    03-revise.md         # needs_fix のときのみ
    04-visualize.md      # スキップ時は「skipped」と1行
    05-finalize.md
  pr/
    01-plan.md
    02-implement-report.md
    03-ai-antipattern-review.md
    03-architecture-review.md   # reviewers 並列。03- で揃える
    04-fix-result.md
    05-readme-sync.md
    06-self-review.md
    07-pr-summary.md
    08-create-pr.md
```

- `<slug>` は対象仕様書 `docs/plans/<slug>.md` の basename。
- 本ディレクトリは **gitignore**（作業用）。永続成果は仕様書本文・コード・PR 本文。

## 各ファイルの必須先頭行

すべての handoff ファイルは次の YAML 風ヘッダで始める（Markdown として可読）:

```markdown
---
phase: audit
spec: docs/plans/example-spec.md
verdict: needs_fix
cycle: 1
---
```

| phase | verdict 例 |
|-------|------------|
| identify | `done` |
| audit | `approved` / `needs_fix` / `approved_with_questions` |
| revise | `done` |
| visualize | `done` / `skipped` |
| finalize | `done` |
| plan | `ready` / `blocked` |
| implement | `done` |
| ai-antipattern-review | `approved` / `needs_fix` |
| architecture-review | `approved` / `needs_fix` |
| fix | `fixed` / `stuck` / `info_missing` |
| readme-sync | `done` / `skipped` |
| self-review | `pass` / `needs_fix` / `cannot_verify` |
| create-pr | `done` / `failed` |

## 親（オーケストレータ）の義務

1. **工程の実作業を自分でやらない。** 必ず Task tool で subagent を起動する。
2. subagent prompt に載せるもの:
   - `spec:` パス（1件）
   - `handoff_dir:` フルパス
   - **入力** handoff ファイルのパス一覧（全文を prompt に貼るか Read 指示）
   - **出力** handoff ファイルパス
   - 正本 instruction パス（`.takt/facets/instructions/...`）
3. subagent 返却後、**summary だけ**親が保持する。audit 全文・implement ログは handoff ファイルを Read して次工程へ渡す。
4. 並列: `spec-ai-antipattern-review` と `spec-architecture-review` は **同一メッセージで2 Task 並列**。

## subagent の義務

1. 指定された instruction 正本を Read して従う（チェックリストの再掲禁止）。
2. 出力 handoff ファイルを **必ず** 書く（スキップも `verdict: skipped` で記録）。
3. 親への返却は **10行以内**（verdict・出力パス・ブロッカー有無のみ）。
