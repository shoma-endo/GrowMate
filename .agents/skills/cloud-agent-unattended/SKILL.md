---
name: cloud-agent-unattended
description: Cursor Cloud AgentがTAKT CLI無しでspec-reviewと実装→PRの無人ループを回すときの正本。Cloud上で仕様レビュー完了や仕様起点PRを依頼されたとき、またはTAKT/APIキー無しで無人系を進めるときに使う。ローカルのtakt -w起動やGrill Me対話では使わない。
---

# Cloud Agent 無人ループ（TAKT CLI なし）

Cursor Cloud Agent 自身がオーケストレータになる。**`takt` コマンドは起動しない。** Anthropic / Cursor の追加 API キーも要求しない（Cloud Agent のモデルを使う）。

## 使うとき / 使わないとき

| 使う | 使わない |
|------|----------|
| Cloud Agent 上で `spec-review` 相当 | ローカルで `takt -w grill-to-gherkin`（対話） |
| Cloud Agent 上で実装→verify→PR | ローカルで `takt -w spec-review` / `spec-to-pr` を回すとき |
| 「TAKT なしでレビューまで」「Cloud で PR まで」 | Grill Me・着手判断・人間承認待ちが必要な前段 |

ローカル TAKT は残置する。Cloud の主系はこの Skill。

## 正本の参照（複製しない）

手順の中身は既存正本を **読んで従う**。ここにチェックリストを再掲しない。

| 工程 | 正本 |
|------|------|
| 仕様レビュー観点 | `.agents/skills/spec-review/SKILL.md`（条件付きは同ディレクトリ） |
| 図解 HTML | `.agents/skills/spec-to-html/SKILL.md` |
| 実装ポリシー | `.agents/skills/implementation-guidelines/SKILL.md` ほか該当 Skill |
| 品質ゲート | `.agents/skills/quality-gate/SKILL.md` |
| 無人前提・ABORT | `.takt/facets/partials/instructions/unattended-operation.md` |
| review 手順詳細 | `.takt/facets/instructions/spec-review/*` |
| 実装→PR 手順詳細 | `.takt/facets/instructions/spec-to-pr/*` |
| MVP / 運用モデル | `.takt/facets/knowledge/growmate.md`、`AGENTS.md` |

## 共通ルール（Cloud）

1. **人間への途中質問をしない。** 判断不能・仕様不足なら停止し、仕様書に未確定事項と次アクションを残す（TAKT の ABORT 相当）。
2. **要件を発明しない。** MVP 最優先。Non-goals に無いものを足さない。
3. **`.takt/runs/` を正本にしない。** 結果は仕様書本文（レビュー記録・未確定事項）と PR 本文、最終応答に残す。
4. **ブランチ名:** Cloud Agent の制約に従う（例: `cursor/<slug>-e562`）。`ManagePullRequest` が使えるなら PR 作成・更新にそれを使う。使えないときだけ `gh`。
5. **検証:** プロダクション影響パスを変えたら `npm run verify`（または `verify:changed`）。ブラウザ手動・実DB・外部 API 実通信・migration リモート適用の未実施だけで失敗にしない（PR の未確認事項へ）。
6. **merge しない。** 人間が最終確認する。

詳細手順は段階的開示:

- 仕様レビューのみ → [`spec-review-loop.md`](spec-review-loop.md)
- 実装から PR → [`spec-to-pr-loop.md`](spec-to-pr-loop.md)
