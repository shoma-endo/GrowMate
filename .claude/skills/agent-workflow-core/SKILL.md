---
name: agent-workflow-core
description: CLAUDE.md の最小コア運用を補完する共通ワークフロー。Skill選定、client-alignment-auditor発火条件、段階的開示ルールを定義する。
---

# Agent Workflow Core

## Purpose

- `CLAUDE.md` は常時読み込みされるため、普遍的な最小方針のみを保持する。
- タスク固有ルールはこのファイルと各 Skill に分離し、必要時のみ参照する（Progressive Disclosure）。

## Skill Selection Baseline

- 実装前に対象領域の Skill を特定し、未読なら先に読む。
- 優先参照:
  - 実装全般: `implementation-guidelines`
  - React: `react19-patterns`
  - Server Actions / Routes: `server-actions-and-routes`
  - Supabase RLS: `supabase-rls`
  - Supabase Service Role: `supabase-service-usage`
  - 検証: `testing-and-troubleshooting`
  - セルフレビュー: `self-review`

## Client Alignment Gate

- 仕様整理時は常に `docs/context/client-vision-from-lark.md` を確認する。
- 以下のいずれかを含む場合は `client-alignment-auditor` を使って確認質問を生成する:
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
