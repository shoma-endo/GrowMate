---
name: agent-workflow-core
description: CLAUDE.md の最小コア運用を補完する共通ワークフロー。Skill選定、client-alignment-auditor発火条件、段階的開示ルールを定義する。タスク着手時にどの Skill を読むか判断するとき、仕様整理でクライアント文脈の確認が必要なとき、CLAUDE.md やメモリなどコアファイルの記述方針に迷ったときに使う。
---

# Agent Workflow Core

## Purpose

- `CLAUDE.md` は常時読み込みされるため、普遍的な最小方針のみを保持する。
- タスク固有ルールはこのファイルと各 Skill に分離し、必要時のみ参照する（Progressive Disclosure）。
- **Skill 正本**: `.agents/skills/`（Codex / Cursor はここを直接走査。Claude Code 用に `.claude/skills` のみ symlink）。
- **Subagent 正本**: `.agents/agents/`（Codex 用 TOML / Claude Code 用 MD。`.codex/agents` と `.claude/agents` は symlink）。
- **Skill を追加・削除・編集したら `npm run verify:agent-skills` を実行する**（symlink・frontmatter・期待 Skill セットの静的検証。Skill の増減時は `scripts/verify-agent-skills.sh` の `EXPECTED_SKILLS` も更新する）。

## Skill Selection Baseline

- 実装前に対象領域の Skill を特定し、未読なら先に読む。
- 優先参照:
  - 実装全般: `implementation-guidelines`
  - UI/UX 実装（着手前・コーディング中）: `growmate-ui-ux`
  - React: `react`（`patterns.md` / `doctor.md`）
  - Server Actions / Zod / エラー: `nextjs-server`
  - Supabase: `supabase`
  - Google 連携（GSC / GA4 / Google Ads・トークン・needsReauth）: `google-integrations`
  - 品質ゲート（検証・セルフレビュー・障害対応）: `quality-gate`
  - 仕様書レビュー: `spec-review` / TAKT workflow `.takt/workflows/spec-review.yaml`
  - 仕様実装→PR: TAKT workflow `.takt/workflows/spec-to-pr.yaml`
  - React Doctor→PR: TAKT workflow `.takt/workflows/react-doctor-to-pr.yaml`

一気通貫の PR 化は Skill ではなく TAKT workflow を正本とする。workflow の共通プロジェクト知識は `.takt/facets/knowledge/growmate.md` を参照する。

## Design Doc First（中〜大規模機能）

- 中〜大規模の機能（3+ステップの実装、または設計判断を伴う変更）は、**実装前に `docs/plans/` へ設計書を作成しレビューを受ける**。合意前に実装を始めない。
- 設計書レビューの観点は `spec-review` スキルを正本とし、一気通貫は TAKT `.takt/workflows/spec-review.yaml` を使う。合意（確認質問への回答・docs PR マージ）後に `spec-to-pr` で実装へ進む。
- 実装中に設計と異なる判断をした場合は、設計書を同じ PR 内で同期更新する（`update-docs` 参照）。

## Client Alignment Gate

- 仕様整理時は常に `docs/context/client-vision-from-lark.md` を確認する。
- 以下のいずれかを含む場合は `client-alignment-auditor`（`.agents/agents/client-alignment-auditor.*`）を使って確認質問を生成する:
  - 要件が曖昧
  - 複数解釈が成立
  - 挙動変更の可能性がある
  - ユーザー運用への影響がある
  - コスト・品質・納期のトレードオフが未合意
- クライアント合意前に実装を確定しない。

## Writing Policy For Core Memory Files

- `CLAUDE.md` には「普遍的に効く事実」と「最小手順」だけを書く。
- 長い手順、領域固有ノウハウ、実装例は Skill に置く。
- 既存コード参照はコピーよりポインタ（ファイルパス）を優先する。
