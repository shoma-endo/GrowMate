# GrowMate Repository Guidelines

<language>Japanese</language>

## Core Rules

- `.env`・secret・credential・tokenは読取・出力しない。破壊的操作は対象を限定する。
- 新規機能は原則として `admin` または `paid` ロールだけに提供する。`trial` と `unavailable` は対象外とし、例外は対象仕様書で明示する。
- 新規機能の認可はUIだけでなく、Server Action・Route Handler・APIなどのサーバー側でも検証する。

## Workflow Source of Truth

- 要件確認: `.takt/workflows/grill-to-gherkin.yaml`
- 要件定義項目: `docs/templates/requirement-definition.md`
- 仕様レビュー: `.takt/workflows/spec-review.yaml`
- 仕様実装からPR: `.takt/workflows/spec-to-pr.yaml`
- 人間向け開発手順: `docs/development-workflow.md`

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
