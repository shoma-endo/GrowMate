---
name: spec-review
description: docs/plans 仕様書（設計書）のレビュー観点チェックリストと適用ルーティングの正本。仕様書のレビュー・監査、spec-to-pr 実行前の品質確認、TAKT spec-review ワークフローで使う。完全性・既存コード整合・非機能・セキュリティの共通観点と、クライアント整合 / LLM / UI / データ / Google 連携の条件付き観点の振り分けを定義する。
---

# 仕様書レビュー観点（SSoT）

`docs/plans/` の仕様書（設計書）を **実装前に** レビューするための観点チェックリスト。実装後の architecture review より修正コストが低い段階で欠陥を検出する。指摘の出力形式・重大度もここを正本とする。

## 共通観点（全仕様書に必須）

### A. 完全性

- [ ] 受け入れ条件（何ができたら完成か）が検証可能な形で書かれているか
- [ ] エラーパスが設計されているか（失敗・途中切れ・再試行・タイムアウト。正常系のみの仕様書は差し戻し）
- [ ] 検証方法（手動確認の画面・観点、`quality-gate` との対応）があるか
- [ ] 純関数・正規化・集計・日付・分離済み Zod スキーマを変更する場合、追加・更新するテストケースと期待結果が明記されているか
- [ ] DB / データ変更を伴う場合、マイグレーションとロールバック手順があるか
- [ ] 影響する既存画面・機能が列挙されているか

### B. 既存コードとの整合

- [ ] 再利用すべき既存実装（`src/server/services/*`、`src/server/actions/*`、`src/components/*`）を特定しているか。新規作成を提案している場合、既存に同等物がないことを確認したか
- [ ] 命名が `project-naming` に沿っているか（新規ファイル・テーブル・型）
- [ ] 既存パターン（`ServerActionResult` / `ERROR_MESSAGES` / `SupabaseService` 経由）からの乖離がある場合、乖離の理由が明示されているか

### C. 非機能

- [ ] データ量の見積りがあるか。大量行の取得・突合を含む場合、`docs/context/db-row-limits-and-data-truncation.md`（PostgREST `db-max-rows = 1000`）と矛盾しないか
- [ ] LLM / 外部 API の呼び出し回数・コスト・実行時間（`maxDuration`）の想定があるか
- [ ] バッチ / 定期処理は失敗時の再実行設計があるか

### D. セキュリティ

- [ ] 認可条件（role: `admin` / `paid` / `trial` / `unavailable`、`viewMode`）が明記されているか
- [ ] RLS / Service Role の使い分けと、Service Role 使用時の明示的な user_id スコープが設計されているか
- [ ] 機密情報（credential、token、`.env`）がクライアントや LLM 入力に露出しない設計か
- [ ] パブリックページ（`/home`, `/privacy` 等）に認証済み情報を出していないか

## 条件付き観点（ルーティング表）

仕様書の内容に応じて、以下の正本を **追加で** 適用する。

| 仕様書が含む内容 | 適用する観点の正本 |
|------|------|
| ユーザー向け挙動・UX・運用の変更 | `.agents/agents/client-alignment-auditor.md` の5条件（曖昧・複数解釈・挙動変更・運用影響・トレードオフ未合意）。該当時は確認質問を生成する |
| LLM 呼び出し・RAG・会話履歴・prompt template・エージェント型機能 | `llm-context-memory` SKILL.md の Review Checklist（Context Assembly Contract、token budget、Memory Taxonomy 等12項目） |
| 画面・UI コンポーネント | `growmate-ui-ux`（正本優先順位、画面種別指針、AI 連携 UI の鉄則） |
| DB スキーマ変更・RLS・大量データ取得 | `supabase`（`rls.md` / `service-usage.md` 運用ルール3） |
| GSC / GA4 / Google Ads 連携 | `google-integrations`（トークン管理、needsReauth、再認証導線） |

## 指摘の出力規約

指摘には必ず以下を含める（`llm-context-memory` の Output Guidance と同形式）。

- 問題箇所（仕様書のセクション）
- なぜ危険か（実装時に何が起きるか）
- 仕様書へ入れるべき修正案

**クライアント確認が必要な論点は修正案を断定せず、確認質問として隔離する**（client-alignment-auditor の出力形式: Alignment Check / Pre-implementation Questions / Risk If Unconfirmed）。エージェントが勝手に仕様を確定しない。

### 重大度

| レベル | 基準 | 扱い |
|--------|------|------|
| 🔴 Critical | このまま実装すると手戻り必至（エラーパス欠落、データ上限矛盾、認可未定義、クライアント合意未取得） | 修正または確認質問の回答まで spec-to-pr に進まない |
| 🟡 Important | 実装中に判断を迫られ、実装者の裁量で仕様が決まってしまう箇所 | 原則修正。残す場合は理由を明記 |
| 🟢 Nice-to-have | 記述の明確化・構成改善 | 任意 |

## ワークフロー

一気通貫のレビューは TAKT `.takt/workflows/spec-review.yaml` を使う（レビュー → 仕様書修正 → 再レビュー → 現在ブランチへ commit。新規ブランチ作成・push・PR はしない）。レビュー済み仕様書の合意後に `.takt/workflows/spec-to-pr.yaml` で実装へ進む。

## 関連スキル

- 設計書先行ルール・クライアント整合ゲート: `agent-workflow-core`
- docs 分類と同期更新: `update-docs`
- 実装後のコードレビュー観点: `quality-gate`（`self-review.md`）
