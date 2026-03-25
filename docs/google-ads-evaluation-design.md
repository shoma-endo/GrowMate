# Google Ads AI評価機能 設計書

> **改訂履歴**: 旧設計（ルールベース評価）から AI 分析方式に全面移行。旧設計は Git 履歴を参照のこと。

## 1. 目的

- Google Ads のキーワード指標（通常KW + 除外KW）と事業者情報を Claude claude-sonnet-4-6 に分析させ、改善提案をメールで送信する。
- メールアカウント登録ユーザー限定の機能として提供する。
- 評価プロンプトは admin/prompts 画面で運用者が編集可能とする。

## 2. スコープ

### 2.1 旧設計との差分

| 項目 | 旧設計 | 新設計 |
|------|--------|--------|
| 評価方式 | ルールベース（固定閾値） | AI分析（Claude claude-sonnet-4-6） |
| 評価入力 | 前日キーワード指標のみ | 全キーワード指標 + 事業者情報 + ペルソナ |
| 評価単位 | `customer_id + keyword_id` | `customer_id`（アカウント単位で一括分析） |
| 結果出力 | アプリ内画面 + 通知 | メール送信のみ |
| 対象ユーザー | 全ユーザー | メールアカウント登録ユーザーのみ |
| 対象キーワード | ENABLED のみ | 全キーワード（除外KW含む） |
| 期間 | 前日固定 | ユーザー指定（デフォルト30日） |
| トリガー | ダッシュボード表示時 | 手動ボタン + 定時 cron |
| プロンプト管理 | なし | admin/prompts で編集可能 |

### 2.2 不要になるもの（旧設計から削除）

- キーワード単位の評価設定（`keyword_id` ベース管理）
- 固定閾値（CTR/CVR/CPA/品質スコア閾値）
- 累積値管理（`cumulative_clicks`, `cumulative_conversions`）
- ベースライン品質スコア比較
- 評価一覧画面（`app/google-ads-evaluations/page.tsx`）
- 通知ハンドラー（`GoogleAdsNotificationHandler`）
- 既読管理（`is_read`, SECURITY DEFINER 関数）
- GSC 通知との共存ロジック

### 2.3 機能スコープ

- 評価単位は `customer_id`（アカウント単位で全キーワードを一括分析）。
- 評価対象期間はデフォルト30日。ユーザーが設定テーブルの `date_range_days` で変更可能。
- 評価対象キーワードはステータスフィルタなし（ENABLED / PAUSED / REMOVED 全取得）。除外キーワードも別途取得。
- AI がプロンプトに基づき自由形式の分析・提案を行う（固定閾値による機械的判定は行わない）。
- 分析結果は Markdown 形式で生成され、HTML 変換後にメール送信される。DB への結果保存は将来拡張（Section 16 参照）。
- 日付判定は **JST基準** で行う（`(now() at time zone 'Asia/Tokyo')::date`）。

## 3. 画面設計

### 3.1 ダッシュボード変更

既存の `app/google-ads-dashboard/_components/dashboard-content.tsx` にボタンを追加。

- **メールユーザーの場合**: 「AI分析を実行してメール送信」ボタンを表示
  - クリック → Server Action 呼び出し → ローディング表示 → 完了/エラーメッセージ
- **非メールユーザー（LINE ユーザー）**: ボタン非表示、またはメール登録誘導メッセージを表示

### 3.2 不要な画面

- `app/google-ads-evaluations/page.tsx` — 作成不要（結果はメールで配信）
- 通知トースト — 不要
- 既読管理 UI — 不要

## 4. AI 分析ロジック

### 4.1 分析方式

- Claude claude-sonnet-4-6 にキーワードデータ + 事業者コンテキストを渡し、自然言語で分析・提案を生成する。
- プロンプトテンプレートは `prompt_templates` テーブルで管理し、admin/prompts 画面で編集可能。
- モデル設定: `MODEL_CONFIGS['google_ads_ai_evaluation']`（ANTHROPIC_BASE, maxTokens: 8000）

### 4.2 プロンプト変数

AI 分析に渡す変数は以下の通り。`PromptService.replaceVariables()` で `{{variableName}}` 形式を置換する。

| 変数名 | ソース | 内容 |
|--------|--------|------|
| `persona` | `BriefService.getVariablesByUserId()` → `persona` | ターゲットペルソナ情報 |
| `strengths` | `BriefService.getVariablesByUserId()` → 各サービスの `strength` | 全サービスの強み（改行区切り） |
| `keywordData` | `GoogleAdsService.getKeywordMetrics({ includeAllStatuses: true })` | 全キーワード指標（構造化テキスト） |
| `negativeKeywords` | `GoogleAdsService.getNegativeKeywords()` | 除外キーワード一覧 |
| `dateRange` | 設定テーブル `date_range_days` から算出 | 分析期間（例: "2026-02-22 〜 2026-03-24"） |
| `customerName` | DB 保存のアカウント名 | Google Ads アカウント名 |

### 4.3 プロンプトテンプレート

- テンプレート名: `google_ads_ai_evaluation`
- 表示名: `Google Ads AI分析`
- カテゴリ: admin/prompts 画面に「Google Ads分析」カテゴリを追加
- 内容: 運用者が admin/prompts で編集（初期テンプレートはシードデータ or マイグレーションで投入）

### 4.4 分析フロー

```
手動ボタン押下 or Cron トリガー
  ↓
メールユーザーチェック（user.email IS NOT NULL）
  ↓
二重実行チェック（last_evaluated_on >= 今日（JST）→ スキップ。force 時は無視）
  ↓
Google Ads API からキーワード指標取得
  ├─ getKeywordMetrics({ includeAllStatuses: true }) — 全ステータスのKW
  └─ getNegativeKeywords() — 除外KW
  ↓
事業者情報取得（BriefService.getVariablesByUserId）
  ↓
プロンプト変数構築 → テンプレート取得 → 変数置換
  ↓
llmChat('anthropic', 'claude-sonnet-4-6', ...) で分析実行
  ↓
分析結果（Markdown）→ HTML 変換 → メール送信
  ↓
設定テーブル UPDATE
  成功時: last_evaluated_on 更新 + consecutive_error_count リセット
  エラー時: last_evaluated_on 更新しない + consecutive_error_count +1
  ↓ (consecutive_error_count >= 3)
cron 対象からスキップ（consecutive_error_count >= 3 の行は cron クエリで除外）
```

## 5. データ設計

旧設計のキーワード単位管理を廃止し、`customer_id` 単位に簡素化する。

### 5.1 評価設定テーブル（新規）

- テーブル名: `google_ads_evaluation_settings`
- 役割: アカウント単位の評価設定を保持する
- 一意制約: `(user_id, customer_id)`

| カラム | 型 | デフォルト | 用途 |
|--------|-----|----------|------|
| `id` | uuid | `gen_random_uuid()` | 主キー |
| `user_id` | uuid | — | 所有ユーザー（`public.users(id)` FK） |
| `customer_id` | text | — | Google Ads カスタマーID |
| `date_range_days` | integer | `30` | 分析対象期間（日数） |
| `cron_enabled` | boolean | `false` | 定時 cron 実行の有効/無効 |
| `last_evaluated_on` | date | `null` | 最終**成功**評価日（二重実行防止） |
| `consecutive_error_count` | integer | `0` | 連続エラー回数（3回以上で cron スキップ） |
| `status` | text | `'active'` | `'active'` / `'paused'` |
| `created_at` | timestamptz | `now()` | 作成日時 |
| `updated_at` | timestamptz | `now()` | 更新日時 |

### 5.2 旧設計との差分（廃止項目）

- `keyword_id` 単位の管理 → `customer_id` 単位に集約
- 閾値関連カラム全廃（`ctr_threshold`, `cvr_threshold`, `cpa_threshold_yen`, `click_threshold`）
- `baseline_quality_score`, `cumulative_*` 廃止
- `triggered_rules` (text[]), `suggestions` (jsonb) → 廃止（AI 分析結果はメール送信のみ、DB 保存は将来拡張）
- `is_read` / 通知関連 廃止（メール送信のみ）
- 既読管理の SECURITY DEFINER 関数 廃止

## 6. メール送信基盤

### 6.1 技術選定

- **メール送信サービス**: Resend（`resend` パッケージ）
- **API キー**: `RESEND_API_KEY`（`src/env.ts` に追加）
- **送信元**: `noreply@mail.growmate.tokyo`
- **Markdown → HTML 変換**: `marked` ライブラリ

### 6.2 EmailService

`src/server/services/emailService.ts` を新規作成。

```typescript
class EmailService {
  /**
   * Google Ads AI 分析結果をメールで送信
   */
  async sendGoogleAdsAnalysis(
    to: string,
    subject: string,
    htmlContent: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }>
}
```

- `SupabaseService` と同じクラスベースのパターンに準拠
- Resend SDK を使用して送信
- エラーハンドリング: 送信失敗時はサーバーログに出力

### 6.3 環境変数

`src/env.ts` の `serverEnvSchema` に追加:
```typescript
RESEND_API_KEY: z.string().min(1),  // メール送信は本機能の必須要件のため required
```

> **`CRON_SECRET` について**: 既存の GSC cron（`app/api/cron/gsc-evaluate/route.ts`）と同様に `process.env.CRON_SECRET` で直接参照する。`src/env.ts` の schema には含めない（既存パターン踏襲。README の環境変数一覧には記載済み）。

## 7. Google Ads API 拡張

### 7.1 新規メソッド

`src/server/services/googleAdsService.ts` に以下を追加。

#### `getKeywordMetrics()` — オプション拡張

既存メソッドに `includeAllStatuses?: boolean` オプションを追加。

- `includeAllStatuses: false`（デフォルト・既存動作）: `campaign.status = 'ENABLED'` フィルタあり
- `includeAllStatuses: true`（AI 分析用）: ステータスフィルタなし（ENABLED / PAUSED / REMOVED 全取得）

既存の GAQL クエリの WHERE 句でステータス条件を動的に付与/除外するのみ。SELECT 句・戻り値型は変更なし。

#### `getNegativeKeywords()`（新規）

- `campaign_criterion` と `ad_group_criterion` から除外キーワードを取得
- キャンペーンレベル・広告グループレベルの両方を取得

```sql
-- キャンペーンレベル除外KW
SELECT
  campaign_criterion.keyword.text,
  campaign_criterion.keyword.match_type,
  campaign.name
FROM campaign_criterion
WHERE campaign_criterion.type = 'KEYWORD'
  AND campaign_criterion.negative = true

-- 広告グループレベル除外KW
SELECT
  ad_group_criterion.keyword.text,
  ad_group_criterion.keyword.match_type,
  campaign.name,
  ad_group.name
FROM ad_group_criterion
WHERE ad_group_criterion.negative = true
  AND ad_group_criterion.type = 'KEYWORD'
```

### 7.2 新規型定義

`src/types/googleAds.types.ts` に追加。

```typescript
/**
 * Google Ads 除外キーワード
 */
export interface GoogleAdsNegativeKeyword {
  /** キーワードテキスト */
  keywordText: string;
  /** マッチタイプ */
  matchType: GoogleAdsMatchType;
  /** 除外レベル */
  level: 'campaign' | 'ad_group';
  /** キャンペーン名 */
  campaignName: string;
  /** 広告グループ名（ad_group レベルの場合のみ） */
  adGroupName?: string;
}

/**
 * 除外キーワード取得の結果
 */
export interface GetNegativeKeywordsResult {
  success: boolean;
  data?: GoogleAdsNegativeKeyword[];
  error?: string;
}
```

## 8. AI 分析サービス

### 8.1 ファイル構成

`src/server/services/googleAdsAiAnalysisService.ts` を新規作成。

### 8.2 クラス設計

```typescript
export class GoogleAdsAiAnalysisService {
  private readonly supabaseService: SupabaseService;
  private readonly googleAdsService: GoogleAdsService;
  private readonly emailService: EmailService;

  /**
   * AI分析を実行しメール送信する
   */
  async analyzeAndSend(
    userId: string,
    customerId: string,
    options?: {
      dateRangeDays?: number;
      force?: boolean;
    }
  ): Promise<AnalysisResult>
}
```

### 8.3 処理ステップ

1. **メールユーザーチェック**: `user.email IS NOT NULL` を確認。メールなしは拒否。
2. **二重実行チェック**: `last_evaluated_on >= 今日（JST）` → スキップ（`force: true` 時は無視）。`consecutive_error_count >= 3` → cron 時はスキップ（手動実行は許可）。
3. **Google Ads API 呼び出し**:
   - `getKeywordMetrics({ includeAllStatuses: true })` — 全ステータスのキーワード指標
   - `getNegativeKeywords()` — 除外キーワード一覧
4. **事業者情報取得**: `BriefService.getVariablesByUserId(userId)` でペルソナ・強み等を取得
5. **プロンプト変数構築**: `{{persona}}`, `{{strengths}}`, `{{keywordData}}`, `{{negativeKeywords}}`, `{{dateRange}}`, `{{customerName}}`
6. **テンプレート取得**: `PromptService.getTemplateByName('google_ads_ai_evaluation')`
7. **変数置換**: `PromptService.replaceVariables(template.content, variables)`
8. **AI 分析実行**: `llmChat('anthropic', 'claude-sonnet-4-6', messages, modelConfig)`
9. **メール送信**: `EmailService.sendGoogleAdsAnalysis(userEmail, subject, htmlContent)`
10. **設定更新**:
    - **成功時**: `last_evaluated_on` を当日（JST）に更新、`consecutive_error_count` を 0 にリセット
    - **エラー時**: `last_evaluated_on` は**更新しない**、`consecutive_error_count` を +1。エラー詳細はサーバーログに出力。

#### 二重実行について

手動実行と cron が同時に走った場合、`last_evaluated_on` チェックはアプリケーションレベルのため両方が通過する可能性がある。その場合メールが2通届くが、コスト（数十秒・数円程度）は許容範囲と判断し、MVP ではロック機構を設けない。

### 8.4 MODEL_CONFIGS エントリ

`src/lib/constants.ts` に追加:

```typescript
google_ads_ai_evaluation: {
  ...ANTHROPIC_BASE,
  maxTokens: 8000,
}
```

### 8.5 PROMPT_DESCRIPTIONS エントリ

`src/lib/prompt-descriptions.ts` に追加:

```typescript
google_ads_ai_evaluation: {
  description: 'Google Adsのキーワード指標をAIで分析し、改善提案をメール送信するプロンプト',
  variables: 'ペルソナ、事業の強み、キーワード指標、除外キーワード、分析期間、アカウント名が自動で置換されます',
}
```

### 8.6 VARIABLE_TYPE_DESCRIPTIONS エントリ

`src/lib/prompt-descriptions.ts` に追加:

```typescript
keywordData: 'Google Ads 全キーワードの指標データ（構造化テキスト）',
negativeKeywords: 'Google Ads 除外キーワード一覧',
dateRange: '分析対象期間（例: 2026-02-22 〜 2026-03-24）',
customerName: 'Google Ads アカウント名',
```

## 9. Server Actions & API エンドポイント

### 9.1 Server Actions

`src/server/actions/googleAdsEvaluation.actions.ts` を新規作成。

```typescript
'use server'

/**
 * AI分析を手動実行
 * メールユーザー認証チェック → GoogleAdsAiAnalysisService.analyzeAndSend()
 */
export async function runGoogleAdsAiAnalysis(
  customerId?: string
): Promise<{ success: boolean; message?: string; error?: string }>

/**
 * 評価設定を取得
 */
export async function getEvaluationSettings(): Promise<EvaluationSettingsResponse>

/**
 * 評価設定を更新（cron 有効/無効、期間変更）
 */
export async function updateEvaluationSettings(
  input: UpdateEvaluationSettingsInput
): Promise<{ success: boolean; error?: string }>
```

**手動実行（`runGoogleAdsAiAnalysis`）の認証・対象ユーザー**

- 認証は既存の `src/server/actions/googleAds.actions.ts` と同様、Cookie からの LIFF トークン取得後に `authMiddleware` で `public.users` のユーザーを解決する。
- メール送信の送付先は **`public.users.email` を正とする**（解決後の `userDetails.email`）。空なら実行しない（LINE のみの利用者は通常ここで弾かれる）。
- `supabase.auth.getUser().email` は送付先の根拠にしない（セッションとアプリユーザーの取り違えを防ぐ）。

### 9.2 Cron エンドポイント

`app/api/cron/google-ads-evaluate/route.ts` を新規作成。

```typescript
export async function GET(request: NextRequest) {
  // 1. Bearer トークン認証（CRON_SECRET）
  // 2. cron_enabled = true の全ユーザーを取得
  // 3. ユーザーごとに GoogleAdsAiAnalysisService.analyzeAndSend() を実行
  // 4. 二重実行防止（last_evaluated_on チェック）
  // 5. 結果サマリーを返す
}

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5分
```

**バッチ処理の仕様**:
- 対象: `google_ads_evaluation_settings` の `cron_enabled = true AND consecutive_error_count < 3`
- 二重実行防止: `last_evaluated_on < (now() at time zone 'Asia/Tokyo')::date`
- タイムアウト対策: 280秒のバッチ制限時間（`maxDuration` の余裕を持つ）
- エラー分離: 1ユーザーの失敗が他ユーザーに影響しない

## 10. DB 物理設計（DDL案）

### 10.1 マイグレーション方針

- 追加先: `supabase/migrations/`
- ファイル名: `YYYYMMDD_create_google_ads_ai_evaluation_tables.sql`
- ロールバック案はマイグレーション SQL 内にコメントで併記する

### 10.2 評価設定テーブル

```sql
-- 評価設定テーブル: アカウント単位のAI分析設定を管理
-- ロールバック: drop table if exists public.google_ads_evaluation_settings cascade;
create table if not exists public.google_ads_evaluation_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  customer_id text not null,

  -- 分析設定
  date_range_days integer not null default 30,
  cron_enabled boolean not null default false,

  -- 実行管理
  last_evaluated_on date,                    -- 最終成功評価日（二重実行防止、JST基準）
  consecutive_error_count integer not null default 0,  -- 連続エラー回数
  status text not null default 'active'
    check (status in ('active', 'paused')),

  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),

  -- 同一ユーザー・アカウントの設定は1件のみ
  unique(user_id, customer_id)
);

-- 評価対象ユーザーの検索用（cron バッチ実行時）
create index if not exists idx_google_ads_eval_settings_cron
  on public.google_ads_evaluation_settings (cron_enabled, consecutive_error_count, last_evaluated_on)
  where cron_enabled = true and consecutive_error_count < 3;

-- ユーザー単位のアカウント設定一覧取得用
create index if not exists idx_google_ads_eval_settings_user
  on public.google_ads_evaluation_settings (user_id, status);

alter table public.google_ads_evaluation_settings enable row level security;
```

### 10.3 RLS ポリシー

```sql
-- ============================================================
-- RLS ポリシー
-- ============================================================

-- 設定テーブル: 参照ポリシー（get_accessible_user_ids 経由）
create policy "google_ads_eval_settings_select"
  on public.google_ads_evaluation_settings for select
  using (user_id in (select get_accessible_user_ids(auth.uid())));

-- 設定テーブル: INSERT/UPDATE はサービスロール経由のため RLS ポリシー不要
-- （RLS は enable だが、supabaseAdmin は RLS をバイパスする）
```

### 10.4 サービスロール使用箇所

| 操作 | 使用ロール | 備考 |
|------|-----------|------|
| 設定テーブル INSERT（評価設定登録） | Service Role | 分析サービスが実行 |
| 設定テーブル UPDATE（`last_evaluated_on` 更新、設定変更） | Service Role | 分析サービスが実行 |
| 設定テーブル SELECT（設定参照） | User Role（RLS） | `get_accessible_user_ids` で絞り込み |

### 10.5 二重実行防止

アプリケーションレベルで `last_evaluated_on >= 今日（JST）` をチェックする。DB ロック（`FOR UPDATE`）は使用しない。

手動実行と cron が同時に走った場合、両方がチェックを通過しメールが2通届く可能性があるが、コスト（数十秒・数円程度）は許容範囲と判断する。

- **手動実行**: `last_evaluated_on >= 今日` → スキップ（`force: true` 時は無視）
- **Cron**: `last_evaluated_on >= 今日` または `consecutive_error_count >= 3` → スキップ

### 10.6 代表クエリ

```sql
-- 手動実行時の二重実行チェック + 設定取得
SELECT id, date_range_days
FROM public.google_ads_evaluation_settings
WHERE user_id = :user_id
  AND customer_id = :customer_id
  AND (last_evaluated_on IS NULL
       OR last_evaluated_on < (now() AT TIME ZONE 'Asia/Tokyo')::date);

-- Cron 対象ユーザーの取得
SELECT s.id, s.user_id, s.customer_id, s.date_range_days, u.email
FROM public.google_ads_evaluation_settings s
JOIN public.users u ON u.id = s.user_id
WHERE s.cron_enabled = true
  AND u.email IS NOT NULL
  AND s.consecutive_error_count < 3
  AND (s.last_evaluated_on IS NULL
       OR s.last_evaluated_on < (now() AT TIME ZONE 'Asia/Tokyo')::date);

-- 設定更新（成功時）
UPDATE public.google_ads_evaluation_settings
SET last_evaluated_on = (now() AT TIME ZONE 'Asia/Tokyo')::date,
    consecutive_error_count = 0,
    updated_at = timezone('utc', now())
WHERE id = :settings_id;

-- 設定更新（エラー時）
UPDATE public.google_ads_evaluation_settings
SET consecutive_error_count = consecutive_error_count + 1,
    updated_at = timezone('utc', now())
WHERE id = :settings_id;
```

## 11. サーバー構成

### 11.1 新規ファイル

| ファイル | 役割 |
|---------|------|
| `src/server/services/emailService.ts` | メール送信サービス（Resend SDK） |
| `src/server/services/googleAdsAiAnalysisService.ts` | AI 分析ロジック（コアサービス） |
| `src/server/actions/googleAdsEvaluation.actions.ts` | 手動実行 / 設定取得・更新 Server Actions |
| `app/api/cron/google-ads-evaluate/route.ts` | 定時バッチ Cron エンドポイント |

### 11.2 既存ファイルへの変更

| ファイル | 変更内容 |
|---------|---------|
| `package.json` | `resend` パッケージ追加 |
| `src/env.ts` | `RESEND_API_KEY`（必須）追加 |
| `src/server/services/googleAdsService.ts` | `getKeywordMetrics()` に `includeAllStatuses` オプション追加、`getNegativeKeywords()` 新規追加 |
| `src/types/googleAds.types.ts` | `GoogleAdsNegativeKeyword`, `GetNegativeKeywordsResult` 追加 |
| `src/lib/constants.ts` | `MODEL_CONFIGS['google_ads_ai_evaluation']` 追加 |
| `src/lib/prompt-descriptions.ts` | `PROMPT_DESCRIPTIONS['google_ads_ai_evaluation']` + 変数説明追加 |
| `app/google-ads-dashboard/_components/dashboard-content.tsx` | AI分析実行ボタン追加 |
| `app/google-ads-dashboard/page.tsx` | メールユーザー判定追加 |

## 12. プロンプトテンプレート登録

### 12.1 初期プロンプトテンプレート内容

以下は `prompt_templates.content` に登録する初期テンプレートである。
admin/prompts 画面で運用者が自由に編集可能。`{{variableName}}` 形式の変数は `PromptService.replaceVariables()` で実行時に置換される。

```
あなたはGoogle広告運用の専門コンサルタントです。
以下の事業者情報と広告データを分析し、具体的な改善提案をMarkdown形式で作成してください。

## 事業者情報

### ターゲットペルソナ
{{persona}}

### 事業の強み
{{strengths}}

## 広告データ

### アカウント情報
- アカウント名: {{customerName}}
- 分析期間: {{dateRange}}

### キーワード指標
{{keywordData}}

### 除外キーワード一覧
{{negativeKeywords}}

## 分析指示

以下の観点で分析し、改善提案を作成してください。各セクションには具体的な数値根拠を含めてください。

### 1. パフォーマンス概況
- 期間全体のクリック数・インプレッション数・費用の傾向
- CTR・CVR・CPAの全体評価

### 2. キーワード分析
- **好調キーワード**: CTRやCVRが高く、費用対効果が良いキーワード（上位5件程度）
- **要改善キーワード**: インプレッションはあるがCTRが低い、またはクリックはあるがCVが出ていないキーワード（上位5件程度）
- **停止検討キーワード**: 費用に対して成果が乏しく、停止または入札調整を検討すべきキーワード
- **品質スコア**: 品質スコアが低い（6以下）キーワードの一覧と改善の方向性

### 3. 除外キーワード評価
- 現在の除外キーワード設定の妥当性
- 追加すべき除外キーワードの提案（キーワードデータから推定される不要な検索意図）

### 4. マッチタイプ最適化
- 部分一致・フレーズ一致・完全一致の配分バランス評価
- マッチタイプ変更の提案

### 5. 事業者コンテキストに基づく提案
- ペルソナと現在のキーワード戦略の整合性
- 事業の強みを活かした新規キーワード候補（3〜5件）
- 競合差別化の観点からの広告文改善ポイント

### 6. 予算・入札戦略
- 検索インプレッションシェアに基づく予算充足度の評価
- 予算配分の最適化提案（好調キャンペーンへの傾斜配分など）

### 7. アクションプラン（優先度順）
上記分析を踏まえ、**今すぐ実行すべきアクション**を優先度の高い順に3〜5件で箇条書きにしてください。
各アクションには期待される改善効果の見込みも記載してください。
```

### 12.2 変数の構築仕様

各変数の実行時の構築ルールを以下に定義する。

#### `{{keywordData}}` の構造化テキスト形式

```
キーワード | マッチタイプ | ステータス | キャンペーン | 広告グループ | IMP | Click | CTR | CPC(円) | CV | CVR | CPA(円) | 費用(円) | 品質スコア | 検索IMP Share
----------|------------|----------|------------|------------|-----|-------|-----|---------|-----|-----|---------|---------|----------|-------------
渋谷 美容院 | EXACT | ENABLED | ブランドKW | 美容院系 | 1,200 | 85 | 7.08% | 120 | 3 | 3.53% | 3,400 | 10,200 | 8 | 65.2%
整体 腰痛 | BROAD | ENABLED | 一般KW | 症状系 | 3,500 | 42 | 1.20% | 250 | 0 | 0.00% | - | 10,500 | 5 | 32.1%
...
```

- `GoogleAdsKeywordMetric[]` をタブ区切りテキスト（TSV 風）に変換
- CTR / CVR はパーセント表示（小数点2桁）
- CPC / CPA / 費用は円表示（整数、カンマ区切り）
- 品質スコアが `null` の場合は `-` 表示
- キーワードはインプレッション数降順

#### `{{negativeKeywords}}` の形式

```
除外キーワード | マッチタイプ | レベル | キャンペーン | 広告グループ
------------|------------|-------|------------|------------
無料 | BROAD | campaign | ブランドKW | -
求人 | EXACT | ad_group | 一般KW | 症状系
...
```

#### `{{persona}}` の形式

`BriefService.getVariablesByUserId()` の `persona` フィールドをそのまま渡す。未設定の場合は `（ペルソナ未設定）` を代入。

#### `{{strengths}}` の形式

```
サービス1: ○○○（強みの内容）
サービス2: △△△（強みの内容）
```

`BriefInput.services[]` の各サービスの `strength` フィールドを改行区切りで結合。サービスが未登録の場合は `（事業の強み未設定）` を代入。

#### `{{dateRange}}` の形式

`YYYY-MM-DD 〜 YYYY-MM-DD`（例: `2026-02-22 〜 2026-03-24`）

#### `{{customerName}}` の形式

DB に保存されたアカウント表示名をそのまま渡す。未設定の場合はカスタマーIDを代入。

### 12.3 期待される出力形式

AI の出力は Markdown 形式とし、以下の構造を持つことを期待する（プロンプトで指示済み）:

```markdown
# Google Ads パフォーマンス分析レポート

## 1. パフォーマンス概況
（数値を含む全体評価）

## 2. キーワード分析
### 好調キーワード
（テーブル or リスト形式）

### 要改善キーワード
（テーブル or リスト形式）
...

## 7. アクションプラン（優先度順）
1. **【高】○○を実施** — 期待効果: CTR +X% 改善見込み
2. **【中】△△を検討** — 期待効果: CPA ○○円削減見込み
3. ...
```

この Markdown を `marked` ライブラリで HTML 変換し、メール本文として送信する。

### 12.4 テンプレートメタデータ（SQL）

```sql
insert into public.prompt_templates (name, display_name, content, variables)
values (
  'google_ads_ai_evaluation',
  'Google Ads AI分析',
  E'（上記 12.1 のプロンプト本文をエスケープして挿入）',
  '[
    {"name": "persona", "description": "ターゲットペルソナ情報"},
    {"name": "strengths", "description": "全サービスの強み（改行区切り）"},
    {"name": "keywordData", "description": "全キーワード指標（構造化テキスト）"},
    {"name": "negativeKeywords", "description": "除外キーワード一覧"},
    {"name": "dateRange", "description": "分析期間"},
    {"name": "customerName", "description": "Google Adsアカウント名"}
  ]'::jsonb
);
```

### 12.5 admin/prompts 画面での表示

- カテゴリ「Google Ads分析」に分類
- 変数のプレビュー・テスト送信機能は将来検討

## 13. エラーハンドリング方針

### 13.1 基本方針

| 結果 | `last_evaluated_on` | `consecutive_error_count` | 次回 cron |
|------|---------------------|--------------------------|-----------|
| **成功** | **当日（JST）に更新** | **0にリセット** | 翌日 |
| **エラー**（種別問わず） | **更新しない** | **+1** | 次回実行で自動リトライ |
| **メール送信失敗**（分析は成功） | **当日に更新** | **0にリセット** | 翌日 |

- エラー時に `last_evaluated_on` を更新しないことで、次回の cron（または手動実行）で自動リトライされる。
- メール送信失敗は分析自体は成功しているため、成功扱いとする。メール送信失敗はサーバーログに記録（再送機能は将来拡張）。
- メールユーザーでない場合は Server Action で即座に拒否（設定テーブルは更新しない）。

### 13.2 連続エラーによる cron スキップ

- `consecutive_error_count >= 3` の行は cron クエリの WHERE 句で除外される。
- 手動実行は `consecutive_error_count` に関わらず常に実行可能（ユーザーが意図的に再試行）。
- 手動実行が成功すれば `consecutive_error_count` が 0 にリセットされ、cron も再開される。

### 13.3 Cron バッチのエラー分離

- 1ユーザーの失敗が他ユーザーに影響しない（try-catch で分離）
- 各ユーザーの処理結果をバッチサマリーに集計して返却

## 14. 実装順序（推奨）

Phase 1〜3 は並行実施可能。

| # | Phase | 内容 | 依存 |
|---|-------|------|------|
| 1 | メール送信基盤 | `resend` インストール、`EmailService`、`env.ts` 更新 | なし |
| 2 | DB マイグレーション | 設定テーブル + RLS | なし |
| 3 | Google Ads API 拡張 | `getKeywordMetrics()` オプション追加, `getNegativeKeywords()`, 型追加 | なし |
| 4 | AI 分析サービス | `GoogleAdsAiAnalysisService`, `MODEL_CONFIGS`, `PROMPT_DESCRIPTIONS` | Phase 1, 2, 3 |
| 5 | Server Actions & Cron | Server Actions, Cron エンドポイント | Phase 4 |
| 6 | ダッシュボード UI | ボタン追加、メールユーザー判定 | Phase 5 |
| 7 | プロンプト登録 | `prompt_templates` INSERT | Phase 4 |
| 8 | 設計書更新 | 本ドキュメントの最終確認 | Phase 7 |

## 15. テスト観点

- **メール送信**: Resend テスト送信で到達確認
- **Google Ads API**: 全キーワード（除外含む）が正しく取得されることを確認
- **AI 分析**: プロンプト変数が正しく置換され、Claude から有意な分析が返ることを確認
- **手動実行**: ダッシュボードのボタン → 分析実行 → メール受信の E2E フロー
- **Cron 実行**: `/api/cron/google-ads-evaluate` エンドポイントの動作確認
- **メールユーザー制限**: LINE ユーザーではボタン非表示・API 拒否を確認
- **二重実行防止**: 同日に2回実行した場合にスキップされることを確認（`force: true` では実行される）
- **エラー分離**: バッチ実行中に1ユーザーがエラーでも他ユーザーの処理が継続されること
- **JST 日跨ぎ**: UTC 15:00 = JST 0:00 前後で正しく日付判定されるか
- `npm run lint` / `npm run build` の通過確認

## 16. 将来拡張（本設計対象外）

- **評価履歴テーブル** (`google_ads_evaluation_history`): 分析結果・メール送信状態・エラー詳細を DB に保存し、アプリ内で閲覧可能にする
- メール再送機能（履歴テーブルの `email_status = 'failed'` のレコードを手動再送）
- 分析期間のプリセット（7日 / 14日 / 30日 / 90日）
- 複数アカウントの一括分析
- 分析結果の PDF エクスポート
- プロンプトテンプレートのバージョン管理・A/B テスト
- Slack / LINE への分析結果通知連携
