# Google Ads AI評価機能 設計書

> **改訂履歴**:
> - 旧設計（ルールベース評価）から AI 分析方式に全面移行。旧設計は Git 履歴を参照のこと。
> - 2026-05-17: フェーズ2（Section 16）をフェーズ1実装完了後の確定方針で全面書き換え。AI自動実行範囲を Step 3〜6 から **Step 5〜6 のみ** に縮小、TOP5 抽出を **プロンプト末尾の JSON ブロック方式** に確定、Step 1〜4 UX を **自動入力＋ユーザー確認・修正のハイブリッド** に変更、Step 5〜6 自動実行を **Server Action 同期実行** に簡素化。
> - 2026-05-18: フェーズ2 のカード選択フローに **プレビュー/編集モーダル** を追加（カードクリック → モーダルで7フィールド編集 → [記事作成を開始] でセッション作成）。`createBlogSessionFromSuggestion` の引数を編集後フィールドを受け取る形に変更。`google_ads_blog_suggestions` 自体は更新せず、編集内容は `content_annotations` にのみ保存（同じ提案を別パターンで複数記事化可能）。
> - 2026-05-18 (追記): `google_ads_blog_suggestions` の保存戦略を **直近 N=3 回分のローリング保持** に変更（旧設計の上書き方式を廃止）。ダッシュボードは最新 TOP5 のみ表示、「履歴を見る」リンクで過去 N-1 回分を **履歴モーダル** で閲覧可能に。古いレコードは UPSERT 時にアプリケーション層で自動削除。
> - 2026-05-18 (追記2): 設計レビューで検出した 8 点のリスクを反映。(1) suggestions DB 保存をメール送信より先に実行、(2) Phase1 maxTokens を 8000→12000 に増加、(3) Step 5・6 自動実行を chat_messages 対として記録、(4) content_annotations.wp_post_id NULLABLE 化に伴う既存クエリ監査チェックリスト追加、(5) [記事作成を開始] 連打防止仕様明記、(6) Step 4→5 トリガー条件を「[次へ] 押下 + 保存 await 後」と明確化、(7) プレビュー編集モーダルをフォーカス時拡張型に変更、(8) モーダル on モーダル禁止（履歴→編集は閉じてから開く）。
> - 2026-05-18 (追記3): Phase 1 既述セクション（4.2, 8.3, 8.5, 8.6, 12.1, 12.2, 12.4）を本番DB現状合わせで更新。初期設計の `{{serviceName}}` / `{{strength}}` 変数を削除し、本番で追加された `{{searchTermData}}` を反映。Section 12.1/12.4 には「本セクションは初期設計時の参考。最新は本番DBを参照」注記を追加（プロンプト本文は本番運用で大幅改修済みのため）。
> - 2026-05-19: フェーズ2 の UI/UX 設計判断の根拠を集約した **Section 16.12「UI/UX 設計判断の根拠」** を新設（旧 16.12「前提・注意点」を 16.13 にリナンバー）。8つの主要決定（ハイブリッド UX、編集モーダル挟込、カード形式、最新+履歴モーダル、ローリング保持、フォーカス時拡張フォーム、モーダル on モーダル禁止、引き継ぎバナー常時表示）について、不採用案と受け入れたトレードオフを明文化。将来の改修判断時の参照用。
> - 2026-05-19 (追記5): §16.1 の保存タイミングを明確化。7フィールドは分析完了時に `google_ads_blog_suggestions` へ保存し、`content_annotations` への書き込みは「記事作成を開始」時のみ（モーダル編集中はフロント state のみ）と明記。
> - 2026-05-19 (追記4): フォローアップレビュー指摘を反映。§4.1 の maxTokens を 12000 に統一、§16.4 の Option A 向け文言修正、`upsertBlogSuggestions` メソッド名統一、§16.9 の `getSystemPrompt` + system/user 2段 `llmChat` パターン明記、ローディング UI の実完了連動・E2E（Step 7 見出し初期化）を追記。
> - 2026-05-19 (追記2): 設計レビューで指摘された **チャットフロー実態との乖離** を受けて **Option A** に大幅ピボット。具体的な変更: (1) Step 4→5 トリガーを廃止しモーダル内 Server Action で Step 5/6 を一気通貫実行、(2) チャットは `initialStep=step7` で起動、(3) 編集 UI は既存 `AnnotationPanel` を流用、(4) プロンプト取得は `getSystemPrompt`（既存 export）を使用、(5) `upsertContentAnnotationBySession` 流用を明記、(6) `getLatestContentAnnotationByUserId` に `wp_post_id IS NOT NULL` フィルタ必須を追記、(7) maxDuration 超過時のフォールバック（Step 5 のみ同期 + Step 6 チャット内追動）を Section 16.13 に追加、(8) 実装前スパイク（JSON フォーマット検証 + 実行時間計測）を強く推奨。工数は 9日 → 8.5日に微減（ChatLayout 改修削減と Server Actions 統合増の差し引き）。
> - 2026-05-20: Phase1 プロンプトの **▼ ユーザーのゴール ▼** が「3 候補 + 推奨」の構造で出力されることを踏まえ、`goal` フィールドの抽出仕様（§16.3, §16.4）を「【推奨ゴール】ブロックのみ（内容 + 選定理由）、【ゴール案1〜3】は破棄」と曖昧性なく明記。他フィールド（main_kw, kw, persona, needs, prep, impressions）は単一パターン出力のため変更なし。
> - 2026-05-20 (区切り): **フェーズ2の仕様検討を一旦ここで区切り**。開発は未着手。再開時に仕様変更の可能性あり（Section 16 冒頭の「開発ステータス」参照）。
> - 2026-05-31: 追加仕様として **Section 17「既存コンテンツとの競合・順位を踏まえた『新規作成 vs 既存修正』判定」** を新設（旧 Section 17「将来拡張」を Section 18 にリナンバー）。2026-05-20 定例MTGの議論を反映した基本設計。**開発未着手**。主な確定事項:
>   - **データソース**: 本機能の核（カニバリ→新規/修正）は **WordPress（既存コンテンツ在庫＝`content_annotations`）+ GSC（自社順位＝`gsc_query_metrics`）の2つで成立**。AI判定方式（固定閾値の機械判定はしない）。
>   - **SerpApi は核には不要・後続フェーズ・任意**。GSC で構造的に取れないのは (A) 自社未ランクKWの現状順位、(B) 競合の並び・難易度の2点のみで、**競合分析をするなら外部SERPデータ源（SerpApi 等）が必須**。これらを求めた場合に限り導入。
>   - **MVPメール書式（§17.4）**: 「本テーマでコンテンツを作成する」リンクは飛び先がチャット作成フロー依存のため **フェーズ2扱い・MVP非搭載**。MVPは各KWの現状成績（検索順位・タイトル・記事URL）＋新規/修正判断のみ。**順位・タイトル・URLはコード側で機械生成し LLM に書かせない**（捏造防止）。URL/タイトルの突合は **`content_annotation_id`（FK）経由**。
>   - **MVP は UI（画面）変更なし**（サーバー・プロンプト・メール出力のみ）。
>   - **工数 約3.5〜4日**。LLMコンテキスト量増を踏まえ、データ形式設計・トークン最適化（区切り表＝TSV/CSV風、本文フル投入回避）と メール順位表のコード生成 を独立計上。

## 1. 目的

- Google Ads のキーワード指標（通常KW + 除外KW）と事業者情報を Claude claude-opus-4-7 に分析させ、改善提案をメールで送信する。
- **フェーズ1では管理者限定ではなく、メールアカウント登録済みの全ユーザーが利用可能とする。** 段階ロールアウト（管理者のみ → 一般ユーザー）や Feature Flag による制限は行わない。
- 評価プロンプトは admin/prompts 画面で管理者ユーザーが編集可能とする。

## 2. スコープ

### 2.1 機能スコープ

- **対象ユーザー**: メールアカウント登録済みの全ユーザー（管理者限定ではなくなる為、権限表示の分岐を削除する）。
- 評価単位は **ユーザー単位**（1ユーザー1アカウント）。`customer_id` は `google_ads_credentials` から取得し、複数アカウント対応は将来拡張（Section 16 参照）。
- 評価対象期間はデフォルト30日。ユーザーが設定テーブルの `date_range_days` で変更可能。
- 評価対象キーワードはステータスフィルタなし（ENABLED / PAUSED / REMOVED 全取得）。除外キーワードも別途取得。
- AI がプロンプトに基づき自由形式の分析・提案を行う（固定閾値による機械的判定は行わない）。
- 分析結果は Markdown 形式で生成され、HTML 変換後にメール送信される。DB への結果保存は将来拡張（Section 16 参照）。
- 日付判定は **JST基準** で行う（`(now() at time zone 'Asia/Tokyo')::date`）。

## 3. 画面設計

### 3.1 ダッシュボード変更

既存の `app/google-ads-dashboard/_components/dashboard-content.tsx` にボタンと設定UIを追加。

- **メールユーザーの場合**: 以下を表示（管理者・一般ユーザー問わず）
  - 「AI分析を実行してメール送信」ボタン
    - クリック → Server Action 呼び出し → ローディング表示 → 完了/エラーメッセージ
    - クリック直後に実行中状態へ遷移し、Server Action の完了（成功/失敗）までボタンを無効化する
    - 実行中はスピナー等のローディング表示を維持し、エラー時はメッセージ表示後に再実行できる状態へ戻す
    - サービス未登録時はボタンを無効化し、事業者情報設定へのリンクを表示する
  - サービス選択 UI（ボタン周辺に配置）
    - Brief 設定済みのサービス一覧をドロップダウンで表示
    - デフォルトは `BriefInput.services[]` の先頭サービスを選択状態にする
    - サービスが1件のみの場合はドロップダウンを表示せず、そのサービスを分析対象とする
    - サービス未登録時は AI 分析を実行せず、エラー表示または事業者情報設定への導線を出す
    - UI では常に選択状態を持つが、Server Action には防御的フォールバックを持たせる。`serviceId` 未送信・UI 初期化前の送信・選択済みサービス削除後の古い `serviceId` などでは、サーバー側で `BriefInput.services[]` の先頭サービスにフォールバックする
  - 設定インライン UI（ボタン周辺に配置）
    - `date_range_days`: 数値入力（デフォルト30日）
    - 入力完了（blur）時に `updateEvaluationSettings` を呼び出して保存
    - AI分析実行中は `date_range_days` 入力欄も無効化し、実行中の設定変更と再送信を防ぐ

### 3.2 不要な画面

- `app/google-ads-evaluations/page.tsx` — 作成不要（結果はメールで配信）
- 通知トースト — 不要
- 既読管理 UI — 不要

## 4. AI 分析ロジック

### 4.1 分析方式

- Claude claude-opus-4-7 にキーワードデータ + 事業者コンテキストを渡し、自然言語で分析・提案を生成する。
- プロンプトテンプレートは `prompt_templates` テーブルで管理し、admin/prompts 画面で編集可能。
- モデル設定: `MODEL_CONFIGS['google_ads_ai_evaluation']`（ANTHROPIC_BASE, maxTokens: **12000**。フェーズ2で JSON 併出するため Section 16.10 参照）

### 4.2 プロンプト変数

AI 分析に渡す変数は以下の通り。`PromptService.replaceVariables()` で `{{variableName}}` 形式を置換する。

| 変数名 | ソース | 内容 |
|--------|--------|------|
| `persona` | `BriefService.getVariablesByUserId()` → `persona` | ターゲットペルソナ情報 |
| `keywordData` | `GoogleAdsService.getKeywordMetrics({ includeAllStatuses: true })` | 全キーワード指標（構造化テキスト） |
| `searchTermData` | `GoogleAdsService.getSearchTermMetrics()` | 実検索語句の表示回数・クリック・コンバージョン（構造化テキスト） |
| `negativeKeywords` | `GoogleAdsService.getNegativeKeywords()` | 除外キーワード一覧 |
| `dateRange` | 設定テーブル `date_range_days` から算出 | 分析期間（例: "2026-02-22 〜 2026-03-24"） |
| `customerName` | `GoogleAdsService.getCustomerInfo()`（取得失敗時は空文字） | Google Ads アカウント名 |

### 4.3 プロンプトテンプレート

- テンプレート名: `google_ads_ai_evaluation`
- 表示名: `Google Ads コンテンツ戦略提案`
- カテゴリ: admin/prompts 画面に「Google Ads分析」カテゴリを追加
- 内容: 運用者が admin/prompts で編集（初期テンプレートはシードデータ or マイグレーションで投入）

### 4.4 分析フロー

```
手動ボタン押下
  ↓
メールユーザーチェック（user.email IS NOT NULL）
  ↓
選択中サービスIDを受け取り、事業者情報内のサービスに解決
  ├─ serviceId が有効: 該当サービスを使用
  ├─ serviceId が未指定または無効: BriefInput.services[] の先頭サービスにフォールバック
  └─ services が空: エラーを返し、AI分析を実行しない
  ↓
Google Ads API からキーワード指標取得
  ├─ getKeywordMetrics({ includeAllStatuses: true }) — 全ステータスのKW
  └─ getNegativeKeywords() — 除外KW
  ↓
事業者情報取得（BriefService.getVariablesByUserId）
  ↓
プロンプト変数構築 → テンプレート取得 → 変数置換
  ↓
llmChat('anthropic', 'claude-opus-4-7', ...) で分析実行
  ↓
分析結果（Markdown）→ HTML 変換 → メール送信
  ↓
設定テーブル UPDATE
  成功時（メール送信まで完了）: last_evaluated_on 更新
  エラー時（API失敗 / メール送信失敗 いずれも）: last_evaluated_on 更新なし、サーバーログに記録
```

## 5. データ設計

旧設計のキーワード単位管理を廃止し、ユーザー単位（1ユーザー1アカウント）に簡素化する。

### 5.1 評価設定テーブル（新規）

- テーブル名: `google_ads_evaluation_settings`
- 役割: ユーザー単位のAI分析設定を保持する
- 一意制約: `user_id`（1ユーザー1レコード）
- MVP では `customer_id` / `customer_name` を保持しない。分析対象アカウントは `google_ads_credentials.customer_id` を正とする。

| カラム | 型 | デフォルト | 用途 |
|--------|-----|----------|------|
| `id` | uuid | `gen_random_uuid()` | 主キー |
| `user_id` | uuid | — | 所有ユーザー（`public.users(id)` FK） |
| `date_range_days` | integer | `30` | 分析対象期間（日数） |
| `last_evaluated_on` | date | `null` | 最終**成功**評価日 |
| `created_at` | timestamptz | `now()` | 作成日時 |
| `updated_at` | timestamptz | `now()` | 更新日時 |

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
- 除外キーワードが紐づくキャンペーン / 広告グループのステータスも取得し、停止済み・削除済み文脈を AI に渡す

```sql
-- キャンペーンレベル除外KW
SELECT
  campaign_criterion.keyword.text,
  campaign_criterion.keyword.match_type,
  campaign.name,
  campaign.status
FROM campaign_criterion
WHERE campaign_criterion.type = 'KEYWORD'
  AND campaign_criterion.negative = true

-- 広告グループレベル除外KW
SELECT
  ad_group_criterion.keyword.text,
  ad_group_criterion.keyword.match_type,
  campaign.name,
  campaign.status,
  ad_group.name,
  ad_group.status
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
    options?: {
      dateRangeDays?: number;
    }
  ): Promise<AnalysisResult>
  // customer_id は内部で google_ads_credentials から取得する
}
```

### 8.3 処理ステップ

1. **メールユーザーチェック**: `user.email IS NOT NULL` を確認。メールなしは拒否。
2. **Google Ads API 呼び出し**:
   - `getKeywordMetrics({ includeAllStatuses: true })` — 全ステータスのキーワード指標
   - `getNegativeKeywords()` — 除外キーワード一覧
3. **事業者情報取得**: `BriefService.getVariablesByUserId(userId)` でペルソナ・サービス情報を取得
4. **プロンプト変数構築**: `{{persona}}`, `{{keywordData}}`, `{{searchTermData}}`, `{{negativeKeywords}}`, `{{dateRange}}`, `{{customerName}}`
5. **テンプレート取得**: `PromptService.getTemplateByName('google_ads_ai_evaluation')`
6. **変数置換**: `PromptService.replaceVariables(template.content, variables)`
7. **AI 分析実行**: `llmChat('anthropic', 'claude-opus-4-7', messages, modelConfig)`
8. **メール送信**: `EmailService.sendGoogleAdsAnalysis(userEmail, subject, htmlContent)`。件名にはJSTの実行時刻を含め、アカウント名が取得できた場合のみ併記する（例: `【GrowMate】Google Ads コンテンツ戦略提案レポート（15:30実行 / アカウント名）`、未取得時: `【GrowMate】Google Ads コンテンツ戦略提案レポート（15:30実行）`）
9. **設定更新**:
    - **成功時**（メール送信まで完了）: `last_evaluated_on` を当日（JST）に更新
    - **エラー時**（API失敗・メール送信失敗いずれも）: `last_evaluated_on` は**更新しない**。エラー詳細はサーバーログに出力。メール失敗時もレポートは保存しないため同日中に手動再実行で再生成可能。

#### 連打時の扱い

手動実行はユーザー操作のたびに分析・メール送信を行う。同日中に複数回実行した場合もメールが複数届くが、件名にJSTの実行時刻を含めて最新レポートを判別できるようにする。プレビュー・確認用途を優先し、MVP ではロック機構を設けない。

### 8.4 MODEL_CONFIGS エントリ

`src/lib/constants.ts` に追加:

```typescript
google_ads_ai_evaluation: {
  ...ANTHROPIC_BASE,
  maxTokens: 8000,  // フェーズ2着手時に 12000 へ変更（Section 16.10 参照）
}
```

### 8.5 PROMPT_DESCRIPTIONS エントリ

`src/lib/prompt-descriptions.ts` に追加:

```typescript
google_ads_ai_evaluation: {
  description: 'Google Adsのキーワード指標と実検索語句をAIで分析し、コンテンツ戦略提案をメール送信するプロンプト',
  variables: 'ペルソナ、キーワード指標、実検索語句、除外キーワード、分析期間、アカウント名が自動で置換されます',
}
```

### 8.6 VARIABLE_TYPE_DESCRIPTIONS エントリ

`src/lib/prompt-descriptions.ts` に追加:

```typescript
keywordData: 'Google Ads 全キーワードの指標データ（構造化テキスト）',
searchTermData: 'Google Ads 実検索語句の指標（構造化テキスト）',
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
export async function runGoogleAdsAiAnalysis(): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}>
// customer_id は認証済みユーザーの google_ads_credentials から取得するため引数不要

/**
 * 評価設定を取得
 * row 未存在時もデフォルト値を返す（null は返さない）
 */
export async function getEvaluationSettings(): Promise<EvaluationSettingsResponse>
// EvaluationSettingsResponse: { dateRangeDays: number; lastEvaluatedOn: string | null }
// row が存在しない場合: { dateRangeDays: 30, lastEvaluatedOn: null }

/**
 * 評価設定を更新（期間変更）
 */
export async function updateEvaluationSettings(
  input: UpdateEvaluationSettingsInput
): Promise<{ success: boolean; error?: string }>
```

**手動実行（`runGoogleAdsAiAnalysis`）の認証・対象ユーザー**

- 認証は `authMiddleware()` を使用する。`authMiddleware` は Supabase Auth セッション（Email認証）で `public.users` のユーザーを解決する。
- メール送信の送付先は **`public.users.email` を正とする**（解決後の `userDetails.email`）。空（`null`）なら実行しない。
- `supabase.auth.getUser().email` は送付先の根拠にしない（セッションとアプリユーザーの取り違えを防ぐ）。

## 10. DB 物理設計（DDL案）

### 10.1 マイグレーション方針

- 追加先: `supabase/migrations/`
- ファイル名: `YYYYMMDD_create_google_ads_ai_evaluation_tables.sql`
- ロールバック案はマイグレーション SQL 内にコメントで併記する

### 10.2 評価設定テーブル

```sql
-- 評価設定テーブル: ユーザー単位のAI分析設定を管理（1ユーザー1レコード）
-- ロールバック: drop table if exists public.google_ads_evaluation_settings cascade;
create table if not exists public.google_ads_evaluation_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,

  -- 分析設定
  date_range_days integer not null default 30,

  -- 実行管理
  last_evaluated_on date,                    -- 最終成功評価日（JST基準）

  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),

  -- 1ユーザー1レコード（複数アカウント対応は将来拡張）
  unique(user_id)
);

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

### 10.5 連打時の扱い

手動実行はユーザー操作のたびに分析・メール送信を行う。`last_evaluated_on` は最終成功日の表示・記録用途であり、実行可否の判定には使わない。DB ロック（`FOR UPDATE`）は使用しない。

手動実行の連打時はメールが複数届く可能性があるが、確認用途を優先し、コスト（数十秒・数円程度）は許容範囲と判断する。

### 10.6 代表クエリ

```sql
-- 手動実行時の設定取得（1ユーザー1レコードのため user_id のみで特定）
SELECT id, date_range_days
FROM public.google_ads_evaluation_settings
WHERE user_id = :user_id;

-- 設定更新（成功時）
UPDATE public.google_ads_evaluation_settings
SET last_evaluated_on = (now() AT TIME ZONE 'Asia/Tokyo')::date,
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

### 11.2 既存ファイルへの変更

| ファイル | 変更内容 |
|---------|---------|
| `package.json` | `resend` パッケージ追加 |
| `src/env.ts` | `RESEND_API_KEY`（必須）追加 |
| `src/server/services/googleAdsService.ts` | `getKeywordMetrics()` に `includeAllStatuses` オプション追加、`getNegativeKeywords()` 新規追加 |
| `src/types/googleAds.types.ts` | `GoogleAdsNegativeKeyword`, `GetNegativeKeywordsResult` 追加 |
| `src/lib/constants.ts` | `MODEL_CONFIGS['google_ads_ai_evaluation']` 追加 |
| `src/lib/prompt-descriptions.ts` | `PROMPT_DESCRIPTIONS['google_ads_ai_evaluation']` + 変数説明追加 |
| `app/google-ads-dashboard/_components/dashboard-content.tsx` | AI分析実行ボタン + 設定インライン UI（`date_range_days` 数値入力）追加 |
| `app/google-ads-dashboard/page.tsx` | メールユーザー判定追加 |
| `src/server/actions/googleAds.actions.ts` | `getGoogleAdsConnectionStatus` / `fetchKeywordMetrics` / `fetchCampaignMetrics` の `isAdmin` チェックを撤去（一般ユーザー許可）。`disconnectGoogleAds` は本機能のスコープ外のため変更しない |
| `app/api/google-ads/oauth/start/route.ts` | `isAdmin` チェックを撤去（一般ユーザーが OAuth 連携を開始できるようにする） |
| `app/api/google-ads/oauth/callback/route.ts` | `isAdmin` チェックを撤去（一般ユーザーの OAuth コールバックを受け付けられるようにする） |
| `src/components/SetupDashboard.tsx` | Google Ads セクションの表示条件 `isAdmin && googleAdsStatus` から `isAdmin &&` を除去（一般ユーザーにも設定導線を表示） |
| `app/api/google-ads/accounts/select/route.ts` | 選択アカウントのアクセス権を検証し、`google_ads_credentials.customer_id` / `manager_customer_id` のみ更新する |
| `app/admin/prompts/PromptsClient.tsx` | `PROMPT_CATEGORIES` に「Google Ads分析」カテゴリを追加 |

## 12. プロンプトテンプレート登録

### 12.1 初期プロンプトテンプレート内容

> **⚠️ 重要**: 以下は **Phase 1 設計時の初期テンプレート**である。本番運用後に admin/prompts 画面で iteratively 大幅改修され、現本番版は「SEOコンテンツ戦略提案 + TOP5 抽出 + 構造化データ出力」に進化している。**最新の本番プロンプトは admin/prompts 画面または supabase の `prompt_templates` テーブルを参照すること**。本セクションは初期設計意図の歴史的記録として残す。
>
> 主な変更点（初期 → 現本番）:
> - 削除: `{{serviceName}}`, `{{strength}}` 変数
> - 追加: `{{searchTermData}}` 変数
> - 出力構造: 「Google広告改善提案」 → 「SEOコンテンツ戦略の TOP5 提案」

以下は `prompt_templates.content` に登録する初期テンプレートである。
admin/prompts 画面で運用者が自由に編集可能。`{{variableName}}` 形式の変数は `PromptService.replaceVariables()` で実行時に置換される。

```
あなたはGoogle広告運用の専門コンサルタントです。
以下の事業者情報と広告データを分析し、具体的な改善提案をMarkdown形式で作成してください。

## 事業者情報

### ターゲットペルソナ
{{persona}}

### 対象サービス
{{serviceName}}

### 対象サービスの強み
{{strength}}

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
除外キーワード | マッチタイプ | レベル | キャンペーン | キャンペーン状態 | 広告グループ | 広告グループ状態
------------|------------|-------|------------|----------------|------------|----------------
無料 | BROAD | campaign | ブランドKW | ENABLED | - | -
求人 | EXACT | ad_group | 一般KW | 症状系
...
```

#### `{{persona}}` の形式

`BriefService.getVariablesByUserId()` の `persona` フィールドをそのまま渡す。未設定の場合は `（ペルソナ未設定）` を代入。

#### `{{searchTermData}}` の形式

`GoogleAdsService.getSearchTermMetrics()` の結果を構造化テキストに整形。実際に検索された語句ごとに、表示回数・クリック数・コンバージョン数を含む（取得失敗時は非致命扱いで警告ログのみ、空文字で代入）。

> **補足**: コード上は `serviceName` / `strength` 変数も `buildAnalysisPrompt` に渡されるが、現本番プロンプトでは参照されないため置換結果に影響しない（Phase 1 初期設計の名残り）。サービス選択 UI と `serviceId` の防御的フォールバックロジック自体はコードに残っており、将来プロンプトで再利用される可能性に備えている。

#### `{{dateRange}}` の形式

`YYYY-MM-DD 〜 YYYY-MM-DD`（例: `2026-02-22 〜 2026-03-24`）

#### `{{customerName}}` の形式

分析実行時に `GoogleAdsService.getCustomerInfo()` から取得する。取得に失敗した場合は空文字を代入し、メール件名にもアカウント名を出さない。

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

> **注**: 以下は **Phase 1 初期設計時** の SQL。本番運用後、admin/prompts でテンプレート本文と variables が iteratively 更新されている。最新の状態は本番DBを参照のこと。

```sql
-- 初期マイグレーション（20260504021501_create_google_ads_evaluation_settings.sql）
-- 本番では admin/prompts 画面で更新済み（serviceName/strength 削除、searchTermData 追加など）
insert into public.prompt_templates (name, display_name, content, variables)
values (
  'google_ads_ai_evaluation',
  'Google Ads AI分析',
  E'（上記 12.1 のプロンプト本文をエスケープして挿入）',
  '[
    {"name": "persona", "description": "ターゲットペルソナ情報"},
    {"name": "keywordData", "description": "全キーワード指標（構造化テキスト）"},
    {"name": "searchTermData", "description": "実検索語句の指標（構造化テキスト）"},
    {"name": "negativeKeywords", "description": "除外キーワード一覧"},
    {"name": "dateRange", "description": "分析期間"},
    {"name": "customerName", "description": "Google Adsアカウント名"}
  ]'::jsonb
);
```

### 12.5 admin/prompts 画面での表示

`PromptsClient.tsx` の `PROMPT_CATEGORIES` 配列に以下を追加し、テンプレート名 prefix `google_ads_` で分類する。

```typescript
// PROMPT_CATEGORIES に追加
{
  id: 'google_ads',
  label: 'Google Ads分析',
  filter: (template: PromptTemplate) => template.name.startsWith('google_ads_'),
},

// chat カテゴリのフィルターも更新（google_ads_ を除外）
{
  id: 'chat',
  label: 'AIチャット・生成',
  filter: (template: PromptTemplate) =>
    !template.name.startsWith('gsc_') && !template.name.startsWith('google_ads_'),
},
```

- 変数のプレビュー・テスト送信機能は将来検討

## 13. エラーハンドリング方針

### 13.1 基本方針

| 結果 | `last_evaluated_on` | 次回手動実行 |
|------|---------------------|--------------|
| **成功**（メール送信まで完了） | **当日（JST）に更新** | 同日中でも再実行可能。メール件名の実行時刻で判別 |
| **API エラー**（Google Ads / LLM） | **更新しない** | 同日中に再実行可能 |
| **メール送信失敗** | **更新しない** | 同日中に再実行可能（LLM再生成） |

- エラー時に `last_evaluated_on` を更新しないことで、同日中の手動再実行を可能にする。
- メール送信失敗も**エラー扱い**とする。DB 保存がない現設計ではレポートが消失するため、再実行で LLM から再生成する（LLM コストは許容範囲）。エラー詳細はサーバーログに記録。
- メールユーザーでない場合は Server Action で即座に拒否（設定テーブルは更新しない）。

### 13.2 エラー時の扱い

- MVP では失敗回数や停止状態を DB に保持しない。
- エラー詳細はサーバーログに記録し、ユーザーは同日中でも手動再実行できる。
- 自動再実行・一時停止・管理者向け状態管理が必要になった時点で、失敗回数やステータス列を再設計する。

## 14. 実装順序（推奨）

Phase 1〜3 は並行実施可能。

| # | Phase | 内容 | 依存 |
|---|-------|------|------|
| 1 | メール送信基盤 | `resend` インストール、`EmailService`、`env.ts` 更新 | なし |
| 2 | DB マイグレーション | 設定テーブル + RLS | なし |
| 3 | Google Ads API 拡張 | `getKeywordMetrics()` オプション追加, `getNegativeKeywords()`, 型追加 | なし |
| 4 | AI 分析サービス | `GoogleAdsAiAnalysisService`, `MODEL_CONFIGS`, `PROMPT_DESCRIPTIONS` | Phase 1, 2, 3 |
| 5 | Server Actions | 手動実行・設定取得/更新 Server Actions | Phase 4 |
| 6 | ダッシュボード UI | ボタン追加、メールユーザー判定 | Phase 5 |
| 7 | プロンプト登録 | `prompt_templates` INSERT | Phase 4 |
| 8 | 設計書更新 | 本ドキュメントの最終確認 | Phase 7 |

## 15. テスト観点

- **メール送信**: Resend テスト送信で到達確認
- **Google Ads API**: 全キーワード（除外含む）が正しく取得されることを確認
- **AI 分析**: プロンプト変数が正しく置換され、Claude から有意な分析が返ることを確認
- **手動実行**: ダッシュボードのボタン → 分析実行 → メール受信の E2E フロー
- **実行中UI**: クリック直後から完了/失敗までボタンと分析期間入力が無効化され、ローディング表示が維持されることを確認
- **メールユーザー制限**: `email` が null のユーザーではボタン非表示・API 拒否を確認
- **同日再実行**: 同日に複数回実行した場合も、毎回分析・メール送信され、メール件名にJSTの実行時刻が含まれることを確認
- **JST 日跨ぎ**: UTC 15:00 = JST 0:00 前後で正しく日付判定されるか
- `npm run lint` / `npm run build` の通過確認

## 16. フェーズ2: 提案からブログ作成への連携（任意機能）

> ### 開発ステータス（メモ）
>
> | 項目 | 状態 |
> |------|------|
> | **仕様の区切り** | **2026-05-20 時点のドラフトで一旦凍結**（本 Section 16 全体） |
> | **開発着手** | **未着手**（マイグレーション・Server Actions・ダッシュボード UI・`googleAdsAiAnalysisService` 拡張いずれも未実装） |
> | **仕様の確定度** | 確定版ではない。再開時に Option A 含め変更される可能性あり |
>
> **再開時の目安**
> - 着手前に Section 16.13 の実装前スパイク（JSON フォーマット・Step 5/6 実行時間）を実施し、必要なら本設計を更新してから実装する
> - フェーズ1（Section 1〜15）とは独立。フェーズ1のみ運用中でも問題なし
>
> **本区切り時点で未実装の主な要素**（実装時のチェックリスト用）: `google_ads_blog_suggestions` テーブル、`content_annotations.wp_post_id` NULLABLE 化と既存クエリ監査、JSON 抽出・`upsertBlogSuggestions`、`createBlogSessionFromSuggestion`、TOP5 カード／編集・履歴モーダル、ChatLayout 引き継ぎバナー、Phase1 プロンプト末尾の構造化 JSON 出力（admin/prompts）

### 16.1 概要

- フェーズ1（メール送信までの AI 分析機能）を起点に、ユーザーがクリック1つで **チャット画面のブログ作成フロー** に乗り入れられるようにする任意機能。
- Phase 1 のプロンプトは **Step 1〜4 相当の内容**（メインKW/サブKW/広告実績/顕在・潜在ニーズ/ペルソナ/ユーザーのゴール/PREP）を TOP5 ごとに JSON で出力する。保存は **2段階**:
  1. **AI 分析完了時**: 抽出した JSON を `google_ads_blog_suggestions` に DB 保存（ダッシュボード TOP5 カード・履歴の表示元）。この時点では `content_annotations` は作らない。
  2. **ユーザーが [この内容で記事作成を開始] を押した時**: モーダルで編集した7フィールドを `content_annotations` に UPSERT（`session_id` 紐付け）。モーダル編集中のみフロント state で保持し、DB には書かない。`google_ads_blog_suggestions` の AI スナップショットは更新しない（Section 16.7 参照）。
- 記事作成フローでは、Step 5・6 の AI 自動実行のみ行い、Step 1〜4 相当の入力は上記 UPSERT 済みの `content_annotations` を前提とする（チャットの step1〜step4 ステップとは別概念）。
- 対象ユーザーはフェーズ1と同じ（メールアカウント登録済みの全ユーザー）。

### 16.2 UI/UX フロー

**Option A** を採用する。Step 1〜4 相当のフィールド編集はダッシュボードの「プレビュー/編集モーダル」に集約し、AI による Step 5/6 自動実行もモーダル内 Server Action で完結させる。チャット画面は **Step 7（本文作成）から起動** し、再編集や再生成が必要なら既存の `AnnotationPanel`（メモ・補足情報パネル）と `StepActionBar` のバック操作で対応する。

> **設計の根拠**: Option A を選んだ理由（チャットフロー実態との整合、Step 4 トリガー廃止の判断、AnnotationPanel 流用の優位性）、編集モーダルを挟む理由、TOP5 をカード形式にした理由などの設計判断は **Section 16.12** にまとめて記載している。

```
【AI分析・メール送信フェーズ】（Phase 1 と共通）

Google Ads API + 事業者情報
    ↓
Claude で分析（Phase 1 プロンプト末尾の JSON ブロックで TOP5 構造化データを併出）
    ↓
JSON ブロックを抽出 → DB（google_ads_blog_suggestions テーブル）に保存
    ↓
JSON ブロックを除去した Markdown を HTML 化してメール送信


【ユーザーアクション後フェーズ】

メール受信 → ダッシュボードで最新の TOP5 カードを確認
    ↓
任意カードの [📝 記事作成へ] をクリック
    ↓
プレビュー/編集モーダルが開く（AI 提案の7フィールドを編集可能フォームで表示）
    ↓
ユーザーが必要に応じて編集 → [この内容で記事作成を開始] をクリック
    ↓
モーダル内ローディング UI（「セッションを準備中…」「Step 5 を生成中…」「Step 6 を生成中…」）
    ↓
Server Action 一気通貫（maxDuration=120 想定）:
  1. chat_sessions に新規セッション作成
  2. content_annotations を UPSERT（session_id, main_kw, kw, impressions, needs, persona, goal, prep）
  3. blog_creation_step5: getSystemPrompt('blog_creation_step5', undefined, sessionId) を system に、短い user トリガーで llmChat（Section 16.9 参照）
     - 成功時: content_annotations.basic_structure を UPDATE（h2/h3/h4 形式。Step 7 見出し抽出に必須）
     - chat_messages に user/assistant メッセージ対を追加（Section 16.8 参照。user 文は llmChat に渡したトリガーと同一）
  4. blog_creation_step6 同様 → opening_proposal を UPDATE + chat_messages 追加
  5. 成功なら { sessionId, completedStep: 'step6' } 返却
  6. 部分失敗なら { sessionId, completedStep: 'step5'|null, failedStep, error } 返却
    ↓
クライアントが結果に応じて遷移先を決定:
  - 成功: /chat?session={id}&initialStep=step7
  - Step 6 失敗（Step 5 まで成功）: /chat?session={id}&initialStep=step6
  - Step 5 失敗: /chat?session={id}&initialStep=step5
  - セッション作成自体の失敗時はモーダル内でエラー表示し遷移しない
    ↓
チャット画面起動:
  - 引き継ぎバナー表示（Google Ads 起点）
  - StepActionBar は対象ステップで起動、バック/スキップで Step 1〜6 にも自由移動可能
  - 再編集したくなったら右パネルの AnnotationPanel（既存）を開いて9フィールドを編集
  - ペルソナや構成案を再生成したい場合は該当 Step にバックして AI に質問
```

- 既存 `app/chat/page.tsx:24-29` の `?initialStep=stepN` URL パラメータと `ChatLayout.initialStep` prop（`app/chat/components/ChatLayout.tsx:83`）を再利用する。
- 既存 `AnnotationPanel`（`app/chat/components/AnnotationPanel.tsx`）と `AnnotationFormFields`（`src/components/AnnotationFormFields.tsx`）をそのまま編集 UI として活用するため、チャット側の新規 UI 実装は最小（引き継ぎバナーのみ）。

### 16.3 Phase 1 プロンプトの修正（admin/prompts で実施）

`prompt_templates.google_ads_ai_evaluation`（本番DB登録済み）の **末尾** に以下の「構造化データ出力」セクションを追加する。Markdown 部分（メール本文）は変更しない。

````
---

## 【構造化データ出力】

最後に、上記の **▼ 推奨着手順序（TOP5）** に対応する各コンテンツの詳細を、以下のJSONブロックで出力してください。これはアプリでのブログ作成連携に使用されます。

```json
[
  {
    "rank": 1,
    "main_kw": "（上記コンテンツの ▼ メインKW ▼）",
    "kw": "（上記コンテンツの ▼ サブKW ▼ と ▼ ロングテールKW ▼ を改行区切りで結合）",
    "impressions": "（上記コンテンツの ▼ 広告実績 ▼ の表示回数合計）",
    "needs": "（上記コンテンツの ▼顕在ニーズ・潜在ニーズ ▼ をそのまま）",
    "persona": "（上記コンテンツの ▼ ペルソナ・CTA要点 ▼ をそのまま）",
    "goal": "（上記コンテンツの ▼ ユーザーのゴール ▼ の【推奨ゴール】ブロックのみを抽出。'内容: ...' と '選定理由: ...' の2行を含む。【ゴール案1〜3】は JSON に含めない）",
    "prep": "（上記コンテンツの ▼ ユーザー要点 ▼ の PREP 全体）"
  }
  // ... rank 2〜5 まで同形式で
]
```
````

サービス側（`googleAdsAiAnalysisService.ts`）で以下を実施:
1. AI 出力全体から ` ```json ... ``` ` ブロックを正規表現で抽出
2. 抽出した JSON をパース → `BlogSuggestion[]` 型に変換 → DB 保存
3. **JSON ブロックを除去した Markdown** を HTML 変換 → メール送信（メール本文に JSON は含めない）
4. JSON パース失敗時はログ出力のみ。メール送信は通常実行（フェーズ2機能はメール送信の成功を阻害しない）。

### 16.4 content_annotations へのマッピング

JSON ブロックの各キーを `content_annotations` カラムに以下のとおりマッピングする。

| JSON キー | content_annotations カラム | Phase 1 プロンプト出力セクション |
|---|---|---|
| `main_kw` | `main_kw` | **▼ メインKW ▼** |
| `kw` | `kw` | **▼ サブKW ▼** + **▼ ロングテールKW ▼**（結合） |
| `impressions` | `impressions` | **▼ 広告実績 ▼** の「表示回数合計」 |
| `needs` | `needs` | **▼顕在ニーズ・潜在ニーズ ▼** |
| `persona` | `persona` | **▼ ペルソナ・CTA要点 ▼** |
| `goal` | `goal` | **▼ ユーザーのゴール ▼** の【推奨ゴール】ブロックのみ（内容 + 選定理由）。【ゴール案1〜3】は破棄 |
| `prep` | `prep` | **▼ ユーザー要点 ▼**（PREP） |

- Phase 1 出力の7フィールド（Step 1〜4 **相当**）のマッピング先は `content_annotations` カラム。**DB への書き込みタイミング**は「記事作成を開始」時のみ（Section 16.1 の2段階保存）。分析直後は `google_ads_blog_suggestions.suggestions`（jsonb）に保持する（チャットの step1〜step4 ステップ番号とは別概念。Section 16.12 参照）。
- `basic_structure`（Step 5 出力）, `opening_proposal`（Step 6 出力）はモーダル内 Server Action の AI 自動実行で生成される。
- **Option A**: 7フィールドの確認・修正はダッシュボードのプレビュー/編集モーダルで行う（初期表示は AI 提案値）。チャット到着後の再編集は `AnnotationPanel`（Section 16.8 参照）。

### 16.5 新規テーブル: google_ads_blog_suggestions

直近の TOP5 提案を **ローリング保持**するテーブル。AI 分析を実行するたびに新しいレコードを INSERT し、ユーザーごとに最新 N 件（既定 `N = 3` 回分、最大 15 カード）を超えたら最古を削除する。

```sql
create table if not exists public.google_ads_blog_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  customer_id text not null,
  evaluated_at timestamptz not null default timezone('utc', now()),

  -- AI出力からパースした TOP5 構造化データ
  suggestions jsonb not null default '[]',
  -- 各要素の構造:
  -- {
  --   rank: number,        // 優先度順位（1〜5）
  --   main_kw: string,     // メインKW
  --   kw: string,          // サブKW + ロングテールKW（改行区切り結合）
  --   impressions: string, // 広告実績の表示回数合計
  --   needs: string,       // 顕在ニーズ・潜在ニーズ
  --   persona: string,     // ペルソナ・CTA要点
  --   goal: string,        // ユーザーのゴール（推奨ゴール）
  --   prep: string         // ユーザー要点（PREP）
  -- }

  created_at timestamptz not null default timezone('utc', now())
  -- UNIQUE 制約は設けない（履歴を複数件保持するため）
);

-- 履歴フェッチ用のインデックス（最新N件取得を高速化）
create index if not exists idx_google_ads_blog_suggestions_user_evaluated
  on public.google_ads_blog_suggestions(user_id, evaluated_at desc);

alter table public.google_ads_blog_suggestions enable row level security;

create policy "google_ads_blog_suggestions_select"
  on public.google_ads_blog_suggestions for select
  using (user_id::text = any(get_accessible_user_ids((select auth.uid()))));

-- INSERT/DELETE は Service Role 経由のため RLS ポリシー不要
-- （RLS は enable だが、supabaseAdmin は RLS をバイパスする）
```

#### ローリング保持ロジック（アプリケーション層）

`SupabaseService.upsertBlogSuggestions(userId, customerId, suggestions)` 内で実施:
1. 新しいレコードを INSERT
2. 同じ `user_id` の全レコードを `evaluated_at DESC` で取得
3. N（既定 3）件を超えたら超過分（古いもの）を DELETE
4. `N` は `src/lib/constants.ts` に `GOOGLE_ADS_BLOG_SUGGESTIONS_RETENTION = 3` として定義

- DB トリガー方式は採用しない（アプリケーション層で完結する方がデバッグ容易）。
- RLS は `google_ads_evaluation_settings` と統一の `get_accessible_user_ids` パターン。代理店スタッフが事業者の代わりに操作するケースも許容。

### 16.6 content_annotations スキーマ変更

Google Ads 起点では WP 投稿が未発行のため、`wp_post_id` を NULLABLE に変更する。

```sql
-- フェーズ2 マイグレーション: Google Ads 起点で wp_post_id 未確定を許容
alter table public.content_annotations
  alter column wp_post_id drop not null;

-- 既存の unique(user_id, wp_post_id) は wp_post_id が NULL の行を複数許可（PostgreSQL 標準挙動）
-- そのため Google Ads 起点の content_annotations は session_id ベースで UPSERT する（既存の content_annotations_session_id_unique 制約を活用）
```

#### 既存クエリへの影響と監査チェックリスト

`wp_post_id` を NOT NULL 前提に書かれている既存クエリ/RPC/サービスメソッドが Google Ads 起点行（`wp_post_id IS NULL`）を誤って巻き込まないように、フェーズ2 実装時に以下を必ず監査・対応する。

| 対象 | 対応 |
|---|---|
| `supabase/migrations/20260219232000_add_get_filtered_content_annotations.sql` の RPC `get_filtered_content_annotations` | WordPress 連携用フィルタ。Google Ads 起点行が混ざらないよう WHERE 句に `wp_post_id IS NOT NULL` を追加。 |
| `src/server/services/wordpressService.ts` / `wordpress.actions.ts` 内の content_annotations 取得・更新コード | `wp_post_id IS NOT NULL` を前提に書かれていれば明示フィルタを追加。 |
| `PromptService.getLatestContentAnnotationByUserId()` | **必須対応**: Google Ads 起点の `wp_post_id IS NULL` 行が `updated_at` 最新になると別セッションの WP フローに紛れ込むため、**最新取得 SELECT に `wp_post_id IS NOT NULL` フィルタを必須追加**。フェーズ2 マイグレーション PR にコード修正を必ず同梱する。 |
| `PromptService.getContentAnnotationBySession()` | session_id 紐付け取得は OK（変更不要）。 |
| `PromptService.getCanonicalLinkEntriesByUserId()` | `canonical_url` 取得用。`wp_post_id IS NOT NULL` 前提のため明示フィルタを追加。 |

監査は `grep -rn "content_annotations\|getLatestContentAnnotation\|getCanonicalLink" src/ supabase/migrations/` で全箇所洗い出してから実施する。**マイグレーション PR と同時に既存クエリ修正をまとめてレビュー対象にする**。

### 16.7 ダッシュボード TOP5 カード表示 + プレビュー/編集モーダル + 履歴モーダル

#### TOP5 カード（最新のみ）

- 配置: `app/google-ads-dashboard/_components/dashboard-content.tsx` に新規コンポーネント `BlogSuggestionCards` を追加（`EvaluationControls` の下に配置）。
- 表示元: `getLatestBlogSuggestions()` Server Action で **最新 1 回分**（5カード）を取得。
- 空状態: 「AI分析を実行すると、ここにブログ記事の提案が表示されます」を表示。
- 各カードの内容:
  - `rank` バッジ（#1〜#5）
  - `main_kw`（タイトル相当）
  - `kw`（短縮: 先頭2件 + 「…他N件」）
  - `persona`（短縮: 先頭120文字 + 「…」）
  - `goal`（短縮: 先頭80文字 + 「…」）
  - [📝 記事作成へ] ボタン
- カード一覧の見出し横に **[履歴を見る]** リンクボタンを配置（履歴が2回分以上ある場合のみ表示）。

- カードの [📝 記事作成へ] クリック時: **プレビュー/編集モーダルを開く**（Server Action はまだ呼ばない）

#### 履歴モーダル

新規コンポーネント `BlogSuggestionHistoryModal`（`app/google-ads-dashboard/_components/blog-suggestion-history-modal.tsx`）。

- 表示元: `getBlogSuggestionsHistory()` Server Action で過去 N-1 回分（最新を除く）を取得。
- 表示構造: 実行日付ごとにグルーピングして TOP5 カードを並べる。

```
┌──────────────────────────────────────────┐
│ 過去の提案履歴                  [✕]      │
├──────────────────────────────────────────┤
│ 📅 2026-05-10 19:23 実行                 │
│  [#1] [#2] [#3] [#4] [#5]                │
│   (それぞれ最新カードと同じ表示形式)      │
│                                          │
│ 📅 2026-05-03 14:55 実行                 │
│  [#1] [#2] [#3] [#4] [#5]                │
└──────────────────────────────────────────┘
```

- 各カードの [📝 記事作成へ] は最新カードと同じく **プレビュー/編集モーダル**を開く（共通フロー）。
- 履歴が0件の場合は [履歴を見る] リンクを非表示にする。

#### プレビュー/編集モーダル

新規コンポーネント `BlogSuggestionEditModal`（`app/google-ads-dashboard/_components/blog-suggestion-edit-modal.tsx`）。

- 表示内容: AI 提案の7フィールドを編集可能フォームで初期表示。フィールドは **重要度順** に並べ、長文フィールドは初期表示時に行数を制限してフォーカス時に拡張する。
  - `main_kw`（テキスト1行、必須）
  - `kw`（テキストエリア、初期 3 行、フォーカス時 6 行）
  - `persona`（テキストエリア、初期 4 行、フォーカス時 10 行）
  - `goal`（テキストエリア、初期 3 行、フォーカス時 6 行）
  - 区切り線「▼ 補助情報（必要に応じて調整）」
  - `needs`（テキストエリア、初期 3 行、フォーカス時 6 行）
  - `prep`（テキストエリア、初期 3 行、フォーカス時 6 行）
  - `impressions`（テキスト1行）
- モーダル全体は `max-height: 80vh` + 内部スクロール。
- ヘッダ: `#{rank} {main_kw 初期値}` + クローズボタン
- フッタ: [キャンセル] / [この内容で記事作成を開始]（送信中は loading spinner + disabled）
- バリデーション: `main_kw` のみ必須、その他は任意。

- [この内容で記事作成を開始] クリック時:
  1. **連打防止**: クリック直後にボタンを disable + loading 表示し、Server Action 完了まで再クリック不可。`useTransition` で実装。
  2. 編集後の全フィールド + 元 `suggestionRecordId` + `rank` を `createBlogSessionFromSuggestion()` Server Action に渡す。
  3. Server Action は **セッション作成 + content_annotations UPSERT + Step 5 実行 + Step 6 実行** を一気通貫で行う（詳細 Section 16.9）。
  4. 実行中はモーダル内のステータステキストを順次更新（「セッションを準備中…」→「Step 5（基本構成）を生成中…」→「Step 6（書き出し案）を生成中…」）。
  5. 成功完了: `router.push('/chat?session={sessionId}&initialStep=step7')` で遷移（push 後にモーダルを閉じる）。
  6. 部分失敗時: 最後に保存できたステップに応じて `initialStep=step5|step6` で遷移。モーダル内にエラーメッセージを 2 秒表示してから遷移。
  7. セッション作成自体の失敗時: モーダル内にエラー表示、ボタンを再 enable して再試行可能。遷移しない。

#### ローディング UI 仕様

長時間処理（30〜80 秒）であるため、モーダル内に視覚的進捗を表示する。

```
┌──────────────────────────────────────┐
│ #1 渋谷 美容室                       │
│ 記事作成の準備中です（30〜80秒）       │
├──────────────────────────────────────┤
│ ✓ セッションを準備中…                │
│ ⏳ Step 5（基本構成）を生成中…        │
│ ⏸ Step 6（書き出し案）を生成中…       │
│                                      │
│  [キャンセル不可]                     │
└──────────────────────────────────────┘
```

- 各ステップは ✓（完了）/ ⏳（進行中）/ ⏸（待機）の3状態を表す。
- 進行中アイコンはスピナーアニメーション。
- ユーザーには「キャンセルできない処理」と明示し、誤操作（タブ閉じ等）を防ぐ警告を表示（`beforeunload` イベントで「処理中です」を表示）。
- Server Action の進行状況をクライアントが知るには SSE / ポーリングが必要だが、MVP では **均等タイマーで擬似進行**（推定3秒で「セッション準備中」、推定30秒で「Step 5 生成中」、推定60秒で「Step 6 生成中」に切り替え）する。
- **実装要件**: `createBlogSessionFromSuggestion` の **Server Action 完了（成功/部分失敗/失敗）時**に、擬似タイマーを止めて最終ステップを ✓ に更新してから遷移する。タイマーだけが先に「完了」表示になる状態は避ける（実時間と多少ズレる擬似進行は許容）。

- ユーザーが編集した内容は **`google_ads_blog_suggestions` には保存しない**（AI 生成スナップショットは不変。同じ提案を別パターンで複数記事化できるようにするため）。`content_annotations` にのみ保存する。

#### モーダル階層の整理

**履歴モーダル**と**プレビュー/編集モーダル**を同時にスタックさせない（モーダル on モーダルを避ける）。
- 履歴モーダル内のカードをクリックした場合は、**履歴モーダルを閉じてから**プレビュー/編集モーダルを開く。
- 編集をキャンセルした場合、履歴モーダルを再度開かない（ユーザー操作でダッシュボードに戻る）。
- これにより z-index 競合・閉じ操作の混乱を回避する。

### 16.8 ChatLayout の変更

Option A では Step 5/6 の自動実行は **ダッシュボードのモーダル内 Server Action で完結** している（Section 16.2, 16.7, 16.9 参照）。そのため、ChatLayout 側で「Step 4→5 トリガー」を実装する必要はない。ChatLayout の変更は最小限の以下のみ。

**引き継ぎバナー表示** (`app/chat/components/ChatLayout.tsx`):
- 表示条件: 現在のセッションに紐づく `content_annotations` で `main_kw` が事前入力済み、かつ `wp_post_id` が NULL（Google Ads 起点と判定）
- 表示内容:

```
┌─────────────────────────────────────────┐
│ 📊 Google Ads分析から引き継ぎ            │
│ KW: {main_kw} / ペルソナ: {persona抜粋}  │
└─────────────────────────────────────────┘
```

- **表示終了条件**: バナーはセッションが Google Ads 起点である限り **常時表示**（Step 1〜7 のどこにいても見える）。文脈ヒントとしての価値があるため、明示的な「閉じる」操作以外では消さない。ユーザーが [✕] で閉じた場合は localStorage に sessionId を保持し、同セッションでは再表示しない。

**編集 UI は既存 AnnotationPanel を使用**:
- 9 フィールド（main_kw, kw, impressions, needs, persona, goal, prep, basic_structure, opening_proposal）の編集は **既存 `AnnotationPanel`** で行う（`app/chat/components/AnnotationPanel.tsx`、`src/components/AnnotationFormFields.tsx`、`useAnnotationForm` フック流用）。
- 既に `upsertContentAnnotationBySession`（`src/server/actions/wordpress.actions.ts:541`）で保存される仕組みになっているため、フェーズ2 で追加実装は不要。
- ユーザーが内容を修正したい場合は右サイドの AnnotationPanel を開いて編集し、保存する流れ。

**StepActionBar の挙動はそのまま**:
- 既存の `handleManualStepShift`（`app/chat/components/StepActionBar.tsx:187`）によるバック/スキップを変更しない。
- Google Ads 起点セッションでも、Step 7 起動後に Step 1〜6 へバックして AI に再質問できる（ペルソナを再生成したい等）。
- スキップで Step を飛ばしても、Section 16.9 で実行済みの内容（basic_structure / opening_proposal）は content_annotations に保存済みなので、後段ステップで参照可能。

**Step 5・6 自動実行の chat_messages 連携（Server Action 内部の責務）**:
- 通常のチャットフローは AI 呼び出しごとに `chat_messages` に user/assistant メッセージが残る。**自動実行版も同じ形式で記録する**ことで、ユーザーが Step 5/6 のステップに戻ったときの履歴整合性を保つ。
- 記録するメッセージ例:
  - User: 仮想的なシステム発言として記録。`role='user'`, `model='blog_creation_step5'`, `content='【自動実行】事前入力された情報から基本構成を生成してください'`
  - Assistant: 通常通り AI 出力を記録。`role='assistant'`, `model='blog_creation_step5'`, `content={basic_structure}`
- Step 6 も同様。
- これにより既存の Canvas ステップ管理ロジック（`latestBlogStep` 等）が自然に Step 5/6 を認識する。
- メッセージの並び順は user → assistant の対であることに注意。
- 記録はモーダル内 Server Action が実行する（クライアントの ChatLayout は記録に関与しない）。

### 16.9 Server Actions（新規）

`src/server/actions/googleAdsBlogSuggestion.actions.ts` を新規作成。

```typescript
'use server'

import type { BlogSuggestion } from '@/types/google-ads-blog-suggestion.types';

/**
 * 最新の TOP5 suggestions を取得
 * 認証済みユーザーの最新 1 回分（5カード）+ 実行日時を返す
 */
export async function getLatestBlogSuggestions(): Promise<{
  success: boolean;
  data?: {
    evaluatedAt: string;
    suggestions: BlogSuggestion[];
  };
  error?: string;
}>

/**
 * 過去の TOP5 suggestions 履歴を取得（最新を除く N-1 回分）
 * 履歴モーダルで使用
 */
export async function getBlogSuggestionsHistory(): Promise<{
  success: boolean;
  data?: Array<{
    evaluatedAt: string;
    suggestions: BlogSuggestion[];
  }>;
  error?: string;
}>

/**
 * プレビュー/編集モーダルで編集された内容を受け取り、以下を一気通貫で実行する:
 *   1. chat_sessions 新規作成
 *   2. content_annotations を UPSERT（7フィールド: main_kw, kw, impressions, needs, persona, goal, prep）
 *   3. blog_creation_step5 実行 → basic_structure 保存 + chat_messages 連携
 *   4. blog_creation_step6 実行 → opening_proposal 保存 + chat_messages 連携
 *
 * `google_ads_blog_suggestions` 自体は更新しない（AI 生成スナップショットは不変）。
 *
 * ファイル先頭で `export const maxDuration = 120` を設定。
 *
 * @param input.suggestionRecordId 元になった google_ads_blog_suggestions レコードの uuid（トレーサビリティ用）
 * @param input.rank 元になった提案の rank（履歴と組み合わせて出所を識別、1〜5）
 * @param input.main_kw〜prep モーダルで編集された後のフィールド値
 * @returns 成功時は sessionId と完了ステップ。部分失敗時は最後に成功したステップ。
 */
export async function createBlogSessionFromSuggestion(input: {
  suggestionRecordId: string;
  rank: number;
  main_kw: string;
  kw: string;
  impressions: string;
  needs: string;
  persona: string;
  goal: string;
  prep: string;
}): Promise<{
  success: boolean;
  sessionId?: string;                          // セッション作成成功時に必ず返す（Step 5/6 失敗時も）
  completedStep?: 'step5' | 'step6' | null;    // 最後に成功したステップ（null = Step 5 失敗）
  failedStep?: 'step5' | 'step6';              // 失敗したステップ
  error?: string;
}>
```

#### Server Action の内部処理詳細

```typescript
// src/server/actions/googleAdsBlogSuggestion.actions.ts
'use server';
export const maxDuration = 120;  // Vercel Pro 上限内、Opus×2回の余裕含む

import { llmChat } from '@/server/services/llmService';
import { getSystemPrompt } from '@/lib/prompts';
import { upsertContentAnnotationBySession } from '@/server/actions/wordpress.actions';
import { MODEL_CONFIGS, toBlogModel } from '@/lib/constants';
// ... 認証、chat_session 作成、chat_messages 追加用ヘルパー等
//
// プロンプト取得: getSystemPrompt(model, undefined, sessionId) を使用する。
// generateBlogCreationPromptByStep（prompts.ts:788）は非 export の内部関数。
// getSystemPrompt が同関数を経由して DB テンプレート + content_annotations 変数置換を行う（既存チャットと同一経路）。

const STEP5_USER_TRIGGER =
  '【自動実行】事前入力された情報から基本構成を生成してください';
const STEP6_USER_TRIGGER =
  '【自動実行】基本構成から書き出し案を生成してください';

export async function createBlogSessionFromSuggestion(input) {
  // ... 認証チェック ...

  // 1) chat_session 作成
  const session = await createChatSessionWithTitle({
    userId,
    title: `Google Ads提案 #${input.rank}: ${input.main_kw}`,
  });

  // 2) content_annotations を UPSERT（既存 upsertContentAnnotationBySession 流用）
  const upsertResult = await upsertContentAnnotationBySession({
    session_id: session.id,
    main_kw: input.main_kw,
    kw: input.kw,
    impressions: input.impressions,
    needs: input.needs,
    persona: input.persona,
    goal: input.goal,
    prep: input.prep,
    // wp_post_id は渡さない → NULL のまま（Google Ads 起点を示す）
  });
  if (!upsertResult.success) return { success: false, error: ... };

  // 3) blog_creation_step5 実行（既存チャットと同様: system=DBテンプレート、user=短いトリガー）
  try {
    const step5Model = toBlogModel('step5');
    const step5Config = MODEL_CONFIGS[step5Model];
    const step5SystemPrompt = await getSystemPrompt(step5Model, undefined, session.id);
    const step5Output = await llmChat(
      step5Config.provider,
      step5Config.actualModel,
      [
        { role: 'system', content: step5SystemPrompt },
        { role: 'user', content: STEP5_USER_TRIGGER },
      ],
      { maxTokens: step5Config.maxTokens }
    );

    // basic_structure を UPDATE（Step 7 の見出し抽出は h2/h3/h4 行形式を前提）
    await upsertContentAnnotationBySession({
      session_id: session.id,
      basic_structure: step5Output,
    });

    // chat_messages に対として追加（user 文は llmChat に渡したトリガーと同一）
    await appendChatMessages(session.id, [
      { role: 'user', model: step5Model, content: STEP5_USER_TRIGGER },
      { role: 'assistant', model: step5Model, content: step5Output },
    ]);
  } catch (err) {
    return {
      success: false, sessionId: session.id,
      completedStep: null, failedStep: 'step5',
      error: '基本構成の生成に失敗しました。再生成は Step 5 でお試しください。',
    };
  }

  // 4) blog_creation_step6 実行（Step 5 と同じパターン）
  try {
    const step6Model = toBlogModel('step6');
    const step6Config = MODEL_CONFIGS[step6Model];
    const step6SystemPrompt = await getSystemPrompt(step6Model, undefined, session.id);
    const step6Output = await llmChat(
      step6Config.provider,
      step6Config.actualModel,
      [
        { role: 'system', content: step6SystemPrompt },
        { role: 'user', content: STEP6_USER_TRIGGER },
      ],
      { maxTokens: step6Config.maxTokens }
    );
    await upsertContentAnnotationBySession({
      session_id: session.id,
      opening_proposal: step6Output,
    });
    await appendChatMessages(session.id, [
      { role: 'user', model: step6Model, content: STEP6_USER_TRIGGER },
      { role: 'assistant', model: step6Model, content: step6Output },
    ]);
  } catch (err) {
    return {
      success: false, sessionId: session.id,
      completedStep: 'step5', failedStep: 'step6',
      error: '書き出し案の生成に失敗しました。再生成は Step 6 でお試しください。',
    };
  }

  return { success: true, sessionId: session.id, completedStep: 'step6' };
}
```

#### 再利用する既存実装

| 対象 | 再利用先 |
|---|---|
| `upsertContentAnnotationBySession` | `src/server/actions/wordpress.actions.ts:541`（既存、そのまま流用） |
| `getSystemPrompt` | `src/lib/prompts.ts:944`（既存 export。内部で `generateBlogCreationPromptByStep` を呼び、`content_annotations` 読み取り + `{{contentXxx}}` 変数置換を担う） |
| `toBlogModel` | `src/lib/constants.ts:132`（`step5` → `blog_creation_step5` 等） |
| `MODEL_CONFIGS.blog_creation_step5` / `step6` | `src/lib/constants.ts:76-77`（既存）。`claude-opus-4-7`、maxTokens 6000/5000。 |
| `llmChat` | `src/server/services/llmService.ts:26-130`（既存） |
| chat_sessions / chat_messages の作成 | `src/server/services/chatService.ts` のヘルパーを流用、または最小限の Supabase 直接呼び出し |

#### Server Action 共通の留意事項

- **`suggestionRecordId` 不在許容**: `suggestionRecordId` が DB に既に存在しない場合（履歴ローリングで削除済み、または手動削除）も、入力フィールドは編集後の値をそのまま使うため処理は続行可能。トレーサビリティログだけは「suggestionRecordId not found, but proceeded with manual values」と warning レベルで出す。
- **連打対策（サーバー側のセカンドライン）**: 同一 `userId` で直近 5 秒以内に作成された chat_session が存在する場合は、新規作成せず既存セッションIDを返す（クライアント側の disable と二重ガード）。ただし、ユーザーが意図的に短時間で複数候補を試したい正当ケースもあるため、**MVP では実装しない**で UI 側の disable のみとし、必要になった時点で追加検討する。
- **maxDuration=120 でも超過する場合**: フォールバックとして Step 5 のみモーダル内で実行し、Step 6 はチャット到着後にクライアントから別 Server Action で追動。詳細 Section 16.13。

### 16.10 googleAdsAiAnalysisService の変更

`src/server/services/googleAdsAiAnalysisService.ts` に以下を追加。

```typescript
// JSON ブロック抽出ヘルパー
type ExtractedOutput = {
  markdown: string;             // メール本文用（JSON 除去版）
  suggestions: BlogSuggestion[]; // DB 保存用
};

function extractStructuredOutput(rawOutput: string): ExtractedOutput {
  // ` ```json ... ``` ` ブロックを正規表現で抽出
  // 失敗時は markdown=rawOutput, suggestions=[] を返す
  // 成功時は markdown から JSON ブロック部分を除去
}

// analyzeAndSend() 内の変更
const analysisRaw = await llmChat(/* ... */);
const { markdown, suggestions } = extractStructuredOutput(analysisRaw);

// 【重要】メール送信より先に suggestions を DB 保存する。
// 順序の理由: メール先送信→DB保存失敗時、ユーザーは「メールに書かれた提案がダッシュボードにない」状態に陥り混乱するため。
// DB 先保存→メール送信失敗時は、再実行で同じ内容のメールを再送できる（同日中のリトライは設計済み）。
if (suggestions.length > 0) {
  const saveResult = await this.supabaseService.upsertBlogSuggestions(
    userId,
    credential.customerId,
    suggestions
  );
  // upsertBlogSuggestions の内部:
  //  1) INSERT 新レコード
  //  2) 同 user_id のレコード数が GOOGLE_ADS_BLOG_SUGGESTIONS_RETENTION (=3) を超えたら最古を DELETE
  if (!saveResult.success) {
    console.error('[GoogleAdsAiAnalysisService] Failed to save blog suggestions:', saveResult.error);
    // suggestions 保存失敗はメール送信を阻害しない（メール本文の Markdown 自体は完成しているため送る価値あり）
    // ユーザーがダッシュボードで提案を見られないことはログ + 監視で検知する
  }
}

// その後にメール送信
const htmlContent = sanitizeEmailHtml(await marked.parse(markdown));
const emailResult = await this.emailService.sendGoogleAdsAnalysis(/* ... */);
```

- JSON パース失敗・スキーマ不一致時はログ出力のみ、メール送信は通常実行（メール本文は Markdown のみで完結するため）。
- 既存の DEV モード分岐にも同様の処理を追加。

#### maxTokens 調整

Phase 1 プロンプトに「構造化データ出力」セクション（JSON ブロック）を追加することで、AI 応答全体のトークン数が増加する。現状 `MODEL_CONFIGS.google_ads_ai_evaluation.maxTokens: 8000` だと **TOP5 詳細 + JSON で切り詰めされるリスク**があるため、`maxTokens: 12000` に増やす（`src/lib/constants.ts` の変更）。

```typescript
// 旧
google_ads_ai_evaluation: { ...ANTHROPIC_BASE, maxTokens: 8000, label: '...' }
// 新
google_ads_ai_evaluation: { ...ANTHROPIC_BASE, maxTokens: 12000, label: '...' }
```

実装時に実出力サイズを計測し、12000 でも切り詰めが発生するなら段階的に増やす（Claude Opus 4.7 の最大は 64000）。

### 16.11 実装工数見積もり（フェーズ2）

| コンポーネント | 内容 | 工数 |
|---|---|---|
| Phase 1 プロンプト更新 | admin/prompts で末尾に「構造化データ出力」セクション追加 | 0.5日 |
| DB マイグレーション | `google_ads_blog_suggestions` テーブル（履歴対応）+ RLS + インデックス + `content_annotations.wp_post_id` NULLABLE | 0.5日 |
| 既存クエリ監査・修正 | content_annotations 関連の WP 連携クエリで `wp_post_id IS NOT NULL` フィルタを追加（Section 16.6 チェックリスト） | 0.5日 |
| AI出力パーサー | JSON ブロック抽出 + バリデーション + Markdown 部分返却 | 0.5日 |
| googleAdsAiAnalysisService 拡張 | maxTokens 増 + DB 先保存 → メール送信の順序入れ替え + ローリング N=3 削除 | 0.5日 |
| Server Actions 3種 | `getLatestBlogSuggestions`, `getBlogSuggestionsHistory`, `createBlogSessionFromSuggestion`（Step 5/6 実行 + content_annotations + chat_messages 連携を統合） | 2日 |
| ダッシュボード TOP5 カードUI | カード表示・空状態・モーダル開閉・[履歴を見る]リンク | 1日 |
| プレビュー/編集モーダル | フォーカス時拡張型の7フィールドフォーム + 連打防止 + ローディング UI（ステップ進捗 + beforeunload 警告） | 1日 |
| 履歴モーダル | 過去 N-1 回分の TOP5 をグルーピング表示 + 編集モーダル切替（モーダル on モーダル回避） | 0.5日 |
| ChatLayout 改修 | 引き継ぎバナー（常時表示+ローカル閉じ）のみ。Step 4→5 トリガー不要、AnnotationPanel/StepActionBar は既存流用 | 0.5日 |
| E2E テスト・確認 | TOP5 表示→クリック→編集→Step 5/6 自動→Step 7（**見出し初期化**: `basic_structure` から h2/h3/h4 抽出成功）、失敗時の Step 5/6 起動、AnnotationPanel 編集、履歴ローリング | 1.5日 |
| **合計** | | **約 8.5日（約2週間）** |

> **工数の変化**: Option A 採用により ChatLayout 改修が 2日 → 0.5日 に圧縮（Step 4 トリガーロジック・race condition 対策・ローディングUI が不要）。代わりに Server Actions が 1.5日 → 2日（Step 5/6 統合実装で複雑度増）、モーダルが 0.5日 → 1日（ローディング UI 仕様追加）に増加。差し引き 0.5日減少。

### 16.12 UI/UX 設計判断の根拠

本フェーズの UI/UX は複数の選択肢から比較・検討して決定している。各決定の **なぜ望ましいか** を記録する。将来の改修判断時に「なぜこの設計を選んだか」を辿れるようにするため。

#### 1. Option A 採用（編集はモーダル集約、Step 5〜6 はモーダル内自動実行、チャットは Step 7 から起動）

**狙い**: AI 出力の誤りをユーザーが検出・修正する機会を担保しつつ、現行コードベース（チャットフローと AnnotationPanel）と素直に整合させ、フェーズ2 の実装複雑度を最小化する。

- **不採用案: 完全自動（クリック1発で Step 7 まで、編集機会なし）**
  → 速いが、AI 出力の誤り（KW の誤読、ペルソナの的外れ等）を発見できず、ユーザーが誤った前提のまま本文執筆を始めてしまう。Step 7 で気づいた場合の戻り工数が大きい。
- **不採用案: ハイブリッド（旧設計）— チャット Step 1〜4 で確認・修正、Step 4 [次へ] で Step 5/6 自動実行**
  → 現行チャットフローは「メッセージ送信で AI と対話する」設計で、Step 番号は対話の進行段階を示すラベルに近い。`AnnotationPanel` は独立した編集 UI として存在し、チャット送信から `content_annotations` への自動同期は無い。この前提のまま「Step 1〜4 で確認」を強制すると、ユーザーは「何をどう編集すれば良いのか」が不明確で、内部実装も「Step 4 トリガー」「race condition 対策」「`prep` vs `goal` の保存タイミング齟齬」などの新規バグ要因を多数抱える。
- **不採用案: 完全手動（メール内容をコピペで全部入力）**
  → フェーズ1メールとフェーズ2の連携意義が消失する。
- **採用理由**: 編集 UI を「ダッシュボード上のモーダル」1箇所に集約することで、編集機会の存在を明確にしユーザー操作の混乱を回避できる。Step 5/6 は前ステップの確定値（編集済み prep / basic_structure）に対する機械的な後工程なのでモーダル内で自動実行して問題ない。チャットは Step 7 から起動するが、`StepActionBar` のバックで Step 1〜6 にも自由移動でき、`AnnotationPanel` でフィールド再編集も可能 — 既存の機能をそのまま「再生成・再編集の入口」として活用できる。

**受け入れたトレードオフ**:
- モーダル内で 30〜80 秒の待機が発生する（Step 5/6 の AI 実行）。これは「セッション準備中」と明示し、ステップ進捗を視覚化することで体感を緩和する。
- モーダルが「フェーズ2 のゲートウェイ」になるため、編集 UX とローディング UX の品質要求が上がる（Section 16.7 で仕様化）。

#### 2. カード → プレビュー/編集モーダル → セッション作成

**狙い**: セッション作成（≒ DB 書き込み + チャットセッション生成 + 課金リソース消費）を「ユーザーが内容を確認してからの確定操作」にすることで、誤クリックや AI 出力ゆらぎによる無駄なセッションを防ぐ。

- **不採用案: カードクリックで即セッション作成 + content_annotations 登録 → チャット画面で編集**
  → 編集の機会自体はチャット Step 1〜4 にあるが、登録「後」の編集はセッション/履歴に痕跡が残る。「やっぱりこの提案やめた」とユーザーが思っても、ゴミセッションが履歴に積もる。
- **不採用案: カード上でインライン編集**
  → カード一覧が縦に長くなり、複数候補を比較しづらくなる。モバイルで特に厳しい。
- **採用理由**: モーダルで編集 → 確定 → セッション作成 という流れにより、(a) 編集を「決定前のドラフト」として扱える、(b) キャンセル時にゴミデータ・ゴミセッションが残らない、(c) 編集中でも背景のカード一覧と並べて比較しやすい。

**受け入れたトレードオフ**: クリックから記事作成開始まで1ステップ増える。代わりにユーザーの「やり直し心理コスト」が下がる。

#### 3. TOP5 をカード形式（リスト・テーブル不採用）

**狙い**: 5件の候補を視覚的に比較し、優先度を直感的に伝える。

- **不採用案: リスト表示** → 縦に並ぶだけで「比較」感が弱い。優先度の差が伝わりにくい。
- **不採用案: テーブル表示** → 情報密度は高いが、各候補の「個別の物語性」（KW + ペルソナ + ゴールが一体となった提案）を分断してしまう。
- **採用理由**: カードは1候補を1単位として視覚的にまとめられ、PC では横3〜5列のグリッド、モバイルでは1列縦並びと自然にレスポンシブ対応できる。各候補の rank バッジ（#1〜#5）で優先度を視覚化できる。

**受け入れたトレードオフ**: 縦スペースを多く使う。横幅の狭いブラウザでは情報量が制約される。

#### 4. ダッシュボードは最新のみ + 「履歴を見る」モーダル

**狙い**: 「今スケジュールしたい記事」への集中を阻害せず、過去資産へのアクセスも担保する。

- **不採用案: タブで全実行履歴を切り替え** → タブが時とともに増え（5回実行で5タブ）、UI が乱雑化する。
- **不採用案: 全履歴をフラットに縦並び** → ダッシュボードが縦に長くなり、最新と過去の区別が弱い。スクロールも長くなる。
- **採用理由**: ダッシュボードの第一視認エリアは「今すぐ動かしたい候補」（最新の TOP5）に専有させる。過去資産は「**必要になったときに探す**」性質のためモーダルで隠してよい。

**受け入れたトレードオフ**: 過去候補へのアクセスがワンクリック分遠くなる。ただし「過去の提案を再考する」頻度は「今週の提案を確認する」頻度より明らかに低いため許容範囲。

#### 5. ローリング N=3 回分の保持

**狙い**: 「先週見た候補をまだ書きたい」というユースケースを救いつつ、UI 過密と DB 肥大化を防ぐ。

- **不採用案: 最新 1 件のみ（上書き）** → 月曜分析→翌週執筆を予定したのに水曜再分析で消失するケースを救えない。
- **不採用案: 無制限保持** → 数ヶ月後にはカードが数十枚並び、履歴モーダルが事実上探索不能になる。
- **採用理由**: N=3 は「週1ペース実行で約1ヶ月分」「月数回実行で1〜2ヶ月分」をカバーでき、ユーザーが過去を振り返る現実的な範囲を満たす。15 カード以内なら履歴モーダル内のスクロールも許容できる。

**受け入れたトレードオフ**: 古い候補は強制削除される（ユーザーは保存できない）。本当に残したいなら「記事作成へ」を押してチャットセッションを作成しておく（セッションは永続）という運用回避策あり。

#### 6. プレビュー/編集モーダルの「フォーカス時拡張型」フォーム

**狙い**: 7フィールドの編集 UI が縦に長くなりすぎないようにしつつ、編集時には十分なスペースを確保する。

- **不採用案: 全フィールドを最初から大きいテキストエリアで表示** → モーダルが縦に長くなりすぎ、スクロールが必須になる。「全体を見渡す」体験が崩れる。
- **不採用案: タブ/アコーディオンで段階的に表示** → 編集する順序を強制してしまい、ユーザーが「気になるフィールドだけ素早く編集」できなくなる。
- **採用理由**: 初期表示は各フィールド 3〜4 行に制限してモーダル全体を一画面に収め、フォーカス時に拡張することで「全体俯瞰」と「詳細編集」を両立。**重要度順**（main_kw → kw → persona → goal → 区切り → 補助フィールド）に並べることで、ユーザーが上から確認していく自然な流れを作る。

**受け入れたトレードオフ**: フォーカス時の拡張アニメーションがレイアウト揺れを起こす可能性。実装時に CSS transition でスムーズ化する。

#### 7. 履歴モーダル → カードクリック時は履歴モーダルを閉じる（モーダル on モーダル禁止）

**狙い**: モーダルの重なりによる視認性・操作性の劣化を防ぐ。

- **不採用案: 履歴モーダルの上にプレビュー/編集モーダルを重ねる** → 背景が二重に暗くなり、どちらのモーダルが「今操作対象」か視覚的に曖昧。閉じる [✕] を間違えるリスク。z-index 管理が複雑化。
- **採用理由**: モーダルは常に1階層に保つことで、ユーザーが「今どこにいるか」を明確に認識できる。編集をキャンセルした場合は履歴モーダルを再表示せず、ダッシュボードに戻る（履歴は探索操作の起点、編集は確定操作という性質の違いに合わせる）。

**受け入れたトレードオフ**: 履歴から続けて別候補を編集したい場合、再度「履歴を見る」を押し直す必要がある。ただしこの操作は稀（通常は1候補を選び切る）と見込む。

#### 8. ChatLayout の引き継ぎバナーを常時表示（自動消去しない）

**狙い**: ユーザーが Step 行き来する際に、「この記事は Google Ads 起点である」という文脈ヒントを常に保つ。

- **不採用案: Step 1 のみ表示、Step 2 以降は消す** → Step 7 で本文を書いているときに「これ何の記事のために書いてたっけ」となるリスク。
- **不採用案: タイマーで5秒後に消す** → トースト的な扱いだが、文脈ヒントとしての継続価値を失う。
- **採用理由**: バナーは情報密度が低く視界の妨げにならない（KW とペルソナ抜粋のみ）。ユーザーが意図的に [✕] で閉じた場合のみ localStorage で同セッション内非表示にする → ユーザーの主体性を尊重しつつ、初期状態では文脈ヒントを提供。

**受け入れたトレードオフ**: 常時表示分のスペースを縦に消費（モバイルで顕著）。最小限の高さ（1〜2行）に抑える設計で対処。

### 16.13 前提・注意点

#### 必須前提
- フェーズ1（AI分析メール送信）の完成後に着手する。
- Phase 1 プロンプトの末尾に **JSON ブロック追加が必須**（admin/prompts で本番DBを更新）。
- Phase 1 の `MODEL_CONFIGS.google_ads_ai_evaluation.maxTokens` を **8000 → 12000** に増やすコード変更が必須（JSON ブロック追加でトークン消費増のため。Section 16.10 参照）。
- メール本文には JSON ブロックを含めない（サービス側でパース後に除去）。
- DB 保存はメール送信より **先** に実行（順序の理由は Section 16.10 参照）。
- content_annotations の wp_post_id NULLABLE 化に伴う **既存クエリ監査が必須**（Section 16.6 のチェックリスト参照）。
- `blog_creation_step5` / `blog_creation_step6` は既存テンプレート（本番DBに登録済み）をそのまま利用。
- Step 5・6 の自動実行は **chat_messages に user/assistant メッセージ対として記録**する（Section 16.8 参照）。

#### 運用方針
- ステップ間で部分失敗した場合は、最後に保存できたステップでチャット表示（部分的な引き継ぎ）。
- メール送信側にはリンクを追加しない（操作はアプリ内に集約）。
#### maxDuration 超過時のフォールバック

`createBlogSessionFromSuggestion`（Section 16.9）の合計実行時間（Opus × 2回 = 推定 30〜80 秒）が **`maxDuration: 120` を超えるケースが頻発する場合**、以下のフォールバックを検討する:

- **案1: Step 5 のみモーダル内同期実行、Step 6 はチャット到着後にクライアントから別 Server Action 追動**
  - モーダルは Step 5 完了で sessionId 返却（約 15〜40 秒で済む）
  - クライアントは `/chat?session=X&initialStep=step6` で起動し、ChatLayout マウント時に `runBlogStep6Only(sessionId)` を呼び出し
  - Step 6 完了後に Step 7 へ自動遷移
  - **メリット**: 各 Server Action が 60 秒以内で済み Vercel 制限に余裕、UX 上もモーダル待機時間が短縮
  - **デメリット**: ChatLayout に追動ロジックが追加され Option A の旨味が減る
- **案2: API Route 化 + クライアントポーリング**
  - 旧設計案。複雑度高いが、長時間処理に最も柔軟。

実装時にスパイク計測した結果で判断。MVP 着手時は `maxDuration=120` で十分の見込み（Opus 4.7 / maxTokens 6000+5000 → 想定 30〜60 秒）。

#### 実装前スパイク（強く推奨）

本フェーズ着手前に **1〜2 日のスパイク** を行うことを推奨する:
1. 本番プロンプト末尾に JSON ブロックを追加した状態で **1 回実出力** を実施し、JSON フォーマット遵守度と総トークン数を計測。`maxTokens=12000` で足りるかを判定。
2. `createBlogSessionFromSuggestion` のモック実装（chat_session 作成 + content_annotations UPSERT + Step 5/6 の llmChat ×2回）の **実行時間を計測** し、`maxDuration=120` で収まるかを判定。
3. 計測結果に応じて Section 16.10（maxTokens）と本セクションのフォールバック方針を確定する。

#### 本フェーズで対応しない事項（別チケット/将来検討）
- **代理店スタッフによる代理操作 UX**: `get_accessible_user_ids` で複数オーナーアクセスは可能だが、「どのオーナーの content_annotations / セッションを作るか」の選択 UI は本フェーズで未定義。フェーズ1 の運用方針と合わせて別途検討。
- **モバイル レスポンシブ詳細**: モーダル類はモバイルでも操作可能な前提だが、詳細なブレークポイント設計は実装フェーズで現物確認の上調整。
- **JSON パース失敗時のユーザー通知**: ログのみで本フェーズではユーザーへの通知 UI は持たない。監視で検知して運用者が手動対応する想定。

## 17. 既存コンテンツとの競合・順位を踏まえた「新規作成 vs 既存修正」判定

> ### 開発ステータス（メモ）
>
> | 項目 | 状態 |
> |------|------|
> | **仕様の確定度** | 基本設計（2026-05-31）。確定版ではない |
> | **開発着手** | **実装中**。Increment 1（データ層＋LLMコンテキスト注入）完了（2026-05-31）。Increment 2（メール機械生成順位表）未着手 |
> | **依存** | フェーズ1（Section 1〜15）完成済みを前提。GSC連携・WordPress取込が利用可能なユーザーが対象 |
>
> **Increment 1 実装済み（2026-05-31）**: `SupabaseService.getContentInventoryByUserId` / `getRankingSnapshotByUserId`（GSC は `property_uri` + `search_type='web'` で絞り込み）、`googleAdsAiAnalysisService` への結線（非致命）・フォーマッタ2種・プロンプト変数 `existingContent`/`rankingData`・DEVサンプル、`prompt-descriptions` 変数説明。**未実施**: メール機械生成順位表（§17.4・要 TOP5 紐付け方式決定）、admin/prompts 本文更新、maxTokens 実測。

### 17.1 目的

フェーズ1の TOP5 コンテンツ提案は「このKWで記事を作る」一辺倒で、**既存コンテンツとの競合（カニバリゼーション）や検索順位を考慮していない**。本機能は TOP5 各提案に対して以下を判定・提示する。

- **既存コンテンツとカニバらない** → **新規作成**を推奨
- **既存コンテンツを修正すれば上昇見込みがある** → **既存修正**（対象記事を明示）を推奨

### 17.2 方針

| 論点 | 決定 |
|------|------|
| データソース | **WordPress（既存コンテンツ在庫）+ GSC（自社順位）を核**。本機能の核（カニバリ→新規/修正）はこの2つで成立する |
| 新規/修正の判断主体 | **AI判定**（データを渡して提案させる。固定閾値の機械判定はしない＝既存設計と一貫） |
| GSC で取れない範囲 | **(A) 自社未ランクKWの現状順位（数値）**、**(B) 競合の並び・難易度**。これらを判断材料に加えたくなった場合に限り SerpApi を導入 |
| SerpApi 導入 | **後続フェーズ・任意**（本機能の核には不要。料金: 例 $150/月〜$275/月。Semrush 等より安価） |

#### データソースの考え方（重要な前提・2026-05-20 定例MTGの議論を反映）

- **既存コンテンツの在庫** = WordPress（`content_annotations` に取込済み。タイトル/URL/本文/カテゴリ）。ここは確定。
- **自社の順位／カニバリ判定** = **GSC（`gsc_query_metrics`）**。GrowMate は既に GSC 連携を持ち **クエリ×ページ単位の順位(position)・表示回数・クリック・CTR を保存**している。GSC は「**自社が既に表示・ランクしているKW**」の順位・（URL突合で）タイトル・記事URLを提供でき、**本機能の核（カニバリ有無 → 新規/修正）はこれで成立する**。
  - **GSC の注意点**: 返すのは**自社が表示された（インプレッションのある）クエリの平均掲載順位**で、GSC インポート設定済み・データ蓄積済みのユーザーに限られる。会議例（平飼い卵通販=8位 等）のように**自社が既にランクしているKWは GSC が保持**しており問題なく出せる。
- **GSC で構造的に取れない範囲（＝SerpApi の出番）**:
  - **(A) 自社がまだランクしていないKWの現状順位**: GSC は該当行を持たない（順位を数値で出せない）。ただし「GSC行なし＝新規候補」で判定は成立し、WP在庫の突合でも記事有無は分かるため、**判定には必須でない**。「未ランクKWの現状順位を数値で見せたい」場合にのみ必要。
  - **(B) 競合の並び・難易度**: GSC は**自社データのみ**で、上位に誰がいるか・勝てるKWかは一切取れない。**競合分析をするなら外部SERPデータ源（SerpApi 等）が必須**。SerpApi の `organic_results[]` で上位ドメイン・タイトル・順位・広告まで取得できる（SERPレベルの競合可視化）。なお競合の流入数・被リンク・保有KW全体といった深い競合インテリジェンスは SerpApi では不足し、Semrush/Ahrefs 級が必要。
- **結論**: SerpApi は本機能の核には不要。**(A) の数値表示 or (B) の競合分析を求めた時に限り、後続フェーズで導入**する。地域絞り込み（例: 岡山）等のローカル順位取得もこの段階で対応可能。

### 17.3 判定ロジック（AI に委ねる）

TOP5 各候補（`main_kw` + サブKW）について、AI に「既存コンテンツ一覧」と「GSC順位スナップショット」を渡し、`新規 / 修正` を提案させる。

**カニバリ判定のトリガーは「ランクインの有無」ではなく「当該KWをカバーする自社記事が存在するか」に置く**。検出は次の **OR** とする:
- WordPress 在庫のトピック一致（タイトル / KW / 本文が当該KWをカバー）、または
- GSC で既存ページが当該KW（または近縁クエリ）にランクイン。

| 既存記事の状態 | 推奨 |
|---|---|
| カバーする記事があり、ランクインしている | **修正**。position が中位帯（概ね 4〜30 位）= 上昇余地が大きい記事を優先。上位安定（1〜3位）なら「現状維持」寄りのコメント |
| カバーする記事はあるが、未ランク／低品質 | **修正**（新規はカニバリ。既存記事を改善して順位を取りに行く） |
| カバーする記事が無い | **新規作成**（カニバリなし） |

- 表記ゆれ・近縁判定は AI の言語理解に委ねる（固定閾値の機械マッチはしない）。

AI 出力には各候補に対し以下を含める: `判定（新規/修正）`、`判定理由`、`期待される上昇見込み`。**順位・タイトル・URL はコードが GSC + `content_annotation_id` 突合で機械生成して付記する**ため、AI には書かせない（捏造防止。§17.4 参照）。

### 17.4 実装スコープ

#### MVP（フェーズ1拡張）= メール本文に判定を反映

最小実装は「フェーズ1の分析プロンプトに既存コンテンツ＋順位コンテキストを足し、メールの提案に新規/修正の判定を載せる」。フェーズ2（カードUI/DB保存）が未実装でも単体で価値が出る。

##### メール書式（MVPで足すのは「②現状成績＋判断」のみ）

2026-05-20 定例MTGで繁田さんが「提案メールに入れたい」とした2点を、スコープに振り分ける。

| メール要素 | 帰属 | MVPで出すか |
|---|---|---|
| ① 「本テーマでコンテンツを作成する」リンク（[URL]） | **フェーズ2**（飛び先＝カード→チャット作成フロー＝Section 16。会議で『ステイ』） | ❌ 出さない |
| ② 各KW（メイン/サブ）の現状成績（**検索順位・タイトル・記事URL**）＋ 新規/修正の判断 | **MVP（Section 17）** | ✅ 出す |

→ **①リンクはフェーズ2でチャット作成フロー復活時に後付け**。MVPメールには含めない。

MVPメールの各提案ブロックの表示イメージ（GSC順位が取れたKWのみ順位/タイトル/URLを出す。取れない場合は「順位データなし」と表示し、**新規候補とは断定しない**＝GSC未連携・取得失敗・圏外でも既存記事は存在し得るため。新規/修正の判定は AI が `existingContent` も踏まえて別途行う）:

```
▼ メインKW ▼ 平飼い卵 通販
  検索順位：8位
  タイトル：【公式】あおぞら養鶏場｜純国産平飼い自然卵の通販
  https://aozora-farm.jp/

▼ サブKW ▼
  ・平飼い卵 おすすめ … 33位 / 平飼い卵と普通の卵の違い… / https://aozora-farm.jp/cage-free-regular
  ・卵 平飼い 通販   … 14位 / 【公式】あおぞら養鶏場…       / https://aozora-farm.jp/

→ （AIの判断）複数KWで上位〜中位に既存記事があるため、新規作成より該当記事の修正を推奨。
   8位止まりの要因はサブKW群の網羅不足の可能性。
```

> **【重要】順位・タイトル・URLはコード側で機械生成する（LLMに書かせない）**
> 検索順位・タイトル・記事URLは**事実**であり、プロンプトに渡して文章生成させると**捏造（ハルシネーション）**が起きる。よってこの「②現状成績ブロック」は **GSC（`gsc_query_metrics`）+ `content_annotations`（タイトル突合）からコードで決定的に組み立てる**。AI は **「新規 / 修正の判断文と理由」だけ**を担当する二段構えとする。
> - プロンプトに渡す `rankingData`（17.4-2）は「AIが判断するための材料」であり、メール表示用の順位表とは別物。
> - キーワード↔GSCクエリは完全一致／正規化一致したものだけ順位を出す。一致しないKWは「順位データなし」と表示する（**新規候補とは断定しない**。新規/修正の判定は AI が `existingContent` も踏まえて行う）。
> - URL/タイトルは `gsc_query_metrics.content_annotation_id`（FK）で `content_annotations` に突合して取得（URL文字列マッチではない）。表示URLは `canonical_url` 優先・無ければ `normalized_url`、タイトルは `wp_post_title`。`content_annotation_id` が NULL（WP未取込ページ）は URL のみ表示にフォールバック。

1. **新規データ取得メソッド（`SupabaseService`）**
   - `getContentInventoryByUserId(userId)` — `content_annotations` から `wp_post_title` / `canonical_url` / `main_kw` / `kw` / `wp_category_names` / `wp_content_text`（先頭抜粋）を取得。`wp_post_id IS NOT NULL`（＝WP由来の実在記事）に限定。トークン肥大を防ぐため上位 N 件（例: 直近更新 50 件程度）に制限。
   - `getRankingSnapshotByUserId(userId)` — `gsc_query_metrics` から最新日付の `query_normalized` / `normalized_url` / `position` / `impressions` / `clicks` / `content_annotation_id` を取得。position 昇順・impressions 降順で上位 N 件（例: 100 件）に制限。
     - **URL/タイトルの突合は `content_annotation_id`（FK）経由**で行う（`gsc_query_metrics.content_annotation_id → content_annotations.id`。GSCインポート時に紐付け済み。URL文字列マッチより堅牢）。表示URL = `content_annotations.canonical_url`（あれば）優先、無ければ `normalized_url`。タイトル = `content_annotations.wp_post_title`。`content_annotation_id` が NULL の行（WP未取込ページ）は **URL のみ・タイトル空**でフォールバック。
   - 参考実装: `gscEvaluationService.ts:398-422`（`gsc_query_metrics` の position/date 読取の実例）。`supabaseService.ts:1960-2010` は削除/件数系メソッドだが、`gsc_query_metrics` へのクエリ組み立て例として参照可。

2. **`googleAdsAiAnalysisService.ts` の拡張**
   - `analyzeAndSend` 内の `Promise.all`（`:167-195`）に上記2メソッドを追加。
   - フォーマッタ追加: `formatContentInventory(...)` / `formatRankingSnapshot(...)`（既存 `formatKeywordMetrics` 等と同じ TSV 風スタイル。`:418-502`）。
   - `buildAnalysisPrompt`（`:21-26`, `:245-254`）の variables に `existingContent` / `rankingData` を追加。
   - DEV サンプルにも既存コンテンツ・順位サンプルを追加しローカル確認可能にする。
   - 取得失敗は**非致命**（`searchTermData` と同じ扱い。`:218-223`）。空文字を渡し分析は続行。

3. **プロンプトテンプレート更新（admin/prompts で実施・コード変更なし）**
   - データセクション: `## 既存コンテンツ一覧\n{{existingContent}}` と `## 検索順位（GSC）\n{{rankingData}}` を追加。
   - 分析指示: 「TOP5 各提案について、既存コンテンツとのカニバリ有無と GSC 順位を踏まえ **新規作成 / 既存修正** を判定し、判定理由と上昇見込みを述べる（**順位・URL・タイトルは本文に書かない**＝コードが付記）」セクションを追加。
   - `src/lib/prompt-descriptions.ts` の `VARIABLE_TYPE_DESCRIPTIONS` に `existingContent` / `rankingData` の説明を追加。

4. **maxTokens 確認**
   - 既存コンテンツ・順位データ追加で入力トークンが増える。`MODEL_CONFIGS.google_ads_ai_evaluation.maxTokens: 8000`（`src/lib/constants.ts`）で出力が切り詰められないか実出力で確認し、必要なら増やす（フェーズ2 でも 12000 への増加が予定＝Section 16.10）。

##### プロンプト追記テンプレート（admin/prompts で `google_ads_ai_evaluation` に貼り付け）

Increment 2（メール順位表のコード機械生成）を有効化するには、本番DB `prompt_templates.google_ads_ai_evaluation` に以下3ブロックを追記する。**コード側（`extractTopProposals` / `buildRankingBlocks`）は実装済みで、このテンプレ追記が入って初めて順位表が出る**（未追記時は JSON が出力されず順位表なしで通常送信＝degrade only）。

**① データセクション**（既存の `{{keywordData}}` 等が並ぶデータ提示部に追記）

```markdown
## 既存コンテンツ一覧（自社のWordPress記事）
{{existingContent}}

## 検索順位（GSC・自社の現状順位）
{{rankingData}}
```

**② 分析指示**（評価・提案の指示セクションに追記）

```markdown
### 新規作成 vs 既存修正の判定
TOP5 の各提案について、「既存コンテンツ一覧」と「検索順位（GSC）」を踏まえ、次を判定すること。
- 当該KWをカバーする自社記事が**ある**（タイトル/KW/本文で一致、またはGSCでランクイン）→ **既存修正**を推奨する。順位が中位帯（概ね4〜30位）なら上昇余地大として優先、上位安定（1〜3位）なら現状維持寄り。
- カバーする記事が**ない** → **新規作成**を推奨（カニバリなし）。
- 既存コンテンツ一覧に、当該KWの検索意図を実際にカバーする記事が見当たらない場合は **新規作成** と判定すること。トピックの異なる無関係な記事（例: 別事業・別ジャンルの記事）を「既存修正の対象」と見なしてはならない。
- 各提案に「判定（新規/修正）」「判定理由」「期待される上昇見込み」を記載する。
- **検索順位・記事URL・タイトルの数値や文字列は本文に書かないこと**（システムが正確な値を別途付記する）。あなたは判断と理由のみを述べる。
```

最後の一文が捏造防止の肝。順位/URL/タイトルはコードが GSC + `content_annotation_id` 突合で機械生成して付記するため、AI には書かせない。

**③ 構造化データ出力**（テンプレの**最末尾**に追記）

````markdown
---

## 【構造化データ出力】
回答の最後に、上記 TOP5 の各提案を以下のJSONブロックで出力すること。これはシステムが検索順位表を生成するために使用する（メール本文には表示されない）。

```json
[
  {
    "rank": 1,
    "main_kw": "（その提案のメインKW）",
    "kw": "（その提案のサブKW群を読点「、」または改行で区切って列挙）"
  }
]
```

rank 1〜5 まで同形式で出力する。`main_kw` は必須、`kw` は無ければ空文字でよい。
````

**パーサ仕様との対応**（テンプレ文言はこれに準拠）:

| 項目 | 仕様 |
|---|---|
| ブロック形式 | ` ```json … ``` `（フェンス必須・**最初の1つ**を抽出） |
| 構造 | オブジェクト配列 |
| 読むキー | `rank`(数値) / `main_kw`(文字列・必須) / `kw`(文字列) |
| `kw` の分割 | 改行・`,`・`、` で分割し各サブKWを順位突合 |
| 突合方法 | `normalizeQuery`（NFKC＋小文字化＋空白圧縮）で GSC `query_normalized` と一致 |
| 失敗時 | JSONが無い/壊れている→順位表なしで通常送信（degrade only） |

**反映後の確認手順**: ①②③を保存 → DEV（`NODE_ENV=development`）で実行しメール末尾に「## 現状成績」順位表が出るか・本文にJSONが残っていないか確認 → 入力トークンを実測し出力が切れるなら `maxTokens` を 8000→12000。

#### フェーズ2 連携（将来・設計に織り込む）

`google_ads_blog_suggestions` テーブル + TOP5 カードUI 実装時に判定結果を構造化データに含める。

- Section 16.3 の末尾 JSON ブロックの各要素に **`action: 'new' | 'modify'`**、**`target_url`**、**`target_post_id`**、**`recommend_reason`** を追加。
- カードに「🆕 新規」「✏️ 修正」バッジと、修正時は対象記事リンクを表示。
- 「✏️ 修正」カードからの導線は、新規セッション作成ではなく**既存記事の `content_annotations`（該当 `wp_post_id`）を起点にした改善フロー**（既存 `gscSuggestionService` のリライト提案系と接続できる余地あり）。MVP では判定提示までで、修正フローの実装は別チケット。

#### SerpApi（後続フェーズ・今回は実装しない / 順位取得の本命候補）

まず MVP で GSC による順位取得可否を検証し、不足する場合に SerpApi を**主要な順位源**として導入する。今回は置き場所と用途の整理のみ。

- `src/env.ts` に `SERP_API_KEY: z.string().min(1).optional()` を追加（`serverEnvSchema` / `serverRuntimeEnv` / `serverOnlyKeys` の3箇所。GSC・WPと同じパターン）。
- 用途（GSC より広い）:
  - **実際のライブ検索順位**: `engine=google` で `organic_results[]` を取得し、対象KWでの自社ページの**現時点の実順位**を取得（GSC の平均掲載順位や手動シークレット検索の代替）。
  - **競合リサーチ**: 上位ドメインの並びを取得し、参入難易度・競合文脈を AI に補足。
  - **広告（リスティング）の可視化**: 検索結果上の広告も取得可能。
  - **地域絞り込み**: `location` 指定でローカル検索（例: 岡山）の順位を取得。
- コスト管理のため対象KWを絞り、結果をキャッシュ（独自テーブル）する設計を別途検討。料金感: $150/月（中位）〜 $275/月（Big Data）。

### 17.5 影響ファイル一覧

| ファイル | 変更 |
|---------|------|
| `src/server/services/supabaseService.ts` | `getContentInventoryByUserId` / `getRankingSnapshotByUserId` 新設 |
| `src/server/services/googleAdsAiAnalysisService.ts` | 取得追加・フォーマッタ追加・プロンプト変数追加・DEVサンプル追加 |
| `src/lib/prompt-descriptions.ts` | `existingContent` / `rankingData` の変数説明追加 |
| `src/lib/constants.ts` | （必要時）`google_ads_ai_evaluation.maxTokens` 調整 |
| admin/prompts（本番DB `prompt_templates`） | プロンプト本文に既存コンテンツ・順位セクション + 判定指示を追記（コード変更なし） |

> **MVP は UI（画面）変更なし**。変更はサーバー（`SupabaseService` / `googleAdsAiAnalysisService`）・定数・プロンプト本文・**メール出力**のみ。ダッシュボード（`dashboard-content.tsx`）は既存の「AI分析を実行してメール送信」ボタンをそのまま使い、**届くメールの中身だけが変わる**。TOP5カード・編集/履歴モーダル・チャット引き継ぎバナー等の画面はすべてフェーズ2（Section 16・『ステイ』中）。
>
> 任意（今回スコープ外）: GSC 未連携／WP 未取込時は順位が出ないため、ダッシュボードに連携を促す案内表示を足す案もあるが、UI 追加になるため MVP には含めない（非連携時はメールが degrade するのみ）。

### 17.6 検証観点

- **DEV モード**: `NODE_ENV=development` 分岐（`:110-156`）にサンプル既存コンテンツ＋順位を流し、AI 出力に「新規/修正の判定 + 理由 + 上昇見込み」が含まれ、**コード生成の順位表（順位/タイトル/URL）がメール末尾に付記され、本文に JSON が残らない**ことを確認。
- **本番経路**: GSC・WP 連携済みテストユーザーで、(a) 既存ランク記事があるKWで「修正」、(b) 未ランクKWで「新規」が出ることを確認。
- **非致命性**: GSC/WP 未連携ユーザーでも分析が落ちず（空コンテキストで）従来通りメール送信されることを確認。
- **トークン**: 在庫・順位が多いユーザーで切り詰めが起きないか実出力サイズを計測。

### 17.7 実装工数見積もり

#### MVP（フェーズ1拡張・本機能の対象範囲）

| コンポーネント | 内容 | 工数 |
|---|---|---|
| データ取得メソッド | `getContentInventoryByUserId` / `getRankingSnapshotByUserId`（クエリ + `content_annotation_id` 突合 + 型 + N件制限 + テスト） | 0.5日 |
| **LLMコンテキスト設計・トークン最適化** | `existingContent` / `rankingData` の**データ形式設計**（区切り表＝TSV/CSV風）、フィールド厳選（本文フル投入回避・抜粋制限）、件数上限調整、フォーマッタ2種実装 | 0.5日 |
| **メール順位表のコード生成** | KW↔記事（`content_annotation_id`）突合 → 検索順位/タイトル/URL ブロックを決定的に組み立て、メール Markdown に差し込み（LLMに書かせない部分） | 0.5日 |
| `googleAdsAiAnalysisService` 結線 | `Promise.all` 追加・プロンプト変数注入・順位表差し込み・DEVサンプル追加 | 0.5日 |
| プロンプト更新 | admin/prompts 本文へ既存コンテンツ/順位セクション + 判定指示追記（コード変更なし）+ `prompt-descriptions` 変数説明 | 0.5日 |
| トークン計測・maxTokens 調整 | 在庫/順位を足した実プロンプトのトークン量を計測、入出力が収まるか確認、必要なら 8000→12000 | 0.5日 |
| E2E検証・確認 | DEV/本番経路（修正/新規の出し分け）、GSC・WP未連携時の非致命性、`lint`/`build` | 0.5〜1日 |
| **MVP 合計** | | **約 3.5〜4日** |

> 旧見積もり（約2.5〜3日）から見直し。LLM へ渡すコンテキスト量が増えるため、(1) **データ形式の設計・トークン最適化**、(2) **メール順位表のコード生成**（KW↔記事突合・整形）を独立項目として明示し、合計を約 3.5〜4日に上方修正した。新規UI・新規テーブル・マイグレーションを伴わない点は変わらない。検証はテストデータ（GSC連携 + WP取込済み）の準備に依存する。
>
> **データ形式の指針**: `existingContent` / `rankingData` は同一構造のレコード配列なので**区切り表（TSV/CSV風、既存 `formatKeywordMetrics` と同スタイル）**が最もトークン効率が良い（JSONはキー反復で冗長）。トークン削減の本質は区切り文字より中身の量 → **本文（`wp_content_text`）はフル投入せずタイトル+KW+カテゴリ中心**、順位は判定に使う列のみ・件数上限100、LLM向けには Markdown 表の区切り行（`---｜---`）は省略。

#### 対象外（別フェーズ・工数は本見積もりに含めない）

| 項目 | 内容 | 概算 |
|---|---|---|
| フェーズ2 連携 | suggestions JSON への `action`/`target_url`/`target_post_id`/`recommend_reason` 追加、カードの新規/修正バッジ・対象記事リンク | フェーズ2本体（Section 16.11）に内包 |
| 既存記事の修正フロー実体 | 「✏️ 修正」導線から既存 `content_annotations` 起点の改善フロー（`gscSuggestionService` 接続検討） | 別チケット（未設計） |
| SerpApi 導入 | env 追加・実ライブ順位/競合/広告/地域の取得・キャッシュ設計（GSC 検証で不足が判明した場合の主要順位源） | 後続フェーズ（未見積もり） |

### 17.8 未確定・リスク

- **KW表記ゆれマッチング**: `gsc_query_metrics.query_normalized` と `main_kw` の正規化差。AI 判断に委ねるが、関連性の低い順位行は渡さない（件数制限）。
- **入力トークン肥大**: 在庫・順位が多いユーザーで上限超過リスク → N件制限（在庫50/順位100目安）を初期値とし、スパイクで調整。
- **判定精度**: 「上昇余地帯」の解釈は AI 依存。プロンプトで観点（中位帯優先・上位安定は維持）を明示してブレを抑える。
- **修正フローの実体**: MVP は「修正推奨の提示」まで。既存記事を実際に改善するUIフローは未設計（フェーズ2 / 別チケット）。

## 18. 将来拡張（本設計対象外）

- **評価履歴テーブル** (`google_ads_evaluation_history`): 分析結果・メール送信状態・エラー詳細を DB に保存し、アプリ内で閲覧可能にする
- メール再送機能（履歴テーブルの `email_status = 'failed'` のレコードを手動再送）
- 分析期間のプリセット（7日 / 14日 / 30日 / 90日）
- 複数アカウントの一括分析
- 分析結果の PDF エクスポート
- プロンプトテンプレートのバージョン管理・A/B テスト
