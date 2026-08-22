# GrowMate - AIマーケティング支援プラットフォーム

メール OTP を入り口に、業界特化のマーケティングコンテンツを一括生成・管理する SaaS アプリケーションです。Next.js（App Router）を基盤に、マルチベンダー AI、WordPress 連携、Supabase による堅牢なデータ管理を統合しています。フレームワークのバージョンは [`package.json`](package.json) を参照してください。

> **認証**: ユーザー向け入口は **メール OTP**（Supabase Auth）。移行手順・`public.users` / `auth.users` 検証 SQL は [docs/runbooks/email-migration-runbook.md](docs/runbooks/email-migration-runbook.md)（**セクション 8**）。

## 🧭 プロダクト概要

- メール OTP でログインしたユーザー向けに、広告／LP／ブログ制作を支援する AI ワークスペースを提供
- Anthropic Claude と OpenAI のモデル（Fine-tuned 含む）を [`src/lib/constants.ts`](src/lib/constants.ts) の `MODEL_CONFIGS` で用途に応じて切り替え
- WordPress.com / 自社ホスティングを問わない投稿取得と、Supabase へのコンテンツ注釈保存
- 管理者向けのプロンプトテンプレート編集・ユーザー権限管理 UI を内蔵

## 🚀 主な機能

- **認証・ユーザー管理**: メール OTP（Supabase Auth）、[`proxy.ts`](proxy.ts) によるセッション更新・CSP・ロール別パスゲート、`authMiddleware`（Server Actions / Route Handlers）、ロール管理（`trial` / `paid` / `admin` / `unavailable`）
- **ランディング** (`/home`): 未ログイン向けの公開 LP。ログイン済みダッシュボードは `/`
- **AI コンテンツ支援**: 7 ステップのブログ作成フロー（ニーズ整理〜本文作成）、広告／LP テンプレート、AI 応答ストリーミング
- **キャンバス編集**: TipTap ベースの `CanvasPanel`、Markdown レンダリング／見出しアウトライン／バージョン履歴、選択範囲リライト
- **見出しフロー・バージョン管理**: Step5 生成見出しからの `session_heading_sections` 初期化、個別 AI 生成・`session_combined_contents` への結合保存、`save_atomic_combined_content` RPC で競合シリアライズ
- **コンテンツ分析** (`/analytics`): GSC 指標・GA4 指標・改善提案を注釈軸で横断表示（paid 以上）。未評価フィルタとコンテンツ評価状態・スコア・診断を一覧で確認し、`/analytics/[annotationId]` の記事詳細で手動評価と履歴を表示する。Instagram 連携済みユーザー向けに Instagram タブ（投稿一覧・指標・手動「最新化」同期）を表示
- **WordPress 連携**: OAuth・Application Password 両対応、投稿の一括インポート、`AnnotationPanel` でメモ・キーワード・ペルソナ等を再利用
- **Google Search Console 連携**: OAuth 認証、日次指標保存（`gsc_page_metrics` / `gsc_query_metrics`）、記事評価・改善提案（`gsc_article_evaluations`）、改善提案ジョブの Cron 実行（`/api/cron/gsc-suggestions`）
- **GA4 連携**: 日次ページ指標保存（`ga4_page_metrics_daily`）、サマリー・ランキング・時系列ダッシュボード、記事ごとのコンテンツ評価、メディア全体の資産価値・実効スコアと散布図
- **Google Ads 連携**: OAuth 認証、MCC アカウント選択、キーワード・キャンペーン指標、GSC 順位と WordPress 記事在庫を考慮した AI コンテンツ戦略提案、除外キーワード提案（自動配信メール対応）
- **Instagram 連携**: Business Login for Instagram による OAuth 認証、プロアカウント（ビジネス/クリエイター）連携、投稿プレビュー（`/setup/instagram`）。Phase 2 では手動同期で `instagram_media` / `instagram_account_insights_daily` に指標を保存し、`/analytics` の Instagram タブで閲覧（cron なし）。認証情報は `instagram_credentials` に保存
- **管理者ダッシュボード** (`/admin`): プロンプトテンプレート編集・バージョン保存、ユーザーロール管理。GA4コンテンツ評価の文章化テンプレートも `/admin/prompts` から登録する
- **事業者情報ブリーフ** (`/business-info`): 複数サービスの 5W2H を登録し、チャットセッションごとに選択したサービスのコンテキストを自動補完
- **外部連携セットアップ** (`/setup`): WordPress・GSC・GA4・Google Ads・Instagram の接続状態と設定画面を集約

## 🏗️ システムアーキテクチャ

```mermaid
graph TB
  subgraph Client["Next.js (App Router)"]
    AuthShell["AuthProvider（Email セッション）"]
    ChatUI["Chat / Session UI"]
    Canvas["Canvas（TipTap）"]
    HeadingFlow["HeadingFlow"]
    Annotation["AnnotationPanel"]
    Analytics["Analytics"]
    BusinessForm["Business Info"]
    AdminUI["Admin"]
    GscSetup["GSC Setup"]
    AnalyticsDetail["Analytics Article Detail (/analytics/[annotationId])"]
    Ga4Dashboard["GA4 Dashboard"]
    GoogleAdsDashboard["Google Ads Dashboard"]
    InstagramSetup["Instagram Setup"]
  end

  subgraph Server["サーバー（app/api/*・src/server/actions/*・proxy.ts）"]
    ProxyGate["proxy.ts（セッション / CSP / ロールゲート）"]
    AuthMiddleware["authMiddleware"]
    ChatAPI["api/chat/*"]
    WordPressAPI["api/wordpress/*"]
    AdminAPI["api/admin/*"]
    UserAPI["api/user/*, api/auth/*"]
    GscAPI["api/gsc/*"]
    GscCron["api/cron/*"]
    Ga4API["api/ga4/*"]
    GoogleAdsAPI["api/google-ads/*"]
    InstagramAPI["api/instagram/*"]
    ServerActions["server/actions/*"]
  end

  subgraph Data["Supabase PostgreSQL（テーブル詳細は database.types.ts。未適用マイグレーションは database.types.pending.ts）"]
    UserData["users / chat_sessions / chat_messages"]
    ContentData["briefs / content_annotations / session_heading_sections / session_combined_contents"]
    IntegrationData["gsc_* / ga4_* / google_ads_* / instagram_credentials / instagram_media / instagram_account_insights_daily / wordpress_settings"]
    AdminData["prompt_templates / prompt_versions"]
  end

  subgraph External["外部 API"]
    Anthropic["Anthropic"]
    OpenAI["OpenAI"]
    WordPress["WordPress REST"]
    GSC["GSC API"]
    GA4["GA4 API"]
    GoogleAds["Google Ads API"]
    Instagram["Instagram Graph API"]
  end

  AuthShell --> ProxyGate
  ProxyGate --> AuthMiddleware
  ChatUI --> ChatAPI
  Canvas --> ChatAPI
  HeadingFlow --> ServerActions
  Annotation --> ServerActions
  Analytics --> ServerActions
  BusinessForm --> ServerActions
  AdminUI --> ServerActions
  GscSetup --> GscAPI
  AnalyticsDetail --> GscAPI
  Ga4Dashboard --> Ga4API
  GoogleAdsDashboard --> GoogleAdsAPI
  InstagramSetup --> InstagramAPI
  AnalyticsDetail --> ServerActions
  Ga4Dashboard --> ServerActions
  GoogleAdsDashboard --> ServerActions

  ServerActions --> UserData
  ServerActions --> ContentData
  ChatAPI --> UserData
  WordPressAPI --> IntegrationData
  AdminAPI --> AdminData
  GscAPI --> IntegrationData
  GscCron --> IntegrationData
  Ga4API --> IntegrationData
  GoogleAdsAPI --> IntegrationData
  InstagramAPI --> IntegrationData

  ChatAPI --> Anthropic
  ChatAPI --> OpenAI
  WordPressAPI --> WordPress
  GscAPI --> GSC
  GscCron --> GSC
  Ga4API --> GA4
  GoogleAdsAPI --> GoogleAds
  InstagramAPI --> Instagram
```

GSC の連携状態・プロパティ・インポート等は **[`src/server/actions/`](src/server/actions/)** の `gsc*.actions.ts` が中心。OAuth の HTTP 開始/コールバックは [`app/api/gsc/`](app/api/gsc) を参照。

Instagram 連携のセットアップ・プレビューは **`instagramSetup.actions.ts`**、手動データ同期は **`instagramSync.actions.ts`**（[`instagramSyncService.ts`](src/server/services/instagramSyncService.ts) / [`instagramMediaService.ts`](src/server/services/instagramMediaService.ts)）。OAuth の HTTP 開始/コールバックは [`app/api/instagram/`](app/api/instagram) を参照。

## 🛠️ 技術スタック

npm 依存のバージョンは **[`package.json`](package.json)** を正とし、ロックされた解決結果は **[`package-lock.json`](package-lock.json)** を参照してください。以下は名称の列挙のみです。

### フロントエンド

- **フレームワーク**: Next.js 16（App Router）, React 19, TypeScript
- **スタイリング**: Tailwind CSS 4, Radix UI, shadcn/ui, lucide-react, tw-animate-css（バージョンは `package.json`）
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

- **Supabase Auth + @supabase/ssr**: メール OTP・セッション（主系）
- **Resend**: SMTP（送信元は運用で固定。例: `noreply@mail.growmate.tokyo`）
- **OAuth / API**: WordPress.com、Google（GSC / GA4 / Ads）、Instagram Graph、WordPress REST、各種 Google API（用途はコード参照）

### 開発ツール

- **型チェック**: TypeScript strict mode
- **リンター**: ESLint, eslint-config-next
- **AI開発workflow**: Takt `0.58.0`（Node.js `>=24.15.0`。workflow変更後は `takt workflow doctor` で検証）
- **コード整形**: `.prettierrc`（エディタ向け。Prettier は npm 依存に未登録）
- **ビルド**: Turbopack（開発）/ Next.js build
- **テスト**: Vitest、`@vitest/coverage-v8`（コアロジック・入力バリデーション）
- **依存関係解析**: Knip

### 依存関係の追加・削除方針

- 新規ライブラリは、標準 API・既存依存・小さな自前実装では代替しにくい場合だけ追加する。
- 追加前に用途、実行面（runtime / dev）、保守状況、推移的依存の増加を確認する。
- 削除候補は `npm run knip` だけで判断せず、`npm run build` で peer / runtime 依存も確認する。
- `overrides` は脆弱性回避など理由が明確なものだけ残し、対象パッケージが lockfile から消えたら削除する。

## 📊 データベーススキーマ

**列・型・外部キー**は Supabase から生成した **[`src/types/database.types.ts`](src/types/database.types.ts)** の `Database['public']['Tables']` を正とする（マイグレーション後は [`package.json`](package.json) の `npm run supabase:types` で再生成）。**リモート未適用のマイグレーション**がある場合は **[`src/types/database.types.pending.ts`](src/types/database.types.pending.ts)** に暫定型を定義し、適用・型再生成後に削除する（詳細は [`.agents/skills/supabase/service-usage.md`](.agents/skills/supabase/service-usage.md) §6）。**ビジュアルなテーブル関係**は Supabase Dashboard の Database / Table Editor を参照。

## 📋 環境変数

`.env.local` を手動で用意する。**必須キー・任意キーの一覧と型**は [`src/env.ts`](src/env.ts) の `clientEnvSchema` / `serverEnvSchema` を正とする（README の表はメンテしない）。`src/env.ts` を利用するモジュールでは起動時に Zod で検証された `env` プロキシを参照する。一部の既存コードと運用スクリプトは `process.env` を直接参照している。

ざっくり区分だけ:

- **Supabase・サイト URL**: `NEXT_PUBLIC_SUPABASE_*`, `NEXT_PUBLIC_SITE_URL`, `SUPABASE_SERVICE_ROLE`
- **AI**: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`
- **メール送信**: `RESEND_API_KEY`（任意・本番 OTP 送信に必要）, `EMAIL_FROM`
- **OAuth（連携時）**: `GOOGLE_OAUTH_*`, `GOOGLE_SEARCH_CONSOLE_REDIRECT_URI`, `WORDPRESS_COM_*`, `WORDPRESS_COM_REDIRECT_URI`, 任意で `COOKIE_SECRET`

### `src/env.ts` に含まれないが `process.env` 直接参照

| 変数名 | 必須 | 用途 |
| ------ | ---- | ---- |
| `CRON_SECRET` | 任意（`/api/cron/*` バッチを使う場合は必須） | Cron バッチの Bearer 認証（`gsc-evaluate` / `gsc-suggestions` / `google-ads-negative-keywords-suggestion`） |
| `GOOGLE_ADS_REDIRECT_URI` | 任意（Google Ads OAuth 利用時は必須） | [`app/api/google-ads/oauth/`](app/api/google-ads/oauth) |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | 任意（Google Ads API 利用時は必須） | [`src/server/services/googleAdsService.ts`](src/server/services/googleAdsService.ts) |
| `EMAIL_FROM` | 任意（未設定時は既定の送信元にフォールバック） | [`src/server/services/emailService.ts`](src/server/services/emailService.ts) の送信元アドレス |
| `GSC_QUERY_ROW_LIMIT` | 任意（未設定時は既定値） | [`src/server/lib/gsc-config.ts`](src/server/lib/gsc-config.ts) のクエリ取得行数上限 |
| `INSTAGRAM_APP_ID` | 任意（Instagram OAuth 利用時は必須） | [`app/api/instagram/oauth/`](app/api/instagram/oauth) |
| `INSTAGRAM_APP_SECRET` | 任意（Instagram OAuth 利用時は必須） | 同上 |
| `INSTAGRAM_REDIRECT_URI` | 任意（Instagram OAuth 利用時は必須） | 同上 |
| `INSTAGRAM_SYNC_ENABLED` | 任意（未設定または `true` で有効。`false` で手動同期を停止し UI に告知。一覧は既存 DB データを表示） | [`src/server/lib/instagram-sync-config.ts`](src/server/lib/instagram-sync-config.ts) |
| `REVIEW_LOGIN_EMAIL` | 任意（App Review 期間のみ設定。審査終了後は削除して経路を塞ぐ） | [`app/review-login/page.tsx`](app/review-login/page.tsx), [`src/server/actions/auth.actions.ts`](src/server/actions/auth.actions.ts) の `signInWithReviewPassword`。**撤去時はこの行と併せて以下も削除する**: [`src/components/ReviewLoginForm.tsx`](src/components/ReviewLoginForm.tsx) / [`proxy.ts`](proxy.ts) と [`src/lib/public-paths.ts`](src/lib/public-paths.ts) の `/review-login` / [`src/domain/errors/error-messages.ts`](src/domain/errors/error-messages.ts) の `REVIEW_LOGIN_*` / `tests/unit/server/actions/reviewLogin.actions.test.ts` / `tests/unit/lib/public-paths.test.ts` の `/review-login` ケース / [`src/components/AuthProvider.tsx`](src/components/AuthProvider.tsx) の `FULL_NAME_DIALOG_PATHS` |
| `NEXT_PUBLIC_APP_URL` | 任意（内部 API 呼び出しのベース URL） | [`src/server/actions/adminUsers.actions.ts`](src/server/actions/adminUsers.actions.ts) |
| `VERCEL_URL` | Vercel が自動設定 | [`src/server/middleware/authMiddlewareGuards.ts`](src/server/middleware/authMiddlewareGuards.ts) の許可オリジン判定 |

追加・リネーム時は **`env.ts` の更新と README の「区分」行の見直し**が必要（フル一覧はソースを見ろ、という運用）。

## 🚀 セットアップ手順

```bash
# GrowMateアプリ: Node.js 20以上
# Takt 0.58.0: Node.js 24.15.0以上
npm ci
# .env.local を作成し、src/env.ts の clientEnvSchema / serverEnvSchema を参照してキーを埋める
npm run dev  # http://localhost:3000
```

### 仕様確認フロー

新規機能は、標準 Grill Me による要件確認・Gherkin承認・概算工数と着手判断・要件定義・仕様レビュー・実装の順に進めます。詳細は [`docs/development-workflow.md`](docs/development-workflow.md) を参照してください。

```bash
takt -w grill-to-gherkin -t "実装したい機能の概要"
```

> **Supabase 注意**: 本番と開発で同一プロジェクトを共有しています。`npx supabase db push` をリモートに対して実行しないこと。スキーマ変更は `supabase/migrations/` にコミットし、適用は管理者が行います。

> **GA4コンテンツ評価の運用**: 管理者が `/admin/prompts` で文章化テンプレートを登録したうえで評価を実行する。評価の可否はロール（`admin` / `paid`）とデータ充足で決まり、DB Kill Switch は使わない。

初回セットアップ後は Supabase の `users` テーブルで自分のロールを `admin` に変更し、`/business-info` で事業者情報を登録してください。Google / WordPress / Google Ads の詳細手順は [`docs/specs/`](docs/specs/) を参照。Instagram 連携の設計・OAuth 要件は [`docs/plans/instagram-integration-design.md`](docs/plans/instagram-integration-design.md) を参照。

### よく使う npm scripts

| コマンド | 用途 |
| -------- | ---- |
| `npm run dev` | 開発サーバー（Turbopack） |
| `npm run dev:types` | 型チェック watch |
| `npm run test` | Vitestによるコアロジック・入力バリデーションのテスト |
| `npm run test:coverage` | Vitestのカバレッジ計測（閾値によるCI強制なし） |
| `npm run verify` | audit → lint → test → build → knip |
| `npm run supabase:types` | `database.types.ts` 再生成 |
| `npm run verify:agent-skills` | Agent Skills 静的検証 |
| `npm run db:stats` / `vercel:stats` / `active:users` | 運用統計（要 `.env.local`） |

## ✅ 動作確認

`npm audit --audit-level=high`、`npm run lint`、`npm run test`、`npm run build`、`npm run knip` で基本チェック（5点まとめは `npm run verify`）。コアロジックと分離済みZodスキーマはVitest、UIの表示・操作感・導線と外部APIを含む実画面は人間の目視で確認する。Agent Skills を変更した場合は `npm run verify:agent-skills` も実行する。husky で **pre-commit に lint、pre-push に test + build + knip** を配置し、CIでも`npm audit --audit-level=high` / lint / test / build / knipを実行する。各機能の詳細な検証手順は [`quality-gate`](.agents/skills/quality-gate/SKILL.md) スキルを参照。

## 📁 プロジェクト構成（概要）

| パス | 内容 |
| ---- | ---- |
| [`app/`](app/) | App Router（画面 + [`app/api/`](app/api) の Route Handlers）。細目はリポジトリ上のツリー参照 |
| [`proxy.ts`](proxy.ts) | Next.js 16 のリクエスト前処理（旧 `middleware.ts` 相当）。Supabase セッション更新・CSP・ロール別ゲート |
| [`src/components/`](src/components/) | UI |
| [`src/hooks/`](src/hooks/) | チャット・キャンバス・見出しフロー等のクライアント hooks |
| [`src/domain/`](src/domain/) | ドメインモデル・エラー・クライアント向けサービス IF |
| [`src/lib/`](src/lib/) | 定数・Supabase クライアント補助・バリデータ等 |
| [`src/server/actions/`](src/server/actions/) | Server Actions（`*.actions.ts` がドメインごとに並ぶ） |
| [`src/server/services/`](src/server/services/) | サーバー統合層（LLM / WordPress / GSC / GA4 / Google Ads / Instagram（setup・sync・media 等）） |
| [`src/server/middleware/`](src/server/middleware/) | `authMiddleware` 等 |
| [`tests/unit/`](tests/unit/) | Vitestユニットテスト（`lib/`・`server/schemas/`） |
| [`supabase/migrations/`](supabase/migrations/) | DB マイグレーション |
| [`docs/context/`](docs/context/) | クライアント文脈・開発上の判断基準・調査知見 |
| [`docs/specs/`](docs/specs/) | 機能仕様書・要件定義（実装状況は各文書を参照） |
| [`docs/plans/`](docs/plans/) | 実装予定・設計中の仕様書 |
| [`docs/templates/`](docs/templates/) | 要件定義などの仕様書テンプレート |
| [`docs/runbooks/`](docs/runbooks/) | 運用手順書 |
| [`scripts/`](scripts/) | DB・Vercel 統計、Cron、Skill 検証等の運用スクリプト |
| [`.agents/skills/`](.agents/skills/) | AI エージェント向け Skill 正本（Codex / Claude Code / Cursor 共通） |
| [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md) | エージェント共通運用ルール（`AGENTS.md`は`CLAUDE.md`のsymlink） |
| [`.takt/`](.takt/) | 要件確認（`grill-to-gherkin.yaml`）・仕様書レビュー（`spec-review.yaml`）・仕様書起点 PR（`spec-to-pr.yaml`） |

## 🛡️ セキュリティと運用の注意点

- Supabase では主要テーブルに RLS を適用済み（開発ポリシーが残る箇所は運用前に見直す）
- [`proxy.ts`](proxy.ts) が Supabase セッション更新・CSP ヘッダ付与・ロール別リダイレクト（`/admin`・`/analytics`・`/setup` 等）を担当。`authMiddleware` は Server Actions / Route Handlers 側でメールセッションを解決する
- `get_accessible_user_ids` と関連 RLS / RPC は一部テーブルで残存しており、旧共有アクセス構成の互換レイヤーとして機能している
- WordPress.com の OAuth アクセストークンは HTTP-only Cookie と `wordpress_settings` に保存し、Application Password 等の設定値も `wordpress_settings` に保存する（現状は平文のため、本番では KMS / Secrets 管理への移行を推奨）
- SSE は 20 秒ごとの ping と 5 分アイドルタイムアウトで接続維持を調整
- `AnnotationPanel` の URL 正規化で内部／ローカルホストへの誤登録を防止

## 📱 デプロイと運用

- Vercel を想定。一部の Route Handler は Node.js Runtime を明示し、その他は Next.js のデフォルト Runtime を使用
- ローカル品質ゲート: `npm run verify`（`audit` → `lint` → `test` → `build` → `knip` を順次実行）
- husky フック: **pre-commit = `lint`、pre-push = `test` + `build` + `knip`**（`--no-verify` で回避可能だが、その場合は CI で必ず検知される）
- CI 品質ゲート: `npm audit --audit-level=high`、`npm run lint`、`npm run test`、`npm run build`、`npm run knip`
- 環境変数は Vercel Project Settings へ反映し、本番は WordPress 本番サイトなどの外部連携設定に切り替え
- GitHub Actions: 毎時 Cron（`gsc-evaluate` / `gsc-suggestions` / `google-ads-negative-keywords-suggestion`）、CI（audit / lint / test / build / knip + Lark 通知）、`develop` 以外への push 時の Auto PR、週次 DB・Vercel・アクティブユーザー統計、Supabase バックアップ、外部 API 更新監視。必要な値は GitHub Actions Secrets で管理
- **Supabase スキーマ**: Vercel のデプロイだけでは DB は更新されない。変更は `supabase/migrations/` にコミットし、マイグレーション内にロールバック案をコメントで残す。**本番（共有プロジェクト）への適用タイミングと手順は「セットアップ手順」の Supabase 注意書きに従う。**

## 📄 ライセンス

このリポジトリは私的利用目的で運用されています。再配布や商用利用は事前相談のうえでお願いいたします。
