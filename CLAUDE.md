# GrowMate Repository Guidelines

<language>Japanese</language>

## Core Rules

- **GrowMateはMVP開発を最優先とする。判断に迷った場合はこれを軸の1つにする。** 要件に無い機能を先回りで作らない。とくに安全機構（Kill Switch・feature flag・専用の設定テーブル・監視ダッシュボード・冗長化）は、**要件に明示されている場合のみ**対象とする。チェックリストを満たすことを目的化しない。
  - 外部API・LLMに依存する機能でも、まず「壊れたときユーザーに何が見えるか」を定義するだけで足りないかを問う。既存手段（デプロイ巻き戻し、該当UIの非表示）で足りるなら新規の停止機構を作らない。
  - 作らない判断をしたものは、対象仕様書のNon-goalに理由付きで書く（黙って省略しない）。
- `.env`・secret・credential・tokenは読取・出力しない。破壊的操作は対象を限定する。
- 新規機能は原則として `admin` または `paid` ロールだけに提供する。`trial` と `unavailable` は対象外とし、例外は対象仕様書で明示する。
- 新規機能の認可はUIだけでなく、Server Action・Route Handler・APIなどのサーバー側でも検証する。

## Workflow Source of Truth

- 要件確認: `.takt/workflows/grill-to-gherkin.yaml`
- 要件定義項目: `docs/templates/requirement-definition.md`
- 仕様レビュー: `.takt/workflows/spec-review.yaml`
- 仕様実装からPR: `.takt/workflows/spec-to-pr.yaml`
- 人間向け開発手順: `docs/development-workflow.md`

## 実行面（ローカル TAKT / Cloud）

- **実行面は Orca とローカル Mac が基本。** spec-review / spec-to-pr は、指示が無い限りローカル TAKT（`takt -w spec-review` / `takt -w spec-to-pr`）で回す。
- Cursor Cloud Agent はユーザーが明示したときだけ使う。「Cloud 主系 / ローカルは副系」は撤回する。
- ユーザーが Cloud での仕様レビューや仕様起点の PR を明示した場合のみ、`.agents/skills/cloud-agent-unattended/SKILL.md` を読み、`takt` を起動しない。追加の `TAKT_ANTHROPIC_API_KEY` / Cursor API キーも要求しない。
- Grill Me・着手判断など対話必須の前段はローカル TAKT（`takt -w grill-to-gherkin`）のまま。人間同席が必要。Cloud では対話前段を無人完遂しようとしない。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
