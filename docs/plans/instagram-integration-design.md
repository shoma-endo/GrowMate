# Instagram 連携（Business Login for Instagram）設計書

作成日: 2026-07-23 / ステータス: レビュー修正中（2026-07-25）
クライアント合意: 2026-07-22 定例MTG（Lark minutes `objpyf287e2otlex7a1m8n25`）で「まず連携（審査申請）から進める」ことを合意済み

## 1. 背景・目的

- 現在 [Adzviser](https://adzviser.com/) + スプレッドシートで行っている Instagram のリール・フィード投稿の実績管理を GrowMate に内製化する。
- 取得したインサイトデータを土台に、`/chat` で AI と壁打ちしながらリール台本を作成できる状態を最終ゴールとする。
- Meta の App Review（Advanced Access）提出に向け、**Phase 1-A でクライアント合意用の UI モック（ハードコーディング）を先に作り、Phase 1-B で OAuth 連携・実 Graph API（`/me`・`/media`・`/insights`）・プライバシーポリシー追記・連携解除を実装したうえで審査提出する**（Meta 公式要件: 外部テスト可能＋対象パーミッションで最低1回の成功 API コール＋パーミッション別スクリーンキャスト。詳細は §3.2 / §4 参照）。Phase 2 以降は審査通過後に着手する。

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
- Advanced Access には App Review **とビジネス認証**が必要（後述「アクセスレベルとビジネス認証」）。**審査前でも App Dashboard でアプリロール（Instagram Tester 等）に追加したプロアカウントなら全機能が動く**（Phase 1-B の実 API 動作確認・審査提出前テストで利用）。
- 対象アカウントは Instagram Business / Creator（プロアカウント）必須。Facebook ページ紐付けは不要。
- **アクセスレベルとビジネス認証（2026-07-27 調査）**: 出典は [アクセスレベル](https://developers.facebook.com/docs/graph-api/overview/access-levels) と [Business Verification](https://developers.facebook.com/documentation/development/release/business-verification)。
  - **スタンダードアクセス**は全ビジネスアプリに自動承認される。ただし「スタンダードアクセスでのアクセス許可は、リクエストするアプリで**役割を付与されているアプリユーザーのみ**がリクエストできます」。→ Instagram Tester に追加した審査用アカウントでの疎通確認・スクリーンキャスト収録は**ビジネス認証なしで実施できる**（前項「審査前でも…全機能が動く」の根拠）
  - **アドバンスアクセスにはビジネス認証が必須**（「アドバンスアクセスを取得するには、ビジネス認証が必要です」）。本番では役割を持たないユーザーが使うため回避不可。未認証のまま公開すると "app users from other Businesses will be unable to grant these apps permissions and **all features will be inactive**" となり、連携ボタンを押しても機能が丸ごと無効になる
  - **実施主体はクライアント側**。[Meta Business Suite でビジネスを認証する](https://www.facebook.com/business/help/2058515294227817) より、ビジネスポートフォリオの**全権限**保持者のみが開始でき、正式なビジネス名・住所・電話番号・ウェブサイトを法人としての詳細情報と完全一致で入力する（ウェブサイトは HTTPS 必須）。公的記録と一致しない場合は「営業許可証や会社定款など、公的な書類」の提出を求められる。**決定に最大14営業日**
  - **進行順序**: ビジネス認証はアプリ作成・疎通確認・収録の**前提ではない**。①アプリ作成 → Tester 追加 → 開発側の実装・収録と、②クライアント側の認証申請を**並行**で進め、両方揃った時点で App Review を提出する（14営業日のリードタイムを吸収するため）
- **開発者をクライアントのポートフォリオに招待するときの権限（2026-07-29 の詰まりから）**: アプリをクライアントのビジネスポートフォリオ配下に置く構成では、開発者を招待する際に **「部分的なアクセス許可 > アプリと統合」**（旧「開発者」ロール）を選ぶ。公式は「アプリと統合のアクセス許可(以前の開発者の役割)を所有するメンバーは、コンバージョンAPIの設定、イベントのモニタリング、**アプリの編集、アクセストークンの作成**ができます」と定義しており（[アクセス許可について](https://www.facebook.com/business/help/442345745885606)）、Facebook ページ・広告アカウント・Instagram アカウントへのアクセスを伴わない。フルアクセス（全権限）は不要。
  - **実際に踏んだ罠**: 初回招待フローの「アセットを割り当てる」でアプリのチェックボックスが有効にならず、"Developer account needed" の注意書きが出る。原因は開発者登録の不備でもアプリ側の設定不備でもなく、**ポートフォリオ権限の選択**にあった。この事象で丸1日を消費している
  - アプリの役割は App Dashboard ではなく Business Manager 側で管理される（「If your app is connected to a business portfolio, you must use the Business Manager to manage roles for your app.」— [App Roles](https://developers.facebook.com/documentation/development/build-and-test/app-roles)）
- **データ使用状況の確認（承認後の継続義務）**: 「アクセス許可または機能のアドバンスアクセスを持っているアプリは、データの使用状況の確認を完了する必要があります。これは、アプリがFacebookのプラットフォーム利用規約と開発者ポリシーに準拠して、Facebook API、製品、データにアクセスしていることを**1年ごと**に証明するプロセスです」（[アクセスレベル](https://developers.facebook.com/docs/graph-api/overview/access-levels)）。**審査通過は一度きりではなく年1回の対応が必要**で、放置するとアドバンスアクセスが失効し全ユーザーの Instagram 連携が停止する。運用引き継ぎ時にクライアントへ明示すること
- **App Review 提出ゲート（Phase 1-B 最小）**: [App Review ガイドライン](https://developers.facebook.com/documentation/instagram-platform/app-review#permission--feature-requests) に基づき、レビュアーが外部からアプリをロード・テストでき（"Confirm that your app can be loaded and tested externally"）、**対象パーミッションで最低1回の成功 API コール**が確認できる状態で提出する。公式は "To request Advanced Access to **certain** permissions, you need to make at least 1 successful API call" と限定表現のため、`instagram_business_basic` / `instagram_business_manage_insights` が該当するかは**実装時に Advanced Access 要件表で確認**する（該当する前提で作れば過不足はない）。具体的には OAuth 連携 → `/me` + `/me/media` + insights 取得 → 画面表示の一連の流れを実装したうえでスクリーンキャストを添付する。
- 審査提出物: **Phase 1-B 実装画面のスクリーンキャスト**（実 OAuth 連携 → 実データ表示）、利用目的の説明、**プライバシーポリシー URL（`/privacy` に Instagram 追記 — §4 Phase1-B item9）**、**データ削除手順（連携解除 — §4 Phase1-B / §5.5。`disconnectInstagram` 実装後に PP へ明記）**
- **スクリーンキャストの要件（公式ガイドラインより。録画前に決めること）**:
  - **パーミッションごとに1本用意する**。公式は各リクエストに対し "Describe how your app uses that specific permission or feature" と "Upload a screencast showing the **end-to-end user experience** for that specific permission or feature" を要求する。`instagram_business_basic`（連携 → プロフィール・投稿一覧表示）と `instagram_business_manage_insights`（投稿ごとのリーチ・視聴・保存表示）で分ける
  - **言語**: 公式は "Use English as the app UI language – If possible, please set the app UI language to English before recording the screen recording." と指示する。**GrowMate は日本語専用 UI のため英語化はしない**。代わりに公式が代替として挙げる **英語キャプション・ツールチップで画面要素とボタンの意味を補う**（"Provide captions and tool-tips" / "Explain the meaning of buttons and other UI elements"）。日本語 UI のまま無注釈で提出しない
  - **GrowMate 自身のログインも収録する**。[Screen Recordings](https://developers.facebook.com/docs/app-review/submission-guide/screen-recordings/) は "Capture the entire login flow, from logged-out to logged-in." を求める。Meta ログイン以外の手段で入れる場合もそのフローを収録せよと明記されているため、`/login` のメール OTP 入力から `/setup/instagram` までを1本に含める
  - 解像度は "record in high-resolution, 1080 or better"。**録画が無いパーミッションは承認されない**（"Any requested permission or feature missing a screen recording will not be approved"）

- **審査を行う環境（2026-07-25 決定）**: **本番（`https://growmate.tokyo`）で収録・提出する**。
  - 公式に「URL やアドレスバーを映せ」という要求は無い（Instagram 審査ページ・Screen Recordings ページとも記載なし）。だが **レビュアーは動画を見るだけでなく自分でアプリを触る**（"Confirm that your app can be loaded and tested externally"、[提出ガイド](https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review/submission-guide) の "We will test your app so be sure that we can access it"）ため、到達可能な公開 HTTPS URL が要る
  - **Vercel の preview URL（`growmatetokyo-git-<branch>-...vercel.app`）でも技術的には通せる**（Deployment Protection 無しで外部から開けることを 2026-07-25 に実測確認済み）。ただし採らない。理由: ①承認後に redirect URI を本番へ付け替える手戻りが出る ②審査期間（数日〜数週間）中にそのブランチへ別変更をマージすると、レビュアーが開く画面と収録が食い違う ③一時環境と読める URL はアプリ設定の Website URL と不一致になり追加確認を招く
  - preview で出す場合は必ず **コミット別 URL ではなくブランチエイリアス**を使い、審査提出用ブランチを切ってマージを凍結し、Preview スコープの `INSTAGRAM_REDIRECT_URI` を別値で登録すること
- **レビュアーのアクセス手段（2026-07-31 に一次情報で確定）**: 提出ガイドは Platform Settings 欄に "describe how we can access your app in order to test it" と記入することを求め、"We will test your app using our own test accounts. Do not include your **personal** Meta Technologies app account's credentials." と注意している。認証情報の提供自体は無条件の必須ではない（Instagram 審査ページの該当見出しは "Credentials (**If applicable**)" で本文も "**If needed**, provide any required test credentials for Meta reviewers to log into your app or website."）。**ただし GrowMate では needed 側になる**。根拠は以下の3点。
  - [提出ガイド](https://developers.facebook.com/documentation/resp-plat-initiatives/individual-processes/app-review/submission-guide)（英語原文）の必須項目に "Make sure we can access your app or website. **Your app must be publicly available or you must provide instructions on how to access it.**" とある。GrowMate はログイン必須かつ allowlist ゲート付きで publicly available ではないため、後者（手順の提示）を選ぶしかない
  - 同ガイドの "We will test your app using our own test accounts." が使えるのは Meta 認証を使うアプリのみ。GrowMate は提出フォームの「このプラットフォームには Facebook ログインが統合されていますか？」に**いいえ**と答える構成なので、Meta 側の test account では入れない
  - [Common Mistakes](https://developers.facebook.com/docs/app-review/submission-guide/common-mistakes) の "Your app is inaccessible" に "**If we can't access your app for any reason, your entire submission will be rejected**" とある。パーミッション単位ではなく提出全体の却下
- **レビュアーのログイン手段（制約。2026-07-31 追記）**: GrowMate の認証は**メール OTP のみ**（`app/login/page.tsx` → `src/server/actions/auth.actions.ts` の `supabase.auth.signInWithOtp`。パスワード認証も他プロバイダも無い）。**提出フォームの認証情報欄に書ける固定値が存在しない**ため、審査用アカウントを作るだけでは前項を満たせない。[Supabase CLI config](https://supabase.com/docs/guides/local-development/cli/config) に `auth.sms.test_otp`（"Use pre-defined map of phone number to OTP for testing."）はあるが、**email 向けの test_otp は存在しない**（同ページ内の `test_otp` の出現は `auth.sms.test_otp` のみ。2026-07-31 に原文で確認）ため、設定だけで回避する道も無い。
  - **採用方針（案1）**: Supabase 標準の `signInWithPassword` を**審査用アカウント1件にだけ**使う。Email プロバイダのパスワード認証を有効化し、当該アカウントにのみパスワードを設定する。パスワード未設定の既存ユーザーはこの経路を使えないため影響しない。新規サインアップは現状でも OTP 経由で誰でも可能（`role` は `unavailable` で `/unavailable` へ送られる）ため、到達できる範囲は広がらない
  - **却下した案**: レビュアーが参照できる受信箱を用意して認証情報欄に書く方式。海外の未知端末からのログインでメールサービス側の追加確認が発生し得るが、これは GrowMate の外にある変数で事前に潰せない。失敗すると "Your app is inaccessible" で提出全体が却下される
  - **審査後の後始末**: アカウントは**削除せずパスワードのみ削除**する。Meta はプラットフォーム上のアプリを定期的に再審査する旨をダッシュボードに明記しており（`設定 > ベーシック` のウェブサイトプラットフォーム内「テストの手順に関する情報」）、§3.2 のデータ使用状況の確認も年1回あるため、アカウントごと消すと再審査のたびに作り直しになる。露出は `INSTAGRAM_BETA_USER_IDS` から外すことで閉じる
- **成功 API コールの有効期限（2026-07-31 追記）**: 提出ガイドに "Make at least 1 successful API call using each permission for which you are requesting advanced access. **Calls must be made within 30 days of submitting for App Review.**" とある。**実 OAuth 疎通で API コールを立てた時点から 30 日以内に提出する**必要があるため、収録・実装・クライアント側の承認とビジネス認証の見通しが立ってから疎通確認を行う。ダッシュボードのアクセス許可一覧に「API呼び出し」件数が出るのでそこで確認する
- **アプリアイコンは 1024x1024 が確定要件（2026-07-31 追記）**: 提出ガイドの必須項目に "Upload a **1024x1024** compliant app icon image to **Settings** > **Basic** > **App Icon**." とある。Instagram 審査ページの Complete App Settings も "App icon (1024x1024)" と明記。リポジトリの `app/icon.png` は 120x120 でベクター元データも無いため、別途 1024 の素材を用意する（アップロードはダッシュボードのネイティブファイル選択が必要で、ブラウザ自動化からは実行できない）
- **ログインボタンのブランド準拠**: Instagram 審査ページのチェックリストに "Verify that the login button or link is visible in your app and screencast, and adheres to our brand guidelines" がある。§11.2 の連携ボタンが **Meta のブランドガイドラインに準拠しているか**、および**アプリ内と収録の両方でボタンが見えているか**を実装時に確認する

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
- **R-2（Phase 2 に内包）**: `app/analytics/AnalyticsClient.tsx` のタブ化。既存のブログ一覧を `TabsContent value="blog"` に包む構造変更。`app/ga4-dashboard/Ga4DashboardClient.tsx:435` の Tabs 実装（`grid grid-cols-2` の TabsList）を踏襲。**ただしタブ UI 自体を Instagram 連携済みユーザーだけに出す**ため、未連携時は既存のまま（`Tabs` で包まず現行のレイアウトを返す）分岐を入れる（§4 Phase 2 item4）。

### Phase 1: OAuth 連携 + 疎通表示（審査前 MVP）

**時系列（クライアント指示・2026-07-25）**: 1-A（UI モック・ハードコーディング）を先に作りクライアント（カオルさん）と画面合意を取る。**Meta App Review 提出は 1-B 最小（OAuth + 実成功 API コール + 外部検証可能）が揃ってから行う**。Phase 2 以降は審査通過後に着手する。

#### Phase 1-A: UI モック（ハードコーディング。クライアント合意用）

**ゴール: `/setup` の Instagram カードと `/setup/instagram` が §11.1/11.2 の全状態（未設定・接続OK・要再認証・エラー・空・部分失敗）を実画面として表示する。データは固定値（ハードコーディング）。クライアントレビュー・画面合意が目的であり、App Review 提出物ではない。**

- 実サービス（`instagramService.ts` 等）・DB テーブル・OAuth ルートの実コードは **不要**（審査通過後の Phase 1-B で実装）
- Meta 開発者アプリ作成（Instagram API with Instagram Login 製品追加、パーミッション申請フォーム記入）はダッシュボード上の設定作業のみで、1-A の UI 実装と並行して進める（審査提出そのものにアプリ登録が前提のため）
- **既存の踏襲パターン**: `src/server/services/googleAdsNegativeKeywordsSuggestionService.ts` の `useMockGoogleAds = process.env.NODE_ENV === 'development'` + `DEV_SAMPLE_SEARCH_TERMS` 定数と同型。新方式（fixtureファイル分離・URL パラメータでの状態切替 UI 等）は導入しない
- **限定公開ゲート（1-A 成果物。審査期間中のみ有効）**: `src/server/lib/instagram-permissions.ts` に `canAccessInstagram({ userId, role })` を新設し、環境変数 `INSTAGRAM_BETA_USER_IDS`（カンマ区切りの user_id）に列挙されたユーザーだけに Instagram 機能を見せる。**空文字なら §7 の通常ロール判定にフォールバック**するので、Phase 2 の解除は環境変数を空にするだけで済む（コード変更・再デプロイ不要）。参照箇所は `/setup` の Instagram カード表示と `/setup/instagram` のガードの2箇所のみ
  - **`role: 'admin'` でゲートしてはいけない**。App Review のレビュアーに渡すアカウントはゲートが開いている必要があり、admin にすると `/admin/users`（`getAllUsers` → `AdminUserListItem extends User`）から**全ユーザーの氏名・メールアドレス・課金状態が閲覧可能になる**。未開示の第三者提供になるため、role とは別軸の allowlist にする
  - レビュアー用アカウントは `role: 'trial'` のまま allowlist にのみ追加する（`isAdmin` で `/admin/*` は弾かれる）
- 型定義: `src/types/instagram.ts` に `InstagramConnectionStatus` / `InstagramProfile` / `InstagramMediaPreview` を **Phase 1-B の実 API 戻り値と同じ形状**で先に定義する。以降 Phase 1-B はこの型を変更せず中身だけ実装する
- `src/server/actions/instagramSetup.actions.ts` に `getInstagramConnectionStatus` / `fetchInstagramPreviewData` を **戻り値型は Phase 1-B と同一のまま** 先に実装し、`process.env.NODE_ENV === 'development'` の間は関数末尾に定義した `DEV_SAMPLE_INSTAGRAM_STATUS` / `DEV_SAMPLE_INSTAGRAM_PROFILE` / `DEV_SAMPLE_INSTAGRAM_MEDIA`（未連携・連携済み・要再認証・投稿0件・部分失敗の5パターン）を返す
- 状態確認は `DEV_SAMPLE_*` の定数を一時的に差し替えて目視する（既存踏襲。トグル UI 等の専用切替導線は作らない＝本番導線を汚さない）
- 「連携を解除」ボタンは §11.2 の見た目のみ実装（`disconnectInstagram` の実処理は Phase 1-B。1-A では確認ダイアログの表示までで良い）
- UI 実装: §11.1（`SetupDashboard.tsx` Instagram カード）・§11.2（`InstagramSetupClient.tsx`, `app/setup/instagram/page.tsx`）をここで完成させる。**Phase 1-B ではこのコンポーネント群は無変更** — データソースを `DEV_SAMPLE_*` から実サービス呼び出しへ差し替えるのみ
- クライアントレビュー: カオルさんに §11 ワイヤーフレームとの差分（特に Q2 の一覧列構成の温度感）を確認してもらい、1-B 着手前に画面合意を取る
- **1-A では `app/privacy/page.tsx` の追記・App Review 提出は行わない**（PP 追記と削除手順の明記は `disconnectInstagram` 実装後の 1-B で行う。§4 Phase1-B item9 参照）

#### Phase 1-B: 実データ連携 + App Review 提出（審査申請の最小実装）

**ゴール: テスターアカウントで実際に OAuth 連携し `/setup/instagram` にプロフィール・投稿・インサイトが実 API 経由で表示される。この実装を Meta App Review に提出する（§3.2 提出ゲート参照）。**

1. Meta 開発者アプリ作成（Instagram API with Instagram Login 製品追加、リダイレクト URI 登録、Instagram Tester 追加）— **1-A 時点で完了済みの前提**（申請作業は 1-A 参照）
2. `instagram_credentials` テーブル（§5）+ RLS
3. OAuth ルート（**エラー UX 正本: Google Ads 型**。`app/api/google-ads/oauth/callback/route.ts` + `app/setup/google-ads/page.tsx` の ERROR_MAP パターン。state 検証のみ `oauth-state.ts` / R-1 の `oauth-flow.ts` を参照。GSC callback は JSON 応答のため OAuth エラー UX の参照に使わない）:
   - `app/api/instagram/oauth/start/route.ts` — `generateOAuthState(userId, cookieSecret)` で state 生成、Cookie `ig_oauth_state`（httpOnly, sameSite=lax, 15分）、`www.instagram.com/oauth/authorize` へ 302
   - `app/api/instagram/oauth/callback/route.ts` — state 検証（Cookie 一致 + `verifyOAuthState` + userId 整合）→ コード交換 → 即長期トークン交換 → `/me` でプロフィール取得 → `saveInstagramCredential`（Service Role）→ 成功時 `/setup/instagram?connected=1` へ 302。失敗時は **常に** `/setup/instagram?error=<種別>` へ 302（`access_denied` / `state_cookie_mismatch` / `invalid_state` / `token_exchange_failed` / `not_professional_account` / `server_error` 等）。JSON 500 は環境変数未設定など callback 自体が起動不能な場合のみ
4. サービス層:
   - `src/server/services/instagramService.ts` — Graph API クライアント（exchangeCodeForTokens / exchangeForLongLivedToken / refreshLongLivedToken / fetchProfile / fetchMedia / fetchMediaInsights / fetchAccountInsights）。AbortController 10秒 timeout、`!response.ok` 時は status+body を `console.error`（プレフィックス `[Instagram]`）してから throw
   - `src/server/services/instagramTokenService.ts` — `ensureValidInstagramToken(credential)`: 期限まで**7日以上**なら再利用、7日未満かつ発行24時間超なら refresh + `updateInstagramCredential` で永続化、期限切れなら `needsReauth` 扱い
   - `src/server/lib/instagram-status.ts` — `toInstagramConnectionStatus(credential)`: 戻り値型は `{ connected: boolean, needsReauth?: boolean }` で、`gsc-status.ts` と同型。未連携は `{ connected: false }`、要再認証は `{ connected: true, needsReauth: true }`、正常は `{ connected: true, needsReauth: false }`（または omit）。UI は3状態を区別表示する
   - **credential 永続化 API（`SupabaseService` 直付け）**: `src/server/services/supabaseService.ts` に以下を追加（Phase 1 必須成果物）
     - `saveInstagramCredential(userId, payload)` — OAuth callback / 初回連携時の upsert（`onConflict: user_id`）。**`saveGoogleAdsCredential` と同型**
     - `getInstagramCredential(userId)` — ステータス・プレビュー・トークン延長用取得
     - `updateInstagramCredential(userId, payload)` — refresh 後の token 部分更新。**`updateGscCredential` 寄せ**（`access_token` / `access_token_expires_at` / `access_token_issued_at` 等のみ更新）
     - `deleteInstagramCredential(userId)` — 連携解除。Phase 2 以降は §5.5 の purge もここから呼ぶ
5. Server Actions: `src/server/actions/instagramSetup.actions.ts` — `getInstagramConnectionStatus` / `disconnectInstagram` / `fetchInstagramPreviewData`（プロフィール+**最新 K 件（K=3）**の投稿+各投稿インサイトを疎通表示用に取得。§4 Phase1-11 参照）。戻り値は `ServerActionResult` + `needsReauth` 規約（google-integrations スキル準拠）
6. UI: **Phase 1-A で実装済み。追加実装なし。** `getInstagramConnectionStatus` / `fetchInstagramPreviewData` の `DEV_SAMPLE_*` 分岐に対して else 側（実サービス呼び出し）を追加するのみ。`app/setup/instagram/page.tsx` の `ERROR_MAP`（`searchParams.error` → `ERROR_MESSAGES.INSTAGRAM.*`）・`SetupDashboard.tsx` の Instagram カードも Phase 1-A のものをそのまま使う
7. `ERROR_MESSAGES.INSTAGRAM.*` を `src/domain/errors/error-messages.ts` に追加（AUTH_FAILED, MISSING_PARAMS, STATE_COOKIE_MISMATCH, STATE_USER_MISMATCH, INVALID_STATE, TOKEN_EXCHANGE_FAILED, AUTH_EXPIRED, CONNECTION_FAILED, API_ERROR, NOT_PROFESSIONAL_ACCOUNT, UNKNOWN_ERROR 等。日本語文言直書き禁止規約準拠）
8. 環境変数: `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` / `INSTAGRAM_REDIRECT_URI` / `INSTAGRAM_BETA_USER_IDS`（`.env.example` 追記）。`COOKIE_SECRET` は既存を共用
   - `INSTAGRAM_REDIRECT_URI` は Meta App Dashboard の登録値と**完全一致**が必要。**本番で審査に出す方針（§3.2）のため Production スコープに `https://growmate.tokyo/api/instagram/oauth/callback` を設定する**。preview 環境でも動作確認したい場合は Vercel の Preview スコープに別値を置き、その URL も Dashboard に追加登録する
   - `INSTAGRAM_BETA_USER_IDS` は審査期間中のみ値を入れる（1-A で新設。§4 Phase 1-A の限定公開ゲート参照）
9. **App Review 必須成果物（1-B で完了。`disconnectInstagram` 実装後に PP 追記）**:
   - `app/privacy/page.tsx` — 既存 §5「第三者サービスと共同利用」に **Meta Platforms, Inc.（Instagram Graph API）** を追加（Google LLC 等と並列）。§6「データ保持期間と削除方法」に Instagram 連携データの保持・削除を追記。§7「ユーザーの権利と手続き」に Instagram 連携解除手順（`/setup/instagram` の解除ボタン → `disconnectInstagram` で credential および同期済み Instagram データを削除）を既存 GSC 連携解除記載と並列で追記。metadata.description も Instagram を含める
   - **「第三者提供なし」とは書かない**（Meta API 利用は §5 の共同利用先追加で明示。既存 `app/privacy/page.tsx` §5 の Google 等と同型）
   - Meta Data Deletion Callback URL は Phase 1 では設けず、手順ページ方式とする（GrowMate は B2B SaaS でユーザー自身がアプリ内解除可能なため）。将来 Meta から必須化された場合は Phase 1.5 で `/api/instagram/data-deletion` を追加
10. **App Review 提出**: 1-B item1〜9 が揃い、§3.2 提出ゲート（外部テスト可能 + 対象パーミッションで成功 API コール）を満たした時点で申請する。提出物は **§3.2「スクリーンキャストの要件」に従い、パーミッションごとに1本ずつ**（`instagram_business_basic` / `instagram_business_manage_insights`）+ 各パーミッションの利用目的の説明。**日本語 UI のため英語キャプション・注釈を付ける**（無注釈で出さない）。利用目的の説明は **1-B の実装画面で見せられる範囲に限定**する（Phase 2 のアカウントインサイト用途まで書くと、画面に無い機能への確認が発生する。同一パーミッション内のため Phase 2 実装後の追記に再審査は不要）
    - **提出前チェック（§3.2 の決定を実行に落としたもの）**:
      - 本番（`https://growmate.tokyo`）にデプロイ済みで、Instagram 機能が `INSTAGRAM_BETA_USER_IDS` により審査用アカウントにのみ見えている
      - 審査用アカウントを作成し（`role: 'trial'`、allowlist に追加）、その Instagram プロアカウントを App Dashboard の Instagram Tester に追加済み
      - 提出フォームの Platform Settings 欄にレビュアーのアクセス手段を記入済み（§3.2「レビュアーのアクセス手段」）
      - 連携ボタンがブランドガイドラインに準拠し、アプリ内と収録の両方で見えている（§3.2「ログインボタンのブランド準拠」）
      - 収録に `/login` のログアウト状態からの流れが含まれている（§3.2）
      - 収録・レビュー作業中に他ユーザーの個人データが映る画面へ到達できないこと（allowlist 方式なら `/admin/*` は `isAdmin` で弾かれる）
11. **プレビュー取得上限（Phase 1-5 詳細）**:
    - `fetchInstagramPreviewData` は `/me/media` から **最新 K=3 件**（`posted_at` 降順）のみ insights を取得する（1件1 API コール × 10s timeout のため全件取得は禁止）
    - 部分失敗時: 取得できた投稿のみカード表示し、失敗件数を Alert（`ERROR_MESSAGES.INSTAGRAM.API_ERROR` または「一部の投稿データを取得できませんでした（N件）」）で表示。プロフィール取得失敗時はプレビュー全体をエラー表示（空画面にしない）
    - 投稿0件の場合は「投稿がありません」プレースホルダーを表示（審査画面が真っ白にならないこと）

**App Review は Phase 1-B 完了時点で提出する**（instagram_business_basic + instagram_business_manage_insights、実 OAuth 連携画面のスクリーンキャストを添付）。**Phase 2 は審査通過後に着手する**。審査待機中に進められるのは UI/デザイン調整など Meta 非依存の作業のみ。

### Phase 2: データ同期 + analytics 一覧（タブ化）

**ゴール: `/analytics` が「ブログ」「Instagram」タブに分かれ、Instagram タブにスプレッドシート相当の投稿一覧＋指標が出る。**

※ タブ切替方式は 2026-07-22 定例で提案しクライアント同意済み（「どういう形がいいかは分からないが、まず連携から」との温度感のため、UI 詳細は Phase 2 着手時に管理表を見せてもらい再確認する）。

0. **限定公開の解除**: 審査通過を確認したら `INSTAGRAM_BETA_USER_IDS` を空にする。`canAccessInstagram` が §7 の通常ロール判定にフォールバックし、Q4 の開放範囲（admin / paid / trial）に戻る。**コード変更は不要**。解除後に `/setup` の Instagram カードが対象ロール全員に出ることを確認する
1. テーブル追加（§5）: `instagram_media` / `instagram_media_insights_daily` / `instagram_account_insights_daily`
2. `src/server/services/instagramSyncService.ts` — 同期本体:
   - `/me/media` を cursor で辿り直近50件を upsert（打ち切り時は件数をログ）
   - **メディアフィルタ**: `media_product_type` が `FEED` / `REELS` **以外**（STORIES 等、§2 非スコープ）は **DB upsert せずスキップ**し、`console.warn('[Instagram Sync]', { skipped, reason: 'unsupported_product_type', media_product_type })` を出力。CHECK 制約違反で同期全体が失敗しないこと
   - 各メディア（FEED/REELS のみ）の insights を取得し、`instagram_media` に最新値を反映＋当日分を `instagram_media_insights_daily` にスナップショット（日次推移用）
   - アカウント insights: **`last_synced_at` が null の初回同期は直近 D=30 日分**（昨日まで）を取得。2回目以降は `last_synced_at` の日付〜昨日までを upsert（欠損日は API 応答に従い補完）
   - 部分失敗は投稿単位で continue し、**必ず `console.error` でログ**（skipped カウントのみのサイレント処理禁止）。結果に `{ synced, failed, skipped, truncated }` を含める
3. 同期トリガー（**専用インポート画面は設けない**。既存3系統の実装調査の結果、GA4は`/setup/ga4`内ボタンのみ・GSCは`/gsc-import`と`gsc-dashboard`inline最新化を併存と、実装は都度判断されておりパターンは一様でない。Instagramは同期パラメータが固定（直近50件・直近30日）でGSC importのような期間フォームが不要な点、既にhourly cronで自動同期がある点から、GSC dashboard の `OverviewTab.tsx` inline「最新化」と同じ**確認ダイアログ + 単一トースト**方式を採用する）:
   - 手動: Instagram タブの「最新化」ボタン（`RefreshCw`アイコン）→ 確認 `Dialog`（`OverviewTab.tsx:153-186` と同型）→ Server Action。**結果メッセージは `getInstagramSyncToastMessage(result)` ヘルパーに集約**し（`getQueryImportToastMessage` と同型）、成功/部分失敗/要再認証/打ち切りの分岐をそこに閉じ込めて呼び出し側に判定ロジックを持たせない。**ダイアログ文言・トースト文言・結果 UI の詳細は §11.3 が正本**（ここには重複して書かない）
   - 自動: `app/api/cron/instagram-sync/route.ts`（`CRON_SECRET` Bearer 検証、`maxDuration = 300`、`gsc-evaluate` と同型のユーザーバッチ処理）を `.github/workflows/hourly-cron.yml` の matrix に追加:
     ```yaml
     - id: instagram-sync
       path: /api/cron/instagram-sync
       profile: count-batch   # success / data.failed を検証（hourly-cron.yml コメント参照）
       interval: hourly
     ```
     **トークン延長もこの cron 内で実施**（期限7日前を切った credential を refresh）
   - **`truncated` の扱い**: 50件上限で打ち切った場合 `truncated: true` をレスポンスに含め **`console.warn` で記録するが cron ジョブ自体は成功扱い**（意図した上限動作のため `count-batch` profile の失敗条件に含めない）。`failed > 0` のみ workflow 警告対象
4. UI: `app/analytics/AnalyticsClient.tsx` をタブ化（R-2）。**タブ UI は Instagram 連携済みユーザーにだけ出す（2026-07-25 決定）**:
   - **未連携ユーザーの `/analytics` は現行のまま**（タブバーを出さない）。`/analytics` は作業画面であり、使わない機能のタブを常設しない。発見導線は `/setup` の Instagram カード（§11.1）が既に担っているので二重に持たない
   - この方式なら **限定公開ゲート（§4 Phase 1-A）の参照箇所を増やさずに済む** — allowlist 外のユーザーは連携できない → 連携済みにならない → タブも出ない、が推移的に成立する
   - 未連携ユーザーが `?tab=instagram` を直接開いた場合は `blog` にフォールバックする（§11.3 の「未指定時は `blog`」と同じ扱い）
   - 連携解除するとタブは消え、現行レイアウトに戻る
   - Instagram タブ（連携済みユーザーのみ）:
     - 投稿一覧テーブル: サムネイル、種別（リール/フィード/カルーセル）、キャプション冒頭、投稿日、リーチ、視聴数(views)、いいね、コメント、保存、シェア、総インタラクション、リールは平均視聴時間。permalink への外部リンク
     - 種別フィルタ（リール/フィード）、期間フィルタ（`posted_at` 範囲指定。開始日～終了日）、ソート（投稿日 / リーチ / views）
     - ページネーションは既存ブログ一覧と同じ URL パラメータ + `Link` 方式（`ig_page` など名前空間を分けてブログ側の `page` と衝突させない）
5. データ取得: Server Component（`app/analytics/page.tsx`）の既存 `Promise.all` に **`getInstagramConnectionStatus`** を追加し、その結果でタブ表示を分岐する。連携済みかつ `tab=instagram` のときだけ `instagramMediaService.getPage(userId, ...)` も取得する（未連携ユーザーに Instagram の DB クエリを走らせない）。PostgREST `db-max-rows = 1000` 制限があるため一覧はページング取得（10件/頁）とし、全件突合は行わない

### Phase 3: AI チャット連携（台本作成）

**本仕様は方針のみ。別仕様で `llm-context-memory` Review Checklist（Context Assembly Contract・token budget 等）を充足するまで実装着手禁止。**

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

- RLS: **`SELECT` のみ** `get_accessible_user_ids(auth.uid())` ベース（オーナー/スタッフ共有モデルを崩さない）。**`INSERT` / `UPDATE` / `DELETE` ポリシーは意図的に設けない** — `google_ads_credentials`（`20260127090000`）は SELECT/INSERT/UPDATE/DELETE の4ポリシーを持つが、Instagram credential は access_token を含むため **JWT 経由の write 経路を完全に遮断**し、OAuth callback・トークン refresh・連携解除はすべて **Service Role + 明示的 `.eq('user_id', userId)`**（`supabaseService.saveInstagramCredential` 等）経由のみとする
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

- 対象ロール: **admin / paid / trial に開放**（`unavailable` のみ `authMiddleware` の 403 で除外。2026-07-23 決定）。これは既存 Google 系連携（GSC / GA4 / Google Ads）と同一の扱い — 既存もロール制御を持たず `unavailable` 除外のみ。**Instagram 独自の恒久的なロールゲートは追加しない**。Phase 3 の台本作成チャットは既存のトライアル日次制限（`checkTrialDailyLimit`）にそのまま乗せる
- **限定公開ゲート（審査期間中の一時措置。2026-07-25 決定）**: 上記の開放範囲は **Phase 2 以降の最終形**であり、App Review 通過までは `canAccessInstagram`（`src/server/lib/instagram-permissions.ts`）が `INSTAGRAM_BETA_USER_IDS` の allowlist で対象を絞る。**環境変数が空なら上記のロール判定にフォールバック**するため、Phase 2 冒頭で変数を空にすれば最終形に戻る（§4 Phase 1-A / Phase 2 item0）。**`role: 'admin'` をゲートに使わない** — レビュアーに admin を渡すと `/admin/users` から全ユーザーの個人データが見えてしまうため（§4 Phase 1-A 参照）
- Service Role 使用箇所: **OAuth callback（credential upsert）・トークン refresh 更新・連携解除（credential + Phase2 media purge）・cron 同期・手動同期**。いずれも明示的 `user_id` スコープ必須。認証ユーザー JWT からの write 経路は設けない
- `INSTAGRAM_APP_SECRET` はサーバーのみ。クライアント・LLM 入力に credential/token を一切出さない
- OAuth state は HMAC 署名 + httpOnly Cookie + セッション整合チェック（既存3系統と同一水準）

## 8. 受け入れ条件・検証

### Phase 1-A（ハードコーディング UI モック・クライアント合意用）
- [ ] `DEV_SAMPLE_*` を切り替えることで `/setup/instagram` が未設定・接続OK・要再認証・投稿0件・部分失敗の5状態を画面表示できる
- [ ] `/setup` ハブに Instagram カードが出て connected / needsReauth / unlinked が区別表示される（Badge 文言は §11.1 準拠: 接続OK / 未設定 / 要再認証）
- [ ] ERROR_MAP 経由でエラー Alert が表示される（state 改ざん等のエラー種別ごとの文言差し替えを確認）
- [ ] `NODE_ENV==='production'` ビルド（`npm run build && npm run start` 相当）で `DEV_SAMPLE_*` 分岐に到達しないことを確認済み
- [ ] `INSTAGRAM_BETA_USER_IDS` に自分の user_id だけを入れた状態で、allowlist 外のユーザーには `/setup` の Instagram カードが出ず `/setup/instagram` も開けない
- [ ] `INSTAGRAM_BETA_USER_IDS` を空にすると §7 のロール判定に戻り、対象ロールに開放される（Phase 2 item0 の解除手順の先行検証）
- [ ] クライアント（カオルさん）へ画面共有し、§11 ワイヤーフレームとの差分（Q2 の列構成含む）を確認済み

### Phase 1-B（実データ連携 + App Review 提出）
- [ ] テスターアカウントで `/setup/instagram` から実際に連携でき、プロフィール（username, フォロワー数等）・**最新3件**の投稿・インサイトが実 API 経由で画面に表示される（部分失敗時は取得分のみ表示 + Alert）
- [ ] 認可拒否・state 改ざん時に ERROR_MAP 経由でエラー Alert が表示され、credential が壊れない
- [ ] 連携解除で credential が削除され unlinked に戻る
- [ ] **`/privacy` に Instagram API 利用・Meta 共同利用・取得データ・削除手順（連携解除）が追記されている**（`disconnectInstagram` 実装後。App Review 提出物）
- [ ] 本番（`https://growmate.tokyo`）にデプロイされ、Instagram 機能が allowlist で審査用アカウントにのみ見えている（§3.2 審査環境）
- [ ] 審査用アカウント（`role: 'trial'` + allowlist）でログイン〜連携〜プレビュー表示まで通しで動作する。`/admin/*` には到達できない
- [ ] 提出フォームの Platform Settings 欄にレビュアーのアクセス手段を記入済み
- [ ] 連携ボタンが Meta ブランドガイドラインに準拠し、アプリ内と収録の両方で見えている
- [ ] 実 OAuth 連携画面のスクリーンキャストを Meta App Review に提出済み（§3.2 提出ゲート充足）。**パーミッションごとに1本**・ログアウト状態からのログインフロー込み・英語キャプション付き

### Phase 2
- [ ] **未連携ユーザーの `/analytics` が現行のまま**（タブバーが出ない）。既存ブログ一覧の挙動もレイアウトも不変
- [ ] 連携済みユーザーの `/analytics` にブログ / Instagram タブが出て、ブログ側の挙動（フィルタ・ページネーション・URL パラメータ）が不変
- [ ] 未連携ユーザーが `?tab=instagram` を直接開くと `blog` にフォールバックする
- [ ] 連携解除するとタブが消え、現行レイアウトに戻る
- [ ] Instagram タブに投稿一覧＋指標が表示され、種別フィルタ・ソートが機能する
- [ ] 手動更新・hourly cron（`profile: count-batch`）の両方で同期され、`last_synced_at` が進む
- [ ] 初回同期でアカウント insights が直近30日分取り込まれる
- [ ] STORIES 等非スコープ `media_product_type` が来ても同期全体が失敗せず skipped ログが出る
- [ ] 50件打ち切り時 `truncated: true` がログに残り cron は成功扱い
- [ ] 連携解除で credential + media/insights が purge される
- [ ] トークンが cron で自動延長される（期限7日前）
- [ ] 未連携ユーザーへの連携導線は `/setup` の Instagram カード（§11.1）のみで、`/analytics` には出さない

検証は `quality-gate` に従い `npm run verify`（audit → lint → test → build → knip）+ 上記画面の手動確認。純関数（インサイト整形・期限判定 `ensureValidInstagramToken` の分岐・cursor ページング処理）には vitest を追加する。

## 9. 未確定事項（実装前に要確認）

- ~~Q1. 複数アカウント~~: **回答済み（2026-07-23）** — 1ユーザー=1 Instagram アカウント。§5.1 の `unique(user_id)` 設計を確定とする
- **Q2. 現行管理表の項目**: 2026-07-22 定例で管理表の画面共有あり（テーマストック → 台本/キャプション/サムネコピー → 結果記録の構成）。一覧に出すべき列・並び順の正は Phase 2 着手時に管理表を共有してもらい確定する
- **Q3. 日次推移の要否**（Phase 2 着手前までに確認で可）: 投稿ごとの指標の日別推移（5.3）は必要か。現在値だけなら Phase 2 が軽くなる。未確定の間、Phase 1 には影響しない
- ~~Q4. 対象ロール~~: **回答済み（2026-07-23）** — admin / paid / trial に開放（`unavailable` のみ除外）。§7 参照。**ただしこれは Phase 2 以降の最終形**で、App Review 通過までは `INSTAGRAM_BETA_USER_IDS` の allowlist で限定公開する（2026-07-25 決定。§7 / §4 Phase 1-A / Phase 2 item0）
- ~~Q5. 台本作成の形~~: **回答済み（2026-07-22 定例）** — ステップ制にせず自由壁打ち（相談役）型。詳細は Phase 3 冒頭参照

なお 2026-07-22 定例のクライアント要望として「チケットに書かれた手段を鵜呑みにせず、目的を確認した上でより軽い代替案があれば先に提案してほしい」がある。上記 Q1〜Q4 の確認時も、選択肢と推奨案をセットで提示する。

## 10. 影響する既存画面・機能

- `app/setup/page.tsx` / `src/components/SetupDashboard.tsx`（Instagram カード追加。**表示は `canAccessInstagram` でガード** — 審査期間中は allowlist 外に出さない）
- `app/setup/instagram/page.tsx` / `src/components/InstagramSetupClient.tsx`（新規。同じくガード）
- `src/server/lib/instagram-permissions.ts`（新規。限定公開ゲート。§7 / §4 Phase 1-A）
- `app/analytics/page.tsx` / `AnalyticsClient.tsx`（**連携済みユーザーのみタブ化**。未連携ユーザーの画面は現行のまま変えない — §4 Phase 2 item4 / §11.3）
- **`app/privacy/page.tsx`（Instagram API セクション追記 — Phase 1-B / App Review 必須）**
- `src/server/services/supabaseService.ts`（Instagram credential CRUD 追加）
- `.github/workflows/hourly-cron.yml`（matrix に `instagram-sync` / `profile: count-batch` 追加）
- `src/domain/errors/error-messages.ts`（INSTAGRAM 追加）
- R-1 実施時のみ: `src/server/lib/oauth-flow.ts`（新規）、Instagram OAuth start/callback から state 検証ヘルパーを利用
- チャット本体（Phase 3 まで変更なし）

## 11. UI/UX イメージ（ワイヤーフレーム）

`growmate-ui-ux` スキル準拠: shadcn/ui primitives のみ・セマンティックトークン・lucide-react アイコン・日本語ラベル・状態（未連携/連携済み/要再認証/エラー/空/ローディング）の明示。ビジュアル刷新はしない（既存 `/setup/ga4` 系の見た目を踏襲）。

### 11.1 `/setup` ハブ — Instagram カード追加（Phase 1）

既存 `SetupDashboard.tsx` のカード列に1枚追加。1カード1主アクション。

```text
┌─ Card ──────────────────────────────────────┐
│ [Instagram icon] Instagram連携   [Badge]    │  Badge: 接続OK(default+green) /
│ リール・フィード投稿の実績データを取得します │        要再認証(default+orange) /
│                                              │        未設定(secondary+gray)
│ 連携アカウント: @username（接続OK時のみ）    │
│                          [設定へ →] Button   │  → /setup/instagram
└──────────────────────────────────────────────┘
```

- Badge 文言・色は `SetupDashboard.tsx:277-290`（GSC カード）準拠: 接続OK=`variant="default"` + `bg-green-100 text-green-800`、要再認証=`variant="default"` + `bg-orange-100 text-orange-800`（**destructive は使わない**）、未設定=`variant="secondary"` + gray。GA4 カード（`SetupDashboard.tsx:561-565`）と同一文言
- ステータス取得中は他カード（GSC 等）と同型: `Loader2` スピナー + `Badge variant="secondary" className="text-xs"`「確認中」（`SetupDashboard.tsx:269-275` 準拠）。
- `needsReauth` 時はカード内に注意文言（AlertTriangle アイコン +「Instagramの再認証が必要です」）。GSC/GA4 カードと同一パターン（`SetupDashboard.tsx:255,298` 準拠）。

### 11.2 `/setup/instagram`（Phase 1、`InstagramSetupClient.tsx`）

`Ga4SetupClient.tsx` と同一構成（戻るリンク → 成功/エラー Alert → ステータス Card → プレビュー Card）。成功 Alert は `app/setup/google-ads/page.tsx:70-97`（Google Ads 型）を踏襲。

**OAuth 成功 / 解除成功（searchParams）**

`?connected=1`（OAuth callback 成功時、`page.tsx` で解釈）:

```text
┌─ Alert (success/green) ────────────────────────┐
│ ✓ 連携完了                                      │
│   Instagram アカウントとの連携が完了しました。   │
│   連携アカウント: @username                     │
└──────────────────────────────────────────────┘
```

`?disconnected=1`（`disconnectInstagram` 成功時）:

```text
┌─ Alert (success/green) ────────────────────────┐
│ ✓ 連携を解除しました                            │
│   Instagram 連携を解除しました。再度連携する    │
│   場合は「Instagramと連携する」から手続きして   │
│   ください。                                    │
└──────────────────────────────────────────────┘
```

**状態A: 未連携**

```text
[← セットアップに戻る]

（?error= がある場合のみ）
┌─ Alert (destructive) ────────────────────────┐
│ ⚠ ERROR_MAP[error] の文言                    │
│   例:「Instagramとの連携がキャンセルされま   │
│   した。もう一度お試しください」             │
└──────────────────────────────────────────────┘

┌─ Card: 連携ステータス ───────────────────────┐
│ 連携ステータス                [未連携 Badge] │
│                                              │
│ Instagramのプロアカウント（ビジネス/クリエ  │
│ イター）と連携すると、投稿の実績データを    │
│ 自動で取得できます。                         │
│ ※個人アカウントは連携できません             │
│                                              │
│ [Instagramと連携する] Button（主アクション） │  → /api/instagram/oauth/start
└──────────────────────────────────────────────┘
```

**状態B: 連携済み（正常）**

```text
┌─ Card: 連携ステータス ───────────────────────┐
│ 連携ステータス   [連携済み Badge] [更新]     │  ← RefreshCw アイコン
│                                              │
│ (○) @username ・ アカウント種別: ビジネス   │  ← profile_picture_url。
│ フォロワー 1,234 / フォロー 56 / 投稿 78     │    失効時は代替アイコン表示
│                                              │  ← Phase1: last_synced_at は非表示
│                                              │    （同期は Phase2。更新=プレビュー再取得）
│ [連携を解除] Button (outline/destructive)    │  → 確認ダイアログ必須（破壊的操作）
└──────────────────────────────────────────────┘

┌─ Card: 最新の投稿プレビュー（最大3件） ─────┐
│ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│ │ サムネ    │ │ サムネ    │ │ サムネ    │      │  ← 横並びカード（モバイルは縦積み）
│ │ [リール]  │ │ [フィード]│ │ [リール]  │      │  ← 種別 Badge
│ │ 7/20 投稿 │ │ 7/18 投稿 │ │ 7/15 投稿 │      │
│ │ リーチ 5.2k│ │ リーチ 1.1k│ │ リーチ 890 │     │
│ │ 視聴 12k  │ │ いいね 45  │ │ 視聴 2.3k │      │
│ │ 保存 320  │ │ 保存 12   │ │ 保存 80   │      │
│ │ [投稿を見る↗]│ ...       │ ...        │      │  ← permalink 外部リンク
│ └──────────┘ └──────────┘ └──────────┘      │
│ ※読み込み中は skeleton 3枚。               │
│ ※投稿0件:「投稿がありません」プレースホルダ │
│ ※部分失敗: 取得分のみ + Alert「一部の投稿   │
│   データを取得できませんでした（N件）」      │
└──────────────────────────────────────────────┘
```

**状態C: 要再認証** — 状態Bの Badge を「要再認証」(default+orange、`SetupDashboard` 同型) に差し替え、Card 冒頭に Alert:

```text
┌─ Alert (orange/warning) ─────────────────────┐
│ ⚠ Instagramの認証が期限切れです。再連携して │
│   ください。          [再連携する] Button    │  ← SetupDashboard / google-ads 要再認証 Alert 同型
└──────────────────────────────────────────────┘
```

- 連携ボタン押下中は disabled + Loader2 スピナー（連打防止）。
- 「更新」= `fetchInstagramPreviewData` 再実行（**プレビュー再取得**。Phase1 に同期 cron はない）。実行中は RefreshCw を回転表示。**`last_synced_at` の表示は Phase2 の `/analytics` Instagram タブのみ**（Phase1 セットアップ画面では出さない）。
- 用語補足: 「リーチ」「保存数」等は初出でツールチップまたは括弧書き（例: リーチ＝投稿を見た人数）。

### 11.3 `/analytics` タブ化（Phase 2）

`Ga4DashboardClient.tsx:435` の Tabs パターン。既存ブログ一覧は `TabsContent value="blog"` に無変更で内包。

**タブ UI は Instagram 連携済みユーザーにだけ出す**（§4 Phase 2 item4）。未連携時は `Tabs` で包まず、下記「未連携時」の現行レイアウトをそのまま返す。

```text
【未連携（既存ユーザーの大半）】— 現行のまま。タブバーを出さない
ページヘッダ（h1「コンテンツ一覧」 + 操作ボタン群）
┌─ Card: ブログ一覧（フィルタ + テーブル + ページネーション）─┐
└──────────────────────────────────────────────┘
  ※ /analytics には Instagram の連携導線を置かない（導線は §11.1 の /setup カード）

【連携済み】
ページヘッダ（既存のまま: タイトル + 操作ボタン群）

┌─ TabsList (grid grid-cols-2 h-12) ───────────┐
│ [FileText ブログ]    [Image Instagram]       │  ← lucide-react。tab= に同期
└──────────────────────────────────────────────┘

▼ TabsContent value="instagram"

┌─ ツールバー ─────────────────────────────────┐
│ 種別: [すべて|リール|フィード]  期間: [開始]〜[終了] │
│ 並び順: [投稿日▼]      [RefreshCw 最新化]        │  ← クリックで確認 Dialog（下記）
│ 最終同期: 2026-07-23 10:00                    │  ← last_synced_at。未同期時は非表示
└──────────────────────────────────────────────┘

「最新化」クリック時（`OverviewTab.tsx:153-186` 同型の確認 Dialog）:
┌─ Dialog ──────────────────────────────────────┐
│ Instagramデータの同期                          │
│ Instagramから最新の投稿・指標を取得し、一覧を  │
│ 更新します。直近50件の投稿が対象です。         │
│                     [キャンセル] [同期を実行]  │
└──────────────────────────────────────────────┘
  → 確認後ダイアログを閉じ `toast.loading('Instagramデータを取得中...')`
  → 完了時に同一トーストを更新（結果は下記「同期結果」参照）

┌─ Card: 投稿一覧 Table ───────────────────────┐
│ サムネ│種別  │キャプション│投稿日│リーチ│視聴│…│
│ ──────┼──────┼────────────┼──────┼──────┼────┼─│
│ [img] │リール│養鶏を始めて…│7/20 │5,200 │12k │…│  ← 行末に [↗] permalink
│ [img] │フィード│卵かけご飯…│7/18 │1,100 │ -  │…│  ← フィードは視聴時間系 "-"
│ …                                            │
│              [← 前へ]  1 / 5  [次へ →]       │  ← ig_page パラメータ + Link
└──────────────────────────────────────────────┘
```

- **URL パラメータ契約**（ブログ既存キー `page` / `start` / `end` / `category` / `uncategorized` / `unread_suggestion` は Instagram タブでも**変更・上書きしない**）:
  - `tab`: `blog` | `instagram`。**未指定時は `blog`**（既存 `/analytics?...` のリグレッション防止）。**未連携ユーザーが `tab=instagram` を指定した場合も `blog` にフォールバック**する（タブ UI 自体が無いため）
  - タブ切替は `router.push` / `Link` で URL 更新必須（`Ga4DashboardClient.tsx:435` の `defaultValue` 非 URL 同期パターンは**踏襲しない**）
  - タブ切替時の頁リセット: **切替先タブの頁パラメータのみ** 1 にリセット（`tab=instagram` へ切替時は `ig_page=1` をセットし `page` は保持、`tab=blog` へ切替時は `page=1` をセットし `ig_*` は保持）
  - `ig_page`: Instagram タブのページ番号（1始まり）。未指定時 1
  - `ig_type`: 種別フィルタ `all` | `reels` | `feed`。未指定時 `all`
  - `ig_start` / `ig_end`: 期間フィルタ（ISO 日付 `YYYY-MM-DD`）。未指定時は直近30日（ブログの `start`/`end` とは**独立**）
  - `ig_sort`: ソートキー `posted_at` | `reach` | `views`。未指定時 `posted_at` desc
- 列構成（初期案。Q2 の管理表確認で最終確定）: サムネイル / 種別 Badge / キャプション冒頭（1行省略）/ 投稿日 / リーチ / 視聴数 / いいね / コメント / 保存 / シェア / 総インタラクション / 平均視聴時間（リールのみ）/ リンク。横スクロールは `overflow-x-auto` で許容しつつ、列の意味をヘッダツールチップで補足
- **未連携時**: テーブルの代わりに空状態カード —「Instagramが未連携です。連携すると投稿の実績が表示されます」+ [連携設定へ] Button（→ `/setup/instagram`）。サイレント空表示にしない
- **連携済みだが同期0件**: 「まだデータがありません。［最新化］を押すと取得します」
- **同期結果 UI**（`getInstagramSyncToastMessage(result)` に集約。`OverviewTab.tsx` の `getQueryImportToastMessage` と同型。§6 エラーパス準拠。**単一の toast を `id` で更新し続ける**方式で、成功時も失敗時も新規 toast を積み増さない）:
  - 成功（`failed=0`）: `toast.success('N件を更新しました', { id: toastId })`。`last_synced_at` をツールバー右に反映
  - 部分失敗（`failed>0`）: `toast.warning('N件中M件の更新に失敗しました', { id: toastId })` + ツールバー直下 Alert（`ERROR_MESSAGES.INSTAGRAM.API_ERROR` または「一部の投稿データを取得できませんでした（M件）」）。取得できた行はテーブルに残す
  - `needsReauth`: `toast.error(..., { id: toastId })` + Alert「Instagramの再認証が必要です」+ [連携設定へ] Button（→ `/setup/instagram`）。サイレントに未連携へフォールバックしない
  - `truncated`: `toast.info('直近50件まで取得しました', { id: toastId })`（cron は §4 Phase2-3 どおり成功扱い）
  - **文言の置き場所**: トースト文言は `getInstagramSyncToastMessage` を置く `src/lib/instagram-sync.ts` に直書きする（`getQueryImportToastMessage` が `src/lib/gsc-import.ts` に直書きしている先例に倣う）。**`ERROR_MESSAGES` へは入れない** — 役割分担は「`ERROR_MESSAGES` = エラー種別の正本（種別ごとに1文言、エラーパスから参照される）」「トースト = 実行結果サマリの整形（件数を埋め込む可変文、結果オブジェクトからしか作れない）」。`needsReauth` / 部分失敗の **Alert 側は `ERROR_MESSAGES.INSTAGRAM.*` を参照する**ので、同じ画面で両方が併存する。日本語文言直書き禁止規約の対象は前者であり、後者は対象外
- ブログタブ側のフィルタ・ページネーション UI は一切変更しない（受け入れ条件: リグレッションなし）

### 11.4 Phase 3 導線（参考。詳細設計時に確定）

- Instagram タブ各行に「台本作成」ボタン → `/chat?ig_media=<id>`
- チャット側では通常のメッセージ UI に集約（キャンバス側に操作を増やさない。§1.6 準拠）

## 12. 参考（調査済み既存実装）

- OAuth **エラー UX 正本**: `app/api/google-ads/oauth/callback/route.ts`（失敗時 redirect）、`app/setup/google-ads/page.tsx`（ERROR_MAP）
- OAuth state 検証: `src/server/lib/oauth-state.ts`
- GSC callback（**JSON 応答。Instagram には非参照**）: `app/api/gsc/oauth/{start,callback}/route.ts`
- credential CRUD 参照: `SupabaseService.saveGoogleAdsCredential`（初回 upsert）/ `updateGscCredential`（token 部分更新）/ `getGoogleAdsCredential` / `deleteGoogleAdsCredential`
- ステータス判定: `src/server/lib/gsc-status.ts`, `ga4-status.ts`
- 同期バッチ: `src/server/services/gscEvaluationService.ts`, `app/api/cron/gsc-evaluate/route.ts`
- cron matrix + profile: `.github/workflows/hourly-cron.yml`（`count-batch` プロファイル）
- タブ UI: `app/ga4-dashboard/Ga4DashboardClient.tsx:435`
- **inline 同期の確認 Dialog + 単一トースト正本**: `app/gsc-dashboard/components/OverviewTab.tsx:111-186`（`handleSync`, `isSyncDialogOpen`, `getQueryImportToastMessage` 相当）
- LLM 変数注入: `src/server/services/gscSuggestionService.ts` + `prompt_templates`
