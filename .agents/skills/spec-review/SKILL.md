---
name: spec-review
description: docs/plans 仕様書（設計書）のレビュー観点チェックリストと適用ルーティングの正本。仕様書のレビュー・監査、spec-to-pr 実行前の品質確認、TAKT spec-review ワークフローで使う。完全性・既存コード整合・非機能・セキュリティの共通観点と、クライアント整合 / LLM / UI / データ / Google 連携 / 外部サービス連携の条件付き観点の振り分けを定義する。外部サービス（Google・WordPress・Instagram 等）連携時は公式ドキュメントを一次情報として WebFetch で照合する規約もここに含む。
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
- [ ] README.md の更新要否を判断しているか（`update-docs` の README 行が対象: 🚀主な機能・🏗️アーキテクチャ図・📋環境変数・📁プロジェクト構成・🛠️技術スタック等に該当する変更があれば更新対象として明記する。該当なしなら明記不要）

### B. 既存コードとの整合

- [ ] 再利用すべき既存実装（`src/server/services/*`、`src/server/actions/*`、`src/components/*`）を特定しているか。新規作成を提案している場合、既存に同等物がないことを確認したか
- [ ] 命名が `project-naming` に沿っているか（新規ファイル・テーブル・型）
- [ ] 既存パターン（`ServerActionResult` / `ERROR_MESSAGES` / `SupabaseService` 経由）からの乖離がある場合、乖離の理由が明示されているか
- [ ] 今回新規追加する処理が、既存の類似実装（本仕様書が触れる既存画面・サービス）と重複する場合、共通化candidateを提案しているか（対象は本仕様書のスコープ内に限る。無関係な既存コードの大規模リファクタは対象外）

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
| 外部サービス連携（Google / WordPress / Instagram(Meta) / LINE / Stripe / Supabase 等）| 下記「外部サービス連携の一次情報検証」。**各サービスの公式ドキュメントを WebFetch で実際に取得して照合する** |

## 外部サービス連携の一次情報検証

外部サービスの仕様は変わる。記憶・過去の実装・ブログ記事・要約サイトを根拠にした記述は信用しない。**一次情報は公式ドキュメントのページ本文のみ**とし、レビュー時に WebFetch で取得して照合する。

### 公式ドキュメントの起点

| サービス | 起点 URL |
|------|------|
| Google Search Console API | https://developers.google.com/webmaster-tools |
| Google Analytics Data API (GA4) | https://developers.google.com/analytics/devguides/reporting/data/v1 |
| Google Ads API | https://developers.google.com/google-ads/api/docs/start |
| Google OAuth 2.0 | https://developers.google.com/identity/protocols/oauth2 |
| WordPress REST API | https://developer.wordpress.org/rest-api/ |
| Instagram Platform (Meta Graph API) | https://developers.facebook.com/docs/instagram-platform |
| LINE Developers (Messaging API / LIFF) | https://developers.line.biz/ja/docs/ |
| Stripe API | https://docs.stripe.com/api |
| Supabase | https://supabase.com/docs |

起点 URL が 404・リダイレクトになっている場合は各サービスの公式トップから辿り直し、**この表を更新する**（表の陳腐化そのものが指摘対象）。表にないサービスは公式ドメインのドキュメントを探し、追加を提案する。

### 検証必須項目

仕様書が外部 API の挙動を前提にしている箇所について、以下を公式ページで確認する。

- [ ] エンドポイント・メソッド・API バージョンが実在し、仕様書の記述と一致するか
- [ ] 必須パラメータ・レスポンスフィールド名が公式の定義どおりか（フィールド名の綴り・型・省略可否）
- [ ] 必要な権限スコープ / パーミッション（OAuth scope、Meta の permission、WordPress のユーザー権限等）が仕様書に列挙されているか
- [ ] レート制限・クォータ・データ取得上限が明記され、仕様書の取得量・実行頻度と矛盾しないか
- [ ] 非推奨（deprecated）・提供終了予定・移行先の告知が出ていないか
- [ ] 前提条件（例: アカウント種別、事前審査、連携済みであること）が公式に明記され、仕様書がそれを満たす前提になっているか
- [ ] データ反映遅延・集計仕様（例: 指標の確定タイミング）が公式に定義されている場合、仕様書の期待値と一致するか

### 引用規約

公式ドキュメントを根拠に仕様書を書く・直す場合は、必ず次を残す。

- 参照 URL（トップではなく該当ページ）
- 確認日（YYYY-MM-DD）
- **原文の verbatim 引用**。要約サイト・記事・過去の会話の要約を経由した引用は禁止。公式ページ本文を実際に取得し、そこにある文言をそのまま引く
- 引用から導いた自分の解釈は、引用と分けて書く（引用の中に解釈を混ぜない）

### 判定

| 状況 | 扱い |
|------|------|
| 公式ドキュメントの記述と仕様書が矛盾する | 🔴。公式を正とし、仕様書を修正する |
| 公式に非推奨・提供終了が告知されている API に依存している | 🔴 |
| 権限スコープ・レート制限・前提条件が公式にあるのに仕様書が未記載 | 🟡 |
| 公式ドキュメントに記述が見つからない挙動を仕様書が前提にしている | 断定せず「公式未記載・実機確認が必要」として確認質問に隔離する。推測で仕様を確定しない |
| WebFetch が失敗し公式ページを取得できない | レビューを止めず、「未確認（取得失敗した URL）」として明記したうえで残りの観点を続行する |

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

共通化candidate（B観点）は原則 🟢。実装しないと後続タスクでのコスト差が明白な場合のみ 🟡 に格上げする。

## ワークフロー

一気通貫のレビューは TAKT `.takt/workflows/spec-review.yaml` を使う（レビュー → 仕様書修正 → 再レビュー → 現在ブランチへ commit。新規ブランチ作成・push・PR はしない）。レビュー済み仕様書の合意後に `.takt/workflows/spec-to-pr.yaml` で実装へ進む。

## 関連スキル

- 設計書先行ルール・クライアント整合ゲート: `agent-workflow-core`
- docs 分類と同期更新: `update-docs`
- 実装後のコードレビュー観点: `quality-gate`（`self-review.md`）
