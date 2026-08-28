# Cloud Agent: 実装 → PR ループ

親: [`SKILL.md`](SKILL.md)。**前提: spec-review 完了（`approved`）。親はオーケストレータのみ。**

handoff: [`workflow-handoff.md`](workflow-handoff.md) — `docs/plans/.workflow/<slug>/pr/`

## 入口ゲート

`spec-plan` subagent が `01-plan.md` で判定。`blocked` なら以降の subagent を起動しない。

## 手順

| 順 | subagent | 備考 |
|----|----------|------|
| 1 | `spec-plan` | |
| 2 | `spec-implement` | verify 含む |
| 3 | `spec-ai-antipattern-review` + `spec-architecture-review` | **並列 Task** |
| 4 | `spec-fix` (`mode: reviewers`) | 両方 approved まで最大3周 → 3 へ |
| 5 | `spec-readme-sync` | **1回のみ**（self_review ループに含めない） |
| 6 | `spec-self-review` | |
| 7 | `spec-fix` (`mode: self_review`) | `needs_fix` のとき。fixed 後は 6 へ（readme へ戻さない） |
| 8 | `spec-pr-summary` | |
| 9 | `spec-create-pr` | draft PR |

### reviewers ループ（最大 3 周）

```
implement → [ai ∥ arch] → (any needs_fix ? fix → 再レビュー : readme_sync)
```

### self_review ループ（最大 3 周）

```
self_review → (needs_fix ? fix[self_review] → self_review : pr-summary)
```

## 停止条件

- plan `blocked`
- 仕様不足・スコープ逸脱が implement 中に発覚
- reviewers / self_review が 3 周して非生産的
- git 書き込み不可（create-pr が failed）

## 完了条件

- 必須 verify 成功（またはスキップ理由記載）
- `07-pr-summary.md` 完成
- draft PR URL（または権限で不可の報告）
- 未確認事項が PR 本文に列挙
