# GrowMate - AIマーケティング支援プラットフォーム

メール OTP を入り口に、業界特化のマーケティングコンテンツを一括生成・管理する SaaS アプリケーションです。Next.js（App Router）を基盤に、マルチベンダー AI、WordPress 連携、Supabase による堅牢なデータ管理を統合しています。フレームワークのバージョンは [`package.json`](package.json) を参照してください。

> **認証移行について**: 旧 LINE LIFF ログインは Phase 1.5 で廃止し、現在はメール OTP のみをユーザー向け入口として提供しています。既存 LINE ユーザーの Email 付与手順は [docs/runbooks/email-migration-runbook.md](docs/runbooks/email-migration-runbook.md) を参照してください。LIFF / LINE OAuth 関連のコード（`@line/liff`, `src/components/LiffProvider.tsx`, `/api/line/callback`, `/api/refresh`, `/api/auth/line-oauth-init`）はレガシー互換のため一時的に残存しており、本ドキュメントでは **(legacy)** と表記します。

## 🧭 プロダクト概要

- メール OTP でログインしたユーザー向けに、広告／LP／ブログ制作を支援する AI ワークスペースを提供
- Anthropic Claude と OpenAI のモデル（Fine-tuned 含む）を [`src/lib/constants.ts`](src/lib/constants.ts) の `MODEL_CONFIGS` で用途に応じて切り替え
- WordPress.com / 自社ホスティングを問わない投稿取得と、Supabase へのコンテンツ注釈保存
- 管理者向けのプロンプトテンプレート編集・ユーザー権限管理 UI を内蔵

## 🚀 主な機能

### 認証とユーザー管理
- **メール OTP 認証（現行）**: Supabase Auth の 6 桁 OTP によるメールログイン。新規ユーザー初回ログイン時はフルネーム登録ダイアログを表示
- **LINE LIFF 認証 (legacy)**: `@line/liff` ・`src/components/LiffProvider.tsx` ・`/api/line/callback` ・`/api/refresh` ・`/api/auth/line-oauth-init` は Phase 1.5 移行互換のため残置。ログイン画面・ホーム画面からの LINE ログイン UI 導線は削除済み
- サーバーサイドの `authMiddleware` はメールセッションを主系として解決し、LINE Bearer/Cookie も暫定互換で受理（移行完了後に削除予定）
- Supabase `users` テーブルにプロフィール・ロール・最終ログインを保存（`supabase_auth_id` で Auth と紐付け）
- 既存 LINE ユーザーへの Email 付与は [docs/runbooks/email-migration-runbook.md](docs/runbooks/email-migration-runbook.md) の SQL ランブックで運用者が手動実施

### スタッフ管理 (legacy)
- オーナー/スタッフ UI 導線は [app/page.tsx](app/page.tsx) から削除済み（カード非表示）
- バックエンドの `/api/employee`（`GET` / `DELETE`）・`users.owner_user_id` / `owner_previous_role` カラム・`employee_invitations` テーブルは未削除のレガシー資産として残存
- 招待リンク発行・受け付け機能（`InviteDialog`, `useEmployeeInvitation`）は削除済みで、アプリ側から `employee_invitations` への新規書き込みは行われない

### AI コンテンツ支援ワークスペース
- `app/chat` 配下の ChatLayout で、セッション管理・モデル選択・AI 応答ストリーミングを統合
- 7 ステップのブログ作成フロー（ニーズ整理〜本文作成）と広告／LP テンプレートを提供
- `search_chat_sessions` RPC（PostgreSQL の `websearch_to_tsquery` や ILIKE 等。拡張 `pg_trgm` はマイグレーションで有効化）でオーナー/スタッフ共有アクセスに対応
- ステップ毎のプロンプト変数へ `content_annotations` と `briefs` をマージし、文脈を再利用

### キャンバス編集と選択範囲リライト
- TipTap ベースの `CanvasPanel` に Markdown レンダリング／見出しアウトライン／バージョン履歴を実装
- `POST /api/chat/canvas/stream` で選択範囲と指示を送信し、Claude の Tool Use で全文差し替えを適用

### 見出しフローと原稿バージョン管理
- ブログ 7 ステップの Step5 で生成された見出し構成から `session_heading_sections` を初期化
- **見出し行のフォーマット**: `h3 見出しテキスト` / `h4 小見出しテキスト` のリテラルプレフィックス形式（Markdown `###`/`####` は使用しない）
- `heading_level` は数値 `3` または `4`、`heading_key` は `{orderIndex}:{normalized_text}:{SHA-256先頭8文字}` の複合キー（[`src/lib/heading-extractor.ts`](src/lib/heading-extractor.ts)）
- 各見出しセクションを個別に AI 生成・確定し、`session_combined_contents` に結合コンテンツをバージョン保存
- `save_atomic_combined_content` RPC（`SECURITY DEFINER`）で同時書き込み競合をシリアライズ化
- Step7（書き出し案）入力後に見出し1へ戻るフロー（`preserveStep7Lead` オプション）をサポート

### WordPress 連携とコンテンツ注釈
- WordPress.com OAuth とセルフホスト版 Application Password の両対応（`app/setup/wordpress`）
- `AnnotationPanel` でセッション単位のメモ・キーワード・ペルソナ・PREP 等を保存し、ブログ生成時に再利用

### Google Search Console 連携
- `/setup/gsc` で OAuth 認証・プロパティ選択・連携解除を管理
- 日次指標を `gsc_page_metrics` / `gsc_query_metrics` に保存し、`content_annotations` と normalized_url でマッチング
- 記事ごとの順位評価と改善提案を `gsc_article_evaluations` で管理（タイトル→書き出し→本文→ペルソナの順にエスカレーション、デフォルト30日間隔）

### GA4 連携
- `gsc_credentials` の GA4 設定カラム（`ga4_property_id`, `ga4_conversion_events`, `ga4_threshold_*`）を `/setup/ga4` で設定
- `/api/ga4/sync` で `ga4_page_metrics_daily` に日次ページ指標（セッション数・エンゲージメント・直帰率・CV・スクロール90%）を保存
- `ga4_page_metrics_daily.normalized_path`（生成列）で GSC の `normalized_url` と結合して記事横断分析を実現
- `/ga4-dashboard` でサマリー・ランキング・時系列グラフを表示（`ga4Dashboard.actions.ts` 経由）

### Google Ads 連携
- `/setup/google-ads` で OAuth 認証・MCC 配下アカウント選択を管理（管理者のみ）
- 選択された `customer_id` を `google_ads_credentials` に保存し、以後の API 呼び出しで使用
- キーワードプランナー / キャンペーン指標を `/google-ads-dashboard` で参照

### 権限と利用制御
- `trial` / `paid` / `admin` / `unavailable` / `owner` のロールで機能制御
- `canRunBulkImport`（実装は [`src/authUtils.ts`](src/authUtils.ts)）で WordPress / GSC の一括インポート可否を判定。**閲覧専用オーナー**（`role=owner` かつ `ownerUserId` なし）は常に可。**スタッフ**（`ownerUserId` あり）と **`unavailable`** は不可。それ以外のロールは **オーナー閲覧モード**（`isOwnerViewMode`）中は不可
- **補足**: オーナー/スタッフ機能の UI 導線は廃止済みのため、通常運用では `owner` / staff ロールは発生しない。バックエンド仕様としてのみ残置

### 管理者ダッシュボード
- `/admin/prompts` でテンプレート編集・バージョン保存
- `/admin/users` でロール切り替え後に `POST /api/auth/clear-cache` でキャッシュを即時無効化

### 事業者情報ブリーフ
- `/business-info` で 5W2H などを入力し、`briefs` テーブルに JSON 保存
- プロンプトテンプレートの変数へ流用し、広告文や LP のコンテキストを自動補完

## 🏗️ システムアーキテクチャ

```mermaid
graph TB
  subgraph Client["Next.js (App Router)"]
    LIFFProvider["LIFF Provider & Auth Hooks (legacy)"]
    ChatUI["Chat Layout / Session Sidebar"]
    Canvas["CanvasPanel (TipTap)"]
    HeadingFlow["HeadingFlow UI"]
    Annotation["AnnotationPanel"]
    Analytics["Analytics Table"]
    BusinessForm["Business Info Form"]
    AdminUI["Admin Dashboards"]
    GscSetup["GSC Setup Dashboard"]
    GscDashboard["GSC Analytics Dashboard"]
    Ga4Dashboard["GA4 Dashboard"]
    GoogleAdsDashboard["Google Ads Dashboard"]
  end

  subgraph Server["Next.js Route Handlers & Server Actions"]
    AuthMiddleware["authMiddleware"]
    ChatStream["/api/chat/anthropic/stream"]
    CanvasStream["/api/chat/canvas/stream"]
    WordPressAPI["/api/wordpress/*"]
    AdminAPI["/api/admin/*"]
    UserAPI["/api/refresh, /api/user/*"]
    GscAPI["/api/gsc/*"]
    GscCron["/api/cron/gsc-evaluate"]
    Ga4API["/api/ga4/*"]
    GoogleAdsAPI["/api/google-ads/*"]
    EmployeeAPI["/api/employee"]
    ServerActions["server/actions/*"]
  end

  subgraph Data["Supabase PostgreSQL"]
    UsersTable["users"]
    EmployeeInvitations["employee_invitations (legacy, write-disabled)"]
    SessionsTable["chat_sessions"]
    MessagesTable["chat_messages"]
    HeadingSections["session_heading_sections"]
    CombinedContents["session_combined_contents"]
    BriefsTable["briefs"]
    AnnotationsTable["content_annotations"]
    PromptsTable["prompt_templates"]
    VersionsTable["prompt_versions"]
    WordpressTable["wordpress_settings"]
    GscCredentials["gsc_credentials (+ GA4設定)"]
    GscPageMetrics["gsc_page_metrics"]
    GscQueryMetrics["gsc_query_metrics"]
    GscEvaluations["gsc_article_evaluations"]
    GscHistory["gsc_article_evaluation_history"]
    Ga4Metrics["ga4_page_metrics_daily"]
    GoogleAdsCredentials["google_ads_credentials"]
  end

  subgraph External["External Services"]
    LINE["LINE Platform (LIFF / Verify, legacy)"]
    Anthropic["Anthropic Claude"]
    OpenAI["OpenAI GPT-4.1 nano FT"]
    WordPress["WordPress REST API"]
    GSC["Google Search Console API"]
    GA4["Google Analytics 4 API"]
    GoogleAds["Google Ads API"]
  end

  LIFFProvider --> AuthMiddleware
  ChatUI --> ChatStream
  Canvas --> CanvasStream
  HeadingFlow --> ServerActions
  Annotation --> ServerActions
  Analytics --> WordPressAPI
  BusinessForm --> ServerActions
  AdminUI --> ServerActions
  GscSetup --> GscAPI
  GscDashboard --> GscAPI
  Ga4Dashboard --> Ga4API
  GoogleAdsDashboard --> GoogleAdsAPI

  ServerActions --> UsersTable
  ServerActions --> BriefsTable
  ServerActions --> AnnotationsTable
  ServerActions --> HeadingSections
  ServerActions --> CombinedContents
  ChatStream --> MessagesTable
  ChatStream --> SessionsTable
  WordPressAPI --> WordpressTable
  AdminAPI --> PromptsTable
  AdminAPI --> VersionsTable
  GscAPI --> GscCredentials
  GscAPI --> GscPageMetrics
  GscAPI --> GscQueryMetrics
  GscAPI --> GscEvaluations
  GscCron --> GscEvaluations
  GscCron --> GscHistory
  Ga4API --> GscCredentials
  Ga4API --> Ga4Metrics
  GoogleAdsAPI --> GoogleAdsCredentials
  EmployeeAPI --> EmployeeInvitations

  AuthMiddleware --> LINE
  ChatStream --> Anthropic
  CanvasStream --> Anthropic
  ChatStream --> OpenAI
  WordPressAPI --> WordPress
  GscAPI --> GSC
  GscCron --> GSC
  Ga4API --> GA4
  GoogleAdsAPI --> GoogleAds
```

GSC の **連携状態・プロパティ選択・切断・インポート** の多くは HTTP の一覧表ではなく、**[`src/server/actions/gscSetup.actions.ts`](src/server/actions/gscSetup.actions.ts)** / **[`gscImport.actions.ts`](src/server/actions/gscImport.actions.ts)** / **[`gscDashboard.actions.ts`](src/server/actions/gscDashboard.actions.ts)** の Server Actions を経由します。OAuth の開始・コールバックとダッシュボード用 JSON は `app/api/gsc/**` の Route Handler を参照してください。

## 🔄 認証フロー

### 1. メール OTP 認証フロー（現行・主系）

```mermaid
sequenceDiagram
    participant U as User
    participant C as Client (/login)
    participant S as Next.js Server Action
    participant SA as Supabase Auth
    participant DB as Supabase (public.users)

    U->>C: メールアドレスを入力
    C->>S: sendOtpEmail(email)
    S->>SA: signInWithOtp({ email, shouldCreateUser: true })
    SA->>U: 6桁コードをメール送信（Resend SMTP）
    U->>C: 6桁コードを入力
    C->>S: verifyOtp(email, token)
    S->>SA: supabase.auth.verifyOtp()
    SA->>S: Supabase セッション Cookie 発行
    S->>DB: users.supabase_auth_id で既存ユーザー検索
    alt 既存ユーザーあり
        DB->>S: public.users を返却
    else 新規ユーザー
        S->>DB: public.users を新規作成（role: trial）
    end
    S->>C: 成功レスポンス
    C->>U: / へリダイレクト
```

### 2. WordPress OAuth 認証フロー

```mermaid
sequenceDiagram
    participant U as User (Admin)
    participant C as Client
    participant S as Next.js Server
    participant WP as WordPress.com OAuth
    participant DB as Supabase

    U->>C: WordPress連携を開始
    C->>S: /api/wordpress/oauth/start
    S->>S: 認証済み・`role=admin`・オーナー本人（スタッフ閲覧・閲覧モード不可）を確認
    S->>S: OAuth state 生成・Cookie保存
    S->>WP: OAuth認証URLへリダイレクト
    WP->>U: WordPress.com認証画面表示
    U->>WP: 認証許可
    WP->>S: /api/wordpress/oauth/callback?code=xxx&state=yyy
    S->>S: state検証
    S->>WP: トークン交換リクエスト (code → access_token)
    WP->>S: access_token, refresh_token 返却
    S->>DB: wordpress_settings にトークンを保存
    S->>C: 連携完了をリダイレクト
```

### 3. Google Search Console OAuth 認証フロー

```mermaid
sequenceDiagram
    participant U as User
    participant C as Client
    participant S as Next.js Server
    participant G as Google OAuth
    participant GSC as Google Search Console API
    participant DB as Supabase

    U->>C: GSC連携を開始
    C->>S: /api/gsc/oauth/start
    S->>S: 認証済みユーザー（メールセッション）チェック
    S->>S: OAuth state 生成・Cookie保存
    S->>G: OAuth認証URLへリダイレクト<br/>(scope: webmasters.readonly)
    G->>U: Google認証画面表示
    U->>G: 認証許可
    G->>S: /api/gsc/oauth/callback?code=xxx&state=yyy
    S->>S: state検証
    S->>G: トークン交換リクエスト (code → tokens)
    G->>S: access_token, refresh_token, scope 返却
    S->>DB: gsc_credentials にトークンを保存
    S->>C: 連携完了をリダイレクト

    Note over U,DB: プロパティ選択フェーズ（Server Action）
    U->>C: プロパティ選択画面
    C->>S: fetchGscProperties / saveGscProperty 等
    S->>GSC: Sites.list API 呼び出し
    GSC->>S: プロパティ一覧を返却
    S->>C: プロパティ一覧を表示
    U->>C: プロパティを選択
    C->>S: saveGscProperty
    S->>DB: gsc_credentials の property_uri を更新
    S->>C: 設定完了
```

## 🛠️ 技術スタック

npm 依存のバージョンは **[`package.json`](package.json)** を正とし、ロックされた解決結果は **[`package-lock.json`](package-lock.json)** を参照してください。以下は名称の列挙のみです。

### フロントエンド

- **フレームワーク**: Next.js（App Router）, React, TypeScript
- **スタイリング**: Tailwind CSS v4, Radix UI, shadcn/ui, lucide-react, tw-animate-css
- **テーマ**: next-themes（ダークモード対応）
- **エディタ**: TipTap, lowlight（シンタックスハイライト）
- **グラフ**: Recharts
- **通知**: Sonner（Toast）
- **Markdown**: react-markdown, remark-gfm

### バックエンド

- **API**: Next.js Route Handlers & Server Actions
- **データベース**: `@supabase/supabase-js`（PostgreSQL + Row Level Security）
- **バリデーション**: Zod
- **ランタイム**: Node.js（LTS 推奨）

### AI・LLM

- **Anthropic**: Claude API（SSE ストリーミング；呼び出しモデル ID は `src/lib/constants.ts` の `MODEL_CONFIGS`）
- **OpenAI**: OpenAI API（Fine-tuned モデル含む；同上）

### 認証・外部連携

- **Supabase Auth + @supabase/ssr**: メール OTP ログイン・セッション管理（現行・主系）
- **LINE (legacy)**: `@line/liff` は Phase 1.5 移行互換のため残置。ログイン UI 導線は削除済みで、将来のクリーンアップで依存ごと除去予定
- **Resend**: メール OTP 配信（`noreply@mail.growmate.tokyo`）
- **OAuth 2.0**: WordPress.com, Google (Search Console, GA4, Google Ads)
- **WordPress REST API**: 投稿取得・同期
- **Google Search Console API / Google Ads API**

### 開発ツール

- **型チェック**: TypeScript strict mode
- **リンター**: ESLint, eslint-config-next
- **コード整形**: Prettier（`.prettierrc`；エディタ拡張やグローバルインストールで使用）
- **ビルド**: Turbopack（開発）/ Next.js build
- **依存関係解析**: Knip
- **ローカル公開**: ngrok（日本リージョン）

## 📊 データベーススキーマ（主要テーブル）

```mermaid
erDiagram
    users {
        uuid id PK
        text line_user_id "NULL許容・UNIQUE"
        text line_display_name "NULL許容"
        text line_picture_url
        text line_status_message
        text email "NULL許容・CI UNIQUE"
        uuid supabase_auth_id "NULL許容・UNIQUE"
        text full_name
        text role
        uuid owner_user_id "NULL許容・FK→users"
        text owner_previous_role "NULL許容"
        timestamptz last_login_at
        timestamptz created_at
        timestamptz updated_at
    }

    employee_invitations {
        uuid id PK
        uuid owner_user_id FK
        text invitation_token UK
        bigint expires_at
        bigint used_at "NULL許容"
        uuid used_by_user_id "NULL許容・FK→users"
        bigint created_at
    }

    chat_sessions {
        text id PK
        text user_id FK
        text title
        text system_prompt
        timestamptz last_message_at
        timestamptz created_at
    }

    chat_messages {
        text id PK
        text user_id FK
        text session_id FK
        text role
        text content
        text model
        timestamptz created_at
    }

    briefs {
        uuid id PK
        text user_id UK
        jsonb data
        timestamptz created_at
        timestamptz updated_at
    }

    content_annotations {
        uuid id PK
        text user_id FK
        bigint wp_post_id
        text session_id
        text canonical_url
        text wp_post_title
        text wp_excerpt
        text wp_content_text
        text wp_categories
        text main_kw
        text kw
        text impressions
        text persona
        text needs
        text goal
        text prep
        text basic_structure
        text opening_proposal
        timestamptz created_at
        timestamptz updated_at
    }

    wordpress_settings {
        uuid id PK
        uuid user_id UK,FK
        text wp_type
        text wp_client_id
        text wp_client_secret
        text wp_site_id
        text wp_site_url
        text wp_username
        text wp_application_password
        text wp_access_token
        text wp_refresh_token
        timestamptz wp_token_expires_at
        text[] wp_content_types
        timestamptz created_at
        timestamptz updated_at
    }

    prompt_templates {
        uuid id PK
        text name
        text description
        text category
        boolean is_active
        uuid created_by FK
        timestamptz created_at
        timestamptz updated_at
    }

    prompt_versions {
        uuid id PK
        uuid template_id FK
        integer version_number
        text content
        text change_summary
        uuid created_by FK
        timestamptz created_at
    }

    gsc_credentials {
        uuid id PK
        uuid user_id UK,FK
        text google_account_email
        text refresh_token
        text access_token
        timestamptz access_token_expires_at
        text[] scope
        text property_uri
        text property_type
        text property_display_name
        text permission_level
        boolean verified
        timestamptz last_synced_at
        text ga4_property_id "NULL許容"
        text ga4_property_name "NULL許容"
        text[] ga4_conversion_events "NULL許容"
        integer ga4_threshold_engagement_sec "NULL許容"
        numeric ga4_threshold_read_rate "NULL許容・0〜1"
        timestamptz ga4_last_synced_at "NULL許容"
        timestamptz created_at
        timestamptz updated_at
    }

    gsc_page_metrics {
        uuid id PK
        uuid user_id FK
        uuid content_annotation_id FK
        text property_uri
        text search_type
        date date
        text url
        text normalized_url
        integer clicks
        integer impressions
        numeric ctr
        numeric position
        timestamptz imported_at
    }

    gsc_query_metrics {
        uuid id PK
        uuid user_id FK
        text property_uri
        text property_type
        text search_type
        date date
        text url
        text normalized_url
        text query
        text query_normalized
        integer clicks
        integer impressions
        numeric ctr
        numeric position
        uuid content_annotation_id FK
        timestamptz imported_at
        timestamptz created_at
        timestamptz updated_at
    }

    gsc_article_evaluations {
        uuid id PK
        uuid user_id FK
        uuid content_annotation_id FK
        text property_uri
        smallint current_suggestion_stage
        date last_evaluated_on
        date base_evaluation_date
        integer cycle_days
        integer evaluation_hour
        numeric last_seen_position
        text status
        timestamptz created_at
        timestamptz updated_at
    }

    gsc_article_evaluation_history {
        uuid id PK
        uuid user_id FK
        uuid content_annotation_id FK
        date evaluation_date
        smallint stage
        numeric previous_position
        numeric current_position
        text outcome_type
        text outcome
        text error_code
        text error_message
        boolean suggestion_applied
        text suggestion_summary
        boolean is_read
        timestamptz created_at
    }

    google_ads_credentials {
        uuid id PK
        uuid user_id UK,FK
        text google_account_email
        text access_token
        text refresh_token
        timestamptz access_token_expires_at
        text[] scope
        text customer_id "NULL許容"
        text manager_customer_id "NULL許容"
        timestamptz created_at
        timestamptz updated_at
    }

    ga4_page_metrics_daily {
        uuid id PK
        uuid user_id FK
        text property_id
        date date
        text page_path
        text normalized_path "Generated（normalize_to_path）"
        integer sessions
        integer users
        integer engagement_time_sec
        numeric bounce_rate "0〜1"
        integer cv_event_count
        integer scroll_90_event_count
        integer search_clicks "GSC連携時の検索クリック数"
        integer impressions "GSC連携時の検索インプレッション数"
        numeric ctr "NULL許容・search_clicks/impressions"
        boolean is_sampled
        boolean is_partial
        timestamptz imported_at
        timestamptz created_at
        timestamptz updated_at
    }

    session_heading_sections {
        uuid id PK
        text session_id FK
        text heading_key UK
        smallint heading_level "3 or 4"
        text heading_text
        integer order_index
        text content
        boolean is_confirmed
        timestamptz created_at
        timestamptz updated_at
    }

    session_combined_contents {
        uuid id PK
        text session_id FK
        integer version_no
        text content
        boolean is_latest
        timestamptz created_at
        timestamptz updated_at
    }

    users ||--o{ chat_sessions : owns
    users ||--o{ employee_invitations : "issues invitations"
    users ||--o{ employee_invitations : "used_by"
    chat_sessions ||--o{ chat_messages : contains
    chat_sessions ||--o{ session_heading_sections : "has headings"
    chat_sessions ||--o{ session_combined_contents : "has versions"
    users ||--|| briefs : "stores one brief"
    users ||--o{ content_annotations : annotates
    users ||--o| wordpress_settings : configures
    users ||--o| gsc_credentials : "has GSC auth"
    users ||--o| google_ads_credentials : "has Google Ads auth"
    users ||--o{ gsc_page_metrics : owns
    users ||--o{ gsc_query_metrics : owns
    users ||--o{ gsc_article_evaluation_history : owns
    users ||--o{ ga4_page_metrics_daily : owns
    users ||--o{ prompt_templates : creates
    users ||--o{ prompt_versions : creates
    prompt_templates ||--o{ prompt_versions : "has versions"
    content_annotations ||--o| gsc_article_evaluations : "monitored by"
    content_annotations ||--o{ gsc_page_metrics : "tracked by"
    content_annotations ||--o{ gsc_query_metrics : "tracked by"
    content_annotations ||--o{ gsc_article_evaluation_history : "evaluated in"
    gsc_article_evaluations ||--o{ gsc_article_evaluation_history : "has history"
```

## 📋 環境変数

`.env.local` を手動で用意してください。

### [`src/env.ts`](src/env.ts) で Zod 検証されるもの

起動時に読み込まれます。**クライアント向け**（`NEXT_PUBLIC_*`）はブラウザに公開されます。**サーバー専用**はサーバー側からのみ参照可能です（`env` プロキシ経由）。

| 種別   | 変数名                               | 必須                               | 用途                                                                                   |
| ------ | ------------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------- |
| Server | `SUPABASE_SERVICE_ROLE`              | ✅                                 | サーバーサイド特権操作用 Service Role キー                                             |
| Server | `OPENAI_API_KEY`                     | ✅                                 | OpenAI API キー                                                                        |
| Server | `ANTHROPIC_API_KEY`                  | ✅                                 | Claude ストリーミング用 API キー                                                       |
| Server | `LINE_CHANNEL_ID`                    | ✅（legacy 互換のため現在も必須）  | LINE Login 用チャネル ID。UI 導線は削除済みだが `src/env.ts` のスキーマでは必須のまま   |
| Server | `LINE_CHANNEL_SECRET`                | ✅（legacy 互換のため現在も必須）  | LINE Login 用チャネルシークレット。同上                                                |
| Server | `GOOGLE_OAUTH_CLIENT_ID`             | 任意（GSC/GA4 連携利用時は必須）   | Google Search Console / GA4 OAuth 用クライアント ID                                    |
| Server | `GOOGLE_OAUTH_CLIENT_SECRET`         | 任意（GSC/GA4 連携利用時は必須）   | Google Search Console / GA4 OAuth 用クライアントシークレット                           |
| Server | `GOOGLE_SEARCH_CONSOLE_REDIRECT_URI` | 任意（GSC/GA4 連携利用時は必須）   | Google OAuth のリダイレクト先（`https://<host>/api/gsc/oauth/callback` など）          |
| Server | `WORDPRESS_COM_CLIENT_ID`            | 任意（WordPress 連携利用時は必須） | WordPress.com OAuth 用クライアント ID                                                  |
| Server | `WORDPRESS_COM_CLIENT_SECRET`        | 任意（WordPress 連携利用時は必須） | WordPress.com OAuth 用クライアントシークレット                                         |
| Server | `WORDPRESS_COM_REDIRECT_URI`         | 任意（WordPress 連携利用時は必須） | WordPress OAuth のリダイレクト先（`https://<host>/api/wordpress/oauth/callback` など） |
| Server | `COOKIE_SECRET`                      | 任意                               | WordPress / Google OAuth 等のセキュアな Cookie 管理用シークレット                      |
| Client | `NEXT_PUBLIC_LIFF_ID`                | ✅（legacy 互換のため現在も必須）  | LIFF アプリ ID。UI 導線は削除済みだが `src/env.ts` のスキーマでは必須のまま            |
| Client | `NEXT_PUBLIC_LIFF_CHANNEL_ID`        | ✅（legacy 互換のため現在も必須）  | LIFF Channel ID。同上                                                                  |
| Client | `NEXT_PUBLIC_SUPABASE_URL`           | ✅                                 | Supabase プロジェクト URL                                                              |
| Client | `NEXT_PUBLIC_SUPABASE_ANON_KEY`      | ✅                                 | Supabase anon キー                                                                     |
| Client | `NEXT_PUBLIC_SITE_URL`               | ✅                                 | サイトの公開 URL                                                                       |

上表は **17 キー**（サーバー 12 + クライアント 5）。`env.ts` のスキーマと一致させてあります。

### `src/env.ts` に含まれないがコードが参照するもの

Route Handler やサービスが **`process.env` を直接参照**します。`env` オブジェクトからは読めません。

| 変数名 | 必須 | 用途 |
| ------ | ---- | ---- |
| `CRON_SECRET` | 任意（`/api/cron/gsc-evaluate` を使う場合は必須） | GSC 評価バッチの Bearer 認証 |
| `GOOGLE_ADS_REDIRECT_URI` | 任意（Google Ads OAuth 利用時は必須） | [`app/api/google-ads/oauth/*`](app/api/google-ads/oauth) のリダイレクト URI |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | 任意（Google Ads API 利用時は必須） | [`src/server/services/googleAdsService.ts`](src/server/services/googleAdsService.ts) から参照 |

## 🚀 セットアップ手順

### 必要条件

- **Node.js**: LTS 推奨
- **Supabase 接続情報**（管理者から取得）
- **Resend API キー**（メール OTP 配信用。Supabase Dashboard の Custom SMTP に設定）
- **LINE 接続情報** (legacy)（`src/env.ts` 必須スキーマのため値自体はダミーでも可。管理者から取得。`authMiddleware` の LINE Cookie 互換パスが残置されているため env 自体は保持）

> **ngrok について**: Phase A で LIFF SDK 依存（`@line/liff`）と `liff.init()` 呼び出しは完全に撤去されたため、**ngrok は不要**になりました。`http://localhost:3000` でメール OTP ログインから全機能まで動作します。LINE ミニアプリ（LINE クライアント内）での動作確認はもうできません。

### 1. インストール

```bash
git clone <repository-url>
cd GrowMate
npm install
```

### 2. Supabase

本番環境と開発環境でプロジェクトを共有しています。管理者から Project URL・anon key・service_role key を取得し `.env.local` に設定してください。

#### マイグレーション運用（このリポジトリの前提）

- **ローカル開発者は、共有 Supabase プロジェクト（本番と同一のリモート）に対して `npx supabase db push` を実行しないこと。** CLI がリモートへスキーマを流し込むと、全員の参照する DB に直接影響するためです。
- スキーマ変更が必要な場合は `supabase/migrations/` に SQL を追加し PR に含める。**リモートへの適用は管理者のみ**が手順に従って行う（SQL Editor、または管理者承認済みの手順でのみ `db push` 等）。
- 初回セットアップで「自分用に DB を流す」必要はない（上記のため、開発者が個別に `db push` する前提ではない）。
- 本番データと同じ DB を使用するため、テストデータは自分のユーザー ID に紐付けて作成し、他のユーザーデータを誤って変更・削除しないよう注意すること
- 直近のマイグレーション概要:
  - `session_heading_sections` / `session_combined_contents` テーブル追加（見出しフロー・原稿バージョン管理）
  - `ga4_page_metrics_daily` テーブル追加・`gsc_credentials` に GA4 設定カラムを追加
  - `ga4_page_metrics_daily` に `search_clicks` / `impressions` / `ctr` カラムを追加（GA4 × Search Console 連携指標）
  - `google_ads_credentials` テーブル追加・`customer_id` カラム追加
  - `employee_invitations` テーブル・スタッフ招待 RPC（`accept_employee_invitation`, `delete_employee_and_restore_owner`）追加（招待フロー UI は後に削除）
  - `get_accessible_user_ids` 追加と `search_chat_sessions` / `get_sessions_with_messages` 更新
  - オーナー/スタッフ共有アクセス向け RLS 更新・オーナー書き込み禁止
  - `users.owner_user_id` / `owner_previous_role` カラム追加（スタッフ→オーナー復元用）

### 3. メール OTP (Resend SMTP)

Supabase Dashboard → Authentication → SMTP Settings に Resend の API キーと送信元アドレス（`noreply@mail.growmate.tokyo` など）を設定します。ローカル開発でも共有 Supabase プロジェクトを使うため、管理者が設定済みの場合は追加作業は不要です。

### 4. LINE (legacy)

`src/env.ts` のスキーマで `LINE_CHANNEL_ID` / `LINE_CHANNEL_SECRET` / `NEXT_PUBLIC_LIFF_ID` / `NEXT_PUBLIC_LIFF_CHANNEL_ID` が必須のため、クリーンアップ完了までは値を設定する必要があります。本番で使われていたチャネル情報を管理者から取得してください。

> **重要**: LINE ログインの UI 導線はすでに削除済みです。Phase 1.5 のレガシー互換のみ目的で、LINE Developers Console の設定変更は原則不要です。

### 5. 外部サービス連携

各サービスの OAuth クライアント・API キーを取得し `.env.local` に設定します。Google Ads 用の `GOOGLE_ADS_REDIRECT_URI` / `GOOGLE_ADS_DEVELOPER_TOKEN` および GSC バッチ用の `CRON_SECRET` は、後述の「環境変数」節にある **`src/env.ts` に含まれない** 表のとおり `process.env` を直接参照します。

| サービス | 取得先 | 主な設定変数 |
|---------|--------|------------|
| Google (GSC/GA4/Ads) | [Google Cloud Console](https://console.cloud.google.com/) → OAuth 2.0 クライアント ID | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, 各 `*_REDIRECT_URI` |
| WordPress.com | WordPress.com Developer Portal → アプリ作成 | `WORDPRESS_COM_CLIENT_ID`, `WORDPRESS_COM_CLIENT_SECRET` |

**Google OAuth の注意点**:
- GSC / GA4 / Google Ads は同一 OAuth クライアントを共有できます
- 必要なスコープ: `webmasters.readonly`（GSC）、`analytics.readonly`（GA4）、`adwords`（Google Ads）
- 使用する各リダイレクト URI を Google Cloud Console の「承認済みのリダイレクト URI」に登録してください（ローカル開発は `http://localhost:3000/...` を登録）
- Google Ads API には別途 MCC アカウントから発行した開発者トークン（`GOOGLE_ADS_DEVELOPER_TOKEN`）が必要です

### 6. 開発サーバーの起動

```bash
npm run dev
# 型チェックを並行で行う場合
npm run dev:types
```

ブラウザで `http://localhost:3000` にアクセスしてアプリケーションを確認できます。

### 7. 初期データのセットアップ

1. **管理者ロールの付与**: Supabase の `users` テーブルで自分のユーザーの `role` を `admin` に変更
2. **事業者情報の登録**: `/business-info` で 5W2H などの基本情報を入力
3. **各種連携**（任意）: `/setup/wordpress`・`/setup/gsc`・`/setup/ga4`・`/setup/google-ads` で外部サービスを接続
4. **プロンプトテンプレートの確認**: `/admin/prompts` でデフォルトテンプレートを確認・編集

## ✅ 動作確認

```bash
npm run lint        # ESLint + Next/Tailwind ルール検証
npm run build       # 本番ビルドの健全性チェック
npm run db:stats    # データベース統計確認
npm run vercel:stats # Vercel 統計確認（デプロイ済みの場合）
```

GSC 連携など各機能の詳細な検証手順は `testing-and-troubleshooting` スキルを参照してください。

## 📁 プロジェクト構成

```
├── app/
│   ├── chat/                # AI チャットワークスペース（Canvas / Annotation / Step UI）
│   ├── analytics/           # WordPress 投稿 + 注釈ダッシュボード
│   ├── business-info/       # 事業者情報フォーム（Server Components + Actions）
│   ├── setup/               # WordPress / GSC / GA4 / Google Ads 等の初期セットアップ導線
│   ├── login/               # ログインページ
│   ├── home/                # パブリックホームページ（非認証可）
│   ├── privacy/             # プライバシーポリシー（非認証可）
│   ├── unauthorized/        # 未認可ユーザー向けページ
│   ├── unavailable/         # 利用不可ユーザー向けページ（role が unavailable の場合）
│   ├── terms/               # 利用規約（非認証可）
│   ├── wordpress-import/    # WordPress 記事の一括インポートページ
│   ├── gsc-dashboard/       # GSC ダッシュボードページ
│   ├── gsc-import/          # GSC データインポートページ
│   ├── ga4-dashboard/       # GA4 ダッシュボードページ
│   ├── google-ads-dashboard/# Google Ads ダッシュボードページ
│   ├── admin/               # 管理者向け機能（プロンプト・ユーザー管理）
│   ├── api/                 # Route Handlers（chat, wordpress, admin, auth, user, line, gsc, ga4, google-ads, employee, cron）
│   └── layout.tsx など      # App Router ルートレイアウト
├── src/
│   ├── components/          # 再利用可能な UI（shadcn/ui, AnnotationFormFields 等）
│   ├── domain/              # フロント向けサービス層（ChatService など）
│   │   ├── errors/          # ドメイン固有エラー定義
│   │   ├── interfaces/      # インターフェース定義
│   │   ├── models/          # ドメインモデル
│   │   └── services/        # ドメインサービス
│   ├── hooks/               # LIFF / UI ユーティリティ
│   ├── lib/                 # 定数・プロンプト管理・Supabase クライアント生成
│   │   ├── supabase/        # Supabase クライアント生成ヘルパー
│   │   └── validators/      # バリデーションユーティリティ
│   ├── pages/               # Pages Router（_document.tsx のみ）
│   ├── server/
│   │   ├── actions/         # Server Actions 経由のビジネスロジック
│   │   ├── auth/            # 認証ユーティリティ（resolveUser 等）
│   │   ├── middleware/      # 認証・ロール判定ミドルウェア
│   │   ├── services/        # 統合層（WordPress / Supabase / LLM / GSC / GA4 / Google Ads など）
│   │   │   ├── chatService.ts            # チャットセッション管理
│   │   │   ├── gscService.ts             # GSC 基本操作
│   │   │   ├── gscEvaluationService.ts   # GSC 記事評価処理
│   │   │   ├── gscSuggestionService.ts   # GSC 改善提案生成
│   │   │   ├── gscImportService.ts       # GSC データインポート
│   │   │   ├── ga4Service.ts             # GA4 基本操作
│   │   │   ├── ga4ImportService.ts       # GA4 データインポート
│   │   │   ├── googleAdsService.ts       # Google Ads API 連携
│   │   │   ├── analyticsContentService.ts # アナリティクスコンテンツ処理
│   │   │   ├── chatLimitService.ts       # チャット制限管理
│   │   │   └── ... その他サービス
│   │   ├── schemas/         # Zod バリデーションスキーマ
│   │   └── lib/             # サーバー専用ユーティリティ
│   └── types/               # 共通型定義（chat, prompt, annotation, wordpress 等）
├── docs/                    # 仕様書・設計ドキュメント・Runbook
├── scripts/                 # ユーティリティスクリプト（DB 統計・Vercel 統計）
├── supabase/migrations/     # データベースマイグレーション
└── config files             # eslint.config.mjs, next.config.ts, tailwind/postcss 設定
```

## 🔧 Route Handlers（`app/api/**/route.ts`）

実装の一覧は `app/api` 配下を正とします。主なものは次のとおりです。

| エンドポイント                      | メソッド | 概要                                                          | 認証 |
| ----------------------------------- | -------- | ------------------------------------------------------------- | ---- |
| `/api/chat/anthropic/stream`        | POST     | Claude とのチャット SSE ストリーム                            | Supabase メールセッション（`authMiddleware`） |
| `/api/chat/canvas/stream`           | POST     | Canvas 編集（選択範囲差し替え）                               | 同上 |
| `/api/chat/canvas/load-wordpress`   | POST     | WordPress 記事を Canvas に読み込み                            | 同上 |
| `/api/user/current`                 | GET      | ログインユーザーのプロファイル・ロール情報                    | Supabase メールセッション |
| `/api/auth/check-role`              | GET      | ロールのサーバー検証                                          | Cookie / セッション |
| `/api/auth/clear-cache`             | POST     | Edge キャッシュクリア通知                                     | 任意 |
| `/api/wordpress/oauth/start`        | GET      | WordPress.com OAuth リダイレクト開始                          | Cookie + admin + オーナー本人 |
| `/api/wordpress/oauth/callback`     | GET      | WordPress.com OAuth コールバック                              | Cookie |
| `/api/wordpress/posts`              | GET      | WordPress 投稿一覧取得（ページネーション対応）                | Cookie / セッション |
| `/api/wordpress/settings`           | POST     | WordPress 接続設定の保存（.com / セルフホスト）               | Cookie / セッション |
| `/api/wordpress/test-connection`    | GET,POST | WordPress 接続テスト                                          | Cookie / セッション |
| `/api/wordpress/status`             | GET,POST | WordPress 接続ステータス確認                                  | Cookie / セッション |
| `/api/admin/prompts`                | GET      | プロンプトテンプレート一覧（管理者）                          | Cookie + admin |
| `/api/admin/prompts/[id]`           | POST     | テンプレート更新・バージョン生成                              | Cookie + admin |
| `/api/gsc/oauth/start`              | GET      | GSC OAuth リダイレクト開始                                    | 公開（環境変数必須） |
| `/api/gsc/oauth/callback`           | GET      | GSC OAuth コールバック                                        | Cookie |
| `/api/gsc/dashboard`                | GET      | GSC ダッシュボード用・注釈一覧など（クエリで絞り込み）         | Cookie / セッション |
| `/api/gsc/dashboard/[annotationId]` | GET    | 注釈別の GSC 関連データ                                       | Cookie / セッション |
| `/api/gsc/evaluate`                 | POST     | GSC 記事評価の手動実行                                        | Cookie / セッション |
| `/api/gsc/evaluations/register`     | POST     | GSC 評価対象の登録                                            | Cookie / セッション |
| `/api/gsc/evaluations/update`       | POST     | GSC 評価設定の更新                                            | Cookie / セッション |
| `/api/cron/gsc-evaluate`            | GET      | GSC 記事評価の定期実行（Vercel Cron）                         | `Authorization: Bearer <CRON_SECRET>`（`CRON_SECRET` は `env.ts` 外） |
| `/api/google-ads/oauth/start`       | GET      | Google Ads OAuth リダイレクト開始                             | Cookie + admin |
| `/api/google-ads/oauth/callback`    | GET      | Google Ads OAuth コールバック                                 | Cookie |
| `/api/google-ads/accounts`          | GET      | Google Ads アカウント一覧取得                                 | Cookie + admin |
| `/api/google-ads/accounts/select`   | GET      | 選択アカウントの保存（`customer_id` 更新）                    | Cookie + admin |
| `/api/google-ads/accounts/clients`  | GET      | MCC 配下クライアントアカウント一覧                            | Cookie + admin |
| `/api/google-ads/keywords`          | GET      | キーワード取得                                                | Cookie + admin |
| `/api/ga4/sync`                     | POST     | GA4 データ同期（`ga4_page_metrics_daily` 更新）               | Cookie / セッション（`canWriteGa4` チェック） |
| `/api/ga4/settings`                 | PUT      | GA4 設定の更新（`gsc_credentials` の GA4 カラム）             | Cookie / セッション |
| `/api/ga4/properties`               | GET      | GA4 プロパティ一覧取得                                        | Cookie / セッション |
| `/api/ga4/key-events`               | GET      | GA4 キーイベント取得                                          | Cookie / セッション |
| `/api/employee` (legacy)            | GET      | スタッフ情報取得（オーナーのみ）。UI 導線は削除済み           | Bearer（オーナーロール） |
| `/api/employee` (legacy)            | DELETE   | スタッフ削除・オーナーロール復元。UI 導線は削除済み           | Bearer（オーナーロール） |

**GSC 評価バッチ**: `CRON_SECRET` を `.env.local` に設定し、`Authorization: Bearer <CRON_SECRET>` で `/api/cron/gsc-evaluate` を呼び出します。

### Server Actions（`src/server/actions/`）

Route Handler とは別に、UI から直接呼び出す Server Actions を以下のファイルで管理しています。

#### GSC

| ファイル | 主なエクスポート | 概要 |
| -------- | ---------------- | ---- |
| `gscSetup.actions.ts` | `fetchGscStatus`, `fetchGscProperties`, `saveGscProperty`, `disconnectGsc`, `refetchGscStatusWithValidation` | 連携状態・プロパティ・切断 |
| `gscImport.actions.ts` | `runGscImport` | 日付範囲の GSC 指標インポート |
| `gscDashboard.actions.ts` | `fetchGscDetail`, `registerEvaluation`, `updateEvaluation`, `runEvaluationNow`, ほか | 注釈別詳細・評価登録・手動評価 |
| `gscNotification.actions.ts` | `getUnreadSuggestionsCount`, `markSuggestionAsRead`, ほか | 改善提案の未読・既読 |

#### GA4

| ファイル | 主なエクスポート | 概要 |
| -------- | ---------------- | ---- |
| `ga4Setup.actions.ts` | `fetchGa4ConnectionStatus`, `disconnectGa4`, ほか | GA4 連携状態・切断 |
| `ga4Dashboard.actions.ts` | `fetchGa4DashboardSummary`, `fetchGa4Ranking`, `fetchGa4Timeseries`, ほか | GA4 ダッシュボード用集計データ取得 |

#### Google Ads

| ファイル | 主なエクスポート | 概要 |
| -------- | ---------------- | ---- |
| `googleAds.actions.ts` | `getGoogleAdsConnectionStatus`, `disconnectGoogleAds`, `getKeywordMetrics`, `getCampaignMetrics` | 連携状態・キーワード・キャンペーン指標取得 |

#### チャット・見出しフロー

| ファイル | 主なエクスポート | 概要 |
| -------- | ---------------- | ---- |
| `heading-flow.actions.ts` | `initializeHeadingSections`, `saveHeadingSection`, `getHeadingSections`, `getLatestCombinedContent`, `resetHeadingSections`, `saveStep7UserLead`, ほか | 見出しセクション管理・結合コンテンツ生成 |
| `chat.actions.ts` | チャットセッション CRUD | セッション一覧・作成・削除・タイトル更新 |

#### WordPress

| ファイル | 主なエクスポート | 概要 |
| -------- | ---------------- | ---- |
| `wordpress.actions.ts` | `fetchWordpressSettings`, `saveWordpressSettings`, `disconnectWordpress`, ほか | 接続設定管理 |
| `wordpressImport.actions.ts` | `runWordpressImport`, ほか | WordPress 記事一括インポート |

#### ユーザー・権限

| ファイル | 主なエクスポート | 概要 |
| -------- | ---------------- | ---- |
| `user.actions.ts` | `updateUserProfile`, `getUserProfile`, ほか | プロファイル取得・更新 |
| `role.actions.ts` | `changeUserRole`, ほか | ロール変更 |
| `auth.actions.ts` | `sendOtpEmail`, `verifyOtp`, `signOutEmail`, `registerFullName` | メール OTP 認証・ログアウト・新規フルネーム登録 |
| `login.actions.ts` (legacy) | `getLineProfileServer` | LINE プロフィール取得（legacy 互換用） |

#### その他

| ファイル | 主なエクスポート | 概要 |
| -------- | ---------------- | ---- |
| `brief.actions.ts` | `saveBrief`, `fetchBrief` | 事業者情報 CRUD |
| `adminPrompts.actions.ts` | `fetchPromptTemplates`, `updatePromptTemplate` | プロンプトテンプレート管理 |
| `adminUsers.actions.ts` | `fetchAllUsers`, `updateUserRole` | ユーザー一覧・ロール変更（管理者用） |
| `prompt.actions.ts` | `fetchActivePromptByCategory`, ほか | プロンプト取得 |

## 🛡️ セキュリティと運用の注意点

- Supabase では主要テーブルに RLS を適用済み（開発ポリシーが残る箇所は運用前に見直す）
- `authMiddleware` がロールを検証し、管理者権限とオーナー/スタッフ関係に基づくアクセス制御を担保
- `get_accessible_user_ids` と RLS により、オーナー/スタッフの共有アクセスとオーナー読み取り専用を担保
- WordPress アプリケーションパスワードや OAuth トークンは HTTP-only Cookie に保存（本番では安全な KMS / Secrets 管理を推奨）
- SSE は 20 秒ごとの ping と 5 分アイドルタイムアウトで接続維持を調整
- `AnnotationPanel` の URL 正規化で内部／ローカルホストへの誤登録を防止

## 🗄️ Supabase バックアップ（Freeプラン / 週次）

GitHub Actions + GCS で週次バックアップを実行します（Storage は対象外、DB のみ）。

- **GCS バケット**: GitHub Secrets `GCS_BUCKET_NAME` で管理（us-central1、ライフサイクル60日で削除）
- **実行スケジュール**: 日曜12:00 JST（`.github/workflows/supabase-backup.yml`）
- **復旧手順**: GCS から `.sql.gz` を取得 → `gunzip` → `psql` で role → schema → data の順に適用
- **注**: GitHub の無活動による Actions 無効化を防ぐ必要がある場合は、リポジトリの運用方針に合わせて別途ワークフローを追加してください（本リポジトリに `keepalive.yml` は含めていません）。

GitHub Secrets に `GCP_PROJECT_ID`・`GCS_BUCKET_NAME`・`GCP_SERVICE_ACCOUNT_KEY`・`SUPABASE_DB_URL` を登録してください。

## 📱 デプロイと運用

- Vercel を想定（Edge Runtime と Node.js Runtime をルートごとに切り分け）
- デプロイ前チェック: `npm run lint` → `npm run build`
- 環境変数は Vercel Project Settings へ反映し、本番は WordPress 本番サイトなどの外部連携設定に切り替え
- **Supabase スキーマ**: Vercel のデプロイだけでは DB は更新されない。変更は `supabase/migrations/` にコミットし、マイグレーション内にロールバック案をコメントで残す。**本番（共有プロジェクト）への適用タイミングと手順は「ローカル環境のセットアップ → 2. Supabase」のマイグレーション運用に従う。**

## 🤝 コントリビューション

1. フィーチャーブランチを作成
2. 変更を実装し、`npm run lint` の結果を確認
3. 必要に応じて `supabase/migrations/` にマイグレーションを追加し、ロールバック手順を明記する。**共有プロジェクトへの適用は管理者に依頼し、自分で `npx supabase db push` をリモートに対して実行しないこと**（「2. Supabase」を参照）
4. 変更内容を簡潔にまとめた PR を作成（ユーザー影響・環境変数・スクリーンショットを添付）

## 📄 ライセンス

このリポジトリは私的利用目的で運用されています。再配布や商用利用は事前相談のうえでお願いいたします。
