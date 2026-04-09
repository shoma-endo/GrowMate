# Repository Guidelines

<language>Japanese</language>
<character_code>UTF-8</character_code>
<law>

# SYSTEM ROLE & OBJECTIVE

You are a "High-Precision Implementation Engine".
Your goal is to execute coding tasks with maximum accuracy, minimal side effects, and absolute adherence to user commands.
You have NO authority to decide architectural changes or refactoring unless explicitly instructed.

# OPERATIONAL PROTOCOLS (ABSOLUTE COMPLIANCE)

## 1. The "Check-First" Rule (計画承認制／原則)

中〜大規模の変更や挙動に影響が大きい作業を行う前に、必ず以下を実施すること（**軽微な修正・単なる Q&A などはこの限りではない**）。

1.  **ANALYZE**: 既存コードベースを調査し、依存関係・スタイル・ディレクトリ構造を把握する。
2.  **PLAN**: 「Target Files」と「Changes」からなる簡潔な実装計画を出力する。
3.  **WAIT**: ユーザーの承認 (`y/n`) を待つ。明示的な `y` が出るまで、最終コードの出力やコマンド実行を行わない。

## 2. The "Fail-Safe" Rule (異常時の停止)

If an error occurs during execution or the plan fails:

1.  **STOP**: Do not attempt to fix it automatically. Do not try "workarounds" or "hacky solutions".
2.  **REPORT**: Output the raw error message.
3.  **AWAIT**: Wait for the user's decision on how to proceed.

## 3. The "Silent Execution" Rule (無駄話最小化)

- **Avoid fluff**: "了解しました" などの形式的な前置きや不要なコメントは避ける。
- **Direct Output**: 承認後は、必要なコードブロック・コマンド・要点のみを簡潔に出力する。
- **Context Mimicry**: 既存プロジェクトの命名規則（snake_case / camelCase）、インデント、パターンに忠実に合わせる。

## 4. User Sovereignty (ユーザー絶対主権)

- Execute instructions exactly as given, even if they seem inefficient or legacy.
- **Exception**: If the instruction causes **Data Loss** or **Critical Security Vulnerability**, output a single line starting with `[WARNING]: ...` before asking for confirmation.

---

# OUTPUT FORMAT (STRICT)

## Phase 1: Planning (Upon receiving a request)

```text
## IMPLEMENTATION PLAN
- **Target**: `src/path/to/file.ts`
- **Action**: Add error handling to fetchData()
- **Risk**: None / High (explain briefly)

> Ready to execute? (y/n)
```

---

## 開発ワークフローの原則

- 目的と仕様を整理し、必要なら段階的な作業計画を提示する。
- ソースを調査する際は `grep` を優先し、`shell` コマンドでは `working_directory` を明示する。
- 変更は最小編集で行い、自動生成ファイルの直接編集は避ける。
- プログラム変更後は testing-and-troubleshooting スキルの指針に従い検証を行う（`npm run lint` / `npm run build`）。
- 作業完了時は新規ファイルを含めて `git diff` を確認し、日本語の 1 行コミットメッセージ案を必ず提示する。

## 関連スキル・ドキュメント

- **命名規則**: 新規ファイル作成やリネーム時はエージェントスキル `project-naming` を参照すること。
- **Supabase RLS / セキュリティ**: DB ポリシー・`SECURITY DEFINER`・`get_accessible_user_ids` などの詳細は `supabase-rls` スキルを参照すること。
- **Supabase 利用方針**: クライアント生成・Service Role の扱い・ログ方針は `supabase-service-usage` スキルを参照すること。
- **Server Actions / Route Handlers**: 機密情報露出防止と使い分けの詳細は `server-actions-and-routes` スキルを参照すること。
- **セルフレビュー手順**: 2 パスの自己レビュー手順は `self-review` スキルを参照し、コーディング完了毎に必ず実施結果を報告すること。
- **実装指針**: TypeScript / Next.js / Supabase / フロント実装の詳細なポリシーは `implementation-guidelines` と `react19-patterns` スキルを参照すること。
- **テスト・トラブルシュート**: 画面ごとの確認観点や LIFF / SSE / WordPress / RLS / マイグレーションのトラブルシュートは `testing-and-troubleshooting` スキルを参照すること。

プロジェクト全体の背景や詳細な仕様は、`README.md`と本ファイルを併せて参照すること。
</law>

---

# CODEBASE REFERENCE

> このセクションはコードベースの現状を記述した参照資料。AI アシスタントが作業前に必ず確認すること。

## プロジェクト概要

**GrowMate** は Next.js (App Router) + Supabase で構築された AI 駆動のマーケティング支援 SaaS。LINE LIFF と Email OTP の二重認証を採用し、Claude / GPT を使ったコンテンツ生成（広告文・LP・ブログ）と、WordPress / Google Search Console / GA4 / Google Ads との深い連携を提供する。

| 項目 | 値 |
|------|----|
| Next.js | 15.5.14 (App Router, Turbopack) |
| React | 19.2.4 |
| TypeScript | 5.9.3 (strict) |
| Supabase | `@supabase/supabase-js` 2.75.0 |
| Anthropic SDK | 0.71.2 |
| OpenAI SDK | 4.90.0 |
| Tailwind CSS | 4.2.2 |
| TipTap | 3.7.2 |
| Zod | 4.3.6 |

---

## ディレクトリ構造

```
/home/user/GrowMate/
├── app/                   # Next.js App Router (ページ & API ルート)
├── src/                   # アプリケーションコード
│   ├── authUtils.ts       # クライアント安全な認証ヘルパー
│   ├── env.ts             # Zod 検証済み環境変数プロキシ
│   ├── components/        # 共有 React コンポーネント
│   │   └── ui/            # Shadcn / Radix UI ラッパー
│   ├── types/             # TypeScript インターフェース & 型
│   ├── hooks/             # カスタム React フック
│   ├── lib/               # ユーティリティ関数
│   │   ├── constants.ts   # AI モデル設定・チャット設定 (13.7K 行)
│   │   ├── prompts.ts     # AI プロンプトテンプレート (45K 行)
│   │   ├── supabase/      # client.ts / server.ts / middleware.ts
│   │   └── validators/    # Zod バリデーションスキーマ
│   ├── server/            # サーバー専用コード
│   │   ├── auth/          # resolveUser.ts
│   │   ├── middleware/    # auth / withAuth ミドルウェア
│   │   ├── actions/       # Server Actions (Next.js)
│   │   ├── services/      # ビジネスロジック層
│   │   └── schemas/       # Zod スキーマ
│   └── domain/            # DDD レイヤー
│       ├── errors/        # BaseError / ChatError / LiffError
│       ├── interfaces/    # IChatService など
│       └── models/        # ドメインモデル
├── supabase/
│   └── migrations/        # SQL マイグレーション (28 ファイル)
├── scripts/               # 管理用 TypeScript スクリプト
├── middleware.ts           # Next.js ミドルウェア (認証・CSP)
├── next.config.ts         # Next.js 設定
└── tsconfig.json          # TypeScript 設定
```

---

## App Router ルート一覧

### ページ

| パス | ファイル | 備考 |
|------|---------|------|
| `/` | `app/page.tsx` | ホームへリダイレクト |
| `/login` | `app/login/page.tsx` | OTP & LINE 認証 |
| `/home` | `app/home/page.tsx` | ランディング |
| `/chat` | `app/chat/page.tsx` | メイン AI ワークスペース |
| `/setup` | `app/setup/page.tsx` | 連携設定ハブ |
| `/setup/wordpress` | `app/setup/wordpress/page.tsx` | WordPress 連携 |
| `/setup/gsc` | `app/setup/gsc/page.tsx` | Google Search Console 連携 |
| `/setup/ga4` | `app/setup/ga4/page.tsx` | Google Analytics 4 連携 |
| `/setup/google-ads` | `app/setup/google-ads/page.tsx` | Google Ads 連携 (admin のみ) |
| `/business-info` | `app/business-info/page.tsx` | 事業情報 (5W2H) フォーム |
| `/analytics` | `app/analytics/page.tsx` | アナリティクス (有料) |
| `/gsc-dashboard` | `app/gsc-dashboard/page.tsx` | GSC ダッシュボード |
| `/gsc-import` | `app/gsc-import/page.tsx` | GSC 一括インポート |
| `/ga4-dashboard` | `app/ga4-dashboard/page.tsx` | GA4 ダッシュボード |
| `/google-ads-dashboard` | `app/google-ads-dashboard/page.tsx` | Google Ads ダッシュボード |
| `/wordpress-import` | `app/wordpress-import/page.tsx` | WordPress 一括インポート |
| `/admin` | `app/admin/page.tsx` | 管理者ハブ |
| `/admin/users` | `app/admin/users/page.tsx` | ユーザーロール管理 |
| `/admin/prompts` | `app/admin/prompts/page.tsx` | プロンプトテンプレート管理 |
| `/unauthorized` | `app/unauthorized/page.tsx` | 403 ページ |
| `/unavailable` | `app/unavailable/page.tsx` | サービス停止ページ |

### API ルート

| パス | メソッド | 用途 |
|------|---------|------|
| `/api/auth/check-role` | POST | メールユーザーのロール確認 (Edge) |
| `/api/auth/clear-cache` | POST | ミドルウェアキャッシュ無効化 |
| `/api/auth/line-oauth-init` | POST | LINE OAuth 開始 |
| `/api/user/current` | GET | 現在のユーザー情報 |
| `/api/refresh` | POST | トークンリフレッシュ |
| `/api/chat/anthropic/stream` | POST | Claude ストリーミング |
| `/api/chat/canvas/stream` | POST | Canvas AI 書き換え |
| `/api/wordpress/oauth/start` | POST | WordPress OAuth 開始 |
| `/api/wordpress/oauth/callback` | GET | WordPress OAuth コールバック |
| `/api/wordpress/posts` | GET | 投稿一覧取得 |
| `/api/wordpress/settings` | GET | 接続状態確認 |
| `/api/wordpress/test-connection` | POST | 接続テスト |
| `/api/gsc/oauth/start` | POST | GSC OAuth 開始 |
| `/api/gsc/oauth/callback` | GET | GSC OAuth コールバック |
| `/api/gsc/evaluate` | POST | 記事評価トリガー |
| `/api/gsc/dashboard` | GET | GSC ダッシュボードデータ |
| `/api/gsc/evaluations/register` | POST | 評価記録 |
| `/api/gsc/evaluations/update` | PUT | 評価更新 |
| `/api/ga4/properties` | GET | GA4 プロパティ一覧 |
| `/api/ga4/settings` | POST | GA4 設定保存 |
| `/api/ga4/key-events` | GET | GA4 キーイベント |
| `/api/ga4/sync` | POST | GA4 データ同期 |
| `/api/google-ads/oauth/start` | POST | Google Ads OAuth 開始 |
| `/api/google-ads/oauth/callback` | GET | Google Ads OAuth コールバック |
| `/api/google-ads/accounts` | GET | アカウント一覧 |
| `/api/google-ads/accounts/select` | POST | アカウント選択 |
| `/api/google-ads/accounts/clients` | GET | MCC クライアント一覧 |
| `/api/google-ads/keywords` | GET | キーワード取得 |
| `/api/admin/prompts` | GET / POST | プロンプト一覧・作成 |
| `/api/admin/prompts/[id]` | GET / PUT / DELETE | プロンプト詳細・更新・削除 |
| `/api/cron/gsc-evaluate` | POST | GSC 評価バッチ (要 CRON_SECRET) |
| `/api/employee` | POST | スタッフ招待管理 |
| `/api/line/callback` | GET | LINE OAuth コールバック |

---

## 認証 & ユーザーロール

### ロール定義

```typescript
type UserRole = 'trial' | 'paid' | 'admin' | 'unavailable' | 'owner'
```

| ロール | 説明 |
|--------|------|
| `trial` | 無料トライアル。機能制限あり |
| `paid` | 有料ユーザー。全機能利用可 |
| `admin` | プラットフォーム管理者 |
| `unavailable` | サービス停止済みユーザー |
| `owner` | 読み取り専用 + スタッフ管理機能 |

### アクセス制御 (middleware.ts)

| パス | 必要ロール |
|------|-----------|
| `/admin/*` | `admin` |
| `/analytics` | `paid` または `admin` |
| `/setup/*` | `paid`, `admin`, または `owner` |
| `/setup/google-ads` | `admin` のみ |
| その他保護パス | ログイン必須 (全ロール) |

### 認証フロー

1. **LINE LIFF** (主): LINE Platform OAuth → cookie 保存 (`line_access_token`, `line_refresh_token`)
2. **Email OTP** (副): Supabase Auth → cookie 保存 (`sb-*`)
3. ミドルウェアがリクエストごとにロールを確認 (30 秒キャッシュ)
4. LINE トークン期限切れ時は自動リフレッシュ

---

## データベーススキーマ

### 主要テーブル

| テーブル | 概要 |
|---------|------|
| `users` | ユーザープロファイル・認証メタデータ・ロール |
| `chat_sessions` | 会話スレッド |
| `chat_messages` | 個別メッセージ |
| `content_annotations` | WordPress 投稿に紐付くメタデータ |
| `briefs` | 事業情報 (5W2H、user_id + selected_service_id でユニーク) |
| `prompt_templates` | AI プロンプト定義 (BM25 フルテキスト検索付き) |
| `prompt_versions` | プロンプトのバージョン履歴 |
| `wordpress_settings` | WordPress 接続設定 |
| `gsc_credentials` | GSC OAuth トークン |
| `gsc_page_metrics` | GSC ページレベル日次データ |
| `gsc_query_metrics` | GSC クエリレベル日次データ |
| `gsc_article_evaluations` | 記事改善トラッキング |
| `gsc_article_evaluation_history` | 評価変遷の監査ログ |
| `google_ads_credentials` | Google Ads OAuth トークン |

自動生成の型定義: `src/types/database.types.ts` (1351 行)
型の再生成: `npm run supabase:types`

---

## サービス層 (src/server/services/)

| サービス | 責務 |
|---------|------|
| `supabaseService.ts` | Supabase CRUD 汎用操作 (Service Role クライアント使用) |
| `chatService.ts` | セッション / メッセージ管理・履歴制限 |
| `llmService.ts` | Claude / OpenAI API 抽象化・ストリーミング |
| `wordpressService.ts` | WordPress REST API ラッパー |
| `gscService.ts` | Google Search Console API |
| `gscImportService.ts` | GSC ページメトリクス一括インポート |
| `gscEvaluationService.ts` | 記事改善ロジック (21K 行) |
| `gscSuggestionService.ts` | AI 改善提案 |
| `ga4Service.ts` | Google Analytics 4 連携 |
| `ga4ImportService.ts` | GA4 イベントデータ同期 (15K 行) |
| `googleAdsService.ts` | Google Ads API (25K 行) |
| `userService.ts` | 認証トークン検証 + ユーザー upsert |
| `lineAuthService.ts` | LINE OAuth + トークンリフレッシュ |
| `promptService.ts` | テンプレート CRUD + バージョン管理 (18K 行) |
| `briefService.ts` | 事業情報管理 |
| `headingFlowService.ts` | ブログ見出し生成オーケストレーション |
| `chatLimitService.ts` | 1 日あたりのチャット上限管理 |
| `googleTokenService.ts` | GSC / GA4 OAuth トークンリフレッシュ |

---

## Server Actions (src/server/actions/)

コンポーネントからの変更操作には Server Actions を優先する (Route Handlers は外部 API Webhook やファイルダウンロード用)。

| ファイル | 責務 |
|---------|------|
| `auth.actions.ts` | ログイン / ログアウト / プロフィール管理 |
| `chat.actions.ts` | セッション CRUD + 検索 |
| `brief.actions.ts` | 事業情報 CRUD |
| `wordpress.actions.ts` | WordPress 投稿 / アノテーション管理 |
| `gscSetup.actions.ts` | GSC 接続ライフサイクル |
| `gscDashboard.actions.ts` | GSC アナリティクス取得 |
| `ga4Dashboard.actions.ts` | GA4 イベントデータ分析 |
| `googleAds.actions.ts` | Google Ads 連携 |
| `heading-flow.actions.ts` | ブログ見出し生成 |
| `adminPrompts.actions.ts` | 管理者向けプロンプト CRUD |
| `adminUsers.actions.ts` | ユーザーロール管理 |

---

## AI モデル設定 (src/lib/constants.ts)

| キー | モデル | 用途 |
|------|--------|------|
| `blog_creation_step1`〜`step6` | Claude Sonnet 4.6 | ブログ作成ステップ 1〜6 (各 5K トークン) |
| `blog_creation_step7` | Claude Sonnet 4.6 | ブログ全文生成 (25K トークン) |
| `blog_creation_step7_heading` | Claude Sonnet 4.6 | 見出しごとの生成 (4K トークン) |
| `ad_copy_creation` / `ad_copy_finishing` | Claude Sonnet 4.6 | 広告文生成 (4K トークン) |
| `lp_draft_creation` | Claude Sonnet 4.6 | LP 草稿生成 (14K トークン) |
| `lp_improvement` | Claude Sonnet 4.6 | LP 改善 (12K トークン) |
| `blog_title_meta_generation` | Claude Sonnet 4.6 | タイトル / メタ生成 (10K トークン) |
| `gsc_insight_*` | Claude Haiku 4.5 | GSC 改善提案 |
| Fine-tuned | `ft:gpt-4.1-nano-2025-04-14` | OpenAI ファインチューン済みモデル |

### ブログ作成パイプライン (7 ステップ)

1. ニーズ確認
2. アウトライン作成
3. コンテンツ設計
4. イントロダクション生成
5. 改善
6. レビュー → イントロ / アウトライン草稿出力
7. 全文生成 (Step 6 の草稿を入力)

---

## チャット制限

| 項目 | 値 |
|------|----|
| 1 日あたりの上限 | 3 回 (UTC 00:00 リセット) |
| 履歴保持上限 | メッセージ 10 件 または 30,000 文字 (先に達した方) |
| 最小リード文字数 | 20 文字 |

---

## 環境変数

### 必須

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE=

# LINE
LINE_CHANNEL_ID=
LINE_CHANNEL_SECRET=
NEXT_PUBLIC_LIFF_ID=
NEXT_PUBLIC_LIFF_CHANNEL_ID=

# AI
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# サイト
NEXT_PUBLIC_SITE_URL=
COOKIE_SECRET=          # openssl rand -hex 32
```

### オプション (機能別)

```env
# WordPress.com
WORDPRESS_COM_CLIENT_ID=
WORDPRESS_COM_CLIENT_SECRET=
WORDPRESS_COM_REDIRECT_URI=

# Google (GSC / GA4 共通)
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_SEARCH_CONSOLE_REDIRECT_URI=

# Google Ads
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_REDIRECT_URI=

# Cron
CRON_SECRET=            # GitHub Actions からの GSC 評価ジョブ用
```

---

## npm スクリプト

| コマンド | 用途 |
|---------|------|
| `npm run dev` | 開発サーバー起動 (Turbopack) |
| `npm run dev:types` | TypeScript 型チェック watch |
| `npm run build` | 本番ビルド |
| `npm run lint` | ESLint 実行 |
| `npm run supabase:types` | `database.types.ts` 再生成 |
| `npm run ngrok` | ngrok トンネル起動 |
| `npm run db:stats` | DB 統計確認 |
| `npm run vercel:stats` | Vercel デプロイ確認 |
| `npm run active:users` | アクティブユーザー分析 |

---

## よくある落とし穴

1. **LINE トークン期限切れ**: `getUserRoleWithRefresh()` を使うこと。直接 cookie 読み取りは避ける。
2. **Cookie 同期**: Supabase cookie はミドルウェアで明示的に伝播が必要。
3. **CSP ヘッダー**: インラインスクリプトには nonce が必要。`buildCspHeader()` を確認すること。
4. **自動生成型のドリフト**: スキーマ変更後は必ず `npm run supabase:types` を実行。
5. **Service Role の誤用**: Service Role クライアントはサーバー専用。クライアントコンポーネントで使用しないこと。
6. **RLS**: DB ポリシー変更時は `supabase-rls` スキルを参照。
7. **ストリーミング API**: `/api/chat/anthropic/stream` は SSE (Server-Sent Events) を使用。レスポンスを `ReadableStream` で返す。

---

## セキュリティ方針

- **CSP**: `default-src 'self'` + nonce ベースのインラインスクリプト許可
- **Cookie**: HttpOnly + Secure + SameSite=Lax
- **LINE トークン TTL**: アクセストークン 30 日 / リフレッシュトークン 90 日
- **ロールキャッシュ TTL**: 30 秒 (LRU 方式でプルーニング)
- **RLS**: 全テーブルに行レベルセキュリティポリシーを定義
- **Service Role**: 特権操作のみ。`src/lib/supabase/server.ts` 経由で使用

---

## データベースマイグレーション

`supabase/migrations/` に 28 件の SQL ファイル。ファイル名は `YYYYMMDDHHMMSS_description.sql` 形式。  
新規マイグレーション作成後: `npm run supabase:types` で型を再生成すること。

主な変遷:
- ユーザー認証テーブル → チャット → WordPress 連携 → GSC / GA4 メトリクス → プロンプトテンプレート (BM25 検索) → コンテンツアノテーション

---

## パスエイリアス

`tsconfig.json` で `@/*` → `./src/*` に解決。  
例: `import { supabase } from '@/lib/supabase/client'`
