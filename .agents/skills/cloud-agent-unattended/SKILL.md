---
name: cloud-agent-unattended
description: Cursor Cloud AgentがTAKT CLI無しでspec-reviewと実装→PRの無人ループを回すときの正本。工程ごとに subagent（Task）でコンテキスト分離する。Cloud上で仕様レビュー完了や仕様起点PRを依頼されたときに使う。ローカルのtakt -w起動やGrill Me対話では使わない。
---

# Cloud Agent 無人ループ（TAKT CLI なし）

**親 Agent = 薄いオーケストレータ。** 工程の実作業は **必ず subagent（Task tool）** に委譲する。同一 context で audit/implement/review を兼務しない。

- **`takt` は起動しない。**
- 追加 API キーは要求しない（Cloud Agent / subagent の model は `inherit` 既定）。
- handoff 正本: [`workflow-handoff.md`](workflow-handoff.md)

## 使うとき / 使わないとき

| 使う | 使わない |
|------|----------|
| Cloud Agent 上で `spec-review` 相当 | ローカルで `takt -w grill-to-gherkin`（対話） |
| Cloud Agent 上で実装→verify→PR | ローカルで `takt -w spec-review` / `spec-to-pr` |
| 「TAKT なしでレビューまで」「Cloud で PR まで」 | Grill Me・着手判断・人間承認待ちが必要な前段 |

ローカル TAKT は残置。Cloud 主系は本 Skill + `.agents/agents/spec-*.md`。

## オーケストレーション規則

1. **親は工程を実行しない。** Task で下表 subagent を起動する。
2. **並列:** `spec-ai-antipattern-review` と `spec-architecture-review` は **1 メッセージで2 Task 並列**。
3. **handoff:** `docs/plans/.workflow/<slug>/`（gitignore）。subagent はファイルに全文、親は **verdict + パス** のみ保持。
4. **人間への途中質問をしない。** 判断不能なら停止し仕様書に確認質問（Q-xxx）を残す。
5. **`.takt/runs/` を正本にしない。**
6. **merge しない。**

## 工程 → subagent 対応表

| 工程 | subagent | handoff 出力 |
|------|----------|--------------|
| identify | `spec-identify` | `review/01-scope.md` |
| audit | `spec-audit` | `review/02-audit.md` |
| revise | `spec-revise` | `review/03-revise.md` |
| visualize | `spec-visualize` | `review/04-visualize.md` |
| finalize | `spec-finalize` | `review/05-finalize.md` |
| plan | `spec-plan` | `pr/01-plan.md` |
| implement | `spec-implement` | `pr/02-implement-report.md` |
| reviewers | `spec-ai-antipattern-review` + `spec-architecture-review` | `pr/03-*.md` |
| fix | `spec-fix` (`mode: reviewers`) | `pr/04-fix-result.md` |
| readme_sync | `spec-readme-sync` | `pr/05-readme-sync.md` |
| self_review | `spec-self-review` | `pr/06-self-review.md` |
| self_review_fix | `spec-fix` (`mode: self_review`) | `pr/04-fix-result.md` |
| prepare_pr_summary | `spec-pr-summary` | `pr/07-pr-summary.md` |
| create_pr | `spec-create-pr` | `pr/08-create-pr.md` |
| watch_pr_comments | `spec-pr-comment-triage` | `pr/09-pr-comment-triage.md` |
| pr_comment_fix | `spec-pr-comment-fix` | `pr/10-pr-comment-fix-result.md` |

## 正本の参照（複製しない）

| 観点 | 正本 |
|------|------|
| 仕様レビュー | `.agents/skills/spec-review/SKILL.md` |
| 図解 HTML | `.agents/skills/spec-to-html/SKILL.md` |
| 実装 | `.agents/skills/implementation-guidelines/` ほか |
| 品質ゲート | `.agents/skills/quality-gate/SKILL.md` |
| 無人前提 | `.takt/facets/partials/instructions/unattended-operation.md` |
| review 詳細 | `.takt/facets/instructions/spec-review/*` |
| 実装→PR 詳細 | `.takt/facets/instructions/spec-to-pr/*` |

## 検証・PR

- プロダクション変更: `npm run verify` / `verify:changed`（subagent 側で実行）
- PR: `ManagePullRequest` 優先、不可なら `gh`。base `develop`
- PR 作成後: `spec-pr-comment-triage` が **5分待って1回だけ**コメントを取り込み、対応要否を判断する。対応する指摘があるときだけ `spec-pr-comment-fix` が修正して commit / push する（1周で終了。返信・resolve・merge はしない）

詳細フロー:

- 仕様レビュー → [`spec-review-loop.md`](spec-review-loop.md)
- 実装→PR → [`spec-to-pr-loop.md`](spec-to-pr-loop.md)
