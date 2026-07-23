# Instagram 連携（Business Login for Instagram）設計書

作成日: 2026-07-23 / ステータス: レビュー待ち
クライアント合意: 2026-07-22 定例MTG（Lark minutes `objpyf287e2otlex7a1m8n25`）で「まず連携（審査申請）から進める」ことを合意済み

## 1. 背景・目的

- 現在 [Adzviser](https://adzviser.com/) + スプレッドシートで行っている Instagram のリール・フィード投稿の実績管理を GrowMate に内製化する。
- 取得したインサイトデータを土台に、`/chat` で AI と壁打ちしながらリール台本を作成できる状態を最終ゴールとする。
- Meta の App Review（Advanced Access）に先立ち、**開発者・テスターアカウントで OAuth 連携 → `/me`・`/media`・`/insights` の取得・表示が動く状態**（審査用スクリーンキャストが撮れる状態）を最初のマイルストーンとする。

## 2. スコープ / 非スコープ

### スコープ（取得データ）

| 分類 | 内容 | API |
|------|------|-----|
| アカウント情報 | ig_user_id, username, name, account_type, profile_picture_url, biography, website, followers_count, follows_count, media_count | `GET /me?fields=...` |
| 投稿一覧 | id, media_type (IMAGE/VIDEO/CAROUSEL_ALBUM), media_product_type (FEED/REELS), media_url, thumbnail_url, caption, timestamp, permalink, like_count, comments_count | `GET /me/media?fields=...`（cursor ページネーション） |
| 投稿インサイト | reach, views, likes, comments, saved, shares, total_interactions（リールは加えて ig_reels_avg_watch_time, ig_reels_video_view_total_time） | `GET /{media-id}/insights?metric=...` |
| アカウントインサイト | reach, views, profile_views, website_clicks, accounts_engaged, total_interactions, follower_count（日次） | `GET /me/insights?metric=...&period=day` |

### 非スコープ

- 投稿の公開（content_publish）、コメント管理、DM（メッセージング）、Sharing to Stories/Feed、埋め込み
- ストーリーズのインサイト（メディア取得対象からも除外。将来検討）
- Facebook Login for Business 経路（Facebook ページ紐付け不要な Instagram Login 経路のみ採用）

## 3. Meta API 前提（2026-07 時点、Web で確認済み）

### 3.1 認証フロー（Business Login for Instagram）

1. **認可**: `https://www.instagram.com/oauth/authorize?client_id=...&redirect_uri=...&response_type=code&scope=instagram_business_basic,instagram_business_manage_insights&state=...`
2. **コード交換**: `POST https://api.instagram.com/oauth/access_token`（client_id, client_secret, code, grant_type=authorization_code, redirect_uri）→ 短期トークン（1時間）+ ig_user_id
3. **長期トークン交換**: `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=...&access_token=<短期>` → **60日有効**
4. **リフレッシュ**: `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=<長期>` → さらに60日延長。**発行から24時間以上経過したトークンのみ延長可。期限切れ後は延長不可（再認証が必要）**

Google OAuth との重要な違い: **refresh_token という別トークンは存在しない**。長期トークン自体を期限内に延長し続ける方式。よって `googleTokenService.ensureValidAccessToken`（refresh_token 前提）はそのまま流用できず、Instagram 専用のトークンサービスを新設する。

### 3.2 スコープと審査

- 必要スコープは `instagram_business_basic` + `instagram_business_manage_insights` の2つのみ。
- Advanced Access には App Review が必要。**審査前でも App Dashboard でアプリロール（Instagram Tester 等）に追加したプロアカウントなら全機能が動く** → Phase 1 の動作実証はこれで行う。
- 対象アカウントは Instagram Business / Creator（プロアカウント）必須。Facebook ページ紐付けは不要。
- 審査提出物: スクリーンキャスト（連携 → データ表示の一連の流れ）、利用目的の説明、**プライバシーポリシー URL（`/privacy` に Instagram 追記 — §4 Phase1-9）**、**データ削除手順（連携解除 — §4 Phase1-9 / §5.5）**

### 3.3 制約・注意点

- `impressions` は 2024-07-02 以降作成のメディアで廃止 → `views` を使う。
- アカウントレベル insights の正確な metric 名・period・metric_type は実装時に最新リファレンスを再確認する（ドキュメントが JS レンダリングのため今回未取得。上表は既知情報）。
- **media_url / profile_picture_url は有効期限付き CDN URL**。DB に保存した URL は失効し得るため、一覧表示のサムネイルは同期のたびに更新し、失効時は permalink リンクで代替する（画像の自前ストレージ保存は非スコープ）。
- レート制限あり（app-user 単位）。投稿インサイトはメディア1件につき1コール必要なため、同期対象は**直近 N 件（初期値 50 件）に制限**し、打ち切り時はログに件数を出す（サイレント truncation 禁止）。
- API バージョンはパスに明示（例: `graph.instagram.com/v23.0/...`。実装時に最新安定版を確認）。

## 4. フェーズ分け

### Phase 0: 事前リファクタリング（小、任意→推奨のみ実施）

調査の結果、**大規模な事前リファクタは不要**。OAuth 基盤（`src/server/lib/oauth-state.ts` の HMAC 署名 state 生成・検証）は Google 非依存の汎用実装であり、そのまま4系統目として再利用できる。実施するのは以下のみ:

- **R-1（推奨・成功パスの state 検証のみ）**: `generateOAuthState` / `verifyOAuthState`（`src/server/lib/oauth-state.ts`）は既に汎用化済み。追加共通化対象は **state Cookie の set/検証 + セッション userId 整合チェック** のみを `src/server/lib/oauth-flow.ts` に抽出する。**エラー応答形式・baseUrl 取得・Cookie 名は GSC（JSON）と Google Ads（`?error=` リダイレクト）で既に異なるため、callback 全体の共通化は行わない**。Instagram OAuth は **Google Ads 型（失敗時 `NextResponse.redirect('/setup/instagram?error=...')` + セットアップ画面の ERROR_MAP）** で新規実装し、R-1 で抽出した state 検証ヘルパーのみ再利用する。GSC/Ads 既存 callback の置き換えは本 PR の必須スコープ外（別 PR 可）。
- **R-2（Phase 2 に内包）**: `app/analytics/AnalyticsClient.tsx` のタブ化。既存のブログ一覧を `TabsContent value="blog"` に包む構造変更。`app/ga4-dashboard/Ga4DashboardClient.tsx:435` の Tabs 実装（`grid grid-cols-2` の TabsList）を踏襲。

### Phase 1: OAuth 連携 + 疎通表示（審査前 MVP）

**ゴール: テスターアカウントで 連携 → `/setup/instagram` にプロフィール・投稿・インサイトが表示される。審査スクリーンキャストが撮れる。**

1. Meta 開発者アプリ作成（Instagram API with Instagram Login 製品追加、リダイレクト URI 登録、Instagram Tester 追加）— 手動作業
2. `instagram_credentials` テーブル（§5）+ RLS
3. OAuth ルート（**エラー UX 正本: Google Ads 型**。`app/api/google-ads/oauth/callback/route.ts` + `app/setup/google-ads/page.tsx` の ERROR_MAP パターン。state 検証のみ `oauth-state.ts` / R-1 の `oauth-flow.ts` を参照。GSC callback は JSON 応答のため OAuth エラー UX の参照に使わない）:
   - `app/api/instagram/oauth/start/route.ts` — `generateOAuthState(userId, cookieSecret)` で state 生成、Cookie `ig_oauth_state`（httpOnly, sameSite=lax, 15分）、`www.instagram.com/oauth/authorize` へ 302
   - `app/api/instagram/oauth/callback/route.ts` — state 検証（Cookie 一致 + `verifyOAuthState` + userId 整合）→ コード交換 → 即長期トークン交換 → `/me` でプロフィール取得 → `saveInstagramCredential`（Service Role）→ 成功時 `/setup/instagram?connected=1` へ 302。失敗時は **常に** `/setup/instagram?error=<種別>` へ 302（`access_denied` / `state_cookie_mismatch` / `invalid_state` / `token_exchange_failed` / `not_professional_account` / `server_error` 等）。JSON 500 は環境変数未設定など callback 自体が起動不能な場合のみ
4. サービス層:
   - `src/server/services/instagramService.ts` — Graph API クライアント（exchangeCodeForTokens / exchangeForLongLivedToken / refreshLongLivedToken / fetchProfile / fetchMedia / fetchMediaInsights / fetchAccountInsights）。AbortController 10秒 timeout、`!response.ok` 時は status+body を `console.error`（プレフィックス `[Instagram]`）してから throw
   - `src/server/services/instagramTokenService.ts` — `ensureValidInstagramToken(credential)`: 期限まで**7日以上**なら再利用、7日未満かつ発行24時間超なら refresh + `updateInstagramCredential` で永続化、期限切れなら `needsReauth` 扱い
   - `src/server/lib/instagram-status.ts` — `toInstagramConnectionStatus(credential)`: 戻り値型は `{ connected: boolean, needsReauth?: boolean }` で、`gsc-status.ts` と同型。未連携は `{ connected: false }`、要再認証は `{ connected: true, needsReauth: true }`、正常は `{ connected: true, needsReauth: false }`（または omit）。UI は3状態を区別表示する
   - **credential 永続化 API（Google Ads 同型、`SupabaseService` 直付け）**: `src/server/services/supabaseService.ts` に以下を追加（Phase 1 必須成果物）
     - `saveInstagramCredential(userId, payload)` — OAuth callback / 初回連携時の upsert（`onConflict: user_id`）
     - `getInstagramCredential(userId)` — ステータス・プレビュー・トークン延長用取得
     - `updateInstagramCredential(userId, payload)` — refresh 後の token 更新
     - `deleteInstagramCredential(userId)` — 連携解除。Phase 2 以降は §5.5 の purge もここから呼ぶ
5. Server Actions: `src/server/actions/instagramSetup.actions.ts` — `getInstagramConnectionStatus` / `disconnectInstagram` / `fetchInstagramPreviewData`（プロフィール+**最新 K 件（K=3）**の投稿+各投稿インサイトを疎通表示用に取得。§4 Phase1-10 参照）。戻り値は `ServerActionResult` + `needsReauth` 規約（google-integrations スキル準拠）
6. UI:
   - `app/setup/instagram/page.tsx` + `src/components/InstagramSetupClient.tsx` — 連携ボタン、連携ステータス、連携済み時はプロフィール＋最新投稿（最大3件）＋主要インサイトのプレビュー表示（審査スクリーンキャスト用を兼ねる）、解除ボタン、`needsReauth` 時の再連携導線。**`app/setup/google-ads/page.tsx` と同型の `ERROR_MAP`**（`searchParams.error` → `ERROR_MESSAGES.INSTAGRAM.*`）を `page.tsx` に実装
   - `src/components/SetupDashboard.tsx` に Instagram カード追加、`app/setup/page.tsx` でステータス取得
7. `ERROR_MESSAGES.INSTAGRAM.*` を `src/domain/errors/error-messages.ts` に追加（AUTH_FAILED, MISSING_PARAMS, STATE_COOKIE_MISMATCH, STATE_USER_MISMATCH, INVALID_STATE, TOKEN_EXCHANGE_FAILED, AUTH_EXPIRED, CONNECTION_FAILED, API_ERROR, NOT_PROFESSIONAL_ACCOUNT, UNKNOWN_ERROR 等。日本語文言直書き禁止規約準拠）
8. 環境変数: `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` / `INSTAGRAM_REDIRECT_URI`（`.env.example` 追記）。`COOKIE_SECRET` は既存を共用
9. **App Review 必須成果物（Meta 審査提出前に完了）**:
   - `app/privacy/page.tsx` — Instagram API 利用目的・取得データ種別・保管期間・第三者提供なし・ユーザーによる削除方法（§5.5 連携解除手順への言及）を追記。metadata.description も Instagram を含める
   - データ削除手順: **連携解除（`/setup/instagram` の解除ボタン → `disconnectInstagram`）で credential および同期済み Instagram データを削除**する旨をプライバシーポリシーに明記。Meta Data Deletion Callback URL は Phase 1 では設けず、手順ページ方式とする（GrowMate は B2B SaaS でユーザー自身がアプリ内解除可能なため。将来 Meta から Callback 必須化された場合は Phase 1.5 で `/api/instagram/data-deletion` を追加）
10. **プレビュー取得上限（Phase 1-5 詳細）**:
    - `fetchInstagramPreviewData` は `/me/media` から **最新 K=3 件**（`posted_at` 降順）のみ insights を取得する（1件1 API コール × 10s timeout のため全件取得は禁止）
    - 部分失敗時: 取得できた投稿のみカード表示し、失敗件数を Alert（`ERROR_MESSAGES.INSTAGRAM.API_ERROR` または「一部の投稿データを取得できませんでした（N件）」）で表示。プロフィール取得失敗時はプレビュー全体をエラー表示（空画面にしない）
    - 投稿0件の場合は「投稿がありません」プレースホルダーを表示（審査画面が真っ白にならないこと）

**このフェーズで App Review を提出**（instagram_business_basic + instagram_business_manage_insights）。審査待ちの間に Phase 2 を進められる（テスターアカウントで開発継続可能）。

### Phase 2: データ同期 + analytics 一覧（タブ化）

**ゴール: `/analytics` が「ブログ」「Instagram」タブに分かれ、Instagram タブにスプレッドシート相当の投稿一覧＋指標が出る。**

※ タブ切替方式は 2026-07-22 定例で提案しクライアント同意済み（「どういう形がいいかは分からないが、まず連携から」との温度感のため、UI 詳細は Phase 2 着手時に管理表を見せてもらい再確認する）。

1. テーブル追加（§5）: `instagram_media` / `instagram_media_insights_daily` / `instagram_account_insights_daily`
2. `src/server/services/instagramSyncService.ts` — 同期本体:
   - `/me/media` を cursor で辿り直近50件を upsert（打ち切り時は件数をログ）
   - **メディアフィルタ**: `media_product_type` が `FEED` / `REELS` **以外**（STORIES 等、§2 非スコープ）は **DB upsert せずスキップ**し、`console.warn('[Instagram Sync]', { skipped, reason: 'unsupported_product_type', media_product_type })` を出力。CHECK 制約違反で同期全体が失敗しないこと
   - 各メディア（FEED/REELS のみ）の insights を取得し、`instagram_media` に最新値を反映＋当日分を `instagram_media_insights_daily` にスナップショット（日次推移用）
   - アカウント insights: **`last_synced_at` が null の初回同期は直近 D=30 日分**（昨日まで）を取得。2回目以降は `last_synced_at` の日付〜昨日までを upsert（欠損日は API 応答に従い補完）
   - 部分失敗は投稿単位で continue し、**必ず `console.error` でログ**（skipped カウントのみのサイレント処理禁止）。結果に `{ synced, failed, skipped, truncated }` を含める
3. 同期トリガー:
   - 手動: Instagram タブの「データを更新」ボタン（Server Action）
   - 自動: `app/api/cron/instagram-sync/route.ts`（`CRON_SECRET` Bearer 検証、`maxDuration = 300`、`gsc-evaluate` と同型のユーザーバッチ処理）を `.github/workflows/hourly-cron.yml` の matrix に追加:
     ```yaml
     - id: instagram-sync
       path: /api/cron/instagram-sync
       profile: count-batch   # success / data.failed を検証（hourly-cron.yml コメント参照）
       interval: hourly
     ```
     **トークン延長もこの cron 内で実施**（期限7日前を切った credential を refresh）
   - **`truncated` の扱い**: 50件上限で打ち切った場合 `truncated: true` をレスポンスに含め **`console.warn` で記録するが cron ジョブ自体は成功扱い**（意図した上限動作のため `count-batch` profile の失敗条件に含めない）。`failed > 0` のみ workflow 警告対象
4. UI: `app/analytics/AnalyticsClient.tsx` をタブ化（R-2）。Instagram タブ:
   - 投稿一覧テーブル: サムネイル、種別（リール/フィード/カルーセル）、キャプション冒頭、投稿日、リーチ、視聴数(views)、いいね、コメント、保存、シェア、総インタラクション、リールは平均視聴時間。permalink への外部リンク
   - 種別フィルタ（リール/フィード）、期間フィルタ（`posted_at` 範囲指定。開始日～終了日）、ソート（投稿日 / リーチ / views）
   - ページネーションは既存ブログ一覧と同じ URL パラメータ + `Link` 方式（`ig_page` など名前空間を分けてブログ側の `page` と衝突させない）
   - 未連携時は `/setup/instagram` への導線を表示（サイレントに空表示しない）
5. データ取得: Server Component（`app/analytics/page.tsx`）でタブに応じて `instagramMediaService.getPage(userId, ...)` を並列取得に追加。PostgREST `db-max-rows = 1000` 制限があるため一覧はページング取得（10件/頁）とし、全件突合は行わない

### Phase 3: AI チャット連携（台本作成）

**ゴール: Instagram の実績データを文脈として持った状態で `/chat` でリール台本の壁打ちができる。**

実装前に別途詳細設計（+ client-alignment 確認）を行う。**2026-07-22 定例でクライアントの要望像が具体化した**ため、以下を前提とする:

- **ステップ制にしない（旧 Q5 は回答済み）**: ブログはキーワード（検索ニーズ）軸で step1〜7 の型があるが、Instagram は検索ニーズ軸ではなく「こちらが作るテーマ」軸。クライアント自身「順番としてはまだ言語化できていない」と明言。よって**自由壁打ち（相談役）型 + データ注入**で設計する。型として言語化済みの要素（冒頭3秒で気づかせるフック、自社サービスを間接的に頼みたくなる内容）はプロンプトテンプレート側に組み込む
- **相談 → 引き継いで作成のフロー**: クライアントの理想は「まず相談（フィードバック壁打ち）→ 方向性が固まったらその文脈を引き継いでコンテンツ作成（Instagram でもブログでも）」。相談セッションの文脈を台本作成に引き継ぐ設計を詳細設計の中心論点とする
- **最終的な運用像（クライアントの現行管理表より）**: ①テーマのストック（ネタ帳。日常で気づいたテーマを蓄積）→ ②テーマを選んで台本・キャプション・サムネイルコピーを作成 → ③収録・投稿 → ④結果（実績数値）を記録して PDCA。Phase 2 の実績一覧 + Phase 3 の台本作成に加え、**テーマストック機能**が将来スコープとして視野に入る（Phase 3 詳細設計時にスコープ判断）
- **導線**: analytics の Instagram タブの各投稿に「この投稿を元に台本作成」ボタン → `/chat?ig_media=<id>` で起動。加えてチャット側で「伸びている投稿 TOP5」を参照する台本作成モードを用意
- **注入方式**: `gscSuggestionService.ts` の確立パターンを踏襲 — `prompt_templates` テーブルにリール台本用テンプレートを seed し、対象投稿のキャプション・指標（+アカウントの平均値との比較）を `PromptService.replaceVariables` で変数注入。チャット本体（`app/api/chat/anthropic/stream/route.ts`）へは `getSystemPrompt` の分岐追加として実装
- **token budget**: 注入する投稿データは上位 N 件・キャプション先頭 M 文字に制限（`llm-context-memory` スキルの Context Assembly Contract に従い、詳細設計時に budget を明記）
- **機密**: access_token・credential 行を LLM 入力に含めない（変数注入は表示用指標とキャプションのみ）

## 5. DB 設計

マイグレーションは `supabase/migrations/` に SQL で追加。適用は管理者手動（`supabase db push`）のため、実装時は `database.types.pending.ts` の暫定型パターン（supabase スキル §6）を使う。各ファイルにロールバック手順（`DROP TABLE` / `DROP POLICY`）をコメントで残す。

### 5.1 `instagram_credentials`（Phase 1）

```sql
create table public.instagram_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  ig_user_id text not null,
  username text,
  account_type text,               -- BUSINESS / MEDIA_CREATOR
  profile_picture_url text,
  access_token text not null,      -- 長期トークン（60日）。refresh_token は存在しない
  access_token_expires_at timestamptz not null,
  access_token_issued_at timestamptz not null default now(),  -- 24h ルール判定用
  scope text[] not null default '{}',
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

- RLS: **`SELECT` のみ** `get_accessible_user_ids(auth.uid())` ベース（`20260127090000` の google_ads_credentials 現行世代と同型。オーナー/スタッフ共有モデルを崩さない）。**`INSERT` / `UPDATE` / `DELETE` ポリシーは設けない** — OAuth callback・トークン refresh・連携解除はすべて **Service Role + 明示的 `.eq('user_id', userId)`**（`supabaseService.saveInstagramCredential` 等）経由のみ。認証ユーザー JWT からの credential 書き込み経路は存在しない
- `user_id` に B-tree インデックス（unique 制約で兼用）
- `updated_at` 自動更新トリガー（既存トリガー関数を再利用）
- トークンは既存3系統と同じく**平文 text + RLS 保護**（暗号化は現行方針踏襲。変える場合は全系統一括の別課題とする）

### 5.2 `instagram_media`（Phase 2）

```sql
create table public.instagram_media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  ig_media_id text not null,
  media_type text not null check (media_type in ('IMAGE','VIDEO','CAROUSEL_ALBUM')),
  media_product_type text not null check (media_product_type in ('FEED','REELS')),
  caption text,
  media_url text,                  -- 失効し得る CDN URL。同期毎に更新
  thumbnail_url text,
  permalink text not null,
  posted_at timestamptz not null,
  -- 最新インサイト（一覧表示用の非正規化。正史は insights_daily）
  like_count int, comments_count int,
  reach int, views int, saved int, shares int, total_interactions int,
  avg_watch_time_ms int, total_watch_time_ms bigint,   -- リールのみ
  insights_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, ig_media_id)
);
create index on public.instagram_media (user_id, posted_at desc);
```

### 5.3 `instagram_media_insights_daily`（Phase 2、日次スナップショット）

```sql
create table public.instagram_media_insights_daily (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  media_id uuid not null references public.instagram_media(id) on delete cascade,
  snapshot_date date not null,
  reach int, views int, likes int, comments int,
  saved int, shares int, total_interactions int,
  avg_watch_time_ms int, total_watch_time_ms bigint,
  imported_at timestamptz not null default now(),
  unique (user_id, media_id, snapshot_date)
);
```

※ Media insights API は**累計値**を返すため、日次スナップショットの差分が日別推移になる。スプレッドシート運用で日次推移を見ていない場合はこのテーブルを Phase 2 から外せる（→ §9 確認質問 Q3）。

### 5.4 `instagram_account_insights_daily`（Phase 2）

```sql
create table public.instagram_account_insights_daily (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  date date not null,
  reach int, views int, profile_views int, website_clicks int,
  accounts_engaged int, total_interactions int, follower_count int,
  imported_at timestamptz not null default now(),
  unique (user_id, date)
);
```

- 5.2〜5.4 の RLS も **上記と同様: 認証ユーザーは `SELECT` のみ**（`get_accessible_user_ids`）。**書き込み（INSERT/UPDATE/DELETE）は Service Role 経由の同期 cron・手動同期 Server Action のみ**。所有者向け write ポリシーは設けない
- DB アクセス:
  - Phase 1 credential: `SupabaseService` の `save/get/update/deleteInstagramCredential`（§4 Phase1-4）
  - Phase 2 media/insights: `SupabaseService` 継承の `instagramMediaService`（`src/server/services/instagramMediaService.ts`）に集約。`withServiceRoleClient` + 明示的 `.eq('user_id', userId)` 必須

### 5.5 連携解除とデータ purge

| フェーズ | `disconnectInstagram` の動作 |
|---------|------------------------------|
| Phase 1 | `deleteInstagramCredential(userId)` のみ（Phase 2 テーブル未存在のため media purge 不要） |
| Phase 2 以降 | 1) `instagram_media_insights_daily` → 2) `instagram_media` → 3) `instagram_account_insights_daily` を **user_id スコープで DELETE**（Service Role）→ 4) `deleteInstagramCredential`。FK は `users` 参照のため credential 削除だけでは media は残る — **明示 purge 必須** |

**再連携時**:
- 同一 `user_id` で OAuth 成功 → `saveInstagramCredential` が upsert（`unique(user_id)`）。**`ig_user_id` が前回と異なる場合**（別 Instagram アカウントに付け替え）は、保存前に §5.5 の purge を実行し旧アカウントの media/insights を削除してから新 credential を保存（混在防止）
- 同一 `ig_user_id` の再連携 → purge 不要、token 列のみ更新

## 6. エラーパス設計

| 事象 | 挙動 |
|------|------|
| OAuth 認可拒否 / state 不一致 / code 交換失敗 | `/setup/instagram?error=<種別>` へ **302 リダイレクト**（Google Ads 型）。`app/setup/instagram/page.tsx` の ERROR_MAP → `ERROR_MESSAGES.INSTAGRAM.*` を Alert 表示。credential は変更しない |
| トークン期限切れ・無効化（API が 190 系エラー） | `isInstagramReauthError()` ヘルパーに判定を集約し `needsReauth: true` を返す。UI は「要再認証」バッジ + `/setup/instagram` 再連携導線（サイレントに未連携へフォールバックしない） |
| refresh 失敗（発行24時間未満 / 期限切れ） | 24時間未満: 次回 cron に持ち越し（エラーにしない）。期限切れ: `needsReauth` |
| プロアカウントでない | callback で account_type 検証し `NOT_PROFESSIONAL_ACCOUNT` エラー表示（credential 保存しない） |
| 同期の部分失敗 | 投稿単位で continue、`console.error('[Instagram Sync]', ...)` 必須、結果サマリに failed 件数 |
| レート制限（429 / code 4） | 当該同期を中断し次回 cron に委ねる。エラーログに残す |
| cron タイムアウト | `gscEvaluationService` と同様の時間上限付きユーザーバッチ（280s ガード）で途中打ち切り、次回続行 |

## 7. 認可・セキュリティ

- 対象ロール: **admin / paid / trial に開放**（`unavailable` のみ `authMiddleware` の 403 で除外。2026-07-23 決定）。これは既存 Google 系連携（GSC / GA4 / Google Ads）と同一の扱い — 既存もロール制御を持たず `unavailable` 除外のみ。Instagram 独自のロールゲートは追加しない。Phase 3 の台本作成チャットは既存のトライアル日次制限（`checkTrialDailyLimit`）にそのまま乗せる
- Service Role 使用箇所: **OAuth callback（credential upsert）・トークン refresh 更新・連携解除（credential + Phase2 media purge）・cron 同期・手動同期**。いずれも明示的 `user_id` スコープ必須。認証ユーザー JWT からの write 経路は設けない
- `INSTAGRAM_APP_SECRET` はサーバーのみ。クライアント・LLM 入力に credential/token を一切出さない
- OAuth state は HMAC 署名 + httpOnly Cookie + セッション整合チェック（既存3系統と同一水準）

## 8. 受け入れ条件・検証

### Phase 1
- [ ] テスターアカウントで `/setup/instagram` から連携でき、プロフィール（username, フォロワー数等）・**最新3件**の投稿・インサイトが画面に表示される（部分失敗時は取得分のみ表示 + Alert）
- [ ] `/setup` ハブに Instagram カードが出て connected / needsReauth / unlinked が区別表示される
- [ ] 認可拒否・state 改ざん時に ERROR_MAP 経由でエラー Alert が表示され、credential が壊れない
- [ ] 連携解除で credential が削除され unlinked に戻る
- [ ] **`/privacy` に Instagram API 利用・取得データ・削除手順（連携解除）が追記されている**
- [ ] 審査用スクリーンキャストが撮影できる（プレビュー空画面にならない）

### Phase 2
- [ ] `/analytics` にブログ / Instagram タブが出て、既存ブログ一覧の挙動（フィルタ・ページネーション・URL パラメータ）が不変
- [ ] Instagram タブに投稿一覧＋指標が表示され、種別フィルタ・ソートが機能する
- [ ] 手動更新・hourly cron（`profile: count-batch`）の両方で同期され、`last_synced_at` が進む
- [ ] 初回同期でアカウント insights が直近30日分取り込まれる
- [ ] STORIES 等非スコープ `media_product_type` が来ても同期全体が失敗せず skipped ログが出る
- [ ] 50件打ち切り時 `truncated: true` がログに残り cron は成功扱い
- [ ] 連携解除で credential + media/insights が purge される
- [ ] トークンが cron で自動延長される（期限7日前）
- [ ] 未連携ユーザーには連携導線が表示される

検証は `quality-gate` に従い `npm run verify`（audit → lint → test → build → knip）+ 上記画面の手動確認。純関数（インサイト整形・期限判定 `ensureValidInstagramToken` の分岐・cursor ページング処理）には vitest を追加する。

## 9. 未確定事項（実装前に要確認）

- ~~Q1. 複数アカウント~~: **回答済み（2026-07-23）** — 1ユーザー=1 Instagram アカウント。§5.1 の `unique(user_id)` 設計を確定とする
- **Q2. 現行管理表の項目**: 2026-07-22 定例で管理表の画面共有あり（テーマストック → 台本/キャプション/サムネコピー → 結果記録の構成）。一覧に出すべき列・並び順の正は Phase 2 着手時に管理表を共有してもらい確定する
- **Q3. 日次推移の要否**（Phase 2 着手前までに確認で可）: 投稿ごとの指標の日別推移（5.3）は必要か。現在値だけなら Phase 2 が軽くなる。未確定の間、Phase 1 には影響しない
- ~~Q4. 対象ロール~~: **回答済み（2026-07-23）** — admin / paid / trial に開放（`unavailable` のみ除外）。§7 参照
- ~~Q5. 台本作成の形~~: **回答済み（2026-07-22 定例）** — ステップ制にせず自由壁打ち（相談役）型。詳細は Phase 3 冒頭参照

なお 2026-07-22 定例のクライアント要望として「チケットに書かれた手段を鵜呑みにせず、目的を確認した上でより軽い代替案があれば先に提案してほしい」がある。上記 Q1〜Q4 の確認時も、選択肢と推奨案をセットで提示する。

## 10. 影響する既存画面・機能

- `app/setup/page.tsx` / `src/components/SetupDashboard.tsx`（Instagram カード追加）
- `app/setup/instagram/page.tsx` / `src/components/InstagramSetupClient.tsx`（新規）
- `app/analytics/page.tsx` / `AnalyticsClient.tsx`（タブ化。既存ブログ一覧はリグレッションなしが条件）
- **`app/privacy/page.tsx`（Instagram API セクション追記 — App Review 必須）**
- `src/server/services/supabaseService.ts`（Instagram credential CRUD 追加）
- `.github/workflows/hourly-cron.yml`（matrix に `instagram-sync` / `profile: count-batch` 追加）
- `src/domain/errors/error-messages.ts`（INSTAGRAM 追加）
- R-1 実施時のみ: `src/server/lib/oauth-flow.ts`（新規）、Instagram OAuth start/callback から state 検証ヘルパーを利用
- チャット本体（Phase 3 まで変更なし）

## 11. 参考（調査済み既存実装）

- OAuth **エラー UX 正本**: `app/api/google-ads/oauth/callback/route.ts`（失敗時 redirect）、`app/setup/google-ads/page.tsx`（ERROR_MAP）
- OAuth state 検証: `src/server/lib/oauth-state.ts`
- GSC callback（**JSON 応答。Instagram には非参照**）: `app/api/gsc/oauth/{start,callback}/route.ts`
- credential CRUD 同型: `SupabaseService.saveGoogleAdsCredential` / `getGoogleAdsCredential` / `deleteGoogleAdsCredential`
- ステータス判定: `src/server/lib/gsc-status.ts`, `ga4-status.ts`
- 同期バッチ: `src/server/services/gscEvaluationService.ts`, `app/api/cron/gsc-evaluate/route.ts`
- cron matrix + profile: `.github/workflows/hourly-cron.yml`（`count-batch` プロファイル）
- タブ UI: `app/ga4-dashboard/Ga4DashboardClient.tsx:435`
- LLM 変数注入: `src/server/services/gscSuggestionService.ts` + `prompt_templates`
