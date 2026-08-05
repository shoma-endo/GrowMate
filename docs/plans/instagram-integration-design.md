# Instagram 連携（Business Login for Instagram）設計書

作成日: 2026-07-23 / ステータス: Phase 1 実装済み・審査提出前 / Phase 2 ローカル開発着手可 / **Phase 3 は保留（2026-08-05 クライアント MTG）**
**本仕様書の完了定義: Phase 2 まで。** Phase 3（AI チャット連携・台本作成）はクライアント判断で保留となり、評価機能の実装を優先する（§4 Phase 3）。
クライアント合意: 2026-07-22 定例MTG（Lark minutes `objpyf287e2otlex7a1m8n25`）で「まず連携（審査申請）から進める」ことを合意済み

## 1. 背景・目的

- 現在 [Adzviser](https://adzviser.com/) + スプレッドシートで行っている Instagram のリール・フィード投稿の実績管理を GrowMate に内製化する。**対象は Instagram 連携以降に GrowMate が取得する投稿のみ**（Adzviser / スプレッドシートに既にある過去分は移行しない — §2 / §9 Q8）。
- ~~取得したインサイトデータを土台に、`/chat` で AI と壁打ちしながらリール台本を作成できる状態を最終ゴールとする。~~ → **2026-08-05 変更: この最終ゴール（Phase 3）は保留**。本仕様書のゴールは「Instagram の実績データを GrowMate 上で一覧・蓄積できる状態」（Phase 2 まで）に縮小する。台本作成は将来の別テーマとして残す（§4 Phase 3）。
- Meta の App Review（Advanced Access）提出に向け、**Phase 1-A でクライアント合意用の UI モック（ハードコーディング）を先に作り、Phase 1-B で OAuth 連携・実 Graph API（`/me`・`/media`・`/insights`）・プライバシーポリシー追記・連携解除を実装したうえで審査提出する**（Meta 公式要件: 外部テスト可能＋対象パーミッションで最低1回の成功 API コール＋パーミッション別スクリーンキャスト。詳細は §3.2 / §4 参照）。
- **Phase 2 の着手時期を変更（2026-08-04）**: 当初は「Phase 2 以降は審査通過後に着手する」としていたが、**審査提出を待たずにブランチを切ってローカル開発を進める**方針に変更した。スタンダードアクセスでもアプリに役割を持つユーザー（Instagram Tester 承認済みのプロアカウント）なら対象パーミッションが動くため（§3.2、実績は §8 の成功 API コール件数）、Phase 2 の実装・検証はテスターアカウントで完結する。**ただし本番反映は審査提出・通過の完了後**とする（制約の全量は §4 Phase 2 冒頭「着手条件」）。

## 2. スコープ / 非スコープ

### スコープ（取得データ）

| 分類 | 内容 | API |
|------|------|-----|
| アカウント情報 | ig_user_id, username, name, account_type, profile_picture_url, biography, website, followers_count, follows_count, media_count | `GET /me?fields=...` |
| 投稿一覧 | id, media_type (IMAGE/VIDEO/CAROUSEL_ALBUM), media_product_type (FEED/REELS), media_url, thumbnail_url, caption, timestamp, permalink, like_count, comments_count | `GET /me/media?fields=...`（cursor ページネーション） |
| 投稿インサイト | reach, views, likes, comments, saved, shares, total_interactions, **reposts**, **reels_skip_rate**（リールは加えて ig_reels_avg_watch_time, ig_reels_video_view_total_time）。**`reposts` / `reels_skip_rate` は 2026-08-05 追加**（クライアントが実際に見ている画面に出ているため — §3.3「Instagram アプリ画面との突き合わせ」） | `GET /{media-id}/insights?metric=...` |
| アカウントインサイト | reach, views, accounts_engaged, total_interactions, follower_count（日次）。**`profile_views` / `website_clicks` は 2025-01-08 に全バージョンで廃止済みのため採用しない**（§3.3）。**後継候補だった `profile_links_taps` も採用しない**（`contact_button_type` に `WEBSITE` が無い）。**「プロフィール閲覧数」は後継指標が存在せず取得不能のためスコープ外** | `GET /me/insights?metric=...&period=day` |

### 非スコープ

- **AI チャット連携・リール台本作成（旧 Phase 3）— 2026-08-05 に保留となり本仕様書のスコープ外**（§4 Phase 3）
- **既存の Adzviser + スプレッドシートに蓄積した過去実績の移行（2026-08-05 決定。§9 Q8）**。GrowMate は**連携以降の投稿だけ**を扱う。CSV 取込等の移行機能は作らない。過去分はスプレッドシート側に残す
- **Instagram アプリのインサイト画面には出るが、API に存在しないもの（2026-08-05 にクライアント提供のスクリーンショットと突き合わせて確定）**。以下は**取得手段が無いため実装できない**。クライアントとの期待値ずれを避けるため非スコープとして明記する（詳細と根拠は §3.3「Instagram アプリ画面との突き合わせ」）
  - 視聴維持率カーブ（再生位置ごとの残存率グラフ）
  - 投稿ごとの閲覧数の推移（0〜24h の時系列）と「あなたの通常のリール動画」との比較線
  - 閲覧数の上位のソース（フィード / [リール]タブ / 発見 / プロフィールの内訳）
  - 「高 / 低 / 通常」の評価ラベル（Instagram 内部のベンチマーク比較）
  - 投稿ごとの視聴者内訳（フォロワー / フォロワー以外の比率）
  - 投稿ごとのオーディエンス詳細（年齢 / 国 / 性別）
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
  - **実施主体はクライアント側（クライアント向け表現は Help Center の full control を正とする）**。出典 [How to verify your business in Meta Business Suite](https://www.facebook.com/business/help/2058515294227817)（**確認日 2026-08-05**）。公式の verbatim:
    > You must have full control of the business portfolio. Full control is the highest permission level for a business portfolio, allowing you to manage all settings including verification.
    >
    > A decision on your verification submission may take up to 14 business days.
    >
    > Confirm your business details. If no matching record is found, then you can select My business isn’t listed or None of these match. In this case, you may be asked to upload official documents, such as a business license or articles of incorporation, to confirm the details you entered.
  - **解釈**: クライアントへは「ビジネスポートフォリオの **full control（最高権限）** を持つ人が Security Center から申請する」と伝える。**口頭の「全権限」は使わない**（Developer 向け [Business Verification](https://developers.facebook.com/documentation/development/release/business-verification) には Admin ロールの記述も残るが、Business Suite 手順の一次情報は上記 Help Center）
  - **進行順序**: ビジネス認証はアプリ作成・疎通確認・収録の**前提ではない**。①アプリ作成 → Tester 追加 → 開発側の実装・収録と、②クライアント側の認証申請を**並行**で進め、両方揃った時点で App Review を提出する（14営業日のリードタイムを吸収するため）。**2026-08-01 時点でクライアント側のビジネス認証は完了済み**
- **アクセス認証（Access Verification）はビジネス認証とは別制度（2026-08-01 調査）**: 出典は [Access Verification](https://developers.facebook.com/docs/development/release/access-verification/)。Tech Provider に該当するかを判定する手続きで、対象パーミッション一覧に `instagram_business_basic` が含まれるため GrowMate でも発生する。
  - 制度上は "Access verification is independent of App Review and permission access levels." と明記されている。**ただし後述のとおり、UI 上は審査追加の手前に技術提供者の宣言が挟まる**
  - **こちらが先回りして着手することはできない**。"Business admins ... will receive an email notification about the access verification requirement **whenever an app administrator requests Advanced Access** for any of the permissions listed above." → **起点は開発側の Advanced Access 申請**であり、クライアントから先に始める手続きではない
  - 通知後 "business admins will have **60 days** to complete the verification process"、完了後の判断は "within approximately **5 days**"
  - 認証を得られないと、**アプリに役割を持たないユーザー**（＝本番の顧客）の呼び出しが `error code 100` で落ちる。「アクセス許可を付与した人がアプリそのものに対して権限を持っているかどうかをチェックします」→ 持たない場合に技術提供者かどうかが問われる。開発中に動いているのは開発者がアプリの役割を持っているからにすぎない
  - **審査追加の手前に技術提供者の宣言モーダルが挟まる（2026-08-02 実測）**。「アクセス許可と機能」→ `instagram_business_basic` 行の「アクション」→ 「+ アプリレビューに追加」（項目自体は有効でグレーアウトしない）を押すと、次のモーダルが出て先へ進めない。
    > To add a permission or feature to App Review, become a Tech Provider
    > To qualify as a Tech Provider, you must complete access verification.
    > **This decision cannot be reversed after you've been identified as a Tech Provider.**

    ボタンは `Go back` / `Continue`。**未検証**: `Continue` 押下後に、アクセス認証の判定（約5日）を待たずに App Review を提出できるのか。ドキュメントの "independent" はこの意味で今も成立している可能性がある。不可逆なため未確認のまま止めている
  - **メニュー項目が有効に見えることを「前提条件ではない」の根拠にしないこと**。2026-08-02 以前の本節はその推論で「案内であって前提条件ではない」と結論していたが、押した先にゲートがあった。Meta の手続き順序は**実際にボタンを押して**確認する
- **開発者をクライアントのポートフォリオに招待するときの権限（2026-07-29 の詰まりから）**: アプリをクライアントのビジネスポートフォリオ配下に置く構成では、開発者を招待する際に **「部分的なアクセス許可 > アプリと統合」**（旧「開発者」ロール）を選ぶ。公式は「アプリと統合のアクセス許可(以前の開発者の役割)を所有するメンバーは、コンバージョンAPIの設定、イベントのモニタリング、**アプリの編集、アクセストークンの作成**ができます」と定義しており（[アクセス許可について](https://www.facebook.com/business/help/442345745885606)）、Facebook ページ・広告アカウント・Instagram アカウントへのアクセスを伴わない。フルアクセス（全権限）は不要。
  - **実際に踏んだ罠**: 初回招待フローの「アセットを割り当てる」でアプリのチェックボックスが有効にならず、"Developer account needed" の注意書きが出る。原因は開発者登録の不備でもアプリ側の設定不備でもなく、**ポートフォリオ権限の選択**にあった。この事象で丸1日を消費している
  - アプリの役割は App Dashboard ではなく Business Manager 側で管理される（「If your app is connected to a business portfolio, you must use the Business Manager to manage roles for your app.」— [App Roles](https://developers.facebook.com/documentation/development/build-and-test/app-roles)）
- **データ使用状況の確認（承認後の継続義務）**: 「アクセス許可または機能のアドバンスアクセスを持っているアプリは、データの使用状況の確認を完了する必要があります。これは、アプリがFacebookのプラットフォーム利用規約と開発者ポリシーに準拠して、Facebook API、製品、データにアクセスしていることを**1年ごと**に証明するプロセスです」（[アクセスレベル](https://developers.facebook.com/docs/graph-api/overview/access-levels)）。**審査通過は一度きりではなく年1回の対応が必要**で、放置するとアドバンスアクセスが失効し全ユーザーの Instagram 連携が停止する。運用引き継ぎ時にクライアントへ明示すること
- **データ保護アセスメント（DPA。承認後の継続義務。2026-08-01 調査）**: 上記「データ使用状況の確認（DUC）」とは**別制度**（公式も "The Data Protection Assessment is different from Data Use Checkup" と明記）。出典は [Data Protection Assessment](https://developers.facebook.com/documentation/resp-plat-initiatives/individual-processes/data-protection-assessment) と [Data Security Requirements](https://developers.facebook.com/docs/resp-plat-initiatives/data-protection-assessment/data-security)。
  - **アクセストークンは Platform Data に該当する**。[DPA FAQ](https://developers.facebook.com/docs/resp-plat-initiatives/data-protection-assessment/faq) に「"Platform Data" ... includes **app tokens, page tokens, access tokens, app secrets, and user tokens**」とある。`instagram_credentials.access_token` も `INSTAGRAM_APP_SECRET` も対象
  - **保存時暗号化が原則要件**。Q3.1-9 に "**You must encrypt all Platform Data stored within your backend environments.**" とある。ただし代替経路があり、"If you do not protect Platform Data in your backend environment with encryption at rest, you will be asked if your **hosting provider has an ISO 27001 or SOC 2 certificate** that meets certain criteria"、および Q3.1-9.c "If you do not implement encryption at rest in the server side environment, you may be protecting Platform Data in an alternative way that is still acceptable"
  - **GrowMate は代替経路（Q3.1-9.c）で満たす**。[Supabase Security](https://supabase.com/security) より「Supabase is **SOC 2 Type 2** compliant」「Supabase is **ISO 27001** certified」「All customer data is **encrypted at rest with AES-256** and in transit via TLS」。**アプリ側のカラム単位暗号化は DPA 対応として必須ではない**。ただし "certificate that **meets certain criteria**" と条件付きのため、DPA 到来時に Supabase の最新レポートが基準に合致するか確認すること
  - **カラム単位の暗号化は別チケット**。現状 GSC / GA4 / Google Ads / WordPress / Instagram の全トークンが平文（`supabaseService.ts` に `encrypt` は 0 件）。Instagram だけ先行しても効果は薄い（スコープが `instagram_business_basic` / `instagram_business_manage_insights` の**読み取りのみ**で、`adwords`（`src/lib/constants.ts:18`）や WordPress の `global`（`app/api/wordpress/oauth/start/route.ts:57`）より影響が小さい）。着手するなら **Google Ads → WordPress → GSC/GA4 → Instagram** の順で共通ヘルパ1本と移行スクリプトをセットにする
  - **DPA の対象になるかは未確定**（公式は "apps that access certain types of data" としか書いていない）。対象になると**メール・App Dashboard・Alert Inbox に通知が届き、回答期限は 60 日**（"An admin of the app will be given 60 days to complete the assessment or risk losing platform access."）。通知の受け取り漏れを防ぐため、アプリの連絡先メールアドレスと管理者設定を生きた状態に保つ。**運用引き継ぎ時にクライアントへ明示すること**
- **App Review 提出ゲート（Phase 1-B 最小）**: [App Review ガイドライン](https://developers.facebook.com/documentation/instagram-platform/app-review#permission--feature-requests) に基づき、レビュアーが外部からアプリをロード・テストでき（"Confirm that your app can be loaded and tested externally"）、**対象パーミッションで最低1回の成功 API コール**が確認できる状態で提出する。公式は "To request Advanced Access to **certain** permissions, you need to make at least 1 successful API call" と限定表現のため、`instagram_business_basic` / `instagram_business_manage_insights` が該当するかは**実装時に Advanced Access 要件表で確認**する（該当する前提で作れば過不足はない）。具体的には OAuth 連携 → `/me` + `/me/media` + insights 取得 → 画面表示の一連の流れを実装したうえでスクリーンキャストを添付する。
- 審査提出物: **Phase 1-B 実装画面のスクリーンキャスト**（実 OAuth 連携 → 実データ表示）、利用目的の説明、**プライバシーポリシー URL（`/privacy` の Instagram / Meta 追記 — §4 Phase1-B item9。実装済み）**、**データ削除手順（連携解除 — §4 Phase1-B item9 / §5.5）**
- **スクリーンキャストの要件（公式ガイドラインより。録画前に決めること）**:
  - **パーミッションごとに1本用意する**。公式は各リクエストに対し "Describe how your app uses that specific permission or feature" と "Upload a screencast showing the **end-to-end user experience** for that specific permission or feature" を要求する。`instagram_business_basic`（連携 → プロフィール・投稿一覧表示）と `instagram_business_manage_insights`（投稿ごとのリーチ・視聴・保存表示）で分ける
  - **言語**: 公式は "Use English as the app UI language – If possible, please set the app UI language to English before recording the screen recording." と指示する。**GrowMate は日本語専用 UI のため英語化はしない**。代わりに公式が代替として挙げる **英語キャプション・ツールチップで画面要素とボタンの意味を補う**（"Provide captions and tool-tips" / "Explain the meaning of buttons and other UI elements"）。日本語 UI のまま無注釈で提出しない
  - **GrowMate 自身のログインも収録する**。[Screen Recordings](https://developers.facebook.com/docs/app-review/submission-guide/screen-recordings/) は "Capture the entire login flow, from logged-out to logged-in." を求める。Meta ログイン以外の手段で入れる場合もそのフローを収録せよと明記されているため、`/review-login` でアドレスとパスワードを入力 → `/setup/instagram` までを1本に含める（§9 Q6 で確定した案1 の手順そのもの）
  - 解像度は "record in high-resolution, 1080 or better"。**録画が無いパーミッションは承認されない**（"Any requested permission or feature missing a screen recording will not be approved"）

- **審査を行う環境（2026-07-25 決定）**: **本番（`https://growmate.tokyo`）で収録・提出する**。
  - 公式に「URL やアドレスバーを映せ」という要求は無い（Instagram 審査ページ・Screen Recordings ページとも記載なし）。だが **レビュアーは動画を見るだけでなく自分でアプリを触る**（"Confirm that your app can be loaded and tested externally"、[提出ガイド](https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review/submission-guide) の "We will test your app so be sure that we can access it"）ため、到達可能な公開 HTTPS URL が要る
  - **Vercel の preview URL（`growmatetokyo-git-<branch>-...vercel.app`）でも技術的には通せる**（Deployment Protection 無しで外部から開けることを 2026-07-25 に実測確認済み）。ただし採らない。理由: ①承認後に redirect URI を本番へ付け替える手戻りが出る ②審査期間（数日〜数週間）中にそのブランチへ別変更をマージすると、レビュアーが開く画面と収録が食い違う ③一時環境と読める URL はアプリ設定の Website URL と不一致になり追加確認を招く
  - preview で出す場合は必ず **コミット別 URL ではなくブランチエイリアス**を使い、審査提出用ブランチを切ってマージを凍結し、Preview スコープの `INSTAGRAM_REDIRECT_URI` を別値で登録すること
- **レビュアーのアクセス手段（2026-07-31 に一次情報で確定）**: 提出ガイドは Platform Settings 欄に "describe how we can access your app in order to test it" と記入することを求め、"We will test your app using our own test accounts. Do not include your **personal** Meta Technologies app account's credentials." と注意している。認証情報の提供自体は無条件の必須ではない（Instagram 審査ページの該当見出しは "Credentials (**If applicable**)" で本文も "**If needed**, provide any required test credentials for Meta reviewers to log into your app or website."）。**ただし GrowMate では needed 側になる**。根拠は以下の3点。
  - [提出ガイド](https://developers.facebook.com/documentation/resp-plat-initiatives/individual-processes/app-review/submission-guide)（英語原文）の必須項目に "Make sure we can access your app or website. **Your app must be publicly available or you must provide instructions on how to access it.**" とある。GrowMate はログイン必須かつ allowlist ゲート付きで publicly available ではないため、後者（手順の提示）を選ぶしかない
  - 同ガイドの "We will test your app using our own test accounts." が使えるのは Meta 認証を使うアプリのみ。GrowMate は提出フォームの「このプラットフォームには Facebook ログインが統合されていますか？」に**いいえ**と答える構成なので、Meta 側の test account では入れない
  - [Common Mistakes](https://developers.facebook.com/docs/app-review/submission-guide/common-mistakes) の "Your app is inaccessible" に "**If we can't access your app for any reason, your entire submission will be rejected**" とある。パーミッション単位ではなく提出全体の却下
- **レビュアーのログイン手段（制約。2026-07-31 追記）**: GrowMate の認証は**メール OTP のみ**（`app/login/page.tsx` → `src/server/actions/auth.actions.ts` の `supabase.auth.signInWithOtp`。パスワード認証も他プロバイダも無い。`signInWithPassword` は src/app に 0 件）。**提出フォームの認証情報欄に書ける固定値が存在しない**ため、審査用アカウントを作るだけでは前項を満たせない。[Supabase CLI config](https://supabase.com/docs/guides/local-development/cli/config) に `auth.sms.test_otp`（"Use pre-defined map of phone number to OTP for testing."）はあるが、**email 向けの test_otp は存在しない**（同ページ内の `test_otp` の出現は `auth.sms.test_otp` のみ。2026-07-31 に原文で確認）ため、設定だけで回避する道も無い。
  - **採用（2026-08-01 決定。クライアント承認済み。§9 Q6 回答済み）— 案1「審査用1アカウントに限定したパスワードログイン」**: `/review-login` を新設し `signInWithPassword` のみを扱う（実装は `src/server/actions/auth.actions.ts` の `signInWithReviewPassword`）。環境変数 `REVIEW_LOGIN_EMAIL` の有無で**経路の有効化とアドレス限定を兼ねる**（未設定ならページは 404、Server Action も認証に到達せず失敗）。**既存の `/login`・`verifyOtp`・Supabase の新規登録設定は変更しない**ため `client-vision-from-lark.md` §1.6 が警戒する「既存ユーザーの挙動変更」は発生しない（同 §1.6 は禁止ではなく**事前許可**の要求であり、2026-08-01 に許可取得済み）。`full_name` 未登録だと `proxy.ts` が OTP 画面へ戻してレビュアーが詰むため、`verifyOtp` と同じく `isNewUser` を返し専用画面上で `FullNameDialog` を出す
  - **却下（案2）— 審査専用の受信箱を渡す**: 当初こちらを採用したが、2026-08-01 の実測で撤回。審査専用 Gmail の作成直後に「通常とは異なるアクティビティが検出されました」の本人確認が発動し、**確認コードは登録電話番号にしか届かず**、「別の方法を試す」にも選択肢が出ず「アカウント所有者を確認できませんでした」で終端した（2段階認証は無効、再設定用の電話・メールは未登録の状態で発生）。**確認が出た時点でレビュアーに回復手段が無い**＝迂回路ではなく行き止まりであり、"If we can't access your app for any reason, your entire submission will be rejected" に直結する。Google のリスクベース認証の発動条件は非公開のため確率を測れず、測れない確率に提出1回分を賭ける構図になる
  - **審査後の後始末**: GrowMate アカウントは**削除せず** `INSTAGRAM_BETA_USER_IDS` から user_id を外して露出を閉じる。Meta はプラットフォーム上のアプリを定期的に再審査する旨をダッシュボードに明記しており（`設定 > ベーシック` のウェブサイトプラットフォーム内「テストの手順に関する情報」）、§3.2 のデータ使用状況の確認も年1回あるため、消すと再審査のたびに作り直しになる。**`REVIEW_LOGIN_EMAIL` は削除する**（これだけで `/review-login` が 404 になり経路が塞がる）。README の環境変数表の該当行を消すことが撤去チェックリストを兼ねる
- **成功 API コールの有効期限（2026-07-31 追記）**: 提出ガイドに "Make at least 1 successful API call using each permission for which you are requesting advanced access. **Calls must be made within 30 days of submitting for App Review.**" とある。**実 OAuth 疎通で API コールを立てた時点から 30 日以内に提出する**必要があるため、収録・実装・クライアント側の承認とビジネス認証の見通しが立ってから疎通確認を行う。ダッシュボードのアクセス許可一覧に「API呼び出し」件数が出るのでそこで確認する
- **アプリアイコンは 1024x1024 が確定要件（2026-07-31 追記）**: 提出ガイドの必須項目に "Upload a **1024x1024** compliant app icon image to **Settings** > **Basic** > **App Icon**." とある。Instagram 審査ページの Complete App Settings も "App icon (1024x1024)" と明記。リポジトリの `app/icon.png` は 120x120 でベクター元データも無いため、別途 1024 の素材を用意した。**2026-08-01 にアップロード済み**。当初「ネイティブのファイル選択ダイアログが必要で自動化不可」と判断したが誤りで、ドロップゾーンの `onDrop` に `DataTransfer` を渡せば実行できた。切り抜き枠の初期値が画像より内側に寄っているため、四隅を広げないと角丸が欠ける点に注意
- **ログインボタンのブランド準拠**: Instagram 審査ページのチェックリストに "Verify that the login button or link is visible in your app and screencast, and adheres to our brand guidelines" がある。§11.2 の連携ボタンが **Meta のブランドガイドラインに準拠しているか**、および**アプリ内と収録の両方でボタンが見えているか**を実装時に確認する

### 3.3 制約・注意点

- `impressions` は 2024-07-02 以降作成のメディアで廃止 → `views` を使う。
- **アカウントレベル insights は `metric_type=total_value` が必要な指標と、付けると空になる指標が混在する（2026-08-01 実測）**。`instagramService.fetchAccountInsights` は `period=day` のみで7指標を1回で取りに行くが、実際に値が返るのは `reach` と `follower_count` の2つだけで、残り5つはエラーではなく**空のデータ**で返る。`manbou536` の実測値は下記。
  - `metric_type=total_value` を付けると取れる: `views`=33 / `profile_views`=3 / `website_clicks`=0 / `accounts_engaged`=2 / `total_interactions`=2 / `reach`=12
  - `metric_type=total_value` を付けると**逆に空になる**: `follower_count`
  - よって7指標を1回では取れず、**2コールに分ける必要がある**（`total_value` 群 + `follower_count` 単独）。`fetchAccountInsights` は現在**呼び出し元が無く** Phase 1 では未使用のため、修正は Phase 2 の実装時に行う
  - **`metric_type` 付与の要否（どの metric を同じ HTTP コールに載せられるか）は 2026-08-01 実測**。metrics 表の **Type 列（time_series / total_value）は 2026-08-05 に公式照合済み**（下記「アカウント指標名の公式照合」L128–132）
  - **⚠「User Insights は `metric_type` が必須」は誤り（2026-08-05 に外部レビュー指摘を検証して否定）**。公式リファレンス上の**必須パラメータは `metric` / `period` / `access_token` の3つのみ**（`timeframe` は demographics 系のみ必須）。**一律に `metric_type` を付ける実装にすると `follower_count` が空になる**（上記実測）。「必須」ではなく「**指標ごとに付ける/付けないを出し分ける**」が正しい
- **アカウント指標名の公式照合（未決着 — Phase 2 の最初のタスク）**
  - **出典 URL**: [Instagram User Insights](https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights)（mirror: [documentation/instagram-platform/api-reference/instagram-user/insights](https://developers.facebook.com/documentation/instagram-platform/api-reference/instagram-user/insights)）
  - **確認日**: 2026-08-05（spec-review audit iteration 2 で mirror URL `documentation/.../api-reference/instagram-user/insights` を WebFetch 再取得し、Interaction Metrics 表・Type 列を照合）
  - **公式 metrics 表からの verbatim（Interaction Metrics 行の列挙。audit 転記）**:
    > `accounts_engaged`, `comments`, `engaged_audience_demographics`, `follows_and_unfollows`, `follower_demographics`, `impressions`, `likes`, `profile_links_taps`, `reach`, `replies`, `reposts`, `saves`, `shares`, `total_interactions`, `views`
  - **解釈**: 上記一覧に **`profile_views` / `website_clicks` は無く**、`profile_links_taps` **がある**。§2 / §5.4 の暫定列名はこの食い違いを解消するまでマイグレーション不可
  - **公式 Limitations からの verbatim（follower_count。§3.3 既存転記・要目視再確認）**:
    > **follower_count and online_followers metrics are not available on Instagram business or creator accounts with fewer than 100 followers.**
  - **metric_type と日次取得（audit 2026-08-05 照合。verbatim は metrics 表の Type 列の転記）**:
    > `reach` — 表上 **time_series** および **total_value** の両方に対応
    >
    > `views`, `accounts_engaged`, `total_interactions`, `profile_links_taps` 等 — 表上 **total_value** のみ（**time_series 非対応**）
  - **解釈**: 日次30日 upsert（§4 Phase 2 item2 / §8）は **列ごとに API 呼び出しパターンが異なる**。`total_value` のみの指標を `period=day` で取ったときに **日別 `values[]` が返るか**は API 仕様上未確定のため、§5.4 の対応表どおり実装前にブラウザ目視 + テスターアカウント実測で確定する。**total_value だけでは日次行に割れないと判明した列は DB に載せない**（期間合計1行を日次テーブルに無理やり入れない）
  - **【決着 2026-08-05】`profile_views` / `website_clicks` は「未記載」ではなく「公式に廃止済み」だった。** 出典は metrics 表ではなく [Instagram Platform Changelog](https://developers.facebook.com/docs/instagram-platform/changelog)（2026-08-05 確認）。**2024-10-02 のエントリ**で以下が deprecate された:
    > `email_contacts`, `get_direction_clicks`, `profile_views`, `text_message_clicks`, `website_clicks`, `phone_call_clicks`

    v21.0+ に先行適用され、**全バージョンへの適用は 2025-01-08**。
    - **リファレンスの metrics 表だけを見ていると気づけない**（表には deprecation 注記が `impressions` の分しか無く、廃止済み指標はそもそも行ごと消えている）。**廃止の一次情報は Changelog 側にある**。以後、指標の採否を判断するときは metrics 表と Changelog の両方を見る
  - **未解決の矛盾（実装前に必ず読むこと）**: 全バージョン廃止から約19か月後の **2026-08-01 実測で `profile_views`=3 / `website_clicks`=0 が実際に返っている**（§3.3「metric_type 実測」）。**廃止告知後も当面は値が返る状態**と見られる。
    - **「まだ返るから使える」と判断しない。** いつ停止されても抗議できない。**廃止済み指標に DB 列を作らない**
    - 現行コード `src/server/services/instagramService.ts:37-38` は `'profile_views'` / `'website_clicks'` を要求している（`fetchAccountInsights` は Phase 1 では呼び出し元が無いため実害なし）。**Phase 2 で除去する**（§10）
  - **`profile_links_taps` は `website_clicks` の 1:1 後継ではない可能性が高い（要実測）**: リファレンス上は `period=day` / **`breakdown=contact_button_type`** / `metric_type=total_value`。出典 [Instagram User Insights](https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights)（mirror: [documentation/.../instagram-user/insights](https://developers.facebook.com/documentation/instagram-platform/api-reference/instagram-user/insights)）。**確認日: 2026-08-05**（revise ステップで mirror URL を WebFetch 再取得）
  - **公式 metrics 表 Description からの verbatim（`profile_links_taps` 行）**:
    > The number of taps on your business address, call button, email button and text button.
  - **解釈**: 公式は **business address / call / email / text** の4種タップのみを述べており、**廃止済み `website_clicks` や「ウェブサイト」への言及はない**
  - **`breakdown=contact_button_type` の応答値（Breakdown 節からの verbatim）**: `BOOK_NOW`, `CALL`, `DIRECTION`, `EMAIL`, `INSTANT_EXPERIENCE`, `TEXT`, `UNDEFINED` — **`WEBSITE` 等は列挙されていない**
  - **【決着 2026-08-05】`profile_links_taps` は採用しない（実測不要）。** Description が列挙するのは **business address / call / email / text** の4種で、`contact_button_type` の取りうる値にも **`WEBSITE` が存在しない**（上記 verbatim。2026-08-05 に独立して2回照合）。したがって **「ウェブサイトクリック相当」を取り出す方法は無い**。実測しても結論は変わらないため、**着手前の実測項目から外す**
  - **【決着 2026-08-05】`profile_views`（プロフィール閲覧数）に後継は無い。取得不能。** 公式 Interaction Metrics 一覧（上記 verbatim）に「プロフィールが閲覧された回数」に相当する指標が存在しない（`profile_links_taps` は**タップ数**、`views` は**コンテンツの視聴数**で、いずれも別物）。**「プロフィール閲覧数」は §2 スコープから落とす**（Meta が指標ごと廃止したため、GrowMate 側でどうにもできない）
  - **【アカウント指標名の照合は 2026-08-05 に完全決着。実測項目なし】** ①metrics 表の目視 → 廃止確定により不要 ②`profile_links_taps` の実測 → `WEBSITE` が存在しないため不要（不採用確定）③`profile_views` の後継 → 存在しないことを一覧で確認済み。**§5.4 の SQL は `reach` / `views` / `accounts_engaged` / `total_interactions` / `follower_count` の5列で確定して書いてよい**（各列の日次取得方式は §5.4 対応表の実測が別途必要）
  - **公式 deprecation verbatim（audit 転記）**:
    > `impressions` **Deprecated for v22.0+ and all versions April 21, 2025.**
  - **解釈**: 本仕様書は既に `views` を採用済みで矛盾なし
- **Graph API のバージョン（2026-08-05 調査）**: 現行コードは `INSTAGRAM_GRAPH_VERSION = 'v23.0'`（`src/server/services/instagramService.ts:13`）で固定。出典 [Graph API Changelog](https://developers.facebook.com/docs/graph-api/changelog)。
  - **最新は v26.0（2026-07-29）**。以下 v25.0（2026-02-18）/ v24.0（2025-10-08）/ **v23.0（2025-05-29）**
  - **v23.0 の有効期限は 2027-10-08**。**Phase 2 の期間中に切れることはない**ため、本 Phase でのバージョン引き上げは**必須ではない**（引き上げると他エンドポイントの挙動差を再検証する必要が出るため、MVP では固定のままとする）
  - **ただし新指標が使えるかはバージョンと別軸で確認する**。[Instagram Platform Changelog](https://developers.facebook.com/docs/instagram-platform/changelog)（mirror: [documentation/instagram-platform/changelog](https://developers.facebook.com/documentation/instagram-platform/changelog)）の **2025-12-03**「Insights Metrics」エントリ。**確認日: 2026-08-05**（revise ステップで mirror URL を WebFetch 再取得）。**公式からの verbatim**:
    > Applies to all versions.
    >
    > Introducing the following metrics fields for media insights:
    >
    > `reels_skip_rate`
    >
    > `reposts`
    >
    > Introducing the following metrics fields for user insights:
    >
    > - `reposts`
  - **解釈**: **`reels_skip_rate` は media insights のみ**（user insights には出てこない）。user insights に追加されたのは **`reposts` のみ**。`"Applies to all versions."` は当該エントリ（Insights Metrics）に付くため **v23.0 でも利用できる**（同エントリで `crossposted_views` / `facebook_views` も追加）。「v24 以降でないと使えない」ではない
  - **Phase 2 着手時に Changelog を必ず確認する**。廃止（`profile_views` の例）も追加（`reels_skip_rate` の例）も、**バージョンではなく Changelog に出る**
- **`follower_count` は 100 フォロワー未満のアカウントでは取得できない（2026-08-04 調査。要目視確認）**: 同ページに "**follower_count and online_followers metrics are not available on Instagram business or creator accounts with fewer than 100 followers.**" とある。§5.4 は `follower_count` を通常の列として持つが、**テスターアカウントを含む小規模アカウントでは常に空で返る**。同ページは "the API will return an empty data set instead of 0 for individual metrics"（データが存在しない場合）とも書いており、**「取得失敗」と「対象外（フォロワー100未満）」を区別して扱う必要がある**（`error_subcode 2108006` と同じ構図）。Phase 2 の UI は `0` と `-` と「対象外」を混同しないこと
- **レート制限の具体値（2026-08-04 調査。要目視確認）**: 出典 [Graph API Rate Limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting)。式は "**Calls within 24 hours = 4800 \* Number of Impressions**" で、Number of Impressions は "the number of times any content from the app user's Instagram professional account has entered a person's screen within the last 24 hours."。
  - **インプレッションが小さいアカウントほど枠が小さい**。GrowMate の対象は「これから伸ばす」アカウントなので、枠が潤沢である前提を置いてはいけない
  - ~~現行の Phase 2 設計（毎時 cron × 直近50件 × 投稿ごと1コール）は 1ユーザーあたり約1,200コール/日~~ → **2026-08-05 に cron を落とした（§4 Phase 2 item3）ため、この懸念は解消**。消費はユーザーが「最新化」を押した回数のみになる。ただし1回の同期で最大51コール（メディア一覧1 + 投稿50）を使う点は変わらないので、ヘッダ監視は引き続き行う
  - 応答ヘッダ `X-App-Usage`（プラットフォーム上限）と `X-Business-Use-Case-Usage`（BUC 上限）に消費率が入る。**現行 `instagramService` はこれを読んでいない**。Phase 2 で記録する（§4 Phase 2）
- **インサイトの保存期間は最大2年（2026-08-05 調査。要目視確認）**: 出典 [Instagram Media Insights](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/)。"**Metrics data is stored for up to 2 years.**" とある。**2年より古い投稿はインサイトを取得できない**。プロ転換前（`error_subcode 2108006`）とは**別軸の恒久的な取得不可条件**であり、直近50件の中に2年超の投稿が混ざり得る（投稿頻度が低いアカウントほど起こる）。§5.2 の `insights_unavailable` は転換前と同じくこのケースも受けるが、**UI の理由文言は分ける**（「プロアカウント転換前」と「2年以上前の投稿」では利用者の受け取り方が違う）。判定方法（専用 subcode があるのか、空データで返るのか）は**未確認**なので、Phase 2 実装時に2年超の投稿を持つアカウントで実測する
- **メディア別の指標対応（2026-08-05 調査。要目視確認。WebFetch で2回照合）**: 同ページの metrics 表より。**リールのインサイトは取得できる**（`aozorayoukei` の全25投稿 REELS で9指標取得済み — 実測）。ただし一部の指標は REELS 非対応。
  - **REELS 対応**: `reach` / `views` / `likes` / `comments` / `saved` / `shares` / `total_interactions` / `ig_reels_avg_watch_time` / `ig_reels_video_view_total_time`（＝現行スコープ）に加え、未採用の `reels_skip_rate` / `crossposted_views` / `reposts` / `total_views` / `total_likes` / `total_comments`
  - **REELS 非対応（FEED / STORY のみ）**: `follows`（投稿経由のフォロー）/ `profile_visits`（投稿経由のプロフィール訪問）/ `profile_activity` / `impressions`（廃止済み）
  - **Adzviser は `Post Follows` / `Post Profile Visits` を持っており、GrowMate は持っていない**（[Adzviser フィールド一覧](https://docs.adzviser.com/connect/instagram-insights/supported-fields)、2026-08-05）。逆に Adzviser には `Post Views` が無く、GrowMate の `views` 採用の方が新しい
  - **採否は保留**。`follows` / `profile_visits` はクライアントの狙い（リールから自社サービスへ間接誘導）に直結する指標だが、**主戦場のリールで取れない**ため価値が限定される。**REELS 非対応であることを実測で確定してから判断する**（下記）
  - **実装方針（採用が決まった場合）**: **`media_product_type` で出し分け、REELS には最初から要求しない**。「REELS にも投げてエラーを握りつぶす」方式は採らない — 本プロジェクトは「エラーは必ず `console.error` でログ記録。サイレント処理禁止」の規約があり、握りつぶすと本物の失敗も一緒に隠れる（2026-08-05、外部レビューの提案を検討したうえで不採用）
  - **実測手順（未実施）**: `GET https://graph.instagram.com/v23.0/{REELS の media id}/insights?metric=follows,profile_visits` を `aozorayoukei` の投稿に対して実行し、空データか `error_subcode` かを確認する。本仕様書の外部ドキュメント照合は WebFetch（本文を要約して返すツール）経由で逐語性が担保できておらず、かつ本件は過去2回ドキュメントと実挙動が食い違っている（`account_type` の大小文字、アカウント insights の `metric_type`）ため、**表の記載だけで確定させない**
- **Instagram アプリ画面との突き合わせ（2026-08-05。クライアント提供のリールインサイト画面6枚と照合）**: 「クライアントが実際に見ている画面」を基準に、API で再現できる／できないを確定させた。**画面に出ている＝API で取れる、ではない**（アプリは内部 API を使う）。
  - **そのまま取れる**: 閲覧数=`views` / リーチしたアカウント=`reach` / 平均再生時間=`ig_reels_avg_watch_time` / いいね=`likes` / コメント=`comments` / 保存=`saved` / 再生時間=`ig_reels_video_view_total_time`
  - **追加すれば取れる（→ §2 スコープに追加済み）**: 再投稿=`reposts`（公式定義「再投稿数から削除された再投稿を引いた数」）/ スキップ率=`reels_skip_rate`（**アプリと同じ「率」で返るため加工不要**。ただし下記の但し書き2点が重要）
- **`reels_skip_rate` の正確な定義と注意点（2026-08-05 に原文で再取得）**: 出典 [Instagram Media Insights](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/)。原文（タイポも含めて verbatim）:
  > "The percentage of views from people who skipped during the first 3 seconds of the reel. This is calculcated as the number of views that skipped the reel during the first 3 seconds divided by the number of intial views. An intial view is when the reel starts to play for the first time in a reel session."

  - **分母は "initial views"**（リールセッション内で初めて再生された回数）であり、**`views` でも `reach` でもない**。§9 Q10 で自前計算する率（分母 = `reach`）とは**分母が揃わない**。同じ「率」として並べても足し引きや比較の意味が通らないため、UI では明確に区別する（§11.3）
  - **同ページで "estimated and in development" と明記されている**。**開発中の指標であり、定義変更・値の変動・提供終了があり得る**。列として常設はするが、**値が急に変わったり空になったりし得ることを前提**にする（`null` を許容し、欠損時は `-`）。Meta 側の変更で壊れたらキルスイッチではなく列を落とす対応になる
  - 「Instagram は算出定義を公開していない」という記述は**この指標には当てはまらない**（下記の自前計算5指標に限る話）
  - **API に存在しない**（→ §2 非スコープに明記済み）: 視聴維持率カーブ / 投稿ごとの閲覧数の時系列と通常リールとの比較線 / 閲覧ソース内訳（フィード・[リール]タブ・発見・プロフィール）/「高・低・通常」の評価ラベル / 投稿ごとのフォロワー比率 / 投稿ごとの年齢・国・性別。**media insights の `breakdown` は `action_type`（`profile_activity` 専用）と `story_navigation_action_type`（`navigation` 専用）の2つのみ**で、流入面・デモグラを割る手段が無い（2026-08-05 確認）
  - **`follows` はアプリのリール画面に「フォロー数 0」として表示されている**。公式 metrics 表の「REELS 非対応」と食い違うため、**上記の実測で決着させる優先度が上がった**
  - **率系（シェア率・いいね率・保存率・再投稿率・コメント率）は API に無い**。実数から自前計算することになる。**分母はリーチと見られる**（提供画面の実数で検算: いいね率 4.1% ← 21 ÷ 523(reach) = 4.02%、21 ÷ 618(views) = 3.40%。保存率 0.4% ← 2 ÷ 523 = 0.38%、2 ÷ 618 = 0.32%。**いずれもリーチ側でのみ一致**）。ただし **Instagram は算出定義を公開していないため一致保証はない**。出す場合の扱いは §9 Q10 で確認する
- **Instagram Login に「認可解除の Webhook」は無い（2026-08-04 調査。要目視確認）**: [Webhooks](https://developers.facebook.com/docs/instagram-platform/webhooks) に載るフィールドは `comments` / `live_comments` / `messages` 系のみで、deauthorize・permission revocation に相当するものが見当たらない。**ユーザーが Meta 側で連携を解除したことは API エラー起点でしか検知できない**（実装済みの `isInstagramRevokedTokenError` がその経路）。Phase 2 の同期処理も同じ前提で設計する（§6。cron は Phase 2 に無い）
- **media_url / profile_picture_url は有効期限付き CDN URL**。DB に保存した URL は失効し得るため、一覧表示のサムネイルは同期のたびに更新し、失効時は permalink リンクで代替する（画像の自前ストレージ保存は非スコープ）。
- **CDN ホストを CSP の `img-src` に許可する必要がある**（`proxy.ts` の `buildCspHeader`）。`https://*.cdninstagram.com` と `https://*.fbcdn.net` が無いと、DB に URL が正しく保存されていてもブラウザ側で画像が全てブロックされ、プレースホルダーだけが並ぶ。2026-08-01 の初回疎通で実際に発生。
- **プロアカウント転換より前の投稿はインサイトを取得できない**。`GET /{media-id}/insights` が `code 100 / error_subcode 2108006`（"このメディアは、ユーザーのアカウントが個人アカウントからビジネスアカウントに最後に変換された時点より前に投稿されました"）を返す（2026-08-01 に `manbou536` の**既存25投稿すべて**で発生。最新の既存投稿が 2019-03-10 で、転換後の投稿が1件も無かった）。**この subcode は Meta のエラーコード一覧3ページのいずれにも記載が無く**、回避策や部分取得できるメトリクスのサブセットがあるかは**未確認**。確実に裏が取れる打ち手は転換後の新規投稿のみ。**審査用スクリーンキャストには転換後の投稿が最低1本必要**。
- **制約は転換タイミングのみで、メディア形式は問わない（2026-08-01 実測）**。転換後に投稿した `CAROUSEL_ALBUM/FEED` で9指標すべて取得できた。公式の "Insights data is not available for any media within an Instagram Media album" はアルバム**内の子メディア**の話であり、アルバム本体は取得できる。GrowMate は `MEDIA_FIELDS` に `children` を含めないため、この制約に当たらない。動画（`VIDEO/REELS`）も同様に取得可能で、`ig_reels_avg_watch_time` / `ig_reels_video_view_total_time` を含む9指標が返ることを `aozorayoukei`（全25投稿が REELS）で確認済み。
- **インサイトのデータは最大48時間遅延する**。公式 Limitations に "Data used to calculate metrics may be delayed up to 48 hours." とあるため、転換後の投稿を作ってすぐ収録すると数値が空のままになり得る。**収録スケジュール上、投稿作成が最長のリードタイム**。逆算して着手する。
  - **実測（2026-08-02、`manbou536`）では48時間も要らなかった**。48時間は上限であって必要な待ち時間ではない。`views` と `likes` は投稿直後から入り、**`reach` だけが約1時間遅れて入り始める**。同一アカウントの3投稿で計測した値: 投稿0.2時間後 `reach=0 views=25`／0.8時間後 `reach=14 views=35`／12.9時間後 `reach=86 views=246`。収録前に空けるべき時間は**1〜2時間**が目安
  - `saved` と `shares` は実際に保存・シェアされなければ待っても 0 のまま。取得失敗の `-` とは別物で、`0` は実データが返っている証拠になる
- **`error_subcode 2108006` は取得失敗と区別して表示する（2026-08-02 実装済み。Phase 2 送りにしていたが前倒し）**。恒久的な状態を「取得できませんでした」と出すと不具合に見えるうえ、個人→プロ転換した利用者は転換前の投稿を必ず持つため**既定の体験として起こる**。`isInstagramPreConversionMediaError`（`src/domain/errors/instagram-error-handlers.ts`）で判定し、`InstagramPreviewData.preConversionCount` として `failedCount` と分けて数え、UI は警告色ではなく情報色の Alert で理由を説明する。
  - **実 API の `type` は `IGApiException` であって `OAuthException` ではない**（2026-08-02 実測。HTTP 400）。そのため `isInstagramReauthError` の `oauthexception` 判定とは衝突しないが、同関数は本文の部分一致が広いため、catch 内では**転換前判定を先に置く**。順序を誤ると「再連携してください」に倒れ、何度再連携しても直らない導線になる
- レート制限あり（app-user 単位）。投稿インサイトはメディア1件につき1コール必要なため、同期対象は**直近 N 件（初期値 50 件）に制限**し、打ち切り時はログに件数を出す（サイレント truncation 禁止）。
- **Graph API バージョン（2026-08-05）**: 現行実装はパスに **`v23.0`** を明示（例: `graph.instagram.com/v23.0/...` — `instagramService.ts`）。spec-review audit 時点で公式 changelog 上の latest は **v26.0**。**Phase 2 着手時**に [Graph API Changelog](https://developers.facebook.com/docs/graph-api/changelog) で v23→v26 の breaking change を確認し、 bump 要否を決める（不要なら v23 維持を明記）。**受け入れ条件（§8）**: 採用バージョンがコード内の API パスと一致し、changelog 確認済みであること

## 4. フェーズ分け

### Phase 0: 事前リファクタリング（小、任意→推奨のみ実施）

調査の結果、**大規模な事前リファクタは不要**。OAuth 基盤（`src/server/lib/oauth-state.ts` の HMAC 署名 state 生成・検証）は Google 非依存の汎用実装であり、そのまま4系統目として再利用できる。実施するのは以下のみ:

- **R-1（推奨・成功パスの state 検証のみ）**: `generateOAuthState` / `verifyOAuthState`（`src/server/lib/oauth-state.ts`）は既に汎用化済み。追加共通化対象は **state Cookie の set/検証 + セッション userId 整合チェック** のみを `src/server/lib/oauth-flow.ts` に抽出する。**エラー応答形式・baseUrl 取得・Cookie 名は GSC（JSON）と Google Ads（`?error=` リダイレクト）で既に異なるため、callback 全体の共通化は行わない**。Instagram OAuth は **Google Ads 型（失敗時 `NextResponse.redirect('/setup/instagram?error=...')` + セットアップ画面の ERROR_MAP）** で新規実装し、R-1 で抽出した state 検証ヘルパーのみ再利用する。GSC/Ads 既存 callback の置き換えは本 PR の必須スコープ外（別 PR 可）。
- **R-2（Phase 2 に内包）**: `app/analytics/AnalyticsClient.tsx` のタブ化。既存のブログ一覧を `TabsContent value="blog"` に包む構造変更。`app/ga4-dashboard/Ga4DashboardClient.tsx:435` の Tabs 実装（`grid grid-cols-2` の TabsList）を踏襲。**ただしタブ UI 自体を Instagram 連携済みユーザーだけに出す**ため、未連携時は既存のまま（`Tabs` で包まず現行のレイアウトを返す）分岐を入れる（§4 Phase 2 item4）。

### Phase 1: OAuth 連携 + 疎通表示（審査前 MVP）

**時系列（クライアント指示・2026-07-25）**: 1-A（UI モック・ハードコーディング）を先に作りクライアント（カオルさん）と画面合意を取る。**Meta App Review 提出は 1-B 最小（OAuth + 実成功 API コール + 外部検証可能）が揃ってから行う**。~~Phase 2 以降は審査通過後に着手する~~ → **2026-08-04 変更: Phase 2 は審査提出前にローカル開発を開始する（本番反映は審査通過後）**。§4 Phase 2 冒頭「着手条件」参照。

#### Phase 1-A: UI モック（ハードコーディング。クライアント合意用）

**実装状態（2026-07-31）**: 当初「1-A のみ先に実装し 1-B は後」としていたが、**UI・型・`DEV_SAMPLE_*`・`canAccessInstagram`・Setup 画面は実装済み**。1-B 相当（OAuth ルート・`instagramService` / `instagramTokenService`・credential CRUD・production 向け実データ分岐）も **同一ブランチで実装済み**。残作業は **App Review 提出ゲート**（§3.2 の順序制約・§9 Q6/Q7 の解消・本番疎通・収録・1024 icon・提出）に集約される。

**ゴール（当初）: `/setup` の Instagram カードと `/setup/instagram` が §11.1/11.2 の全状態を実画面表示。開発時は `DEV_SAMPLE_*`、本番は実 API。**

- ~~実サービス・OAuth は 1-B で実装~~ → **実装済み**（以下チェックリストは完了確認用に残す）
- Meta 開発者アプリ作成（Instagram API with Instagram Login 製品追加、パーミッション申請フォーム記入）はダッシュボード上の設定作業のみで、1-A の UI 実装と並行して進める（審査提出そのものにアプリ登録が前提のため）
- **既存の踏襲パターン**: `src/server/services/googleAdsNegativeKeywordsSuggestionService.ts` の `useMockGoogleAds = process.env.NODE_ENV === 'development'` + `DEV_SAMPLE_SEARCH_TERMS` 定数と同型。新方式（fixtureファイル分離・URL パラメータでの状態切替 UI 等）は導入しない
- **限定公開ゲート（1-A 成果物。審査期間中のみ有効）**: `src/server/lib/instagram-permissions.ts` に `canAccessInstagram({ userId, role })` を新設し、環境変数 `INSTAGRAM_BETA_USER_IDS`（カンマ区切りの user_id）に列挙されたユーザーだけに Instagram 機能を見せる。**空文字なら §7 の通常ロール判定にフォールバック**するので、Phase 2 の解除は環境変数を空にするだけで済む（コード変更・再デプロイ不要）。参照箇所は `/setup` の Instagram カード表示と `/setup/instagram` のガードの2箇所のみ
  - **`role: 'admin'` でゲートしてはいけない**。App Review のレビュアーに渡すアカウントはゲートが開いている必要があり、admin にすると `/admin/users`（`getAllUsers` → `AdminUserListItem extends User`）から**全ユーザーの氏名・メールアドレス・課金状態が閲覧可能になる**。未開示の第三者提供になるため、Instagram 機能の露出は **user_id allowlist** で制御する（`role` とは別軸）
  - **allowlist 非空時は `canAccessInstagram` は user_id のみを見る**（`src/server/lib/instagram-permissions.ts:28-30`）。`INSTAGRAM_ALLOWED_ROLES` に `trial` が含まれていても、allowlist 外ユーザーは Instagram UI に到達できない。**role は allowlist 解除後（Phase 2 item6）の §7 最終形および `proxy.ts` の経路ゲート用**であり、審査期間中の Instagram 露出理由として「trial だから」とは書かない
  - レビュアー用アカウントは **`role: 'admin'` にしない**（上記）。`/admin/*` は `isAdmin` で弾かれる。**`/setup/*` へは `proxy.ts` の `hasSetupAccess`（= `hasPaidFeatureAccess` → paid / admin のみ）が別途必要**（§9 Q7）。allowlist に載せただけでは `/setup/instagram` に到達できない
- 型定義: `src/types/instagram.ts` に `InstagramConnectionStatus` / `InstagramProfile` / `InstagramMediaPreview` を **Phase 1-B の実 API 戻り値と同じ形状**で先に定義する。以降 Phase 1-B はこの型を変更せず中身だけ実装する
- `src/server/actions/instagramSetup.actions.ts` に `getInstagramConnectionStatus` / `fetchInstagramPreviewData` を **戻り値型は Phase 1-B と同一のまま** 先に実装し、`process.env.NODE_ENV === 'development'` の間は関数末尾に定義した `DEV_SAMPLE_INSTAGRAM_STATUS` / `DEV_SAMPLE_INSTAGRAM_PROFILE` / `DEV_SAMPLE_INSTAGRAM_MEDIA`（未連携・連携済み・要再認証・投稿0件・部分失敗の5パターン）を返す
- 状態確認は `DEV_SAMPLE_*` の定数を一時的に差し替えて目視する（既存踏襲。トグル UI 等の専用切替導線は作らない＝本番導線を汚さない）
- 「連携を解除」ボタンは §11.2 の見た目のみ実装（`disconnectInstagram` の実処理は Phase 1-B。1-A では確認ダイアログの表示までで良い）
- UI 実装: §11.1（`SetupDashboard.tsx` Instagram カード）・§11.2（`InstagramSetupClient.tsx`, `app/setup/instagram/page.tsx`）をここで完成させる。**Phase 1-B ではこのコンポーネント群は無変更** — データソースを `DEV_SAMPLE_*` から実サービス呼び出しへ差し替えるのみ
- クライアントレビュー: カオルさんに §11 ワイヤーフレームとの差分（特に Q2 の一覧列構成の温度感）を確認してもらい、1-B 着手前に画面合意を取る
- **1-A 当時のスコープ**: `app/privacy/page.tsx` の追記・App Review 提出は 1-A では行わない（**item9 の PP 追記は 1-B で実装済み**。§4 Phase1-B item9 参照）

#### Phase 1-B: 実データ連携 + App Review 提出（審査申請の最小実装）

**ゴール: テスターアカウントで実際に OAuth 連携し `/setup/instagram` にプロフィール・投稿・インサイトが実 API 経由で表示される。この実装を Meta App Review に提出する（§3.2 提出ゲート参照）。**

**実装状態（2026-07-31）**: コード上の 1-B 本体（§4 item2〜9 の OAuth・サービス・Actions・環境変数・UI 実データ分岐・**`app/privacy/page.tsx` の Instagram/Meta 追記**）は **実装済み**。未完了は **運用・合意・提出**（item0 の順序制約、§9 Q6/Q7、本番疎通、収録、1024 App Icon、Meta 提出）および §8 Phase 1-B の未チェック項目。

0. **提出前の順序制約（§3.2「30日ルール」・レビュアーアクセス）** — **実 OAuth で Advanced Access 用の成功 API コールを立てる前に**、以下を揃える（30 日タイマーは API コール起点で始まるため、早すぎる疎通は避ける）:
   - §9 Q6（レビュアーログイン手段＝案1 `/review-login`。実装済み）・Q7（審査用アカウントの role＝`paid`）が確定済み（2026-08-01 回答済み。クライアント承認取得済み）
   - 審査用 GrowMate アカウントが **`full_name` 登録済み**（`proxy.ts:147-148` — 未登録は `/login` へ戻され `/setup` に到達不可）
   - 当該アカウントの Instagram プロアカウントが App Dashboard の Instagram Tester で **承認済み**
   - クライアント側ビジネス認証の見通しと収録スケジュールが確定（並行は可だが、30 日以内に提出できるタイミングで疎通する）
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
9. **App Review 必須成果物 — プライバシーポリシー（1-B。**実装済み** 2026-07-31）**:
   - `app/privacy/page.tsx` — 既存 §5「第三者サービスと共同利用」に **Meta Platforms, Inc.（Instagram Graph API）** を追加済み（Google LLC 等と並列）。§6「データ保持期間と削除方法」に Instagram 連携データの保持・削除を追記済み。§7「ユーザーの権利と手続き」に Instagram 連携解除手順（`/setup/instagram` の解除ボタン → `disconnectInstagram`）を GSC 連携解除と並列で追記済み。metadata.description に Instagram を含む
   - **「第三者提供なし」とは書かない**（Meta API 利用は §5 の共同利用先追加で明示。既存 `app/privacy/page.tsx` §5 の Google 等と同型）
   - Meta Data Deletion Callback URL は Phase 1 では設けず、手順ページ方式とする（GrowMate は B2B SaaS でユーザー自身がアプリ内解除可能なため）。将来 Meta から必須化された場合は Phase 1.5 で `/api/instagram/data-deletion` を追加
   - **提出前**: 本番 `/privacy` を目視し、App Review 用 URL が最新内容を指していることを §8 で確認する
10. **App Review 提出**: 1-B item0〜9 が揃い、§3.2 提出ゲート（外部テスト可能 + 対象パーミッションで成功 API コール）を満たした時点で申請する。提出物は **§3.2「スクリーンキャストの要件」に従い、パーミッションごとに1本ずつ**（`instagram_business_basic` / `instagram_business_manage_insights`）+ 各パーミッションの利用目的の説明。**日本語 UI のため英語キャプション・注釈を付ける**（無注釈で出さない）。利用目的の説明は **1-B の実装画面で見せられる範囲に限定**する（Phase 2 のアカウントインサイト用途まで書くと、画面に無い機能への確認が発生する。同一パーミッション内のため Phase 2 実装後の追記に再審査は不要）
    - **提出前チェック（§3.2 の決定を実行に落としたもの）**:
      - 本番（`https://growmate.tokyo`）にデプロイ済みで、Instagram 機能が `INSTAGRAM_BETA_USER_IDS` により審査用アカウントにのみ見えている（allowlist 非空時は role 無関係）
      - 審査用 GrowMate アカウントを作成し（**`role: 'paid'`** — §9 Q7、`full_name` 登録済み、allowlist に user_id 追加）、その Instagram プロアカウントを App Dashboard の Instagram Tester に追加済み
      - `REVIEW_LOGIN_EMAIL` を本番に設定し、そのアドレスとパスワードを提出フォームの Credentials 欄に記入済み（§9 Q6 の案1）。パスワードは**24文字・約140ビット**の乱数（レート制限がインスタンス毎で緩いため総当たり耐性は長さで担保するが、140ビットあれば十分。桁を増やすより**転記ミス対策**が実質的で、`0` `O` `1` `l` `I` を除いた文字種を使う）
      - Meta App Dashboard **Settings > Basic > App Icon** に **1024×1024** 画像をアップロード済み（§3.2。リポジトリ `app/icon.png` は 120×120 のため別素材）
      - 提出フォームの Platform Settings 欄にレビュアーのアクセス手段を記入済み（§3.2「レビュアーのアクセス手段」。合意したログイン手順・URL・テストアカウント識別子。パスワード等の機密は提出フォームのみに記載し、本仕様書には書かない）
      - 連携ボタンがブランドガイドラインに準拠し、アプリ内と収録の両方で見えている（§3.2「ログインボタンのブランド準拠」）
      - 収録に **`/login` からのログインフロー**（審査用アドレス入力 → 受信箱で OTP 取得 → ログイン）が含まれている（§3.2）
      - 成功 API コールが **提出日から 30 日以内**であること（§3.2）
      - 収録・レビュー作業中に他ユーザーの個人データが映る画面へ到達できないこと（allowlist 方式なら `/admin/*` は `isAdmin` で弾かれる）
11. **プレビュー取得上限（Phase 1-5 詳細）**:
    - `fetchInstagramPreviewData` は `/me/media` から **最新 K=3 件**（`posted_at` 降順）のみ insights を取得する（1件1 API コール × 10s timeout のため全件取得は禁止）
    - 部分失敗時: 取得できた投稿のみカード表示し、失敗件数を Alert（`ERROR_MESSAGES.INSTAGRAM.API_ERROR` または「一部の投稿データを取得できませんでした（N件）」）で表示。プロフィール取得失敗時はプレビュー全体をエラー表示（空画面にしない）
    - 投稿0件の場合は「投稿がありません」プレースホルダーを表示（審査画面が真っ白にならないこと）

**App Review は Phase 1-B 完了時点で提出する**（instagram_business_basic + instagram_business_manage_insights、実 OAuth 連携画面のスクリーンキャストを添付）。**Phase 2 はブランチを切って審査提出前からローカル開発を進める（2026-08-04 変更）**。当初は「審査通過後に着手」「審査待機中は Meta 非依存の作業のみ」としていたが、テスターアカウントで Phase 2 が使う API が動くことが実証済みのため前倒しした。**本番反映と allowlist 解除は審査通過後**という制約は維持する（§4 Phase 2 冒頭「着手条件」/ item6）。

### Phase 2: データ同期 + analytics 一覧（タブ化）

**ゴール: `/analytics` が「ブログ」「Instagram」タブに分かれ、Instagram タブにスプレッドシート相当の投稿一覧＋指標が出る。**

※ タブ切替方式は 2026-07-22 定例で提案しクライアント同意済み（「どういう形がいいかは分からないが、まず連携から」との温度感のため、UI 詳細は Phase 2 着手時に管理表を見せてもらい再確認する）。

#### 着手条件（2026-08-04 変更 — 審査提出前にローカル開発を開始する）

**方針変更**: Phase 2 はブランチを切ってローカルで先行開発する。App Review の通過を待たない。根拠は §3.2 のとおりスタンダードアクセスでも**アプリに役割を持つユーザー（Instagram Tester 承認済みのプロアカウント）なら対象パーミッションが動く**こと、および §8 に記録済みの成功 API コール実績（`instagram_business_basic` 29 件 / `instagram_business_manage_insights` 3 件、2026-08-02）。Phase 2 が使う `/me/media`・`/{media-id}/insights` は Phase 1 で疎通済みのエンドポイントそのものである。

そのうえで、以下を**制約として厳守する**。

- **本番反映しない**。審査提出・通過が済むまで Phase 2 のコードを production にマージしない。理由は §3.2 の審査環境が本番であり、審査用アカウントは `role: 'paid'` で `/analytics` に到達できるため、**未完成の Instagram タブをレビュアーが踏む**可能性があること。[Common Mistakes](https://developers.facebook.com/docs/app-review/submission-guide/common-mistakes) の "**If we can't access your app for any reason, your entire submission will be rejected**" はパーミッション単位ではなく提出全体の却下である
- **`INSTAGRAM_BETA_USER_IDS` を空にしない**。allowlist の解除は本 Phase の**最終タスク（item6）** であり、審査通過後に行う。審査前に空にすると allowlist 外の paid ユーザーに Instagram カードが出て、連携しても Advanced Access が無いため `error code 100` で落ちる（§3.2 アクセス認証）
- ~~cron を本番で有効化しない~~ → **2026-08-05 に cron 自体を Phase 2 スコープから外した**（item3）ため、この制約は不要になった。同期はユーザーが「最新化」を押したときだけ走るので、審査提出前にレート枠を使い切る経路が無い
- **着手前にテスターアカウントの検証データ量を数える**。Phase 2 の受け入れ条件は一覧・種別フィルタ・ページネーション（10件/頁）を含むが、§3.3 の実測では `manbou536` は既存25投稿すべてが転換前（`2108006` で指標取得不可）、`aozorayoukei` は全25投稿が REELS。**指標が入る投稿が数件しかなく、2頁目が作れない / FEED×REELS 混在のフィルタを検証できない**恐れがある。不足する場合は転換後の投稿を作る（指標が入るまで1〜2時間必要 — §3.3）
- **`follower_count` はテスターアカウントでは検証できない前提で作る**（§3.3 の 100 フォロワー未満制約）。空が返ることを「対象外」として表示する設計を先に決めてから実装する

1. テーブル追加（§5）: `instagram_media` / `instagram_account_insights_daily` の **2本のみ**
   - **`instagram_media_insights_daily` は作らない**（2026-08-05、Q3 回答済み。Adzviser に投稿ごとの日別ディメンションが無く、そもそも API が累計値しか返さないため — §5.3）
   - **`instagram_account_insights_daily` は指標名の公式照合待ち**（§5.4 / §3.3）。照合が終わるまでマイグレーションを書かない。存在しない指標の列が本番に残るのが最悪の手戻り
   - よって**先に書けるのは `instagram_media`（§5.2）だけ**
   - 適用は §5 冒頭のとおり**管理者が手動で実行**する（`npx supabase db push` をリモートに投げない）。ローカル開発中は `database.types.pending.ts` の暫定型パターンで進める
2. `src/server/services/instagramSyncService.ts` — 同期本体:
   - `/me/media` を cursor で辿り直近50件を upsert（打ち切り時は件数をログ）。**`instagramService.fetchMedia(accessToken, limit)` は現状 `after` 引数を持たないため署名変更が必要**。ページ連結ヘルパー `collectInstagramMediaPages` / `extractInstagramMediaAfterCursor`（`src/server/lib/instagram-media-pagination.ts`）は Phase 1 で実装済みだが**呼び出し元が無い**状態なので、ここで初めて使う
   - **メディアフィルタ**: `media_product_type` が `FEED` / `REELS` **以外**（STORIES 等、§2 非スコープ）は **DB upsert せずスキップ**し、`console.warn('[Instagram Sync]', { skipped, reason: 'unsupported_product_type', media_product_type })` を出力。CHECK 制約違反で同期全体が失敗しないこと
   - 各メディア（FEED/REELS のみ）の insights を取得し、**`instagram_media` に最新値を反映する（それだけ）**。日次スナップショットは取らない（2026-08-05、Q3 回答済み — §5.3）
     - **取得する metric に `reposts` と `reels_skip_rate` を含める**（2026-08-05 追加 — §2 / §3.3）。`reels_skip_rate` は **REELS のみ**なので、`ig_reels_*` と同じく `mediaProductType === 'REELS'` の分岐に入れる。**率（%）で返るため実数へ変換しない**
     - 現行の `instagramService.fetchMediaInsights` は 7指標 + リール2指標の構成なので、**metric リストの変更が必要**
   - アカウント insights: **`last_synced_at` が null の初回同期は、§5.4 で「日次行の埋め方」が確定した列のみ**直近 D=30 日分（昨日まで）を upsert。2回目以降も**同じ列集合**について `last_synced_at` の日付〜昨日までを upsert（欠損日は API 応答に従い補完）。**日次取得不可と確定した列（`views` 等の total_value のみで日別配列が取れないもの）は upsert 対象外** — §5.4 / §3.3
     - **取得方式が指標ごとに違う点を実装前に確定する**（§3.3「アカウント指標名の公式照合」）。公式表では `reach` は time_series / total_value の両対応、`views` 等は total_value 系と分かれており、**`metric_type=total_value` は期間合計を返すため日別に割れない**可能性が高い。§5.4 の列ごとに「time_series で日別取得」「total_value で当日分のみ」を表にしてから実装する。ここが未定のままだと実装者が暗黙に決めてしまう
     - 現行の `instagramService.fetchAccountInsights` は `extractLatestInsightMetric` で**最新1点しか取らない**ため、**日次取得可列**について30日分を埋めるには実装変更が必要（Phase 1 では呼び出し元が無く未使用）
     - `follower_count` は 100 フォロワー未満で空が返る（§3.3）。**空を「対象外」として記録し、取得失敗と混同しない**
   - 部分失敗は投稿単位で continue し、**必ず `console.error` でログ**（skipped カウントのみのサイレント処理禁止）。結果に `{ synced, failed, skipped, truncated }` を含める
   - **`error_subcode 2108006`（プロ転換前の投稿）は恒久失敗として他の部分失敗と区別する**（§3.3）。直近50件が対象のため転換前の投稿が数十件該当し得る。再試行しても永久に直らないので「取得できませんでした」で一括表示するとユーザーが再試行を繰り返す。**判定ヘルパーは Phase 1 で実装済み**（`isInstagramPreConversionMediaError` — `src/domain/errors/instagram-error-handlers.ts`。`/setup/instagram` プレビューで使用中）。**Phase 2 で新規作成せず、これを再利用する**（2026-08-02 に前倒し実装済み。「Phase 2 に集約」「`instagramService` 側に置く」とした当初記述は失効）
   - **恒久失敗は再試行しない**: 2108006 を返したメディアは `instagram_media.insights_unavailable = true` かつ `insights_unavailable_reason = 'pre_conversion'`（§5.2）を立て、以後の同期で insights コールを**投げない**。2年超で恒久不可と判定した場合は同フラグに `insights_unavailable_reason = 'retention_expired'`。**同期のたびに**恒久失敗行へ insights コールを投げ続けると、失敗分だけレート枠（§3.3）を捨て続ける。フラグは連携解除・再連携（`ig_user_id` 変更）でリセットされる（行ごと purge されるため自動）
   - **トークン失効の判定は `isInstagramRevokedTokenError` を使う**（`isInstagramReauthError` ではない）。Meta はレート制限（code 4 / 17 / 32 / 613）にも `"type":"OAuthException"` を付けるため、広い方の判定で credential を書き換えると**レート制限を恒久失効と誤認して全ユーザーの連携を壊す**。手動同期でも同じ判定を使うため、誤ると当該ユーザーの連携が自力回復不能になる。詳細は §6
   - **レート消費を記録する**: 応答ヘッダ `X-App-Usage` / `X-Business-Use-Case-Usage`（§3.3）を読み、`console.warn('[Instagram Sync]', { appUsage, bucUsage })` で残量を出す。閾値（例: `call_count >= 80`）を超えたら当該同期を打ち切り次回に委ねる。**現行 `instagramService` はヘッダを一切読んでいない**ため新規実装
   - **同期頻度の概念自体を持たない**（2026-08-05 決定。下記 item3）。同期はユーザーが「最新化」を押したときだけ走る
3. **同期トリガーは手動のみ（MVP。2026-08-05 クライアント判断で cron を落とした）**

   **決定**: 自動同期（cron）を Phase 2 のスコープから外し、**Instagram タブの「最新化」ボタンだけ**にする。理由は「最初はシンプルな作り（MVP）優先」（CLAUDE.md の MVP 原則にも沿う）。
   - **落としたもの**: ~~`app/api/cron/instagram-sync/route.ts`~~（廃止）、~~`.github/workflows/hourly-cron.yml` の matrix 追加~~（廃止）、`count-batch` profile 連携、`INSTAGRAM_SYNC_ENABLED` キルスイッチの cron 側分岐、**§9 Q9（同期頻度の確認）そのもの**
   - **副次的な利点**: §3.3 のレート枠の懸念（毎時×50件＝1ユーザー約1,200コール/日）が消える。ユーザーが押した回数しか消費しない。審査提出前にレート枠を使い切る事故（着手条件）も起こらなくなる
   - **専用インポート画面は設けない**（従来どおり）。GSC dashboard の `OverviewTab.tsx` inline「最新化」と同じ**確認ダイアログ + 単一トースト**方式を採用する

   実装:
   - 手動: Instagram タブの「最新化」ボタン（`RefreshCw`アイコン）→ 確認 `Dialog`（`OverviewTab.tsx:153-186` と同型）→ Server Action。**結果メッセージは `getInstagramSyncToastMessage(result)` ヘルパーに集約**し（`getQueryImportToastMessage` と同型）、成功/部分失敗/要再認証/打ち切りの分岐をそこに閉じ込めて呼び出し側に判定ロジックを持たせない。**ダイアログ文言・トースト文言・結果 UI の詳細は §11.3 が正本**（ここには重複して書かない）
   - **⚠ トークン延長の契機がユーザー操作だけになる（重要）**: 当初は「トークン延長も cron 内で実施」する設計だった。cron を落としたことで、**長期トークン（60日）を延長する経路は `/setup/instagram` のプレビュー取得（`instagramSetup.actions.ts:195` の `ensureValidInstagramToken`）と、この「最新化」だけ**になる。
     - **リスクは限定的**: 延長条件は「期限まで7日未満かつ発行から24時間超」（`src/server/lib/instagram-token.ts`）なので、**60日のうち最後の7日間に一度でも画面を開けば延長される**。失効するのは「60日間まったく Instagram 機能を使わなかったユーザー」だけ
     - **失効しても壊れない**: `needsReauth` として「要再認証」バッジ + 再連携導線が出る（§6・§11.2）。**サイレントに未連携へ落ちない**ことが担保されていれば MVP として許容する
     - **「最新化」の Server Action でも必ず `ensureValidInstagramToken` を通す**こと。プレビューだけが延長契機になると、`/analytics` しか使わないユーザーが失効する
   - **キルスイッチ**: 環境変数 `INSTAGRAM_SYNC_ENABLED`（既定 `true`、`false` で無効）は**残す**。cron が無くても、Meta 側の仕様変更・障害時に手動同期を止める手段は要る。無効時の挙動:
     - 手動「最新化」: ボタンを disabled にし、ツールバー直下に情報色 Alert「Instagramの同期を一時停止しています」。**押せるのに何も起きない状態にしない**
     - 一覧表示: DB の既存データはそのまま出す（`last_synced_at` も従来値のまま）。空にしない
   - **初回同期の起動導線**: Phase 1 で既に連携済みのユーザーは `last_synced_at` が null。**OAuth callback 成功時に同期を自動起動しない**（callback を重くしない。10秒 timeout × 50件は callback 内で完了しない）。`/analytics` の Instagram タブ初回表示時に「まだデータがありません。［最新化］を押すと取得します」（§11.3）を出してユーザー操作を起点にする。**cron が無いので、押さなければ永久に空**である点が従来案との違い。空状態の文言はこの前提で書く
   - **1リクエストで実行時間を使い切る経路がある**: 投稿インサイトは1件1コールで各 10 秒 timeout のため、**全件がタイムアウトすると 500 秒**かかる。Server Action は **`app/analytics/page.tsx` に `export const maxDuration = 800` を設定**する（`app/google-ads-dashboard/page.tsx:15` と同型。Vercel Pro / Fluid Compute 上限）。同期本体の**時間予算は 760 秒**（maxDuration より 40 秒短く、レスポンス返却の余裕 — `gscEvaluationService` の 280/300 秒比を踏襲）。**連続失敗 K 件（初期値 5）** は時間上限に達する**前**の早期中断条件（各失敗最大 10 秒 × 5 = 50 秒程度で打ち切りうる）。時間予算到達時は `{ stoppedReason: 'time_budget' }`、連続失敗時は `{ stoppedReason: 'consecutive_failures' }` を結果に含めトーストで伝える（再度「最新化」で続き）
   - **`truncated` の扱い**: 50件上限で打ち切った場合 `truncated: true` を結果に含め `console.warn` で記録する。**エラー扱いにしない**（意図した上限動作）。UI は §11.3 のトースト（`toast.info('直近50件まで取得しました')`）で伝える
   - **将来 cron を足す場合**（本 Phase では実装しない）: `.github/workflows/hourly-cron.yml` は `on.schedule` が `'0 * * * *'` の1本のみで、各 step も `github.event.schedule == '0 * * * *'` で守られている（`hourly-cron.yml:65,71`）。matrix の `interval` フィールドはどこからも参照されていない注記にすぎず、**日次の枠は存在しない**。日1回にしたい場合は ①workflow に日次 cron を足して `interval` で分岐させる ②毎時呼び出しのまま route 側で `last_synced_at` を見てスキップする（`gsc-evaluate` の「次回評価予定日時 <= 現在日時」と同型）のいずれか。**②の方が既存前例があり、ユーザーごとに実行が分散する分レート枠にも優しい**
4. UI: `app/analytics/AnalyticsClient.tsx` をタブ化（R-2）。**タブ UI は Instagram 連携済みユーザーにだけ出す（2026-07-25 決定）**:
   - **未連携ユーザーの `/analytics` は現行のまま**（タブバーを出さない）。`/analytics` は作業画面であり、使わない機能のタブを常設しない。発見導線は `/setup` の Instagram カード（§11.1）が既に担っているので二重に持たない
   - この方式なら **限定公開ゲート（§4 Phase 1-A）の参照箇所を増やさずに済む** — allowlist 外のユーザーは連携できない → 連携済みにならない → タブも出ない、が推移的に成立する
   - 未連携ユーザーが `?tab=instagram` を直接開いた場合は `blog` にフォールバックする（§11.3 の「未指定時は `blog`」と同じ扱い）
   - 連携解除するとタブは消え、現行レイアウトに戻る
   - Instagram タブ（連携済みユーザーのみ）:
     - 投稿一覧テーブル: サムネイル、種別（リール/フィード/カルーセル）、キャプション冒頭、投稿日、リーチ、視聴数(views)、いいね、コメント、保存、シェア、総インタラクション、リールは平均視聴時間。permalink への外部リンク
     - **表示する列はユーザーが選べる**（2026-08-05 Q2 回答）。既存の `FieldConfigurator` を再利用し、`INSTAGRAM_COLUMNS` と専用 `storageKey` を足すだけで実装する。**詳細は §11.3 が正本**
     - 種別フィルタ（リール/フィード）、期間フィルタ（`posted_at` 範囲指定。開始日～終了日）、ソート（投稿日 / リーチ / views）
     - ページネーションは既存ブログ一覧と同じ URL パラメータ + `Link` 方式（`ig_page` など名前空間を分けてブログ側の `page` と衝突させない）
5. データ取得: Server Component（`app/analytics/page.tsx`）の既存 `Promise.all` に **`getInstagramConnectionStatus`** を追加し、その結果でタブ表示を分岐する。連携済みかつ `tab=instagram` のときだけ **`instagramMediaService.getPage(userId, ...)`**（投稿一覧・10件/頁）と **`instagramMediaService.getAccountInsightsLatestDay(userId)`**（アカウント指標サマリー用・**最新日1行のみ** — §5.4 / §11.3）を取得する（未連携ユーザーに Instagram の DB クエリを走らせない）。PostgREST `db-max-rows = 1000` 制限があるため投稿一覧はページング取得とし、**サマリーは30日分を丸ごと返さない**（クライアント集計を避ける）
6. **限定公開の解除（本 Phase の最終タスク。審査通過後に実施 — 2026-08-04 に item0 から末尾へ移動）**: Phase 2 の本番反映と同時に行う。手順と条件は以下。
   - **前提条件（すべて満たすまで実施しない）**: ①App Review 通過（Advanced Access 付与）②アクセス認証（Tech Provider）完了 — §3.2。未完だと役割を持たないユーザーの呼び出しが `error code 100` で落ちる ③クライアント側ビジネス認証完了（2026-08-01 時点で完了済み）
   - `INSTAGRAM_BETA_USER_IDS` を空にする。`canAccessInstagram` が §7 の通常ロール判定にフォールバックし、Q4 の開放範囲（admin / paid / trial）に戻る。**コード変更は不要**
   - **解除直後に、allowlist に載っていなかったアカウントで実際に OAuth 連携が通ることを実測する**（メニューが出ることを根拠にしない — §3.2 の教訓）。落ちる場合はアクセス認証が未完了なので変数を戻す
   - `/setup` の Instagram カードが対象ロール全員に出ることを確認する（**ただし `/setup/*` 自体は引き続き `proxy.ts` の `hasSetupAccess` = paid / admin のみ**。trial が `/setup/instagram` に来るには proxy 側の別変更が必要 — §9 Q7）
   - **継続義務の引き継ぎを同時に行う**: データ使用状況の確認（DUC。年1回）とデータ保護アセスメント（DPA。通知から60日）は解除後に全ユーザーへ影響する（§3.2）。担当者とアプリ連絡先メールの生存を運用側に明示する

### Phase 3: AI チャット連携（台本作成）— **保留（2026-08-05 クライアント MTG）**

**クライアント判断で保留。評価機能の実装を優先することになった。本仕様書は Phase 2 の完了をもって終了とする。**

- **保留であって中止ではない**。将来再開する可能性があるため、調査済みの内容と検出済みの設計不足はこの節に残す（消さない）
- **再開の前提は 2026-08-04 時点から変わっていない**: `llm-context-memory` Review Checklist（Context Assembly Contract・token budget 等）を充足する別設計書を書き起こすまで実装着手しない。Phase 3 のブロッカーは Meta 側ではなく**設計不足**なので、保留期間が過ぎても自動では解消しない
- **§4 Phase 2 の設計判断が Phase 3 の前提を変えている**点に注意。再開時は下記「データ読み出し方」「伸びている投稿の判定方法」を必ず読み直すこと（日次推移テーブルを作らない決定が効いている）
- ~~別設計書を書き起こす作業自体は Phase 2 と並行して着手してよい~~ → 保留に伴い、**別設計書の起案も行わない**

**再開時に埋めるべき項目（2026-08-04〜05 のレビューで検出済み。調査結果として保存）**

- **認可（最重要）**: `/chat?ig_media=<id>` は URL パラメータで他人の media id を指定できてしまう。`instagram_media` を引く際に **`.eq('user_id', userId)` を必ず併用**し、他ユーザーの投稿・指標が LLM 文脈に混入しない設計にする（§7 の Service Role 規約と同じ水準）。存在しない / 他人の id の場合の画面挙動も定義する
- **token budget の具体値**: 「上位 N 件・キャプション先頭 M 文字」の N / M が未定。`llm-context-memory` の Context Assembly Contract に沿って数値で決める
- **`prompt_templates` の seed 手順**: リール台本テンプレートのマイグレーション（seed SQL か管理画面登録か）とテンプレート識別子の命名が未定。`gscSuggestionService` の先例に合わせる
- **「相談 → 引き継いで作成」の文脈引き継ぎ方式**: クライアント要望の中心でありながら「詳細設計の中心論点とする」と書いたまま未設計。会話履歴の要約・引き継ぎ単位（セッション / スレッド / 明示的な引き継ぎ操作）を決める
- **データ読み出し方**: 「伸びている投稿 TOP5」は `instagram_media`（最新値のみ。日次推移テーブルは Phase 2 で不採用 — §5.3）から取る。並べ替え + 上位 N 件なので `db-max-rows = 1000` には当たらないが、母集団が増えたら RPC 側で集約する
- **事業者情報（`briefs`）の注入が設計に含まれていない（2026-08-05 検出。最優先）**: 既存チャットは `briefs`（`/business-info` で入力。`src/server/schemas/brief.schema.ts` の `profile` / `services[]` / `persona`）をシステムプロンプトに注入している。Phase 3 の記述にはこの言及が無く、**素直に実装すると事業者情報が入らないものが出来上がる**。
  - **構造上の罠**: `getSystemPrompt`（`src/lib/prompts.ts:741`）は `switch` で、`ad_copy_creation` / `lp_draft_creation` / `blog_title_meta_generation` だけが専用の生成関数を通って事業者情報を得る。**`STATIC_PROMPTS` に足すと `default` 分岐に落ちて事業者情報はゼロ**。「`getSystemPrompt` の分岐追加」とだけ書くと実装者がどちらにも解釈できるため、**専用の生成関数（`generateInstagramScriptPrompt` 相当）を新設して `case` を足す**と明記すること
  - **注入は2段構え**: `generateTitleMetaPrompt`（`src/lib/prompts.ts:681-682`）が正本。①`replaceTemplateVariables(template.content, businessInfo, serviceId)` で事業者変数 → ②`PromptService.replaceVariables(..., contentVars)` で対象固有の変数。**本仕様書の「注入方式」に書いてあるのは②だけ**
  - **事業者情報が未登録のときのフォールバック**: `replaceTemplateVariables` は `businessInfo` が null のとき、テンプレート内の該当セクションを**正規表現でまるごと削除**して汎用プロンプトに落とす（`src/lib/prompts.ts:231-241`）。この正規表現は**既存テンプレートの文面に強く依存**しているため、リール台本テンプレートを新規に書くならフォールバック処理もセットで設計しないと、**未登録ユーザーに `{{persona}}` のまま LLM へ渡る**
- **`serviceId` との紐付けが未定義（2026-08-05 検出）**: 既存は1事業者に複数サービスがあり `useServiceSelection` で「どのサービスの文脈か」を切り替える（`getSystemPrompt` の `serviceId` 引数）。一方 Instagram は **1ユーザー=1アカウント**（Q1 で確定）。リール台本を**どのサービスの訴求として作るのか**が決まっていない。選択させるのか、アカウント全体の文脈で作るのかを決める
- **「伸びている投稿」の判定方法（Q3 の決定が波及。2026-08-05 検出）**: 日次推移テーブルを作らないため（§5.3）、保持しているのは**同期時点の累計値だけ**。累計値をそのまま降順に並べると**投稿日が古いものほど数値が積み上がっており、TOP5 が古い投稿で埋まる**。「直近で伸びている」を出したいなら、投稿からの経過日数で正規化する等の方針が要る。何をもって「伸びている」とするかを定義してから実装する

**保留前に固まっていた方針（再開時の出発点。2026-08-05 時点で凍結）**

**ゴール（凍結）: Instagram の実績データを文脈として持った状態で `/chat` でリール台本の壁打ちができる。**

実装前に別途詳細設計（+ client-alignment 確認）を行う。**2026-07-22 定例でクライアントの要望像が具体化した**ため、以下を前提としていた。**再開時はクライアントの要望が変わっていないかを最初に確認すること**（2026-08-05 の優先順位変更のように、前提そのものが動く）:

- **ステップ制にしない（旧 Q5 は回答済み）**: ブログはキーワード（検索ニーズ）軸で step1〜7 の型があるが、Instagram は検索ニーズ軸ではなく「こちらが作るテーマ」軸。クライアント自身「順番としてはまだ言語化できていない」と明言。よって**自由壁打ち（相談役）型 + データ注入**で設計する。型として言語化済みの要素（冒頭3秒で気づかせるフック、自社サービスを間接的に頼みたくなる内容）はプロンプトテンプレート側に組み込む
- **相談 → 引き継いで作成のフロー**: クライアントの理想は「まず相談（フィードバック壁打ち）→ 方向性が固まったらその文脈を引き継いでコンテンツ作成（Instagram でもブログでも）」。相談セッションの文脈を台本作成に引き継ぐ設計を詳細設計の中心論点とする
- **最終的な運用像（クライアントの現行管理表より）**: ①テーマのストック（ネタ帳。日常で気づいたテーマを蓄積）→ ②テーマを選んで台本・キャプション・サムネイルコピーを作成 → ③収録・投稿 → ④結果（実績数値）を記録して PDCA。Phase 2 の実績一覧 + Phase 3 の台本作成に加え、**テーマストック機能**が将来スコープとして視野に入る（Phase 3 詳細設計時にスコープ判断）
- **導線**: analytics の Instagram タブの各投稿に「この投稿を元に台本作成」ボタン → `/chat?ig_media=<id>` で起動。加えてチャット側で「伸びている投稿 TOP5」を参照する台本作成モードを用意
- **注入方式**: `gscSuggestionService.ts` の確立パターンを踏襲 — `prompt_templates` テーブルにリール台本用テンプレートを seed し、対象投稿のキャプション・指標（+アカウントの平均値との比較）を `PromptService.replaceVariables` で変数注入。チャット本体（`app/api/chat/anthropic/stream/route.ts`）へは `getSystemPrompt` の分岐追加として実装
  - **補足（2026-08-05）**: ここに書いてあるのは**注入2段のうち②（対象固有の変数）だけ**。①の事業者情報（`briefs`）注入が抜けており、かつ `STATIC_PROMPTS` に足すと事業者情報が入らない構造になっている。詳細と対処は上記「事業者情報（`briefs`）の注入が設計に含まれていない」を参照
- **token budget**: 注入する投稿データは上位 N 件・キャプション先頭 M 文字に制限（`llm-context-memory` スキルの Context Assembly Contract に従い、詳細設計時に budget を明記）
- **機密**: access_token・credential 行を LLM 入力に含めない（変数注入は表示用指標とキャプションのみ）

## 5. DB 設計

マイグレーションは `supabase/migrations/` に SQL で追加。**本番と開発は同一 Supabase プロジェクトを共有するため `npx supabase db push` をリモートに実行してはならない**（README「セットアップ手順」）。**Vercel のデプロイでは DB は更新されない**ので、適用は管理者が別途手動で行う（未適用のままコードだけ本番に出すと `42P01 relation does not exist` になる。2026-08-01 に実際に発生）。適用されるまでは `database.types.pending.ts` の暫定型パターン（supabase スキル §6）を使い、適用後に型再生成して撤去する。各ファイルにロールバック手順（`DROP TABLE` / `DROP POLICY`）をコメントで残す。

### 5.1 `instagram_credentials`（Phase 1）

```sql
create table public.instagram_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  ig_user_id text not null,
  username text,
  account_type text,               -- Business / Media_Creator（API 実値。判定は大小文字を正規化して行う）
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
  -- インサイト（Phase 2 での唯一の保存先。日次スナップショットは不採用 — §5.3）
  like_count int, comments_count int,
  reach int, views int, saved int, shares int, total_interactions int,
  reposts int,                     -- 2026-08-05 追加（アプリ画面の「再投稿」）
  reels_skip_rate numeric,         -- 2026-08-05 追加。API が率（%）で返すので実数化しない。リールのみ
  avg_watch_time_ms int, total_watch_time_ms bigint,   -- リールのみ
  insights_synced_at timestamptz,
  -- 恒久的に insights を取得できないメディア（プロ転換前 = error_subcode 2108006）。
  -- true の行には以後 insights コールを投げない（§4 Phase 2 item2）。
  insights_unavailable boolean not null default false,
  -- 恒久不可の理由（insights_unavailable=true のとき必須）。UI 文言分岐用（§11.3）
  insights_unavailable_reason text check (
    insights_unavailable_reason is null
    or insights_unavailable_reason in ('pre_conversion', 'retention_expired')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, ig_media_id)
);
create index on public.instagram_media (user_id, posted_at desc);
```

- **UI は `insights_unavailable = true` の行を「取得失敗」と表示しない**。§11.3 の一覧では指標セルを `-` ではなく「対象外」相当にし、**`insights_unavailable_reason` でツールチップを分ける**（`pre_conversion` →「プロアカウント転換前の投稿のため取得できません」／`retention_expired` →「投稿から2年以上経過しているため取得できません」）。部分失敗の件数にも含めない（`preConversionCount` と同じ扱い — §4 Phase1-11）。`insights_unavailable=true` なのに `reason` が NULL の行を UI が出さない（同期側で必ずセット）

### 5.3 `instagram_media_insights_daily`（**Phase 2 スコープ外。将来検討** — 2026-08-05 に Q3 回答済み）

**このテーブルは作らない。** §9 Q3 が「不要」で確定したため（根拠は下記）。設計は将来必要になったときのために残すが、**Phase 2 のマイグレーションには含めない**。必要になった時点で、その日以降のスナップショットから積み上がる（過去に遡って作ることはできない）。

- **確定の根拠（2026-08-05）**: クライアント指示は「取得するデータは基本 [Adzviser](https://adzviser.com/) に合わせる」。Adzviser の Instagram コネクタには**投稿ごとの日別ディメンションが存在しない**。[Instagram Insights Metrics and Breakdowns](https://docs.adzviser.com/connect/instagram-insights/supported-fields)（2026-08-05 確認）の Post Level ブレークダウンは Media ID / Media Creation Datetime / Media Type / Media URL / Media Permalink / Media Product Type / Media Shortcode / Video Thumbnail URL / Media Caption / Media Comments Enabled の10個で、**Date / Day に相当するものが無い**。投稿メトリクス（Post Reach / Post Likes / Post Saved / Post Shares / Post Total Interactions 等）は現在値のみ
- **これは Adzviser の制約ではなく API の制約**。Media Insights は投稿ごとの**累計値**しか返さず日付ブレークダウンが無いため、日別推移は「毎日スナップショットを取って差分を出す」以外に作れない。Adzviser もそれをしていない
- **`instagram_media` の「正史は insights_daily」というコメントは失効**（§5.2）。Phase 2 では `instagram_media` の最新値が唯一の保存先になる

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

※ Media insights API は**累計値**を返すため、日次スナップショットの差分が日別推移になる。この設計自体は正しいが、上記のとおり **Phase 2 では採用しない**。

**将来採用する場合の注意（Phase 2 では未適用）**

- **データ量と読み出し方**: 50件 × 365日 ≒ **18,000行/年/ユーザー**。`docs/context/db-row-limits-and-data-truncation.md` のとおり PostgREST の `db-max-rows = 1000` は `.rpc()` にも効くため、**推移グラフや集計を「全件取得してコード側で集計」してはいけない**。集計は RPC 内で `GROUP BY` してから返す（母集団が大きくても返却は数百行）
- **保持期間**: 明示的な purge を設計に含めること（連携解除時の §5.5 だけでは無限に増える）
- **遡れない**: 採用した日以降のスナップショットからしか積み上がらない。過去の日別推移を後から復元する手段は API 側に無い

### 5.4 `instagram_account_insights_daily`（Phase 2）

```sql
create table public.instagram_account_insights_daily (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  date date not null,
  reach int, views int,
  -- 採用列はこの5つで確定（2026-08-05 決着 — §3.3）
  -- profile_views / website_clicks: 2025-01-08 に全バージョンで廃止済み
  -- profile_links_taps: contact_button_type に WEBSITE が無く不採用
  -- 「プロフィール閲覧数」は後継指標が存在せず取得不能
  accounts_engaged int, total_interactions int, follower_count int,
  imported_at timestamptz not null default now(),
  unique (user_id, date)
);
```

- **列名は暫定。マイグレーションを書く前に §3.3「アカウント指標名の公式照合」を決着させる**（2026-08-04 追記 → 2026-08-05 更新）。**`profile_views` / `website_clicks` は Changelog 2024-10-02 で deprecate、2025-01-08 に全バージョン適用済み**と判明したため**列を作らない**（2026-08-01 の実測では今も値が返るが、廃止済み指標に列を作らない）。残る未確定は **`profile_links_taps` を後継として採るか**（`breakdown=contact_button_type` の合算指標であり `website_clicks` の 1:1 後継ではない可能性）と、**`profile_views` の後継が存在するか**の2点。**列を作ってから「その指標は無い」と分かるのが最悪の手戻り**
- **列ごとに取得方式を確定してから実装する**（§4 Phase 2 item2 / §3.3 公式照合）。**マイグレーション前の固定対応表（2026-08-05。metric 名の採否は §3.3 決着後に更新）**:

| DB列（暫定） | API metric（暫定） | metric_type | period | 日次行の埋め方 | 根拠 |
|--------------|-------------------|-------------|--------|----------------|------|
| `reach` | `reach` | `time_series` | `day` | 応答 `values[]` を `date` キーで upsert | §3.3 公式表: `reach` は time_series 対応（2026-08-05 audit） |
| `follower_count` | `follower_count` | （付けない） | `day` | **`fetchAccountInsights` を follower_count 単独コールに分離**（§3.3 実測）。100未満は NULL + UI「対象外」 | 公式 Limitations verbatim（§3.3） |
| `views` | `views` | `total_value` | `day` | **未確定** — `time_series` 非対応のため、日別 `values[]` が返るか実測で確認。**返らなければ列不採用** | §3.3 公式表（2026-08-05 audit） |
| ~~`profile_views` / `website_clicks`~~ | **採用しない** | — | — | **列を作らない**（2025-01-08 に全バージョンで廃止済み） | Instagram Platform Changelog 2024-10-02（§3.3 verbatim） |
| ~~`profile_links_taps`~~ | **採用しない（2026-08-05 決着）** | — | — | **列を作らない**。`contact_button_type` に `WEBSITE` が無く、ウェブサイトクリック相当を取り出せない | 公式 Description・Breakdown verbatim（§3.3） |
| `accounts_engaged`, `total_interactions` | 同名 | `total_value` | `day` | **未確定**（`views` と同様。日次分割不可なら列不採用） | §3.3 公式表 |

- **`metric_type=total_value` だけの指標を日次テーブルに入れる判断は、実測で日別配列が取れることを確認してから行う**。確認できない指標は §2 スコープ表から外すか、アカウントサマリー（単一値）として別 UI に退避する（Phase 2 では**日次テーブルに無理に載せない**）
- **`follower_count` は 100 フォロワー未満のアカウントでは常に NULL**（§3.3）。**NULL の意味が「取得失敗」と「対象外」で二重化する**ため、区別が必要なら `follower_count_unavailable boolean` 等を足す。区別しない場合も、UI が「取得失敗」と読める表示をしないこと
- **サマリー Card 用の表示集約（§11.3 が正本。DB から最新1日分だけ返す — クライアントで30行を集計しない）**:

| DB列 | サマリー Card の表示値 | 禁止 |
|------|------------------------|------|
| `reach` | **`date` が最大の行**の `reach` のみ | **日次行の SUM 禁止**（ユニークリーチの意味が壊れる） |
| `follower_count` | **`date` が最大の行**の `follower_count` | SUM 禁止（点指標） |
| `views` / `accounts_engaged` / `total_interactions` / `profile_links_taps`（採用時） | **`date` が最大の行**の当該列 | **30行を Client Component で合算しない**（`docs/context/db-row-limits-and-data-truncation.md` の「全件取得してコード側で集計」禁止と同趣旨）。期間合計が欲しくても Phase 2 サマリーでは**最新日スナップショットのみ** |
| 読込 | `instagramMediaService.getAccountInsightsLatestDay(userId)` — **1行 SELECT**（下記 §4 item5 / §10） | 30行を `page.tsx` に載せて React 側で `reduce` しない |

- 5.2〜5.4 の RLS も **上記と同様: 認証ユーザーは `SELECT` のみ**（`get_accessible_user_ids`）。**書き込み（INSERT/UPDATE/DELETE）は Service Role 経由の手動同期 Server Action のみ**。所有者向け write ポリシーは設けない
- DB アクセス:
  - Phase 1 credential: `SupabaseService` の `save/get/update/deleteInstagramCredential`（§4 Phase1-4）
  - Phase 2 media/insights: `SupabaseService` 継承の `instagramMediaService`（`src/server/services/instagramMediaService.ts`）に集約。`withServiceRoleClient` + 明示的 `.eq('user_id', userId)` 必須

### 5.5 連携解除とデータ purge

| フェーズ | `disconnectInstagram` の動作 |
|---------|------------------------------|
| Phase 1 | `deleteInstagramCredential(userId)` のみ（Phase 2 テーブル未存在のため media purge 不要） |
| Phase 2 以降 | 1) `instagram_media` → 2) `instagram_account_insights_daily` を **user_id スコープで DELETE**（Service Role）→ 3) `deleteInstagramCredential`。FK は `users` 参照のため credential 削除だけでは media は残る — **明示 purge 必須**。※ `instagram_media_insights_daily` は Phase 2 で作らないため purge 対象外（将来採用する場合は `instagram_media` より**先に**消すこと。FK が `instagram_media.id` を指すため） |

**再連携時**:
- 同一 `user_id` で OAuth 成功 → `saveInstagramCredential` が upsert（`unique(user_id)`）。**`ig_user_id` が前回と異なる場合**（別 Instagram アカウントに付け替え）は、保存前に §5.5 の purge を実行し旧アカウントの media/insights を削除してから新 credential を保存（混在防止）
- 同一 `ig_user_id` の再連携 → purge 不要、token 列のみ更新

## 6. エラーパス設計

| 事象 | 挙動 |
|------|------|
| OAuth 認可拒否 / state 不一致 / code 交換失敗 | `/setup/instagram?error=<種別>` へ **302 リダイレクト**（Google Ads 型）。`app/setup/instagram/page.tsx` の ERROR_MAP → `ERROR_MESSAGES.INSTAGRAM.*` を Alert 表示。credential は変更しない |
| トークン期限切れ・無効化（API が 190 系エラー） | `isInstagramReauthError()` ヘルパーに判定を集約し `needsReauth: true` を返す。UI は「要再認証」バッジ + `/setup/instagram` 再連携導線（サイレントに未連携へフォールバックしない） |
| **ユーザーが Meta 側で連携を解除**（2026-08-04 明記） | **Webhook では検知できない**（Instagram Login に deauthorize フィールドが無い — §3.3）。**API エラー起点でのみ検知**する。`isInstagramRevokedTokenError`（190 系限定）が真のときだけ保存済み `access_token_expires_at` を過去に倒し、表示を「要再認証」に揃える（実装済み） |
| **Instagram アカウント削除・停止等で API が恒久エラー**（2026-08-05 追記） | **`needsReauth` と同じ UX**（要再認証バッジ + `/setup/instagram` 再連携）。**取得済み `instagram_media` / `instagram_account_insights_daily` は自動 purge しない**（連携解除操作まで DB に残す）。一覧は既存データを表示しつつ同期・最新化は `needsReauth` で止める |
| **判定ヘルパーの使い分け（重要）** | **credential を書き換える処理は `isInstagramRevokedTokenError`（190 系限定）を使う。表示だけ切り替える用途は広めの `isInstagramReauthError` でよい**。Meta はレート制限（code 4 / 17 / 32 / 613）にも `"type":"OAuthException"` を付けるため、広い方で書き換えると**一時的な制限を恒久失効として保存**してしまう。期限を過去に倒すと `resolveInstagramTokenAction` がリフレッシュを試みなくなり自力回復しない。**Phase 2 で cron を作らない（§4 Phase 2 item3）ため被害は当該ユーザーに閉じるが、そのユーザーは再連携するまで復旧できない** |
| **恒久的に取得できないデータ**（プロ転換前 = `2108006` / 2年超 = `retention_expired` / フォロワー100未満の `follower_count`） | 「取得失敗」と**別カテゴリ**として表示する（情報色 Alert・「対象外」ラベル）。再試行導線を出さない。DB 側は `instagram_media.insights_unavailable` + `insights_unavailable_reason`（§5.2）でフラグ化し、以後コールしない |
| **同期の停止（キルスイッチ）** | `INSTAGRAM_SYNC_ENABLED=false` で手動ボタンを disabled + 情報色 Alert、一覧は既存データを表示（§4 Phase 2 item3）。**押せるのに何も起きない状態を作らない** |
| refresh 失敗（発行24時間未満 / 期限切れ） | 24時間未満: 次回のユーザー操作（プレビュー表示 / 最新化）に持ち越し（エラーにしない）。期限切れ: `needsReauth` |
| プロアカウントでない | callback で account_type 検証し `NOT_PROFESSIONAL_ACCOUNT` エラー表示（credential 保存しない） |
| 同期の部分失敗 | 投稿単位で continue、`console.error('[Instagram Sync]', ...)` 必須、結果サマリに failed 件数 |
| レート制限（429 / code 4） | 当該同期を中断し、トーストで再試行を促す（cron が無いので自動リトライは無い）。エラーログに残す |
| 手動同期が実行時間上限に達する | **時間予算 760 秒**（§4 Phase 2 item3）到達で中断し `stoppedReason: 'time_budget'` を返す。**連続失敗 K 件（初期値 5）** でも `stoppedReason: 'consecutive_failures'`。いずれも `export const maxDuration = 800`（`app/analytics/page.tsx`）を使い切らない。取得済み分は保存し、再度「最新化」で続き。**cron は Phase 2 に無い**ので自動での続行はしない |

## 7. 認可・セキュリティ

- **Instagram 機能のロール（`canAccessInstagram`・allowlist 解除後）**: **admin / paid / trial に開放**（`unavailable` のみ `authMiddleware` の 403 で除外。2026-07-23 決定）。`src/server/lib/instagram-permissions.ts` の `INSTAGRAM_ALLOWED_ROLES` がこれに対応。**Instagram 独自の恒久的なロールゲートは追加しない**。Phase 3 の台本作成チャットは既存のトライアル日次制限（`checkTrialDailyLimit`）にそのまま乗せる
- **`proxy.ts` による経路ゲート（Instagram 仕様とは独立した既存実装）**: `/setup/*`（Google Ads 系パス除く）は `hasSetupAccess` = **`hasPaidFeatureAccess`（paid / admin のみ）**（`proxy.ts:156-158,205-207`）。`/analytics` も同様（`PAID_FEATURE_REQUIRED_PATHS`）。よって **`role: 'trial'` のユーザーは allowlist に載っていても `/setup/instagram` および `/analytics` の Instagram タブ経路に到達できない**。§7 の trial 開放は **allowlist 解除後かつ proxy が trial を `/setup` に通す場合**にのみ成立する（現状コードでは trial は `/setup` 不可 — §9 Q7）
- 全 Email ユーザー共通: **`full_name` 未登録は `/login` へリダイレクト**（`proxy.ts:147-148`）。審査用アカウントも例外なし
- **限定公開ゲート（審査期間中の一時措置。2026-07-25 決定）**: App Review 通過までは `canAccessInstagram` が `INSTAGRAM_BETA_USER_IDS` の allowlist で対象を絞る。**環境変数が非空の間は allowlist の user_id のみが Instagram UI（Setup カード・`/setup/instagram` ガード）に到達可** — この間 `role` は `canAccessInstagram` では参照されない（§4 Phase 1-A）。**環境変数が空なら上記ロール判定にフォールバック**するため、Phase 2 の**最終タスク item6**（審査通過後）で変数を空にすれば最終形に戻る（§4 Phase 1-A / Phase 2 item6。2026-08-04 に Phase 2 冒頭 item0 から移動）。**`role: 'admin'` を Instagram 露出の理由に使わない** — レビュアーに admin を渡すと `/admin/users` から全ユーザーの個人データが見えてしまうため（§4 Phase 1-A 参照）
- Service Role 使用箇所: **OAuth callback（credential upsert）・トークン refresh 更新・連携解除（credential + Phase2 media purge）・手動同期**。いずれも明示的 `user_id` スコープ必須。認証ユーザー JWT からの write 経路は設けない
- `INSTAGRAM_APP_SECRET` はサーバーのみ。クライアント・LLM 入力に credential/token を一切出さない
- OAuth state は HMAC 署名 + httpOnly Cookie + セッション整合チェック（既存3系統と同一水準）

## 8. 受け入れ条件・検証

### Phase 1-A（ハードコーディング UI モック・クライアント合意用）
- [ ] `DEV_SAMPLE_*` を切り替えることで `/setup/instagram` が未設定・接続OK・要再認証・投稿0件・部分失敗の5状態を画面表示できる
- [ ] `/setup` ハブに Instagram カードが出て connected / needsReauth / unlinked が区別表示される（Badge 文言は §11.1 準拠: 接続OK / 未設定 / 要再認証）
- [ ] ERROR_MAP 経由でエラー Alert が表示される（state 改ざん等のエラー種別ごとの文言差し替えを確認）
- [ ] `NODE_ENV==='production'` ビルド（`npm run build && npm run start` 相当）で `DEV_SAMPLE_*` 分岐に到達しないことを確認済み
- [ ] `INSTAGRAM_BETA_USER_IDS` に自分の user_id だけを入れた状態で、allowlist 外のユーザーには `/setup` の Instagram カードが出ず `/setup/instagram` も開けない
- [ ] `INSTAGRAM_BETA_USER_IDS` を空にすると §7 のロール判定に戻り、**allowlist 解除後の** `canAccessInstagram` 対象ロール（admin / paid / trial）に Instagram UI が開放される（Phase 2 item6 の解除手順の先行検証。**`/setup` 経路は proxy の paid/admin 制約が別途残る** — §9 Q7）
- [ ] クライアント（カオルさん）へ画面共有し、§11 ワイヤーフレームとの差分（Q2 の列構成含む）を確認済み

### Phase 1-B（実データ連携 + App Review 提出）
- [x] **§9 Q6・Q7 が確定済み**（2026-08-01 回答済み。**案1**（`/review-login` 固定メール＋パスワード）+ `role: 'paid'`。案2＝審査専用受信箱は、Gmail のリスクベース認証で復旧経路が確保できず却下）
- [ ] item0 の順序制約を満たしたうえで、テスターアカウントで `/setup/instagram` から実際に連携でき、プロフィール（username, フォロワー数等）・**最新3件**の投稿・インサイトが実 API 経由で画面に表示される（部分失敗時は取得分のみ表示 + Alert）
- [ ] 認可拒否・state 改ざん時に ERROR_MAP 経由でエラー Alert が表示され、credential が壊れない
- [ ] 連携解除で credential が削除され unlinked に戻る
- [x] **`/privacy` に Instagram API 利用・Meta 共同利用・取得データ・削除手順（連携解除）が追記されている**（`app/privacy/page.tsx` 実装済み。App Review 提出前に本番 URL で目視確認）
- [x] 本番（`https://growmate.tokyo`）にデプロイされ、Instagram 機能が allowlist で審査用アカウントにのみ見えている（§3.2 審査環境）。`INSTAGRAM_BETA_USER_IDS` は Production / Preview とも遠藤・薫・審査用の3件（2026-08-02）。**この変数は Vercel の Sensitive 設定で読み戻せない**ため、追記ではなく全件上書きになる。変更時は既存 ID を落とさないよう `instagram_credentials` の実績から再構成すること
- [ ] 審査用アカウント（**`role: 'paid'`**、`full_name` 登録済み、allowlist 上の user_id）で **`/setup/instagram` まで到達**し、ログイン〜連携〜プレビュー表示まで通しで動作する。`/admin/*` には到達できない
  - 到達までは 2026-08-02 に確認済み（`role` は `trial` では不可。`hasPaidFeatureAccess` が `paid` / `admin` のみを通すため、`trial` だとホーム画面に「設定」カードが出ず `/setup` へ辿り着けない）
  - **連携〜プレビュー表示は未実施**。スクリーンキャスト収録と同時に行う
- [x] **`/review-login` がセッションを持たない状態で 200 で開ける**（案1 の前提。`proxy.ts` と `src/lib/public-paths.ts` の**両方**に `/review-login` が入っていること。片方だけだと `AuthProvider` がマウント直後に `/login` へ戻し、レビュアーは OTP を受け取れず詰む。2026-08-02 にシークレットウィンドウで確認）
- [x] **`/terms` がセッションを持たない状態で 200 で開ける**（App Dashboard の利用規約 URL。同じ公開パス漏れが `/terms` にもあった。2026-08-02 に修正・確認）
- [x] Meta Dashboard に **1024×1024** App Icon をアップロード済み
- [x] 成功 API コールが提出 **30 日以内**（§3.2）。2026-08-02 時点で `instagram_business_basic` 29 件 / `instagram_business_manage_insights` 3 件、ダッシュボード上のステータスは両方「テスト準備完了」
- [ ] 提出フォームの Platform Settings 欄にレビュアーのアクセス手段を記入済み
  - **Instagram アカウントは事前に連携済みにしておき、その旨も書く**。スタンダードアクセスでは「役割を付与されているアプリユーザーのみ」がパーミッションをリクエストできる（§3.2）ため、レビュアーが自分の Instagram アカウントでその場で連携することは期待できない
- [ ] 連携ボタンが Meta ブランドガイドラインに準拠し、アプリ内と収録の両方で見えている
- [ ] 実 OAuth 連携画面のスクリーンキャストを Meta App Review に提出済み（§3.2 提出ゲート充足）。**パーミッションごとに1本**・**§9 Q6 で確定したログインフロー**込み・英語キャプション付き

### Phase 2
- [ ] **未連携ユーザーの `/analytics` が現行のまま**（タブバーが出ない）。既存ブログ一覧の挙動もレイアウトも不変
- [ ] 連携済みユーザーの `/analytics` にブログ / Instagram タブが出て、ブログ側の挙動（フィルタ・ページネーション・URL パラメータ）が不変
- [ ] 未連携ユーザーが `?tab=instagram` を直接開くと `blog` にフォールバックする
- [ ] 連携解除するとタブが消え、現行レイアウトに戻る
- [ ] Instagram タブに投稿一覧＋指標が表示され、種別フィルタ・ソートが機能する
- [ ] **§5.4 で確定したアカウント指標**が Instagram タブのサマリー Card に表示される（§11.3「アカウント指標 UI」）。**最新日1行のみ**（`getAccountInsightsLatestDay`）。ラベルは「（最新日）」、`reach` の日次 SUM をしていないこと。`follower_count` の対象外表示を含む
- [ ] **フィールド構成ダイアログで表示列を変更でき、リロード後も保持される**（`FieldConfigurator` 再利用）。**ブログタブの列設定が影響を受けない**（`storageKey` が別であること）
- [ ] **率の列（いいね率 / 保存率 / シェア率 / コメント率 / 再投稿率）が `(実数 ÷ reach) × 100` で算出され、小数第1位で表示される**。既定は非表示。DB に保存されていない（表示時計算）
- [ ] 率の表示: 分母 `reach` が `null` / `0`、または分子（いいね / 保存 / シェア / コメント / 再投稿の実数）が `null` のときは `-`（`0%` にしない）。分子が `0` かつ分母 `reach > 0` のときのみ `0.0%`
- [ ] **着手前**: 率の**分母を複数投稿で確定**する（フィード・リール双方でアプリ表示値と誤差を測る。現状の「分母 = `reach`」は1投稿・2指標だけの逆算で根拠が弱く、リールは `views` の方が近い可能性がある — §9 Q10）
- [ ] `reels_skip_rate` が `null` で返っても列が壊れない（**"estimated and in development" のため値が変動・欠損し得る** — §3.3）
- [ ] **スキップ率（公式値）と独自計算の率が、ツールチップで出所を区別できる**（§11.3。混同させない）
- [ ] 率の算出が純関数として切り出され、vitest がある（分母 `reach` が null / 0 / 通常値、分子 null、分子 0 かつ分母 > 0 のケースを含む）
- [ ] 非表示にした列でソート中になる状態が起きない — **列を非表示にした時点で `ig_sort` を `posted_at` desc に戻す**（§11.3 採用方式）
- [ ] **手動「最新化」で同期され、`last_synced_at` が進む**（cron は Phase 2 スコープ外 — §4 Phase 2 item3）
- [ ] 初回同期で、**§5.4 で日次取得可と確定した列**について `instagram_account_insights_daily` に直近30日分が取り込まれる（日次不可列は行・列とも作らない）
- [ ] STORIES 等非スコープ `media_product_type` が来ても同期全体が失敗せず skipped ログが出る
- [ ] 50件打ち切り時 `truncated: true` がログに残り、エラー扱いにならない
- [ ] 連携解除で credential + media/insights が purge される
- [ ] **トークンが「最新化」実行時にも延長される**（期限7日前）。プレビュー表示だけでなく同期 Server Action でも `ensureValidInstagramToken` を通ること（§4 Phase 2 item3 の ⚠）
- [ ] 未連携ユーザーへの連携導線は `/setup` の Instagram カード（§11.1）のみで、`/analytics` には出さない

**Phase 2 追加（2026-08-04 レビュー反映。ローカル・テスターアカウントで検証する）**

- [ ] **着手前**: テスターアカウントの「転換後・指標が取れる投稿」の件数と FEED/REELS 内訳を数え、一覧2頁目・種別フィルタを検証できる量があることを確認（不足なら投稿を作り1〜2時間空ける — §3.3）
- [x] ~~**着手前**: §3.3「アカウント指標名の公式照合」を決着~~ → **2026-08-05 完全決着（実測不要）**。採用列は `reach` / `views` / `accounts_engaged` / `total_interactions` / `follower_count` の5列。`profile_links_taps` は不採用、「プロフィール閲覧数」はスコープ外（§3.3）
- [ ] `ACCOUNT_INSIGHT_METRICS` から **`profile_views` / `website_clicks` が除去されている**（2025-01-08 に全バージョンで廃止済み — §3.3 / §10）。あわせて **`fetchAccountInsights` のマッピング**と **`InstagramAccountInsights` 型**からも同フィールドが除去されていること
- [ ] **着手前**: Instagram Platform Changelog を確認し、Phase 2 で使う指標に新たな廃止・追加が無いか見る（廃止も追加も metrics 表ではなく Changelog に出る — §3.3）
- [ ] Graph API 採用バージョン（`v23.0` 等）が `instagramService` のパスと一致し、changelog 確認済み（§3.3）
- [ ] **着手前**: `follows` / `profile_visits` が REELS で本当に取れないかを `aozorayoukei` の REELS 投稿で実測し、採否を決める（§3.3「メディア別の指標対応」）。**アプリのリール画面には「フォロー数」が出ている**ため、公式表の記載と食い違っている
- [ ] `reposts` と `reels_skip_rate` が実 API で取得でき、`reels_skip_rate` が**率（%）のまま**保存・表示される（§3.3「Instagram アプリ画面との突き合わせ」）
- [ ] §2 非スコープに挙げた「アプリでは見えるが API に無い項目」を、UI 上で**取得失敗と誤解させない**（そもそも列・グラフとして置かない。「準備中」等の表示もしない）
- [ ] `instagram_media_insights_daily` を**作っていない**こと（Q3 = 不要。マイグレーションは2本のみ）
- [ ] 2年より古い投稿が直近50件に含まれる場合、「取得失敗」ではなく **`insights_unavailable_reason = 'retention_expired'`** の対象外ツールチップで表示される（§3.3 / §5.2。API 判定方法は実測で確認）
- [ ] `insights_unavailable = true` の投稿に対し、2回目以降の同期が insights コールを**投げない**（ログまたはコール数で確認）
- [ ] 一覧で「取得失敗」「対象外（転換前）」「実データの 0」が**見分けられる**
- [ ] `follower_count` が空で返るアカウントでも、画面が「取得失敗」と読める表示にならない
- [ ] レート消費ヘッダ（`X-App-Usage` / `X-Business-Use-Case-Usage`）が同期ログに出る
- [ ] `INSTAGRAM_SYNC_ENABLED=false` で手動ボタンが disabled + Alert 表示になり、一覧は既存データを保つ
- [ ] レート制限エラー（code 4 等）で **credential が書き換わらない**（`isInstagramRevokedTokenError` 側でのみ期限を倒す）。擬似エラーを注入して確認する
- [ ] insights が連続失敗したとき、**1ユーザーで `maxDuration`（800 秒）を使い切らずに中断**する（連続 K=5 件で `stoppedReason: 'consecutive_failures'`、または時間予算 760 秒で `stoppedReason: 'time_budget'` — §4 Phase 2 item3）
- [ ] **本番反映していない**こと（審査提出前は develop / feature ブランチ止まり）
- [ ] `INSTAGRAM_BETA_USER_IDS` が非空のままであること（item6 は審査通過後）

### 本仕様書の完了定義（2026-08-05 追加）

**Phase 2 の受け入れ条件がすべて満たされ、本番反映と allowlist 解除（Phase 2 item6）が完了した時点で本仕様書は完了**とする。Phase 3 は保留のため完了条件に含めない。

- [ ] Phase 1-B の残件（App Review 提出・通過）
- [ ] Phase 2 の受け入れ条件（上記すべて）
- [ ] Phase 2 item6（allowlist 解除・本番反映・継続義務の引き継ぎ）
- 完了後、本仕様書は `docs/specs/` へ移す（`update-docs` の規約に従う）。**その際は図解バンドル（`docs/plans/_html/instagram-integration-design/` と同 `.html`）も削除する** — `refresh` の対象外になり、更新されないまま開ける状態が残るため（`spec-to-html` SKILL.md の出力先規約）

検証は `quality-gate` に従い `npm run verify`（audit → lint → test → build → knip）+ 上記画面の手動確認。純関数（インサイト整形・期限判定 `ensureValidInstagramToken` の分岐・cursor ページング処理）には vitest を追加する。

## 9. 未確定事項（実装前に要確認）

### App Review 提出に関する確認事項 — **2026-08-01 時点で残件なし**

（Phase 2 の未決は次節。「残件なし」は審査提出まわり = Q6/Q7 についての記述であり、Phase 2 の Q2/Q3/Q8/Q9 は未回答）
- ~~Q6. Meta レビュアーの GrowMate ログイン手段~~: **回答済み（2026-08-01、同日中に案2 → 案1 へ変更）** — **案1「審査用1アカウントに限定したパスワードログイン」で確定**。`/review-login` を新設し、`REVIEW_LOGIN_EMAIL` に一致するアドレスのみ `signInWithPassword` を通す。アドレスとパスワードは提出フォームの Credentials 欄にのみ記入し、本仕様書には書かない。**既存の `/login`・`verifyOtp`・Supabase の新規登録設定は変更しない**。`client-vision-from-lark.md` §1.6 は認証変更の**禁止ではなく事前許可の要求**であり、2026-08-01 にクライアント承認取得済み。当初採用した案2（審査専用 Gmail に OTP を届ける）は、Google のリスクベース認証が発動して確認コードが登録電話番号にしか届かず、代替手段も提示されないことを実測したため撤回。詳細は §3.2「レビュアーのログイン手段」
- ~~Q7. 審査用 GrowMate アカウントの `/setup/instagram` 到達~~: **回答済み（2026-08-01）** — **`role: 'paid'` で確定**。`proxy.ts:156-158` の `hasSetupAccess` = `hasPaidFeatureAccess`（`src/types/user.ts:31` の `PAID_FEATURE_ROLES = ['paid','admin']`）を `paid` は通過し、`isAdmin`（`src/authUtils.ts:6-8`）は `role === 'admin'` のみのため `proxy.ts:162` の `/admin/*` は弾かれる。`PAID_FEATURE_REQUIRED_PATHS`（`proxy.ts:10` = `['/analytics']`）・`ADMIN_REQUIRED_PATHS`（同 `:9` = `['/admin']`）は `/setup/instagram` に適用されない。**proxy もアプリコードも変更しない**（選択肢 B・C は不要）。**`role: 'trial'` では `/setup/*` に到達できない**ため trial は採らない（2026-07-31 コード照合）

### Phase 2 着手前に確認が必要（2026-08-04 時点の未決。クライアント確認）

Phase 2 をローカル先行開発する方針に変えたことで、**下記4件が実装のブロッカーに昇格**した。いずれも「実装者が勝手に決めると後で作り直しになる」もの。2026-07-22 定例の要望（手段を鵜呑みにせず選択肢と推奨案をセットで出す）に従い、選択肢つきで確認する。

~~**Q3 投稿ごとの指標の「日別推移」は必要ですか。**~~ → **回答済み（2026-08-05）— 不要。`instagram_media_insights_daily` は作らない**
- クライアント指示は「取得するデータは基本 Adzviser に合わせる」。**Adzviser の Instagram コネクタに投稿ごとの日別ディメンションが存在しない**ことを公式フィールド一覧で確認した（§5.3 に出典・確認日・列挙）
- 根本原因は API 側。Media Insights は累計値しか返さず日付ブレークダウンが無いため、日別推移は毎日スナップショットを取る以外に作れない。Adzviser もやっていない
- 影響: Phase 2 のテーブルが3本→**2本**（`instagram_media` / `instagram_account_insights_daily`）。同期処理から当日分スナップショットが消える。18,000行/年/ユーザーの増加も消える

~~**Q2 一覧に出す列と並び順の「正」をください。**~~ → **回答済み（2026-08-05）— 正を決めず、ユーザーが選べる形にする**
- クライアント回答: 「列構成は決まっていないので実装しやすいシンプルな形でよい。**ブログ記事同様に、フィールド構成のダイアログで表示フィールドのチェックボックスを出し、ユーザーが自由に変更できる形**が望ましい」
- **既存の `FieldConfigurator`（`src/components/FieldConfigurator.tsx`）をそのまま再利用する**。ブログ一覧（`AnalyticsTable.tsx:634-640`）が既に使っている汎用コンポーネントで、表示/非表示のチェックボックス・**ドラッグでの並び替え**・localStorage 永続化・新規追加列の自動表示までを持つ。**Instagram 用に新規実装しない**
- **管理表のヒアリング待ちが解消**した。列の「正」を確定させる必要がなくなったため、Phase 2 のブロッカーから外れる。ただし §11.3 の列定義（既定で表示するもの／隠すもの）は実装時に決める

~~**Q8 Adzviser + スプレッドシートで貯めてきた過去の実績は、GrowMate に移しますか。**~~ → **回答済み（2026-08-05）— 移行しない**
- GrowMate は**連携以降の投稿だけ**を扱う。過去分はスプレッドシート側に残す。CSV 取込等の移行機能は作らない
- **§2 非スコープに明記**（下記）。リリース後に「去年の実績が見えない」と言われたときに、仕様上の意図的な決定であることを示せる状態にしておく
- Phase 2 が取得するのは **直近50件の投稿と直近30日のアカウント指標**のみ。この上限自体は §3.3 のレート制約に基づくもので、移行の可否とは独立

~~**Q10「いいね率」「保存率」などの率は、GrowMate 側で計算して出しますか。**~~ → **回答済み（2026-08-05）— 出す。ただし独自計算であることを明示する**
- **採用理由**: 評価・PDCA を主軸に置くため、**投稿間の横比較には率が要る**（リーチ数の違う投稿を実数だけで比べられない）。Instagram アプリは1投稿ずつしか見られないので、一覧で率を並べられること自体が GrowMate 側の価値になる
- **算出方法（§11.3 が正本）**: `率 = 実数 ÷ reach`。**分母の根拠は弱い**ので下記「分母の確定」を必ず実施する
- **「Instagram は算出定義を公開していない」は自前計算の5指標（いいね率 / 保存率 / シェア率 / コメント率 / 再投稿率）にのみ当てはまる**（2026-08-05 に切り分け）。**`reels_skip_rate` は公式が定義を明記している**（分母 = initial views。§3.3）。この2つを「定義が不明な率」として一括りにしない
  - アプリ内「エンゲージメント」画面の5つの率について、Meta のヘルプセンターにも開発者ドキュメントにも計算式は載っていない。分母（reach / views / impressions）も基準時点も非公開
- **アプリ値とズレるのは仕様**（設計上の前提として明記する）。理由は3つあり、いずれも解消できない:
  1. 算出定義が非公開（上記）
  2. API のデータは**最大48時間遅延**する（§3.3。公式 "Data used to calculate metrics can be delayed up to 48 hours."）
  3. 一部指標は**推定値**（`accounts_engaged` は "This metric is estimated"、`reels_skip_rate` は "estimated and in development"）
- **分母の確定（実測。着手前チェックに追加）**: 現在の「分母 = `reach`」は **1投稿・2指標だけの逆算**（いいね率 4.1% ← 21÷523=4.02%／保存率 0.4% ← 2÷523=0.38%。閲覧数 618 では一致しない）に基づく。**n=1 では根拠として弱い**。特に**リールは `views` の方がアプリ値に近いケースがある**ため、**複数投稿（フィード・リール双方）でアプリ表示値との誤差を測ってから分母を確定する**。測っても一致しない場合は「近い方を採用し、誤差があることを注記する」で確定させる（完全一致は目指さない）
- **UI では分母を明示する**（§11.3）。「独自計算です」だけでは何と比較すべきか分からないため、**式そのものを出す**（例:「いいね数 ÷ リーチ数。Instagram 非公式の独自計算のため、アプリの表示と一致しない場合があります」）
- **`reels_skip_rate` と混ぜて表示しない** — 公式値と独自計算値、かつ**分母が違う**（initial views vs reach）。同じ見た目で並べると、片方だけアプリと一致しない理由を説明できなくなる

~~**Q9 実績データの更新は毎時必要ですか。**~~ → **回答済み（2026-08-05）— 自動更新そのものを作らない**
- クライアント回答: 「手動同期もあるので、それだけでいいかな。最初はシンプルな作り（MVP）優先」
- **cron を Phase 2 スコープから外した**（§4 Phase 2 item3）。同期はユーザーが「最新化」を押したときだけ走るため、**頻度という設計変数が消えた**
- 副次的に §3.3 のレート枠の懸念も解消（毎時×50件＝1ユーザー約1,200コール/日 → 押した回数のみ）
- **代わりに1点だけ守ること**: トークン延長の契機がユーザー操作だけになるため、「最新化」の Server Action でも必ず `ensureValidInstagramToken` を通す（§4 Phase 2 item3 の ⚠）

### その他（Phase 2 以降で可のもの）

- ~~Q1. 複数アカウント~~: **回答済み（2026-07-23）** — 1ユーザー=1 Instagram アカウント。§5.1 の `unique(user_id)` 設計を確定とする
- **Q2. 現行管理表の項目** → **前節「Phase 2 着手前に確認が必要」へ移動**（Phase 2 をローカル先行開発する方針に変えたため、後回しにできる論点からブロッカーへ昇格した）。2026-07-22 定例で管理表の画面共有あり（テーマストック → 台本/キャプション/サムネコピー → 結果記録の構成）
- ~~Q3. 日次推移の要否~~: **回答済み（2026-08-05）— 不要**。詳細は前節。`instagram_media_insights_daily` は Phase 2 では作らない
- ~~Q4. 対象ロール~~: **回答済み（2026-07-23）** — `canAccessInstagram` 解除後は admin / paid / trial（`unavailable` のみ除外）。§7 参照。**App Review 通過までは allowlist**（2026-07-25）。**trial が `/setup` に来るかは proxy 側の別論点（Q7）**
- ~~Q5. 台本作成の形~~: **回答済み（2026-07-22 定例）** — ステップ制にせず自由壁打ち（相談役）型。**ただし Phase 3 自体が 2026-08-05 に保留となったため、この回答も凍結**（再開時に前提の再確認が必要 — §4 Phase 3）

なお 2026-07-22 定例のクライアント要望として「チケットに書かれた手段を鵜呑みにせず、目的を確認した上でより軽い代替案があれば先に提案してほしい」がある。上記 Q1〜Q4 の確認時も、選択肢と推奨案をセットで提示する。

## 10. 影響する既存画面・機能

- `app/setup/page.tsx` / `src/components/SetupDashboard.tsx`（Instagram カード追加。**表示は `canAccessInstagram` でガード** — 審査期間中は allowlist 外に出さない）
- `app/setup/instagram/page.tsx` / `src/components/InstagramSetupClient.tsx`（新規。同じくガード）
- `src/server/lib/instagram-permissions.ts`（新規。限定公開ゲート。§7 / §4 Phase 1-A）
- `app/analytics/page.tsx` / `AnalyticsClient.tsx`（**連携済みユーザーのみタブ化**。未連携ユーザーの画面は現行のまま変えない — §4 Phase 2 item4 / §11.3）。**Phase 2**: `app/analytics/page.tsx` に `export const maxDuration = 800`（Instagram 手動同期 Server Action — §4 Phase 2 item3）
- **`app/privacy/page.tsx`（Instagram / Meta 追記 — Phase 1-B item9。**実装済み**）**
- `src/server/services/supabaseService.ts`（Instagram credential CRUD 追加）
- ~~`.github/workflows/hourly-cron.yml`（matrix に `instagram-sync` 追加）~~ → **変更しない**（2026-08-05）
- `src/domain/errors/error-messages.ts`（INSTAGRAM 追加）
- R-1 実施時のみ: `src/server/lib/oauth-flow.ts`（新規）、Instagram OAuth start/callback から state 検証ヘルパーを利用
- **チャット本体は本仕様書のスコープで一切変更しない**（Phase 3 が保留になったため — 2026-08-05）。再開時に触るのは `src/lib/prompts.ts` の `getSystemPrompt`（専用生成関数の追加 + `case` 追加。`STATIC_PROMPTS` への追加では事業者情報が入らない — §4 Phase 3）と `prompt_templates` の seed

**Phase 2 で追加・変更するもの（2026-08-04 追記）**

- `src/server/services/instagramSyncService.ts`（新規。同期本体）
- `src/server/services/instagramMediaService.ts`（新規。`SupabaseService` 継承の media/insights DB アクセス — §5）。**メソッド**: `getPage`（投稿一覧）、**`getAccountInsightsLatestDay(userId)`** — `instagram_account_insights_daily` から `.eq('user_id', userId).order('date', { ascending: false }).limit(1).maybeSingle()` 相当で**最新日1行のみ**返す（§5.4 サマリー集約表）。30行 fetch + クライアント集計は禁止
- `src/lib/instagram-sync.ts`（新規。`getInstagramSyncToastMessage` — §11.3）
- `src/lib/constants.ts`（**変更**: `INSTAGRAM_COLUMNS` 追加（率の列は `defaultVisible: false`）、`ANALYTICS_STORAGE_KEYS` に `IG_VISIBLE_COLUMNS` 追加 — §11.3）
- `src/lib/instagram-format.ts`（**変更**。率算出の純関数を追加。既存の `formatCount` と同居可 — `tests/unit/lib/instagram-format.test.ts` にミラー。**返り値は百分率の数値または表示用文字列**（例: `12.3` → 表示 `"12.3%"`）。`AnalyticsTable.tsx` の `formatPercent`（比率 0〜1 入力 → 内部で ×100）は**使わない** — 二重換算で表示が破綻するため）
- `src/types/instagram.ts`（**変更**: `InstagramMediaInsights` に `reposts: number | null` と `reelsSkipRate: number | null` を追加 — §2 スコープ / §3.3。Phase 1-A で UI モック用に型を固定した場合でも **Phase 2 の API 取得・DB マッピング前に本型へ揃える**）
- `src/components/FieldConfigurator.tsx`（**変更なし・再利用**。列選択ダイアログは新規実装しない — §11.3）
- ~~`app/api/cron/instagram-sync/route.ts`~~ → **Phase 2 スコープ外**（2026-08-05。cron を落としたため `.github/workflows/hourly-cron.yml` も変更しない — §4 Phase 2 item3）
- `src/server/services/instagramService.ts`（**変更** — §3.3 廃止指標の除去は次の3点をセットで行う）:
  1. **`ACCOUNT_INSIGHT_METRICS`（`:37-38`）から `'profile_views'` / `'website_clicks'` を除去**
  2. **`fetchAccountInsights`（`:396-397` 付近）の return マッピングから `extractLatestInsightMetric(..., 'profile_views')` / `(..., 'website_clicks')` および対応プロパティ代入を除去**
  3. 加えて: `fetchMedia` に cursor 引数、`fetchAccountInsights` の日別取得対応、レート消費ヘッダの読み取り
- `src/types/instagram.ts`（**変更** — §3.3 とセット）: **`InstagramAccountInsights` から `profileViews` / `websiteClicks` フィールド（`:45-46` 付近）を除去**
- 環境変数: `INSTAGRAM_SYNC_ENABLED`（新規。キルスイッチ。`.env.example` 追記）
- **README 更新の予告**: 「🚀主な機能」（Instagram 実績一覧・同期）、「📋環境変数」（`INSTAGRAM_SYNC_ENABLED`）、「📁プロジェクト構成」（新規サービス）が対象になりそう。**最終判断は実装時の `spec-to-pr` の `readme_sync` が差分を見て行う**

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
│ 分析画面の［最新化］で取得できます。         │
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
- 「更新」= `fetchInstagramPreviewData` 再実行（**プレビュー再取得**。同期 cron は Phase 1・Phase 2 とも無い — §4 Phase 2 item3）。実行中は RefreshCw を回転表示。**`last_synced_at` の表示は Phase2 の `/analytics` Instagram タブのみ**（Phase1 セットアップ画面では出さない）。
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

┌─ Card: アカウント指標（サマリー）────────────────┐
│ データ: 最新日 YYYY-MM-DD（DB 直近30日分のうち最新1行）│
│ リーチ（最新日）│ 視聴数（最新日）│ フォロワー数（最新日）│ …│
│       12        │       33        │    対象外          │   ← 例。単回 API 実測と同値になりうる。30日 SUM ではない │
└──────────────────────────────────────────────┘
  ※ **列は §5.4 で「日次行の埋め方」が確定したものだけ**出す。未確定列（`profile_links_taps` 等）は実測決着まで非表示
  ※ **`reach` を日次行 SUM して表示しない**（§5.4 サマリー集約表）
  ※ 同期0件・日次行0件のときは Card ごと非表示（投稿一覧の空状態のみ）

┌─ Card: 投稿一覧 Table ───────────────────────┐
│ サムネ│種別  │キャプション│投稿日│リーチ│視聴│…│
│ ──────┼──────┼────────────┼──────┼──────┼────┼─│
│ [img] │リール│養鶏を始めて…│7/20 │5,200 │12k │…│  ← 行末に [↗] permalink
│ [img] │フィード│卵かけご飯…│7/18 │1,100 │ -  │…│  ← フィードは視聴時間系 "-"
│ …                                            │
│              [← 前へ]  1 / 5  [次へ →]       │  ← ig_page パラメータ + Link
└──────────────────────────────────────────────┘
```

- **アカウント指標 UI（`instagram_account_insights_daily` — §5.4 / §8）**: 投稿一覧 Card の**直上**にサマリー Card を置く（上記ワイヤーフレーム）。**表示する指標名・列数は §5.4 の対応表で「日次行の埋め方」が確定した列に限定**（`profile_links_taps` 等、採否未定の列は出さない）。**データ源は §4 item5 の `getAccountInsightsLatestDay` が返す最新日1行のみ**。ヘッダに **「最新日: {date}」** を出す（「直近30日合計」と誤読させない）。**列ごとの表示規則（§5.4 サマリー集約表）**:
  - **`reach` / `follower_count` / その他採用列**: いずれも**最新日の行のセル値**をそのまま表示。**日次行を Client で SUM しない**（特に `reach` — ユニークリーチの SUM は意味が壊れる）
  - **ラベル**: 各指標名に **「（最新日）」** を付ける（例: リーチ（最新日）、フォロワー数（最新日））。ツールチップで「DB には直近30日分を保持。表示は最新同期日の値です」と補足可
  - 各セルは `formatCount` 相当で数値表示。**`follower_count` が NULL で 100 フォロワー未満と判断できる場合**（§3.3 / §5.4）は `-` ではなく **「対象外」ラベル + ツールチップ**（例:「フォロワー100人未満のアカウントではこの指標は提供されません」）。取得失敗（再試行で回復しうる）と混同しない（§8 `follower_count` 受け入れ条件）。**日次行が1件も無い**（未同期・§5.4 未確定で取込列ゼロ）ときはサマリー Card を出さない

- **URL パラメータ契約**（ブログ既存キー `page` / `start` / `end` / `category` / `uncategorized` / `unread_suggestion` は Instagram タブでも**変更・上書きしない**）:
  - `tab`: `blog` | `instagram`。**未指定時は `blog`**（既存 `/analytics?...` のリグレッション防止）。**未連携ユーザーが `tab=instagram` を指定した場合も `blog` にフォールバック**する（タブ UI 自体が無いため）
  - タブ切替は `router.push` / `Link` で URL 更新必須（`Ga4DashboardClient.tsx:435` の `defaultValue` 非 URL 同期パターンは**踏襲しない**）
  - タブ切替時の頁リセット: **切替先タブの頁パラメータのみ** 1 にリセット（`tab=instagram` へ切替時は `ig_page=1` をセットし `page` は保持、`tab=blog` へ切替時は `page=1` をセットし `ig_*` は保持）
  - `ig_page`: Instagram タブのページ番号（1始まり）。未指定時 1
  - `ig_type`: 種別フィルタ `all` | `reels` | `feed`。未指定時 `all`
  - `ig_start` / `ig_end`: 期間フィルタ（ISO 日付 `YYYY-MM-DD`）。未指定時は直近30日（ブログの `start`/`end` とは**独立**）
  - `ig_sort`: ソートキー `posted_at` | `reach` | `views`。未指定時 `posted_at` desc
- **列構成はユーザーが選ぶ（2026-08-05 Q2 回答）— `FieldConfigurator` を再利用する**
  - **既存コンポーネントをそのまま使う**: `src/components/FieldConfigurator.tsx`。ブログ一覧が `AnalyticsTable.tsx:634-640` で使っている。props は `columns: {id, label, defaultVisible?}[]` / `storageKey` / render prop（`visibleSet`・`orderedIds` を受け取る）。表示チェックボックス・**ドラッグ並び替え**・localStorage 永続化・**新規追加した `defaultVisible` 列の自動表示**（`FieldConfigurator.tsx:94-106`）まで揃っているので、Instagram 用の実装は**列定義の定数を足すだけ**
  - **`storageKey` はブログと別にする**: `src/lib/constants.ts` の `ANALYTICS_STORAGE_KEYS` に `IG_VISIBLE_COLUMNS: 'analytics.instagramVisibleColumns'` を追加する。**`VISIBLE_COLUMNS`（`'analytics.visibleColumns'`）を共用してはいけない** — `FieldConfigurator` は保存値を `columns` に無い id で正規化して落とすため（`FieldConfigurator.tsx:66-68`, `117-118`）、共用するとタブを切り替えるたびに相手側の設定が消える
  - **列定義**: `src/lib/constants.ts` に `INSTAGRAM_COLUMNS` を追加（`ANALYTICS_COLUMNS`（`constants.ts:257-277`）と同型）。候補は 種別 / キャプション冒頭 / 投稿日 / リーチ / 視聴数 / いいね / コメント / 保存 / シェア / **再投稿** / 総インタラクション / 平均視聴時間 / 総再生時間 / **スキップ率（リールのみ）** / **いいね率** / **保存率** / **シェア率** / **コメント率** / **再投稿率**（後者5列はいずれも **`defaultVisible: false`** — §9 Q10）。**既定表示は絞り、残りは `defaultVisible: false`** にして初期表示をシンプルに保つ（クライアント回答の「実装しやすいシンプルな形」に対応）
  - **列選択の対象外（常時表示）**: サムネイルと permalink リンクは行の識別・遷移手段なので `FieldConfigurator` の対象に入れず固定表示にする。隠せると行が識別不能になる
  - **ソートキーとの整合（採用方式）**: `ig_sort` が**非表示にした列を指している**状態があり得る。**列を非表示にした時点で `ig_sort` を `posted_at` desc に戻す**（`FieldConfigurator` の toggle / ダイアログ「閉じる」時に、現在の `ig_sort` が非表示列なら URL を更新）。ソート UI で選べる列は **`INSTAGRAM_COLUMNS` のうち `defaultVisible !== false` 相当の「ソート可能列」**に限定してもよいが、MVP では非表示→ソートリセットのみで足りる
  - 横スクロールは `overflow-x-auto` で許容しつつ、列の意味をヘッダツールチップで補足
- **率の列（2026-08-05 Q10 回答。GrowMate 独自計算）**
  - **対象**: いいね率 / 保存率 / シェア率 / コメント率 / 再投稿率。**既定は非表示**（`defaultVisible: false`）にし、必要な人だけ出す
  - **算出**: `率 = 実数 ÷ reach × 100`、**小数第1位で四捨五入**（アプリの表記に合わせる）。分母は `views` ではなく **`reach`**（§9 Q10 の検算根拠）。**検算に基づく推定であり、Instagram が公開している算出定義はない。UI 上は参考値として表示する**（§3.3「推定・一致保証なし」と同強度）
  - **DB に保存しない。表示時に計算する。** 保存すると、次の同期で `reach` だけが更新されたときに率が古い分母のまま残る。純関数は `src/lib/instagram-format.ts` に切り出し vitest を書く（§8 の「純関数には vitest」に該当）
  - **表示ルール**: 分母 `reach` が `null` / `0`、または分子（各実数）が `null` のときは `-`（ゼロ除算を出さない。未取得を「0%」と表示しない）。**分子が `0` かつ分母 `reach > 0` のときのみ `0.0%`**
  - **恒久的に取得できない投稿**（`insights_unavailable`）では率も出さない。「対象外」表示に従う
  - **`reels_skip_rate` と混ぜない**: スキップ率は**公式が率で返す唯一の指標**で、**分母も違う**（initial views ＝ リールセッション内の初回再生。§3.3 の verbatim 定義）。独自計算の率（分母 = `reach`）と同じ見た目で並べると、片方だけアプリと一致しない理由を説明できなくなる。**ツールチップで出所と分母を書き分ける**:
    - スキップ率 →「Instagram が提供する値（3秒以内にスキップされた再生数 ÷ 初回再生数）。**推定値・開発中の指標**のため変動することがあります」
    - その他の率 →「**Instagram 非公式の GrowMate 独自計算**（例: いいね数 ÷ リーチ数）。Instagram アプリの表示と一致しない場合があります」
    - **「独自計算です」だけで済ませない。式そのものを出す** — 何と比較すべきかが分からないと、ズレたときに判断できない
  - **ソート対象にしない**（`ig_sort` は `posted_at` / `reach` / `views` のまま）。DB に持たない以上、ページング前の全体ソートができないため。**ページ内だけ並び替わる中途半端な挙動を作らない**
- **未連携ユーザー向けの Instagram タブ空状態は定義しない（到達不能）**: §4 Phase 2 item4 / §8 により、未連携ユーザーは Instagram タブ UI 自体が出ず `?tab=instagram` も `blog` にフォールバックする。**連携導線は §11.1 の `/setup` カードのみ**
- **連携済みだが同期0件**: 「まだデータがありません。［最新化］を押すと取得します」。Phase 1 から連携済みのユーザーは初回同期が走っていないため**必ずこの状態から始まる**（§4 Phase 2 item3「初回同期の起動導線」）
- **指標セルの3状態を見分けられるようにする**（2026-08-04 追記）: ①実データの `0`（保存・シェアが実際に0件。§3.3）②取得失敗（再試行で回復しうる。`-` + 再取得導線）③**対象外**（`insights_unavailable` + `insights_unavailable_reason`、**アカウントサマリーの `follower_count` 100未満** — 上記「アカウント指標 UI」）。③は再試行しても直らないので、`-` と同じ見た目にせず **`reason` に応じたツールチップ**（§5.2 / §3.3）を出す
- **同期停止中**（`INSTAGRAM_SYNC_ENABLED=false`）: 「最新化」ボタンを disabled にし、ツールバー直下に情報色 Alert「Instagramの同期を一時停止しています」。テーブルは既存データをそのまま表示する（§4 Phase 2 item3）
- **同期結果 UI**（`getInstagramSyncToastMessage(result)` に集約。`OverviewTab.tsx` の `getQueryImportToastMessage` と同型。§6 エラーパス準拠。**単一の toast を `id` で更新し続ける**方式で、成功時も失敗時も新規 toast を積み増さない）:
  - 成功（`failed=0`）: `toast.success('N件を更新しました', { id: toastId })`。`last_synced_at` をツールバー右に反映
  - 部分失敗（`failed>0`）: `toast.warning('N件中M件の更新に失敗しました', { id: toastId })` + ツールバー直下 Alert（`ERROR_MESSAGES.INSTAGRAM.API_ERROR` または「一部の投稿データを取得できませんでした（M件）」）。取得できた行はテーブルに残す
  - `needsReauth`: `toast.error(..., { id: toastId })` + Alert「Instagramの再認証が必要です」+ [連携設定へ] Button（→ `/setup/instagram`）。サイレントに未連携へフォールバックしない
  - `truncated`: `toast.info('直近50件まで取得しました', { id: toastId })`（エラー扱いにしない）
  - **文言の置き場所**: トースト文言は `getInstagramSyncToastMessage` を置く `src/lib/instagram-sync.ts` に直書きする（`getQueryImportToastMessage` が `src/lib/gsc-import.ts` に直書きしている先例に倣う）。**`ERROR_MESSAGES` へは入れない** — 役割分担は「`ERROR_MESSAGES` = エラー種別の正本（種別ごとに1文言、エラーパスから参照される）」「トースト = 実行結果サマリの整形（件数を埋め込む可変文、結果オブジェクトからしか作れない）」。`needsReauth` / 部分失敗の **Alert 側は `ERROR_MESSAGES.INSTAGRAM.*` を参照する**ので、同じ画面で両方が併存する。日本語文言直書き禁止規約の対象は前者であり、後者は対象外
- ブログタブ側のフィルタ・ページネーション UI は一切変更しない（受け入れ条件: リグレッションなし）

### 11.4 Phase 3 導線（**保留。実装しない** — 2026-08-05）

Phase 3 が保留になったため、**Phase 2 の一覧に「台本作成」ボタンを置かない**。押しても何も起きない導線を先に作らないこと。以下は再開時の参考として残す。

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
