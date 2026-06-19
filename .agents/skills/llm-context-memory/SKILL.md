---
name: llm-context-memory
description: GrowMate の LLM 機能におけるコンテキスト設計・メモリ設計・token budget・RAG/外部ドキュメント注入・会話履歴要約・長期記憶の保存方針を確認する。チャット、Canvas、Google Ads/GSC 分析、RAG、Google Docs 連携、エージェント型機能、prompt_templates、LLM 呼び出し経路の仕様レビューや実装前設計では必ず使う。
---

# LLM Context / Memory

GrowMate で LLM を使う機能を設計・実装・レビューするときの補助 Skill。

LLM はリクエスト間の状態を保持しないため、アプリケーション側が「何を渡すか」「何を保存するか」「どこまで削るか」「誰が記憶を書き込めるか」を明示的に設計する必要がある。

## First Step

対象が LLM 呼び出し、RAG、外部ドキュメント注入、会話履歴、長期記憶、prompt template、分析データの要約、agentic workflow のいずれかを含む場合は、先に以下を読む。

- `docs/context/llm-context-memory-engineering.md`

## Review Checklist

仕様レビューや実装前設計では、最低限以下を確認する。

- Context Assembly Contract があるか
- LLM に渡す入力要素の由来と優先順位が分かれているか
- role、feature flag、model key、画面状態などの注入条件が明示されているか
- token / 文字数 / 件数 / データ期間の上限があるか
- 上限超過時の削減順序があるか
- 正本テンプレートや必須ユーザー入力を黙って削る仕様になっていないか
- Memory Taxonomy に沿って、正本知識、手順、会話履歴、ユーザー固有情報、運用状態を分けているか
- Memory Operations として、Compaction、Retrieval、Write / Consolidation、Forgetting / Decay の扱いが決まっているか
- ユーザー入力、LLM 出力、Web 検索結果を正本ナレッジへ自動保存していないか
- stale content や取得失敗時に、既存の正本を消さず UI に状態を出すか
- `.env`、secret、token、credential、不要な個人情報を LLM に渡していないか
- デバッグログに LLM 入力全文や機密情報を常時出していないか

## Output Guidance

レビュー時は、実装リスクに直結する抜け漏れを優先して指摘する。

指摘には以下を含める。

- 問題箇所
- なぜ危険か
- 仕様書または実装へ入れるべき修正案

問題がない場合も、残るリスクがあれば token budget、memory write、security / privacy、stale content の観点で短く明示する。
