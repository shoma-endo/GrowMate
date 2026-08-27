# Cloud Agent: spec-review ループ

親: [`SKILL.md`](SKILL.md)。**`takt` は使わない。親はオーケストレータのみ。**

handoff: [`workflow-handoff.md`](workflow-handoff.md) — `docs/plans/.workflow/<slug>/review/`

## 入口

ユーザー指示から `docs/plans/<slug>.md` を特定。`handoff_dir` を作成。曖昧なら **停止**（subagent を起動しない）。

## 手順（最大 3 周 audit↔revise）

各工程は **Task tool で subagent を1回起動**。親が instruction 正本を自分で実行しない。

| 順 | subagent | 分岐 |
|----|----------|------|
| 1 | `spec-identify` | `01-scope` 完了まで |
| 2 | `spec-audit` | verdict 参照 |
| 3a | `spec-revise` | `needs_fix` のとき → 2 へ（最大3周） |
| 3b | — | `approved_with_questions` → **停止**（finalize しない） |
| 4 | `spec-visualize` | `approved` のとき |
| 5 | `spec-finalize` | `approved` のとき |

### subagent prompt テンプレ（親が毎回埋める）

```text
spec: docs/plans/<slug>.md
handoff_dir: docs/plans/.workflow/<slug>/review/
（入力ファイルパス）
正本: .takt/facets/instructions/spec-review/<step>.md
```

## 停止条件

- `approved_with_questions`
- audit↔revise が 3 周しても `needs_fix`
- identify / audit が `blocked`

停止時: 仕様書に未確定事項を残し、「回答反映後に Cloud Agent で spec-review ループ再実行」。**実装ループへ進まない。**

## 実装前ゲート

UI たたき台未承認でも finalize 可。次の `spec-to-pr-loop` はゲート承認まで開始しない。

## 完了時

- 未解決質問あり → 仕様反映 → 本ループ再実行
- UI ゲート未承認 → PO 承認後 `spec-to-pr-loop`
- それ以外 → `spec-to-pr-loop`
