# LLMトークン使用量 仕様書（全機能対象・改訂版）

> **2026-09-30 改訂**: 本書は旧版（2026-01-28、`chat_token_usages`・チャット `/app/chat` 専用）を**全面的に置き換える**。
> ファイル名は既存リンクを壊さないため旧名（`chat-token-usage-spec`）のまま据え置く。
> 旧版にあった「管理画面 トークン消費UI 仕様（追記）」は本書の末尾に**削除せず残す**が、**別タスク・本書のスコープ外**（§8）。

## メタデータ

- 文書名: LLMトークン使用量 仕様書（全機能対象）
- ステータス: `draft`（ユーザー確認待ち。§11 の確認事項が未解決）
- 最終更新日: 2026-09-30
- 確認した develop: `b26c3207`（2026-09-30 時点）
- 関連: `docs/specs/anthropic-base-sonnet5-migration-spec.md`（`claude-sonnet-5` 移行）
- 種別: **設計書のみ。実装・DB 変更は含まない**（共有 DB `rnmljzdsncucvkcmoaun` へのマイグレーション適用は §10 の PR1 で別途ユーザー承認を取る）

## 1. 背景と現状（develop 時点の事実）

旧版の前提のうち、次の点が現状と合っていない。

| 旧版の記述 | 現状（コード確認済み） |
| --- | --- |
| 対象は `/app/chat` のチャットのみ | LLM は全機能で使われている（§4 の表） |
| 保存箇所は anthropic stream route と `llmService` の2箇所 | LLM 呼び出しは **Anthropic SDK 直叩きが 2 ルート（chat 1 箇所・canvas 3 箇所）＋ `llmChat` 経由が 7 ファイル（計 11 呼び出し箇所）** |
| 集計軸は `service_id` | 機能（feature）・ユーザー・モデルが必要。`service_id` は chat/canvas でしか意味を持たない |
| 前提モデルは Sonnet 4.6 | `ANTHROPIC_BASE.actualModel = 'claude-sonnet-5'`（`src/lib/constants.ts`）。`content_annotation_ai_summary` のみ同値を個別指定。OpenAI は FT モデル `ft:gpt-4.1-nano-2025-04-14:personal::BZeCVPK2` と `gpt-4o-mini` |
| キャッシュトークンは扱わない | 既に `mergeTokenUsage` が `cache_creation_input_tokens` / `cache_read_input_tokens` / TTL 別（5m・1h）/ `web_search_requests` を保持している。`llmService` は `system` に `cache_control: ephemeral` を付けるためキャッシュ分は現実に発生する |
| 管理画面 UI まで含む | UI は本書のスコープ外 |

現在の計測状況:

- **DB に使用量テーブルは存在しない**（共有 DB を読み取り SQL で確認。`token` / `usage` を含む public テーブルなし）。`chat_token_usages` も未作成。
- チャット（`app/api/chat/anthropic/stream/route.ts`、`message_stop` 時）と Canvas（`app/api/chat/canvas/stream/route.ts`、リクエスト末尾）は `logTokenUsage()`（`src/server/lib/anthropic-token-usage.ts`）で**アプリログにのみ**出力している。
- `src/server/services/llmService.ts` は `callAnthropic` / `callOpenAI` とも `resp.usage` / `completion.usage` を**捨てている**（`max_tokens` 打ち切り時の `console.warn` で `usage` を参照するだけ）。`llmChat` の戻り値は `Promise<string>`。
- `anthropic-token-usage.ts` には **Sonnet 4.6 の単価がハードコード**されており（`SONNET_4_6_PRICE_PER_MILLION_TOKENS_USD`、`WEB_SEARCH_PRICE_PER_REQUEST_USD`）、ログの `sonnet46CostUsd` はそれで計算している。現行モデルは `claude-sonnet-5` なので**この値を sonnet-5 の原価として流用してはならない**（§7）。
- 5 本の cron（`vercel.json`）: `gsc-evaluate`・`ga4-content-evaluate`・`google-ads-negative-keywords-suggestion`・`gsc-suggestions`（毎時）、`content-annotation-summary`（10 分毎）。このうち LLM 呼び出し箇所（`llmChat` 等）に到達するのは後ろ 4 本（`gsc-evaluate` 自体は `llmChat` を呼ばない。grep で確認）。

## 2. 目的・非目標

**目的**: LLM の**原価を把握する（記録する）**こと。「いつ・誰が（またはシステムが）・どの機能で・どのモデルに・何トークン使ったか」を 1 API 呼び出し 1 行で残し、金額は集計時に算出できるようにする。

**非目標（今回やらない）**:

- プラン別の上限でリクエストを止める処理（クォータ・ブロック）。
- 請求・課金処理、ユーザー向けの使用量表示、管理画面 UI（§8）。
- 金額（USD/JPY）の DB 保存。
- 過去分の遡及記録（計測不可。**記録開始日以降のみ**）。
- OpenAI FT モデルの**学習コスト**（推論トークンのみ対象）。

**将来の余地**: 上限制御は、本テーブルの `(user_id, created_at)` 集計をプランの上限値と突き合わせる形で後付けできる。そのため `user_id` と `created_at` のインデックスは最初から用意する（実装は別タスク）。

## 3. データモデル

### 3.1 テーブル名

旧 `chat_token_usages` を **`llm_token_usages`** に改名する（全機能・全プロバイダ対象のため）。

### 3.2 カラム定義（案）

| カラム | 型 | Null | 説明 |
| --- | --- | --- | --- |
| id | uuid | NO | PK（`gen_random_uuid()`） |
| user_id | uuid | **YES** | 帰属ユーザー（`public.users.id`）。**NULL = システム分**（§5.5）。`chat_sessions.user_id` は text だが、`users.id` は uuid のため uuid 型（`content_annotation_summary_jobs.user_id` と同型） |
| feature | text | NO | 機能キー（§4）。TS 側の const union を正とし、DB の CHECK は付けない（機能追加のたびにマイグレーションが要るのを避ける） |
| origin | text | NO | `interactive`（ユーザー操作の同期実行）/ `cron`（cron 起点。ユーザー起票ジョブを cron が処理する場合を含む）。CHECK で 2 値に制限 |
| environment | text | NO | `production` / `preview` / `local`。**本番とプレビューが同じ共有 DB を使う**ため、集計時に切り分けられるようにする（`cron_run_logs.environment` と同じ考え方。判定ロジックは `src/server/lib/cron-observability.ts` の関数内にあり export されていないため、PR2 で共通関数へ切り出す） |
| provider | text | NO | `anthropic` / `openai` |
| model | text | NO | 実際に API へ渡したモデル名（例 `claude-sonnet-5`、`ft:gpt-4.1-nano-…`）。`MODEL_CONFIGS[*].actualModel`。§6 の単価結合キー |
| response_model | text | YES | API が応答で返したモデル名（Anthropic `message.model` / OpenAI `completion.model`）。`model` が別名の場合、別名の指す実体（スナップショット）が変わったことを後から見分けるため（Claude 案・未確認）。単価結合には使わない |
| input_tokens | integer | NO | キャッシュ分を**含まない**通常入力（§9 の正規化ルール） |
| output_tokens | integer | NO | 出力。拡張思考（thinking）を有効にした場合の思考トークンは出力側に含まれる想定（公式で要再確認） |
| cache_read_tokens | integer | NO | キャッシュ読み取り入力（Anthropic `cache_read_input_tokens`） |
| cache_creation_tokens | integer | NO | キャッシュ書き込み入力の合計。TTL 内訳があればその合計、無ければ `cache_creation_input_tokens`（既存 `getCacheCreationInputTokens` と同じ規則） |
| cache_creation_5m_tokens | integer | NO | 上記のうち 5 分 TTL 分（内訳が取れない場合 0） |
| cache_creation_1h_tokens | integer | NO | 上記のうち 1 時間 TTL 分（内訳が取れない場合 0） |
| web_search_requests | integer | NO | Anthropic `server_tool_use.web_search_requests`（OpenAI は 0） |
| total_tokens | integer | NO | **GENERATED**: `input + output + cache_read + cache_creation`（既存 `getTotalTokens` と同じ定義。旧版の `input + output` から変更） |
| session_id | text | YES | `chat_sessions.id`（text）。FK は張らない（セッション削除で原価記録を消さない） |
| message_id | text | YES | `chat_messages.id`（text）。FK なし。**現状どの経路でも値を入れられず常に NULL になる見込み**（ストリーム中は未確定）。Claude 案として予約するのみで、不要なら削る |
| request_id | text | YES | プロバイダの応答 ID（Anthropic `message.id` / OpenAI `completion.id`）。追跡・重複調査用 |
| context | jsonb | NO | 機能固有の補助情報。**ID と種別のみ**（例 `{"stage":"canvas_edit"}`、`{"template":"gsc_insight_ctr_boost"}`、`{"model_key":"blog_creation_step3"}`、`{"content_annotation_id":"…"}`）。**プロンプト本文・記事本文・個人情報は入れない**。既定 `{}` |
| created_at | timestamptz | NO | `timezone('utc', now())`（`cron_run_logs` と同じ既定値） |

設計上の判断:

- **金額カラムは持たない**（合意済み）。`web_search_requests` も件数のみ保存し、単価は集計時に掛ける。
- **1 行 = 1 回の LLM API 呼び出し**（旧版の「1 リクエスト 1 レコード」から変更）。Canvas（最大 3 回）や GSC 提案（最大 4 ステージ）のように 1 リクエスト内で複数回呼ぶ機能は複数行になる（§4・§5.3）。
- `user_id` に FK は張らない案。ユーザー削除（`docs/specs/admin-user-deletion-design.md`）で原価履歴を残すため。ただし孤児行を許容するかは §11 の確認事項。
- `feature` の CHECK を付けない代わりに、`src/server/lib/` の const 配列＋型で網羅性を保つ。

### 3.3 `total_tokens` の扱い

GENERATED カラム（`stored`）。アプリは INSERT/UPDATE で `total_tokens` を指定しない（旧版の規約を継承）。キャッシュ込みで定義を変えるため、旧版の「input + output」前提の集計は使えない。

### 3.4 インデックス（案）

- `idx_llm_token_usages_user_created` : `(user_id, created_at desc)` — ユーザー別・月次、将来の上限判定
- `idx_llm_token_usages_feature_created` : `(feature, created_at desc)` — 機能別
- `idx_llm_token_usages_created` : `(created_at desc)` — システム全体の月次・`user_id is null` の集計
- `idx_llm_token_usages_session` : `(session_id) where session_id is not null` — セッション別（旧版の `(session_id, created_at)` を部分インデックス化）
- モデル別集計は `(provider, model, created_at)` を**最初は作らない**（行数が小さいうちは不要。必要になってから追加）

### 3.5 RLS・権限

`supabase/migrations/20260928220845_add_cron_run_logs.sql`・`20260904000000_add_content_annotation_summary_jobs.sql` の書式に合わせる。

- `alter table … enable row level security`
- select: 本人のみ `using ((select auth.uid()) = user_id)`（`user_id is null` のシステム分は誰からも見えない）。**ユーザー指定（select 本人）に従う**。前例は `content_annotation_summary_jobs_select_own`（`20260904000000_…`）。一方 `cron_run_logs` などは `revoke all … from anon, authenticated` のみでポリシーなし。本書はユーザー向け表示を非目標にしているので、**select 本人を本当に許可するかは §11 で確認**（不要なら `cron_run_logs` 型の revoke のみに絞る）
- insert/update/delete: ポリシーを作らない＝**サービスロールのみ**（RLS をバイパス）。select を許可する場合は `grant select on … to authenticated` を明示する
- 実際のセキュリティ境界はアプリ層の `.eq('user_id', userId)`（`.agents/skills/supabase/service-usage.md` §3）。RLS は多層防御

### 3.6 マイグレーション規約・ロールバック

- ファイル名: `supabase/migrations/<14桁タイムスタンプ>_add_llm_token_usages.sql`。最新は `20260930000000_unschedule_cleanup_employee_invitations.sql`。`20260928220845_add_cron_run_logs.sql`（14 桁・時刻あり）と `20260930000000_…`（時刻 0 埋め）の両方の実例があり、どちらでも既存規約内。**それより後の日時**にする。
- 先頭にコメントで `-- Rollback:` を書く（`add_cron_run_logs.sql` と同じ形式）:
  ```sql
  -- Rollback:
  --   drop table if exists public.llm_token_usages;
  ```
- `create table if not exists` / `create index if not exists` / `drop policy if exists` → `create policy` の冪等形式にする。
- 単価表（§7）は**別マイグレーション**にする（単価確認待ちで本体をブロックしないため）。

### 3.7 DDL スケッチ（実装者向け・未適用）

```sql
create table if not exists public.llm_token_usages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  feature text not null,
  origin text not null check (origin in ('interactive', 'cron')),
  environment text not null check (environment in ('production', 'preview', 'local')),
  provider text not null check (provider in ('anthropic', 'openai')),
  model text not null,
  response_model text,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cache_read_tokens integer not null default 0 check (cache_read_tokens >= 0),
  cache_creation_tokens integer not null default 0 check (cache_creation_tokens >= 0),
  cache_creation_5m_tokens integer not null default 0 check (cache_creation_5m_tokens >= 0),
  cache_creation_1h_tokens integer not null default 0 check (cache_creation_1h_tokens >= 0),
  web_search_requests integer not null default 0 check (web_search_requests >= 0),
  total_tokens integer generated always as
    (input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens) stored,
  session_id text,
  message_id text,
  request_id text,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint chk_llm_token_usages_cache_ttl
    check (cache_creation_5m_tokens + cache_creation_1h_tokens <= cache_creation_tokens)
);
```

## 4. 機能キー一覧（LLM 呼び出し箇所の網羅）

develop（`b26c3207`）でリポジトリ全体（`src` / `app` / `scripts` / `supabase` / `.github`）を検索した結果。検索語: `llmChat`、`anthropic.messages.(create|stream)`、`openai.chat.completions`、`new Anthropic` / `new OpenAI`、SDK import、`/v1/messages`、`api.anthropic.com` / `api.openai.com`、Gemini 等の他プロバイダ名、`ft:`。**SDK を直接 `new` しているのは `llmService.ts` と 2 つのストリームルートのみ**。他プロバイダ（Gemini 等）の利用はなし。

| feature | 呼び出し元（ファイル:位置） | 経路 | プロバイダ/モデル | user_id の取得元 | origin |
| --- | --- | --- | --- | --- | --- |
| `chat` | `app/api/chat/anthropic/stream/route.ts`（`anthropic.messages.stream`、`message_stop` で `logTokenUsage`） | SDK 直（ストリーム） | anthropic / `MODEL_CONFIGS[model].actualModel`（現行 `claude-sonnet-5`）。Web 検索ツールあり | 認証済み `userId` | interactive |
| `chat` | `src/server/services/chatService.ts` `startChat`/`continueChat` 内の `llmChat`（2 箇所）。`src/server/actions/chat/modelHandlers.ts` 経由のサーバーアクション（`chat.actions.ts`） | `llmChat`（非ストリーム） | `MODEL_CONFIGS[model]`（未指定は `ad_copy_creation`） | メソッド引数 `userId` | interactive |
| `canvas` | `app/api/chat/canvas/stream/route.ts` の最大 3 段（Web 検索（`shouldEnableWebSearch` のときのみ）/ 編集 / 分析）。末尾で `requestTokenUsageTotal` を `logTokenUsage` | SDK 直（ストリーム）×3 | anthropic / `actualModel`。Web 検索あり | 認証済み `userId` | interactive |
| `chat_ft_keyword` | `modelHandlers.ts` の `llmChat`（2 箇所: `handleContinue` 内 FT 分岐、`handleFTModel`） | `llmChat` | openai / `ft:gpt-4.1-nano-2025-04-14:personal::BZeCVPK2` | メソッド引数 `userId` | interactive |
| `chat_history_summary` | `chatService.ts` `summarizeHistory`（`continueChat` から呼ばれる。履歴が長いとき） | `llmChat` | openai / FT モデルの `actualModel`（無ければ `gpt-4o-mini`） | **現状は引数に無い。`continueChat` の `userId` を渡すよう変更** | interactive |
| `gsc_suggestion` | `gscSuggestionService.ts` `runOne()` 内 `llmChat`（1 箇所。`generate()` がステージ 1〜4 を `Promise.allSettled` で**並列**実行するため、1 ジョブで最大 4 行） | `llmChat`（本文は `stream: true`） | anthropic / `gsc_insight_*`（現行 sonnet-5） | `generate()` の `params.userId`（`gscSuggestionJobService.processJob` が `job.user_id` を渡す）。**`runOne` は現状 `userId` を受け取らない**ため引数追加が要る | cron |
| `ga4_content_evaluation` | `ga4EvaluationLlmService.ts` `generateGa4EvaluationLlmOutput`（最大 `MAX_ATTEMPTS` 回ループ。**試行ごとに 1 行**） | `llmChat` | anthropic / `ga4_content_evaluation` | **`ga4ContentEvaluationService.generateNarrative` は `runInput.userId` を持つが LLM サービスへは渡していない。request に追加** | cron（定期）/ interactive（手動実行アクション） |
| `content_annotation_summary` | `contentAnnotationSummaryService.ts` `generateSummary()` の `llmChat`（1 箇所） | `llmChat` | anthropic / `content_annotation_ai_summary`（`thinking: disabled`） | `params.executorUserId`（一括ジョブは `job.user_id`） | 単記事の同期実行 = interactive / 一括バックグラウンド（`contentAnnotationSummaryJobService` → cron）= cron |
| `google_ads_ai_analysis` | `googleAdsAiAnalysisService.ts` `analyzeAndSend()` の `llmChat`（2 箇所: 開発用サンプル経路と本番経路） | `llmChat`（`stream: true`） | anthropic / `google_ads_ai_evaluation` | 引数 `userId`（呼び出しは `googleAdsEvaluation.actions.ts` のみ） | interactive |
| `google_ads_negative_keywords` | `googleAdsNegativeKeywordsSuggestionService.ts` `sendNegativeKeywordsSuggestionForUser()` の `llmChat`（1 箇所） | `llmChat` | anthropic / `google_ads_negative_keywords_suggestion` | 引数 `userId`（cron は `runAllDueSuggestions` → `runWithUserTimeLimit(userId)`） | interactive（`googleAdsNegativeKeywordsSuggestion.actions.ts`）/ cron |
| 共通 | `src/server/services/llmService.ts` `llmChat` → `callOpenAI` / `callAnthropic` | — | — | — | **ここで usage を受け取り記録する**（§5.1） |

対象外（確認済み）:

- `scripts/check-api-changelogs.ts` の `anthropic.messages.*` / `chat.completions` はプロンプト文字列中の記述で、SDK 呼び出しではない。
- CI（`.github/workflows/ci.yml`）の `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` はダミー値。TAKT 等の開発ツールはアプリ経路ではないため対象外。
- ストリームルート（chat: `route.ts` の `startChat`/`continueChat`、canvas: `continueChat`）は、いずれも**メッセージ配列**で呼んでおり、応答の保存のみ（`llmChat` を呼ぶのは `string` 引数の分岐のみ）。`llmChat` 経由の記録と二重計上にならない（レビューで確認済み）。

到達性（レビュー時のコード確認。実装時に再確認）: UI から非ストリーム経路（サーバーアクション）へ進むのは `provider === 'openai'` のモデル（FT）のみ（`useChatSession.ts`）。したがって `chat_ft_keyword` は現役。一方、`chatService` の `string` 分岐（Anthropic の `chat` 2 箇所）と、そこからのみ呼ばれる `summarizeHistory`（`chat_history_summary`）は、現状 UI から到達しない。到達しなくても `llmChat` を通るため、§5.1 の仕組みで自動的に記録される。

機能キーの TS 定義案（新規ファイル・実装は別 PR）: `src/server/lib/llm-usage-features.ts`（新規）に `export const LLM_FEATURES = [...] as const; export type LlmFeature = (typeof LLM_FEATURES)[number];`。

## 5. 記録の集約方針

### 5.1 `llmService`（`llmChat`）での記録

「呼び出し元が記録し忘れる」ことを型で防ぐ。

1. `LLMOptions` に**必須**の `usageContext: LlmUsageContext` を追加する。現状は `opts: LLMOptions = {}`（既定値あり）なので、**既定値を外して必須引数にする**。名前は、応答の `usage`（トークン数）と紛らわしいため `usageContext` とする。
   ```ts
   type LlmUsageContext = {
     feature: LlmFeature;
     userId: string | null;        // null = システム分
     origin: 'interactive' | 'cron';
     sessionId?: string;
     messageId?: string;
     context?: Record<string, string | number | boolean>;
   };
   ```
   必須にすることで、全呼び出し元（§4 の `llmChat` 経由 11 箇所）が指定しないとコンパイルエラーになる。`userId: null` は「システム分」を**明示的に**選ばせるため（付け忘れで NULL になる事故を防ぐ）。
2. `callAnthropic` / `callOpenAI` の戻り値を `{ text, usage, requestId, responseModel }` に変更し、`llmChat` の外向き戻り値は **`Promise<string>` のまま**にする（呼び出し元の戻り値の扱いは変わらない）。現状「応答が空」の例外は `callOpenAI`（`llmService.ts:138`）・`callAnthropic`（同 `:202`）の中で戻り値を返す前に投げているため、**空チェックを `llmChat` 側へ移す**（`call*` は空文字のまま返し、`llmChat` が記録した後に同じ例外を投げる）。`usageContext` を `call*` まで渡す案より変更箇所が少ない。
   - 既存テストへの影響: `usageContext` 必須化で、`tests/unit/server/services/ga4EvaluationLlmService.test.ts` の `toHaveBeenCalledWith(…, { timeoutMs: 45_000, maxTokens: 1234 })`（オプションの完全一致）と、`tests/unit/server/services/llmService.test.ts` の 3 引数呼び出しは書き換えが要る（PR2 に含める。§10）。
3. usage の取り込み:
   - Anthropic: `resp.usage`（`input_tokens`・`output_tokens`・`cache_read_input_tokens`・`cache_creation_input_tokens`・`cache_creation.ephemeral_5m/1h_input_tokens`・`server_tool_use.web_search_requests`）。既存 `mergeTokenUsage` を再利用して `TokenUsageTotals` に正規化する。`stream: true` の場合も `finalMessage()` の `usage` を使う。
   - OpenAI: `completion.usage`（`prompt_tokens` / `completion_tokens` / `prompt_tokens_details.cached_tokens`）。正規化ルールは §9。
4. **記録のタイミング**: `llmChat` 内で `call*` から戻った直後、**「応答が空」エラーを投げる前**に記録する（トークンは課金済みのため。手順 2 の空チェック移動が前提）。`max_tokens` 打ち切りでも応答は返るので通常どおり記録。
5. 記録は新設の `recordLlmTokenUsage(input)`（新規ファイル案: `src/server/services/llmTokenUsageService.ts`）に集約する。`SupabaseService` のサービスロールクライアントで insert し、`environment` はここで解決する。

### 5.2 記録失敗が本処理を止めない

- `recordLlmTokenUsage` は**例外を投げない**（内部で try/catch）。失敗は `logger.error('[LLM Token Usage] record failed', {feature, provider, model, …})` に出すだけで、**リトライしない**（合意済み）。DB 障害時は欠損し得る（§11 リスク）。
- Vercel のサーバーレスでは、応答返却後の未 await の Promise は打ち切られ得るため、**fire-and-forget にはせず `await` する**。ただし待ち時間が本処理を伸ばさないよう短いタイムアウト（値は実装時に決める。未決）を付ける。代案として Next.js の `after()` で応答後に記録する方法もある。公式ドキュメント（`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`）上は Route Handler・Server Function で使えるが、Vercel で応答後に確実に実行されるか、リクエスト外（下記の打ち切られた処理など）から呼んだときの挙動は**未検証**（実装時に確認）。
- `await` しても、呼び出し元が LLM 呼び出しの完了を待たずに先へ進む経路では記録が失われ得る。現状の該当: `googleAdsNegativeKeywordsSuggestionService.runWithUserTimeLimit`（`Promise.race` でユーザー単位の時間切れを判定し、LLM 呼び出しは裏で走り続ける）。時間切れ後に完了した呼び出しの記録は、関数終了後に凍結・打ち切られ得る（既知の欠損。§11 リスク 3）。
- usage が取れない（プロバイダが返さない等）場合は記録をスキップしてログのみ。0 埋めの行は作らない。
- タイムアウト・中断（`AbortSignal`）・API エラーで応答が取れなかった呼び出しは usage が無いため**記録されない**（既知の欠損。§11）。

### 5.3 ストリーム系（チャット / Canvas）

`llmChat` を通らないため、**既存の `logTokenUsage` 呼び出し箇所で DB にも記録**する。

- **チャット**（`app/api/chat/anthropic/stream/route.ts`）: `message_stop` の `logTokenUsage(tokenUsage)` の直後に `recordLlmTokenUsage`（`feature: 'chat'`、`origin: 'interactive'`、`userId`、`sessionId` = リクエストの `sessionId`、`context.model_key` = `model`）。新規セッションでは `sessionId` が保存後に確定するため NULL になり得る（許容）。`message_id` は常に NULL（§3.2）。ストリーム後の上限チェック（`checkTrialDailyLimit`）や保存処理が失敗しても usage は残すため、**これらより前に**記録を開始する。ただし記録の insert を待ってから上限チェックに進むと、毎ターンの保存と最後の SSE が insert の分だけ遅れる。記録と上限チェックは互いに依存しないため、**`Promise.all` で並行実行**する（Claude 案・未確認）。
- **Canvas**（`app/api/chat/canvas/stream/route.ts`）: 現状は最大 3 段（Web 検索（`shouldEnableWebSearch` のときのみ）・編集・分析）の usage を `requestTokenUsageTotal` に合算して末尾で 1 回だけログ出力している。末尾まで到達しないエラーでは途中段の usage が失われるため、**各段の完了直後に 1 行ずつ記録する案を推奨**（`feature: 'canvas'`、`context.stage` = `web_search` / `edit` / `analysis`）。モデルは各段とも同一（`actualModel`）なので合算 1 行でも原価は同じだが、欠損耐性と段別の原価把握のため段別を推奨。記録の置き場所は、各段の `withAnthropicRetry`（`src/server/lib/anthropic-retry.ts`）に渡す**クロージャの中**とし、試行ごとに `try/finally` で「その試行で `message_start` 以降に取れた usage」があれば 1 行記録する（`context.attempt` に試行番号。Claude 案・未確認）。クロージャの外に置くと成功した試行の分しか残らず、現状 `requestTokenUsageTotal` への加算も成功経路（`message_stop` 後、Web 検索段は成功時の戻り値）でしか行っていないため、`message_start` 後に overloaded 等で再試行された試行の usage は失われる。失敗試行が課金対象かどうかは**未確認**（実装時に確認。課金されないと分かれば成功試行のみに絞る）。
- `logTokenUsage` 自体は残す（アプリログでの即時確認用）。ただし `sonnet46CostUsd` の出力は、sonnet-5 の単価確認後に削除または差し替える（§7）。

### 5.4 feature と user_id を呼び出し元から渡す

§4 の表の「user_id の取得元」のとおり、ほぼ全経路で呼び出し元のコンテキストに `userId` が既にある。追加が必要なのは次の引数の取り回しのみ。

- `summarizeHistory(messages)` → `summarizeHistory(userId, messages)`（`continueChat` から渡す）
- `generateGa4EvaluationLlmOutput(request)` の `request` に `userId` と `origin` を追加（`generateNarrative` が `runInput.userId` を渡す）。`origin` の入口は `RunGa4ContentEvaluationInput`（`ga4ContentEvaluationService.ts`）と `retryNarrative(userId, annotationId)`。呼び出し元は、アクション（`ga4ContentEvaluation.actions.ts`）= `interactive`、バッチ（`ga4ContentEvaluationBatchService.ts` の `ga4ContentEvaluationService.run`、`userId = cycle.user_id`）= `cron`
- `contentAnnotationSummaryService.generateSummary` に `origin` を追加（呼び出し元: アクション = `interactive`、`contentAnnotationSummaryJobService` = `cron`。`maxRetries` の有無などから**推測しない**）
- `sendNegativeKeywordsSuggestionForUser(userId, opts)` に `origin` を追加（cron は `runWithUserTimeLimit` 経由で `cron`）
- `gscSuggestionService.generate` は `params.userId` があるため `origin: 'cron'` 固定（呼び出しは `gscSuggestionJobService` のみ）。LLM を呼ぶのは `runOne()` なので、`generate` → `runOne` へ `userId` / `origin` を渡す引数を追加する

### 5.5 バッチ・cron・バックグラウンドでの user_id 帰属

合意方針: **実行を起動したユーザーの `user_id` で記録し、ユーザーがいない処理は `user_id = NULL`（システム分）として別枠で記録する。**

コード上の取り方:

| 処理 | 帰属 | 取得元 |
| --- | --- | --- |
| AI 要約の一括（バックグラウンド） | 起票したユーザー | `content_annotation_summary_jobs.user_id`（`processJob` で `job.user_id`、`generateSummary({ executorUserId })`）。`origin = cron` |
| GSC 改善提案ジョブ | 評価対象記事の所有者 | `gsc_article_evaluation_history` の claim 行 `job.user_id`。`origin = cron` |
| GA4 コンテンツ評価（定期） | 評価対象記事の所有者 | `cycle.user_id`（`ga4ContentEvaluationBatchService` がユーザー単位でループ）。`origin = cron` |
| 除外キーワード提案（定期） | 設定を持つユーザー | `runAllDueSuggestions` のユーザーループの `userId`。`origin = cron` |
| ユーザーが UI から起動した処理 | そのユーザー | 認証済み `auth.userId`。`origin = interactive` |
| **ユーザーに紐付かない処理（システム分）** | `NULL` | 現状のコードには**該当する呼び出しは見つかっていない**（上記 cron はいずれもユーザー単位）。将来の社内バッチ、またはユーザーを特定できない場合に `userId: null` を明示する |

この整理のポイントと確認事項（§11）:

- cron 起動の処理でも、**対象ユーザーが特定できるものはそのユーザーに帰属**させ、`origin = 'cron'` で「自動実行分」を分離して集計できるようにした。「システム分」= `user_id IS NULL`、「自動実行分」= `origin = 'cron'` と、**2 つの切り口を別々に集計できる**。
- 「cron 起動＝ユーザー不在＝NULL」と解釈する場合は、上記 4 行の帰属を NULL に変えるだけ（スキーマ変更なし）。どちらにするかをユーザーに確認したい。

## 6. 集計クエリ例

UTC で集計し、表示側でタイムゾーン変換する（旧版の方針を継承）。金額は §7 の単価表を**結合して集計時に算出**する。`environment = 'production'` での絞り込みを忘れないこと（共有 DB）。

**月別・機能別（トークン数）**
```sql
select date_trunc('month', created_at) as month,
       feature,
       sum(input_tokens) as input_tokens,
       sum(output_tokens) as output_tokens,
       sum(cache_read_tokens) as cache_read_tokens,
       sum(cache_creation_tokens) as cache_creation_tokens,
       sum(web_search_requests) as web_search_requests,
       sum(total_tokens) as total_tokens
from public.llm_token_usages
where environment = 'production'
  and created_at >= date_trunc('month', now()) - interval '5 months'
group by 1, 2
order by 1 desc, total_tokens desc;
```

**ユーザー別（当月）**
```sql
select user_id, sum(total_tokens) as total_tokens
from public.llm_token_usages
where environment = 'production'
  and user_id is not null
  and created_at >= date_trunc('month', now())
group by 1
order by total_tokens desc;
```

**システム分（`user_id IS NULL`）と自動実行分（`origin = 'cron'`）**
```sql
select date_trunc('month', created_at) as month,
       (user_id is null) as is_system,
       origin,
       feature,
       sum(total_tokens) as total_tokens
from public.llm_token_usages
where environment = 'production'
group by 1, 2, 3, 4
order by 1 desc, 2 desc, 3;
```

**モデル別**
```sql
select provider, model, sum(total_tokens) as total_tokens
from public.llm_token_usages
where environment = 'production'
  and created_at >= date_trunc('month', now())
group by 1, 2
order by total_tokens desc;
```

**金額の計算（単価表を結合する考え方）**

単価は期間で変わり得るため、`effective_from` を持つ単価表から「その行の `created_at` 時点で有効な 1 件」を引く。単価が未登録のモデルは**金額 NULL**（0 にしない）にする。ただし `sum()` は NULL を無視して一部の月の金額を小さく見せるため、`unpriced_rows`（単価未登録行数）を併記し、0 でない月は金額を信用しない。`unpriced_rows` が数えるのは単価行が無い場合だけなので、単価行の**列**が NULL だと（例: Web 検索の無い OpenAI の `web_search_per_request_usd`）その行の金額が警告なしに NULL になる。これを防ぐため単価表の単価列は `not null default 0` にする（§7）。

```sql
select date_trunc('month', u.created_at) as month,
       u.feature,
       sum(
         (u.input_tokens * p.input_per_mtok_usd
          + u.output_tokens * p.output_per_mtok_usd
          + u.cache_read_tokens * p.cache_read_per_mtok_usd
          + u.cache_creation_5m_tokens * p.cache_write_5m_per_mtok_usd
          + u.cache_creation_1h_tokens * p.cache_write_1h_per_mtok_usd
          -- TTL 内訳が無い分は 5m 単価で計算（既存 calculateSonnet46CostUsd の fallback と同じ規則）
          + (u.cache_creation_tokens - u.cache_creation_5m_tokens - u.cache_creation_1h_tokens)
              * p.cache_write_5m_per_mtok_usd) / 1000000.0
         + u.web_search_requests * p.web_search_per_request_usd
       ) as cost_usd,  -- p が無い行は NULL。sum() は NULL を無視するため、下の件数で未登録行の有無を必ず確認する
       count(*) filter (where p.model is null) as unpriced_rows
from public.llm_token_usages u
left join lateral (
  select * from public.llm_model_prices p
  where p.provider = u.provider and p.model = u.model and p.effective_from <= u.created_at
  order by p.effective_from desc
  limit 1
) p on true
where u.environment = 'production'
group by 1, 2;
```

## 7. 単価表の置き場所（案）と単価の扱い

- **案（推奨）: DB に `llm_model_prices` テーブル**を別マイグレーションで作る。カラム案: `provider`, `model`, `effective_from`, `input_per_mtok_usd`, `output_per_mtok_usd`, `cache_read_per_mtok_usd`, `cache_write_5m_per_mtok_usd`, `cache_write_1h_per_mtok_usd`, `web_search_per_request_usd`。単価列はすべて `numeric not null default 0`（そのモデルに該当しない項目は 0。NULL を許すと §6 の金額が警告なしに欠ける）。SQL だけで過去分も含め再計算でき、単価修正（`effective_from` の追加・修正）で**過去分の金額も再計算**される。
- 代替: TS の定数ファイル＋アプリ側集計。DB に依存しないが、SQL 集計・将来の管理画面で二重管理になる。
- **単価の数値は本書に書かない。`claude-sonnet-5` の公式単価は未確認（要確認）**。OpenAI の FT モデル（`ft:gpt-4.1-nano-…`）・`gpt-4o-mini` の単価も**未確認**。Web 検索の 1 リクエスト単価も、コード中の定数 `WEB_SEARCH_PRICE_PER_REQUEST_USD` は現行で有効か**未確認**。
- 既存 `anthropic-token-usage.ts` の `SONNET_4_6_*` 定数は旧モデル（Sonnet 4.6）用の値であり、**sonnet-5 の単価として流用しない**。単価確認後に、`logTokenUsage` のコスト出力は削除するか単価表参照に寄せる。
- 単価表への投入は、ユーザーが公式の価格ページで確認した値を承認してから（本書では値を決めない）。

## 8. 既存仕様・管理画面 UI との関係

- 本書は本ファイル（初版 2026-01-28、チャット専用・`chat_token_usages` 案）を**全面的に置き換える**。初版の「スコープ」「データモデル」「保存タイミング」「集計クエリ」「`total_tokens` 整合性」「アプリケーションコード要件」「既存データの扱い」「影響範囲」は本書（§1〜§7）に書き換え済みで、初版の内容は git 履歴で参照できる。`chat_token_usages` というテーブルは作らない。
- 初版の **「管理画面 トークン消費UI 仕様（追記）」は本書の末尾に削除せず残す。ただし別タスク・本書のスコープ外**。着手する場合は本書の `llm_token_usages` に合わせて下記を読み替える。
- 旧 UI 仕様から**流用できる点**: `/admin/users/[userId]/token-usage` のルート構成、admin 権限チェック（`resolveAdminUser()`）、日次/週次/月次の粒度セレクタ、recharts の積み上げ棒グラフ、UTC で集計し UI 側でタイムゾーン変換する方針、`UsersClient.tsx` の「トークン」ボタン、Server Action の型（`TokenUsageDataPoint` 等）の骨格。
- **読み替えが要る点**: テーブル名 `chat_token_usages` → `llm_token_usages`、`total_tokens` の定義（キャッシュ込み）、`service_id` 絞り込み（→ チャット限定にするなら `feature in ('chat','canvas')` と `session_id` 結合）、機能別内訳の追加、モデル例（`claude-sonnet-4-6` → 現行モデル）、金額表示を出す場合は §7 の単価表経由（単価確定後）。初版の工数見積り（UI 4.0d / 全工程 6.5d）は前提（`chat_token_usages`・チャットのみ）が変わったため**無効**。UI の再見積りは別タスクで行う。

## 9. プロバイダ別の正規化ルール

本テーブルの 4 つの入力系カラムは**互いに重ならない**ように保存する（合計と金額計算を単純にするため）。

- **Anthropic**: `input_tokens` = `usage.input_tokens`（キャッシュ読み書きを含まない値として扱う。既存の `getTotalTokens` が 4 項目を加算している実装と整合。**公式仕様で要再確認**）。`cache_read_tokens` = `cache_read_input_tokens`、`cache_creation_tokens` = TTL 内訳の合計（無ければ `cache_creation_input_tokens`）。
- **OpenAI**: `prompt_tokens` には `prompt_tokens_details.cached_tokens` が含まれる前提で、`input_tokens = prompt_tokens - cached_tokens`、`cache_read_tokens = cached_tokens`、`cache_creation_tokens = 0`。**この前提（`prompt_tokens` がキャッシュ分を含む）は未確認**。実装時に SDK の型定義と実レスポンスで確認し、異なる場合は本節を修正する。FT モデルで `cached_tokens` が返るかも未確認。
- ストリームの usage は累積値として届くため、既存の `mergeTokenUsage`（最大値で取り込む）を使う。

## 10. 実装段階案

工数は**粗い目安**（旧版の見積り粒度に合わせた推定。実測ではない）。

| PR | 内容 | 目安 | 備考 |
| --- | --- | --- | --- |
| PR1 | マイグレーション: `llm_token_usages`（§3）＋ RLS | 0.5d | **共有 DB への適用は別途ユーザー承認が必要**。先にマージ・適用しないと PR2 以降の insert が失敗する（失敗しても本処理は止まらない設計だが記録は欠損する） |
| PR2 | 新テーブルの型の扱い（`.agents/skills/supabase/service-usage.md` §6 の pending 型か、生成型の再作成か。実装時に決める）＋ `recordLlmTokenUsage`＋`LLM_FEATURES`＋`llmService` の usage 受け取り・記録＋全 `llmChat` 呼び出し元に `usageContext` を追加（§4 の 11 箇所、§5.4 の引数追加）＋既存テストの書き換え（§5.1 手順 2） | 2〜2.5d | `usageContext` 必須化のため全呼び出し元・既存テストを同一 PR で直す |
| PR3 | ストリーム 2 ルート（chat / canvas）の DB 記録（§5.3） | 1.0d | Canvas を段別 1 行にする場合のテスト追加を含む |
| PR4 | 単価表 `llm_model_prices`（別マイグレーション）＋集計 SQL（§6）の整備。`logTokenUsage` のコスト出力整理 | 1.0d | **単価確認後**。単価はユーザーが承認した値のみ |
| （別タスク） | 管理画面 UI（§8） | 未見積り | スコープ外 |

テスト方針（既存の vitest）:

- `recordLlmTokenUsage`: insert 失敗・例外時に**投げない**こと、usage なしでスキップすること、`total_tokens` を payload に含めないこと。
- `llmChat`: Anthropic / OpenAI のモックで usage が正規化されて記録されること（キャッシュあり/なし、`stream: true`、「応答が空」エラー時も記録されること）。`usageContext` が未指定だと型エラーになること（型テスト）。
- 各呼び出し元: 正しい `feature` / `userId` / `origin` を渡していること（cron 経路で `job.user_id` / `cycle.user_id` が渡る）。
- ストリーム: `message_stop` で 1 回だけ記録されること、Canvas は段・試行ごとに記録されること（`message_start` 後に再試行された試行も 1 行残る）。
- マイグレーション: ローカルでの適用確認と RLS（§3.5 の最終案どおり。select 本人を許可する場合は他人・システム行が見えないこと）の確認。

## 11. リスク・未決事項・ユーザーに確認したい点

**リスク・未決事項**

1. **単価が未確認**: `claude-sonnet-5`、OpenAI FT モデル、`gpt-4o-mini`、Web 検索の単価はいずれも未確認。確認が取れるまで金額は出せない（トークン数のみ先行して記録できる設計にしてある）。
2. **入力トークンのキャッシュ内訳**: Anthropic の `input_tokens` の定義と、OpenAI の `prompt_tokens` がキャッシュ分を含むかは未確認（§9）。実装前に公式仕様と実レスポンスで確認する。取り違えると金額が過大/過小になる。
3. **失敗時の欠損**: 記録失敗（ログのみ・リトライなし）に加え、タイムアウト・クライアント切断・API エラーで usage が取れない呼び出しは記録されない。チャットのストリームはクライアントが切断すると `message_stop` に到達せず usage が失われる（現行の `logTokenUsage` も同じ）。除外キーワード提案の cron は、ユーザー単位の時間切れ（`runWithUserTimeLimit`）後に完了した LLM 呼び出しの記録が失われ得る（§5.2）。この欠損率は実測しないと分からない（**未確認**）。
4. **OpenAI FT 経路の usage 取得**: `callOpenAI` は `completion.usage` を現状無視している。FT モデルでも `usage` / `prompt_tokens_details` が返るかは**未確認**。返らない場合はその行をスキップ（ログのみ）にする。
5. **共有 DB**: 本番・プレビューが同じ DB のため `environment` で分離しないと原価が混ざる。プレビューの動作確認でも本番 DB に行が入る（集計時に除外）。
6. **二重計上**: `llmChat` 経由の記録とストリームルートの記録は経路が重ならないため通常は起きないが、将来ストリームルートを `llmChat` 化する際は片方に寄せること。
7. **行数の増加**: 一括要約・GA4・GSC で 1 呼び出し 1 行。保持期間（TTL・アーカイブ）は未決（`cron_run_logs` は 90 日 TTL だが、原価は月次・年次で見直すため同じにはしない想定）。
8. **`chatService` の `string` 分岐（Anthropic `chat`）と `chat_history_summary` は現状 UI から到達しない**（§4 注記）。将来の再利用に備え、記録の仕組みだけは入れておく。

**ユーザーに確認したい点（3 点）**

1. **cron 起動分の帰属**: 対象ユーザーが特定できる cron 処理（GSC 提案・GA4 評価・一括要約・除外キーワード）を**そのユーザーに帰属**させ `origin = 'cron'` で分離する案（本書の案）でよいか。それとも cron 起動分は NULL（システム分）にするか。
2. **`user_id` の FK と select 本人の許可**: FK を張らない案（ユーザー削除後も原価履歴を残す）と、RLS で select 本人を許可する案（ユーザー指定どおり）のままでよいか。ユーザー向け表示は非目標なので、select 許可が不要なら revoke のみに絞れる。
3. **単価表の置き場所**: DB（`llm_model_prices`、推奨）か TS 定数か。

**確認なしで本書が置いた既定案（Claude 案・未確認。異論があれば修正する）**: `cache_creation_5m/1h_tokens`（TTL 内訳）の保存、追加カラム `origin` / `environment` / `context` / `response_model`、Canvas を段別・試行別に記録（§5.3）、チャットの記録と上限チェックの並行実行、単価列の `not null default 0`、保持期間は当面設けない（未決）、管理画面 UI は別タスク（着手時期は本書の範囲外）。

---

> **【別タスク・本書（LLMトークン使用量の記録）のスコープ外】**
> 以下は初版（2026-01-28）で追記された管理画面 UI 仕様を**原文のまま残したもの**。前提（`chat_token_usages`・チャットのみ・`service_id`・Sonnet 4.6・工数見積り）は古く、着手時は上記 §8「読み替えが要る点」に従って見直すこと。本書の実装（PR1〜PR4）には含まない。

## 管理画面 トークン消費UI 仕様（追記）

### 概要
管理者が `/admin/users` 画面から、各ユーザーのトークン消費状況を時系列グラフで確認できる機能を追加する。

---

### 画面構成

#### 1. ユーザー一覧画面（既存）への変更
- **対象ファイル**: `app/admin/users/UsersClient.tsx`
- アクションカラムに「トークン」ボタンを追加。
- 遷移先: `/admin/users/{userId}/token-usage`

```
| フルネーム | LINE表示名 | メール / 認証 | 最終ログイン | 登録日 | 権限 | アクション        |
|------------|-----------|--------------|------------|------|-----|-----------------|
| 田中 一郎   | ...       | ...          | ...        | ...  | ... | 編集 ｜ トークン  |
```

#### 2. トークン消費詳細画面（新規）
- **Route**: `/admin/users/[userId]/token-usage`
- **ファイル構成**:
  ```
  app/admin/users/
  └─ [userId]/
     └─ token-usage/
        ├─ page.tsx                 # Server Component（ユーザー情報・初期データ取得）
        └─ TokenUsageClient.tsx     # Client Component（recharts グラフ）
  ```

---

### UIレイアウト（詳細ページ）

```
← ユーザー一覧に戻る

# 田中 一郎 のトークン消費量

[サマリーカード群]
  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
  │ 当月合計         │ │ 前月比           │ │ Webサーチ回数    │
  │ 1,234,567 tokens │ │ ▲ +12.3%        │ │ 42 回           │
  └─────────────────┘ └─────────────────┘ └─────────────────┘

[粒度セレクタ] ── [ 日次 | 週次 | 月次 ]

[時系列バーチャート]
  - X軸: 日付ラベル（日次: 過去30日、週次: 過去12週、月次: 過去12ヶ月）
  - Y軸: トークン数
  - 積み上げ棒グラフ: input_tokens（青）/ output_tokens（橙）
  - ホバー: ツールチップで各値・合計を表示

[モデル別内訳テーブル]
  | モデル            | Input Tokens | Output Tokens | 合計        |
  |------------------|-------------|--------------|------------|
  | claude-sonnet-4-6 | 800,000     | 400,000      | 1,200,000  |
  | ...              | ...         | ...          | ...        |
```

---

### データ取得仕様

#### Server Action（新規）
```typescript
// src/server/actions/admin.actions.ts に追加（または adminTokenUsage.actions.ts を新規作成）

export type TokenUsageGranularity = 'daily' | 'weekly' | 'monthly';

export type TokenUsageDataPoint = {
  period: string;        // '2026-05-01' / '2026-W18' / '2026-05'
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type TokenUsageByModel = {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type TokenUsageSummary = {
  currentMonthTotal: number;
  previousMonthTotal: number;
  webSearchRequests: number;  // chat_token_usages.web_search_requests の SUM
  series: TokenUsageDataPoint[];
  byModel: TokenUsageByModel[];
};

// webSearchRequests 算出ロジック:
//   SELECT SUM(web_search_requests) FROM chat_token_usages
//   WHERE user_id = :user_id AND created_at >= :start AND created_at < :end
// 保存元: Anthropic ストリーミングレスポンスの server_tool_use.web_search_requests
//         （TokenUsageTotals.webSearchRequests として anthropic-token-usage.ts が保持）
// service_id 絞り込み: なし（全サービスを合算して表示。絞り込みが必要な場合は別途 API パラメータを追加）

export const getTokenUsageByUser = async (
  userId: string,
  granularity: TokenUsageGranularity
): Promise<{ success: true; data: TokenUsageSummary } | { success: false; error: string }>;
```

#### SQLクエリ（日次集計例）

> **タイムゾーン方針**: DB は常に UTC 基準で集計し、`period` は UTC 日付文字列として返す。
> UI（`TokenUsageClient.tsx`）側でユーザーのタイムゾーンに変換して表示する。

```sql
-- 日次（過去30日）— UTC 基準
SELECT
  date_trunc('day', created_at)::date::text AS period,
  SUM(input_tokens)  AS input_tokens,
  SUM(output_tokens) AS output_tokens,
  SUM(total_tokens)  AS total_tokens
FROM chat_token_usages
WHERE user_id = :user_id
  AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY 1
ORDER BY 1;
```

> 週次・月次も同様に `date_trunc('week' / 'month', created_at)` で集計（`AT TIME ZONE` は使用しない）。

#### UI 側タイムゾーン変換（TokenUsageClient.tsx）

```ts
// period は 'YYYY-MM-DD'（UTC）で届く
// ユーザーのタイムゾーンに合わせてラベルを整形する
const formatPeriodLabel = (period: string, userTimezone: string) =>
  new Date(period).toLocaleDateString('ja-JP', { timeZone: userTimezone });
```

- `userTimezone` は `Intl.DateTimeFormat().resolvedOptions().timeZone` で取得（ブラウザのロケール）。
- 将来の国際展開時はユーザープロフィールの `timezone` フィールドを参照する想定。

---

### recharts コンポーネント設計

```tsx
// TokenUsageClient.tsx（概略）
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

// 粒度選択タブ: 'daily' | 'weekly' | 'monthly'
// データ切り替えは Server Action 再呼び出し（useTransition）
```

- **ライブラリ**: 既存 `recharts`（package.json 済み）
- **グラフ種別**: `BarChart`（積み上げ棒グラフ）
- **色定義**: input=`#3B82F6`（青）/ output=`#F97316`（橙）

---

### ルーティング・権限

- 既存 `/admin` レイアウトのミドルウェア（admin権限必須）がそのまま適用される。
- `page.tsx` で `getAllUsers` と同様の `resolveAdminUser()` チェックを実施。
- 対象ユーザーが存在しない場合は404リダイレクト。

---

### 前提条件
以下が先行タスクとして完了している必要がある。
1. **DB マイグレーション**: `chat_token_usages` テーブル作成（本仕様書「データモデル」参照）。
2. **保存処理実装**: `app/api/chat/anthropic/stream/route.ts` での usage 永続化。

---

### 開発工数見積もり

| タスク | 工数 | 備考 |
|--------|------|------|
| **前提①** DBマイグレーション（`chat_token_usages` テーブル） | 0.5d | 先行タスク。未完の場合 |
| **前提②** API保存処理（stream/route.ts → chat_token_usages INSERT） | 1.0d | 先行タスク。未完の場合 |
| Server Action 追加（`getTokenUsageByUser`・集計クエリ） | 1.0d | 日次/週次/月次の3クエリ＋型定義＋データなし期間の補完 |
| `UsersClient.tsx` 変更（「トークン」ボタン追加） | 0.5h | 軽微 |
| `app/admin/users/[userId]/token-usage/` 新規ページ | 1.5d | page.tsx + TokenUsageClient.tsx + 404リダイレクト・ローディング・エラーハンドリング |
| recharts グラフ実装（積み上げ棒・ツールチップ・粒度切替） | 1.0d | useTransition・ツールチップカスタマイズ・レスポンシブ対応 |
| サマリーカード・モデル別テーブル実装 | 0.5d | |
| lint / build / 動作確認 | 0.5d | |
| **合計（UI部分のみ）** | **4.0d** | DB・API完了済みを前提（バッファ含む） |
| **合計（全工程）** | **6.5d** | 前提タスク未完の場合（バッファ含む） |
