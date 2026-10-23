# WordPress 自動投稿（完成した記事を WordPress へ送る）仕様書

## メタデータ

- 文書名: WordPress 自動投稿（完成した記事を WordPress へ送る）
- ステータス: `approved`
- 作成日: 2026-10-21
- 最終更新日: 2026-10-23
- 作成者: 開発（Cursor Cloud Agent 起票）
- 承認者: 未定
- 対象リリース: 未定（「今後開発予定」として先に仕様化）
- 関連する依頼・Issue・PR: 2026-10-21 開発依頼「ワードプレス自動投稿機能を今後開発予定の為に先に仕様書を作りましょうか。コンテンツ一覧画面とチャット画面で自動投稿できるのが良さそう。UI/UX はマーケター思考も入れてね」（会話）。参考資料として依頼者から WordPress REST API への `POST /wp-json/wp/v2/posts` と Application Passwords の概説が共有された

## 現在地と次の一手

- 現在の工程: spec-review 通過。見た目は既存フォームの写しで確定。送信 UI の4点（公開済みは info、再送の初期値、未連携・完成形なしはフォーム上の Alert、完了トーストはリンクなし）も回答済み。OPEN-001 は決着
- 止まっている理由・待っている人: なし
- 次の一手: `.takt/workflows/spec-to-pr.yaml` で実装（`takt -w spec-to-pr -t "docs/plans/wordpress-auto-publish-spec.md 仕様書に沿って実装してください"`）
- 未確認事項: なし
- 関連ブランチ・PR: `cursor/wordpress-auto-publish-spec-f040`（仕様書のみ）、PR #691
- 更新日・更新した工程: 2026-10-23 送信 UI の決定4点を書き戻し（実装前）

## 0. 依頼時の参考資料との差分（先に読む）

依頼時に共有された参考資料は「Node.js プロジェクトをゼロから作り、Application Password を発行し、`axios` で `POST /wp-json/wp/v2/posts` を叩く」構成だった。GrowMate には同等の土台がすでにあるため、本書は**土台を作らず、投稿メソッドと UI を足す**設計にする。

| 参考資料の項目 | GrowMate の現状 | 本書の扱い |
| --- | --- | --- |
| Application Password の発行・保存 | `wordpress_settings.wp_username` / `wp_application_password`（セルフホスト）と WordPress.com OAuth トークン（`wp_access_token`）を `/setup/wordpress` で保存済み。`WordPressService.getAuthHeaders()` が Basic / Bearer を出し分ける（`src/server/services/wordpressService.ts`） | 再利用。新しい認証画面・保存先は作らない |
| HTTP クライアント（`axios`） | `fetch` と `rest_route` フォールバック（`WordPressService.fetchRestResource`）、`REST_FETCH_TIMEOUT_MS = 60_000` | 再利用。`axios` は入れない（最小実装ラダー 5） |
| `POST /wp/v2/posts` | 取得系は `posts` と `pages` の両方をすでに扱う（`normalizeContentType`、`buildRestFetchCandidates`）。作成・更新は無い | **新規**: 同じ `baseUrl` に `posts` または `pages` を付けて `createPost` / `updatePost` / `fetchPost`。カテゴリ取得は `posts` のときだけ |
| 記事データ元（AI 生成・CSV・RSS） | ブログ作成フロー step1〜7 の完成形が `session_combined_contents`（Markdown）に保存される（`headingFlowService.getLatestCombinedContent`） | データ元は **Canvas の完成形だけ**。CSV / RSS / 外部 AI は Non-goal |
| 実行タイミング（cron / 手動） | 日次の WordPress 取込 cron はあるが、投稿 cron は無い | **手動トリガーだけ**（記事ごとにユーザーが押す）。予約投稿は WordPress 側の `future` に任せる。GrowMate 側の cron は作らない |

## 1. 背景・目的・成功指標

### 背景・解決したい課題

- 現在、誰が、どの業務で困っているか:
  - ブログ作成フロー（チャット step1〜7）で記事を完成させても、WordPress へ載せる工程は手作業になっている。Canvas の本文をコピーし、WordPress 管理画面で新規投稿を作り、貼り付け、カテゴリを選び、公開または予約し、最後に GrowMate のコンテンツ一覧の「編集」で WordPress 投稿 URL を手入力して紐づける（`src/components/AnnotationFormFields.tsx` の「WordPress投稿URL（任意）」）。
  - Instagram 投稿のブログ化（`docs/specs/instagram-high-engagement-blog-draft-spec.md`）は記事を自動で作るところまで到達したが、同仕様 §3 To-Be の最終行は「記事を WordPress に公開し、コンテンツ一覧で URL を登録する（既存の操作）」のまま手作業で止まる。複数記事を一度に作れるようになった分、手作業の回数が増える。
  - URL の手入力を忘れた記事は `wp_post_id` / `canonical_url` が空のままになり、GSC・GA4 の評価サイクル（`docs/plans/content-pdca-semi-auto-execution-spec.md` BR-01「記事に `wp_post_id` がある」）に入らない。作った記事が PDCA から漏れる。
- 放置した場合の影響: 「作る」は自動化できたのに「公開する」で人手に戻り、クライアントの開発方針「ユーザーに操作させない半自動化〜完全自動化」（`docs/context/client-vision-from-lark.md` §1.12.6）に反する。公開後の PDCA が重点（同 §1.12）なのに、公開と紐づけが抜けると PDCA の入口が閉じる。

### 目的

- この開発で実現する状態: 完成した記事を、チャット画面とコンテンツ一覧のどちらからでも「WordPress に投稿」1回で WordPress へ送れる。送るときに公開状態（下書き・公開・予約）、タイトル、カテゴリを選べる。送った記事はコンテンツ一覧に WordPress 投稿として自動で紐づき、URL の手入力が要らなくなる。
- 利用者・事業にとっての価値: 記事1本あたりの公開作業がコピー＆ペーストと URL 手入力から、ダイアログ1回に減る。公開した記事が漏れなく GSC・GA4 の評価対象に入る。

### 成功指標

| 指標 | 現状 | 目標 | 測定方法 | 測定時期 |
| --- | --- | --- | --- | --- |
| 完成した記事を WordPress に載せて GrowMate に紐づけるまでのユーザー操作 | Canvas コピー → WordPress で新規投稿・貼付・設定・公開 → GrowMate で URL 入力（画面またぎ3回以上） | ダイアログ1回（画面またぎ0回） | 操作手順を数える | リリース時 |
| チャット由来の記事（`session_id` あり）のうち `wp_post_id` が空の行の割合 | 未計測 | 現状比で減少 | `content_annotations` を集計 | リリース1か月後 |

## 2. 利用者・関係者・利用シナリオ

| 区分 | 対象 | 期待すること・責任 |
| --- | --- | --- |
| 利用者 | `admin` / `paid` ロールで、WordPress 連携済み（`wordpress_settings` 行あり）のユーザー | 完成した記事を WordPress へ送る。公開状態・タイトル・カテゴリを選ぶ。公開前の最終確認は WordPress 側か Canvas で行う |
| 運用担当 | GrowMate 開発・運用 | 失敗時のエラーメッセージから原因（連携切れ・権限不足・サイト側障害）を切り分けられる |
| 管理者・承認者 | クライアント（カオルさん） | Q-001 は 2026-10-23 に、押したときだけ、と決まった |
| 外部サービス・連携先 | WordPress（セルフホスト REST API / WordPress.com REST API） | 投稿の作成・更新、カテゴリ一覧の提供 |

### 主な利用シナリオ

1. **マーケターが**、**チャットで step7 まで進めて記事を完成させた直後に**、**その場で「WordPress に投稿」を押し、下書きとして WordPress へ送って、WordPress 側でアイキャッチを付けてから公開したい**。
2. **マーケターが**、**Instagram 投稿のブログ化でまとめて作った記事をコンテンツ一覧で順に確認し**、**確認が済んだ記事から「WordPress に投稿」で予約投稿（毎週火曜 10:00 など）に積みたい**。
3. **マーケターが**、**コンテンツ一覧で**、**どの記事が WordPress に未送信・下書き止まり・予約済み・公開済みかを見分け、放置している下書きに気づきたい**。
4. **マーケターが**、**WordPress 側で下書きを公開したあと**、**GrowMate のコンテンツ一覧で公開 URL が自動で埋まり、GSC・GA4 の評価対象に入ったことを確認したい**。

## 3. 業務要件と業務フロー

### 現状（As-Is）

```text
チャット step7 で記事が完成（Canvas に完成形）
  → Canvas の本文をコピー
  → WordPress 管理画面を開き「新規投稿」→ タイトル入力 → 本文貼付 → カテゴリ選択 → 下書き保存 / 公開 / 予約
  → 公開 URL をコピー
  → GrowMate コンテンツ一覧の「編集」→「WordPress投稿URL」に貼付 → 保存（忘れると PDCA から漏れる）
```

### 導入後（To-Be）

```text
チャット step7 で記事が完成（Canvas に完成形）
  → チャットの「その他の操作」またはコンテンツ一覧の行で［WordPress に投稿］
  → ダイアログ: 送信先（投稿 / 固定ページ。既定は投稿）/ タイトル（自動入力・編集可）/ 公開状態（下書き・公開・予約）/ 公開日時 / カテゴリ（投稿のときだけ）/ スラッグ
  → ［下書きとして送信］［公開する］［予約する］のいずれか1回
  → （自動）Canvas の完成形（Markdown）を HTML に変換し、WordPress へ POST
  → （自動）コンテンツ一覧の行に wp_post_id / タイトル / 公開状態を保存。公開なら URL も保存
  → コンテンツ一覧のタイトル列に「下書き」「予約」のバッジ。公開 URL は従来どおり URL 列のリンク
  → WordPress 側で下書きを公開した場合は、日次の WordPress 取込（既存）が URL を埋める
```

### 業務ルール

- ルール ID: BR-001（送信はユーザーが押したときだけ）
  - ルール: WordPress への送信は、ユーザーが押したときだけ行う。入口はチャット（`/chat`）step7 の「その他の操作」と、コンテンツ一覧（`/analytics` ブログタブ）の行の操作列。どちらも投稿ダイアログを開き、ダイアログの送信ボタンで送る（Q-001、2026-10-23）。記事の完成・Instagram ブログ化の完了・日次 cron をきっかけに自動で送らない。
  - 例外: なし。一括もユーザーが押したときだけ（BR-008）。押していない送信はしない。
- ルール ID: BR-002（未送信の既定は下書き、再送は現在の状態）
  - ルール: 未送信の公開状態の既定値は「下書き」。「公開」「予約」はユーザーが選んだときだけ送る。再送時は現在の状態（下書き / 予約）と予約済み日時をダイアログの初期値に入れる。送信ボタンの文言は選んだ公開状態に合わせて変える（§6 画面設計）。LLM が書いた本文を確認なしで公開する事故を、既定値で防ぐ。
  - 例外: なし。
- ルール ID: BR-003（送る本文は Canvas の最新の完成形）
  - ルール: 送る本文は `session_combined_contents` の `is_latest = true` の行（Canvas の step7 完成形）。チャットのメッセージ本文や見出し単体（`session_heading_sections`）からは組み立てない。完成形が無いセッションは送れない（「完成した記事がありません」）。
  - 例外: なし。Canvas で編集中の未保存内容は含めない（Canvas の保存で完成形が更新されてから送る）。
- ルール ID: BR-004（1記事1投稿。2回目以降は更新）
  - ルール: 1つのコンテンツ行（`content_annotations`）に対する WordPress 側の1件は、投稿か固定ページのどちらか（BR-007）。行に `wp_post_id` が無ければ作成（`POST /wp/v2/{type}`）、あれば更新（`POST /wp/v2/{type}/{id}`）にする。`{type}` は `posts` または `pages`。同じ記事を2回送っても WordPress に重複を作らない。
  - ルール（更新前の実態確認）: 更新のときは送信前に `GET /wp/v2/{type}/{id}?context=edit` で WordPress 側の現在の `status` を見る。`{type}` は保存済みの `wp_post_type`（BR-007）。GrowMate の `wp_post_status` は送信時点の値で、WordPress 側で公開・削除されても日次取込までは古いままになるため、行の値だけを信じない。WordPress 側が `publish` なら更新せず、行を `publish` と `link` に同期して「すでに WordPress で公開されています」と返す。表示はお知らせ（info）とし、赤いエラーにしない。応答 JSON の `code` が `rest_post_invalid_id` のときだけ、行の `wp_post_id` / `wp_post_title` / `wp_post_status` を NULL に戻し、「WordPress 側で投稿が削除されていました。もう一度送信すると新しい投稿を作ります」と返す（S-14。`WP_REST_Posts_Controller`。https://developer.wordpress.org/reference/classes/wp_rest_posts_controller/ ）。それ以外の 404（HTML、別の `code`、サイト削除、REST の不在、接続先の違い）は紐づけを残し、接続の失敗として返す。文言の「投稿」は保存済み `wp_post_type` が `posts` のときで、`pages` のときは「固定ページ」に置き換える。`wp_post_type` は NULL にしない（既存列が NOT NULL。解除後の送信先の初期値に残す）。
  - ルール（他の保存経路との整合）: 下書き・予約として送信済みの行（`wp_post_status` が `draft` / `future`）は `canonical_url` が空のまま `wp_post_id` を持つ。チャットの登録情報パネル（`upsertContentAnnotationBySession`、`src/server/actions/wordpress.actions.ts`）は現状、WordPress 投稿 URL が空で保存されると `wp_post_id` を NULL に上書きする（L194〜L197 で空 URL を `wpPostId: null` に解決し、L686〜L698 で書く）。このままだと送信済みの下書きの紐づけがパネルの保存で消え、次の送信が新規作成になって重複投稿ができる。本機能の実装時に、URL が空のまま変わらず `wp_post_status` が `draft` / `future` の行では `wp_post_id` / `wp_post_title` / `wp_post_status` を保持するよう同関数を直す（S-12）。コンテンツ一覧の「編集」（`updateContentAnnotationFields`）は URL が変わらなければ ID を保持する（L1006〜L1016）ためサーバー側の変更は不要。画面の補足「空欄の場合は連携を解除します。」（`src/components/AnnotationFormFields.tsx` L128）はこの保持と逆に読めるため、2文に更新する（§4）。下書き・予約で URL が空のときは紐づけを残す。公開 URL が入っている行を空にして保存したときは従来どおり解除する。サーバー側の保持条件は変えない。
  - 例外: 行の `wp_post_status` が `publish`（公開済み）の場合、本機能からは更新しない（公開後の本文書き換えは `content-pdca-semi-auto-execution-spec.md` の範囲。公開済みの記事を Canvas の内容で上書きすると WordPress 側の手直しが消える）。WordPress 取込で入った行（`wp_post_status` が NULL で `wp_post_id` あり。本機能のリリース後に取込が触った行は `publish`）も同じく対象外。
- ルール ID: BR-007（送信先は投稿か固定ページ。作成後は変えない）
  - ルール: 未送信の行では、ダイアログの送信先を `posts`（投稿）か `pages`（固定ページ）から選ぶ。既定は `posts`。REST のパスは既存の `WordPressService.baseUrl` にそのタイプを足す（`/posts` または `/pages`）。`normalizeContentType`（`src/server/services/wordpressContentTypes.ts`）の `post` → `posts`、`page` → `pages` に合わせる。成功時に既存列 `content_annotations.wp_post_type`（`text not null default 'posts'`。`supabase/migrations/20251103090000_extend_wordpress_content_types.sql`）へ `posts` または `pages` を書く。新しい列は作らない。
  - ルール: `wp_post_id` がある行の再送信は、保存済みの `wp_post_type` へ更新する。送信先の選択は出さない。WordPress は投稿と固定ページを同じ ID の付け替えでは移せない。移すには削除して作り直すことになり、削除は Non-goal のため、本書ではタイプを変えない。
  - ルール: カテゴリは `posts` のときだけ送る。`pages` の公式スキーマに `categories` は無い。固定ページを選んだときはカテゴリ欄を出さず、カテゴリ取得もしない。親ページ（`parent`）は送らない。固定ページは最上位として作る。
  - 例外: なし。カスタム投稿タイプ（製品、施工実績など）と、添付ファイル・リビジョン・ナビゲーションメニュー・カスタム CSS・チェンジセットは選べない（Non-goals）。
- ルール ID: BR-005（公開 URL は公開されてから保存する）
  - ルール: `canonical_url` は WordPress が返した `status` が `publish` のときだけ、レスポンスの `link` で保存する。`draft` / `future` のときは `canonical_url` を空のままにする（下書きの `link` は `?p=123` 形式の仮 URL で、公開時のパーマリンクと一致しない。GSC・GA4 の URL 突合を汚さない）。
  - 例外: なし。WordPress 側で公開されたあとの URL は、既存の日次 WordPress 取込（`src/server/services/wordpressImportService.ts` の `importWordPressContent`。`existingByPostId` で `wp_post_id` 一致の行を更新）が埋めることを期待する。ただし取込は `wordpress_settings.wp_content_types`（既定は `posts` と `pages`。`20251103090000_extend_wordpress_content_types.sql`）のタイプについて、`status=publish` の差分を `modified_after` と `after`（基準日時 `wp_import_baseline_at` 以降）で取り、`isChangedSinceBaseline`（`src/server/lib/wordpress-diff-import.ts`）で `modified_gmt` か `date_gmt` が基準日時より後の投稿だけを更新する。下書きを WordPress 管理画面で公開した場合は `modified_gmt` が進むので拾える。予約投稿が WordPress の自動公開で `publish` になった場合は `modified_gmt` が進まないことがあり、`date_gmt`（予約日時）が基準日時より後であることに依存する。予約日時を過ぎても WordPress 側の cron が動かず遅れて公開された（missed schedule）場合は両方とも基準日時より前になり、差分から漏れうる（R-007。実機確認）。漏れた行は手動の「WordPress 記事を一括インポート」でも差分条件が同じなら埋まらない。R-007 の結果次第で、取込側で「`wp_post_status` が `future` の行の `wp_post_id` を、保存済みの `wp_post_type` で個別に `GET /wp/v2/{type}/{id}` する」補完を足す。
- ルール ID: BR-006（セルフホストと WordPress.com の両方に同じ操作）
  - ルール: `wordpress_settings.wp_type` が `self_hosted` でも `wordpress_com` でも同じダイアログ・同じ結果にする。差は `WordPressService` の `baseUrl` と認証ヘッダーだけに閉じる（既存の取込と同じ）。WordPress.com の送信は既存クライアントの public-api（`src/server/services/wordpressService.ts` L116 と L130。`https://public-api.wordpress.com/wp/v2/sites/${siteId}`。保存済み site id）に載せる。サイト種別ごとのベース URL は新設しない（既存取込と同じ経路。MVP）。public-api の POST が失敗したときは §6 の 401 / 403 / 5xx に乗せ、301 を POST の再送条件にしない（R-006 と同じ。作成の重複を避ける。根拠は §9、確認日 2026-10-22）。WordPress.com のアクセストークンは期限切れでも `resolveWpComAccessToken`（`src/server/services/wordpressContentSync.ts`。日次取込が L413 付近で使っている）で更新してから送る。`buildWordPressServiceFromSettings`（`src/server/services/wordpressContext.ts`）は保存済みトークンをそのまま使うだけで更新しないため、送信の Server Action では取込と同じ順で先に更新を通す。組み立てるときの cookie getter は `wpcom_oauth_token` を返さない（日次取込の `buildWordPressServiceFromSettings(settings, () => undefined)`。`wordpressImportService.ts` L424）。`buildWordPressServiceFromSettings` は cookie を保存済みトークンより先に使う（`wordpressContext.ts` L38）。リクエストの cookie を渡すと、更新した DB のトークンが使われず 401 になる。送信では `resolveWordPressContext` にリクエスト cookie を渡して組み立てない。
  - 例外: なし。なお WordPress.com 連携の保存は既存仕様で `admin` に限られている（`app/api/wordpress/settings/route.ts` L52〜L57「WordPress.com 連携は管理者のみ利用できます」）ため、`paid` ユーザーの送信先は実質セルフホストだけになる。本書はこの制限を変えない。
- ルール ID: BR-008（一括は下書きだけ。初回の画面には出さない）
  - ルール: コンテンツ一覧の複数行を、下書き送信の直列で送れる。`status` は `draft` 固定。送信先は `posts`。タイトルは1件と同じ既定（最初の `# ` 見出し → `wp_post_title`。どちらも空の行は送らない。`main_kw` はタイトルに使わない。Q-004）。カテゴリとスラッグは送らない。一括の対象は、`session_id` があり、未送信、または `wp_post_status` が `draft` の行だけである。`future`・`publish`・取込由来・固定ページは送らずスキップする。予約を下書きに戻すのは、1件ダイアログで公開状態を「下書き」にしたときだけである（Q-003 の3択は1件のダイアログだけ）。タイトルが空の行も送らずスキップする。戻りは成功、スキップ（タイトル空 / 予約 / 対象外）、時間切れで止めた残り、に分ける。
  - ルール: ツールバーのボタンは、既存の選択時ツールバー（`app/analytics/AnalyticsClient.tsx` L539〜L567。`selectedCount >= 1` のとき「評価サイクルを開始」と「AIで要約」）と同じ場所に実装する。初回リリースではマウントしない。定数1つで止め、その定数は `false` のまま出荷する。feature flag、設定テーブル、環境変数は作らない（Q-002「MVP に入れるが公開しない。あとですぐ使える状態」）。定数を `true` にしたとき、ボタン文言は「下書きとして一括送信」。押すと対象行を直列に送る。`/analytics` の既存 `maxDuration = 800` を超える前に止め、残りは送らず、上の3区分で返す。ジョブテーブルは作らない。
  - 例外: なし。ボタンのマークアップは shadcn の `Button` を使う。同ファイルの生の色クラスは写さない（`eslint-suppressions.json` を増やさない）。

## 4. 対象範囲と Non-goals

> **判断軸: GrowMate は MVP 開発を最優先とする**（`AGENTS.md` Core Rules）。要件に無い機能は入れない。作らないと決めたものは下の Non-goals に理由付きで書く。

### 対象範囲

- 画面・操作:
  - チャット画面（`/chat`）: step7 の「その他の操作」メニュー（`app/chat/components/StepActionBar.tsx`）に「WordPress に投稿」を追加し、投稿ダイアログを開く
  - コンテンツ一覧（`/analytics` ブログタブ）: 行の操作列（`src/components/AnalyticsTable.tsx` の `AnalyticsOpsCell`）に「WordPress に投稿」を追加し、同じ投稿ダイアログを開く。タイトル列に「下書き」「予約」のバッジを出す
  - 投稿ダイアログ（新規共通コンポーネント `src/components/WordPressPublishDialog.tsx`）: 送信先（投稿 / 固定ページ）・タイトル・公開状態（下書き・公開・予約。未送信の既定は下書き。再送は現在の下書き / 予約と予約済み日時を初期値にする。Q-003）・公開日時・カテゴリ（投稿のときだけ）・スラッグ
  - 一括下書き（BR-008）: 対象は未送信と `draft` だけ。`future`・`publish`・取込由来・固定ページは送らない。Server Action とツールバーボタンを実装し、初回はボタンをマウントしない
- API・外部連携:
  - `WordPressService` に `createPost` / `updatePost` / `fetchPost` / `fetchCategories` を追加。パスは `baseUrl` に `posts` または `pages` を付ける（`POST /wp/v2/posts` と `POST /wp/v2/pages`、更新と `GET ?context=edit` も同じ）。`fetchCategories` は送信先が `posts` のときだけ
  - Server Action `src/server/actions/wordpressPublish.actions.ts`: 投稿の既定値取得、カテゴリ取得、送信
  - Markdown → HTML 変換の純関数 `src/lib/markdown-to-wordpress-html.ts`（既存依存 `marked` を使う）
- データ・DB:
  - `content_annotations.wp_post_status text null`（CHECK: `draft` / `future` / `publish`）と、`wp_publish_claimed_at timestamptz null` を追加
  - 既存の日次 WordPress 取込が挿入・更新する行に `wp_post_status = 'publish'` を書く（取込は `status=publish` の投稿だけを取る。`data` は挿入と更新の両方に使われる）
  - チャットの登録情報パネル（`upsertContentAnnotationBySession`）が、送信済みの下書き・予約の `wp_post_id` を空 URL の保存で消さないようにする（BR-004）
  - 登録情報パネルと一覧の「編集」が使う `src/components/AnnotationFormFields.tsx` の補足文（L128「空欄の場合は連携を解除します。」）を更新する。下書き・予約で URL が空のときは紐づけを残す。公開 URL が入っている行を空にして保存したときは従来どおり解除する。サーバー側の保持条件（BR-004 / S-12）は変えない
- 権限・ロール: `admin` / `paid`。UI と Server Action の両方で判定（§6 権限）
- 影響を受ける既存機能（仕様上は変更しないが挙動が変わるもの）:
  - コンテンツの AI 要約（`src/server/services/contentAnnotationSummaryService.ts` L143〜L146 のローカル `isWordPressLinked`）と一覧の「未要約」絞り込み RPC（`supabase/migrations/20261013233000_narrow_get_filtered_content_annotations_working_set.sql` L123〜L124 の `or`）は、`wp_post_id` が正、または公開 URL（`canonical_url`）がある、で「WordPress 連携済み」を判定する。下書き・予約として送信した行は ID があり URL が空なので、公開前から連携済みとして数えられ、要約の対象・未要約の件数に入る。URL だけの行は本書の送信では作らない。本書では直さず OPEN-004 とする
- 運用・監視: 送信結果は Sonner トーストで返す。失敗は Server Action のエラーメッセージで原因と次の操作を返す。新しい監視・ログテーブルは作らない
- README: `🚀主な機能` の WordPress 連携の記述に「投稿」が増える可能性がある（最終判断は `spec-to-pr` の `readme_sync`）
- UI 用語: 実装時に `.agents/skills/growmate-ui-ux/ui-text.md` へ追記する（本書の revise では `ui-text.md` 自体は編集しない）。対象は「WordPress に投稿」「送信先」「投稿」「固定ページ」「下書き」「予約投稿」「公開」と、登録情報の補足2文「下書き・予約で URL が空のときは、空のまま保存しても紐づけを残します。」「公開 URL が入っている行を空にして保存したときは、従来どおり連携を解除します。」（§6 UI 用語）

### Non-goals（今回の対象外）

| 対象外にするもの | 対象外にする理由 | 将来検討する条件・時期 |
| --- | --- | --- |
| 記事完成時・Instagram ブログ化完了時の**自動送信**（ユーザーが押さない） | Q-001（2026-10-23）で、押したときだけ送ると決定した。押していない下書きが WordPress に溜まる | 完成時の下書き自動送信を別段で採るとき。自動公開はしない |
| GrowMate 側の cron・node-cron・GitHub Actions による定期投稿 | 予約投稿は WordPress の `status: future` + `date_gmt` で WordPress 自身が公開する。GrowMate が投稿を保持して時刻に送る仕組みは二重管理になる | WordPress 以外の配信先ができたとき |
| CSV・スプレッドシート・RSS・外部 AI（OpenAI 等）からの記事取り込み | GrowMate の記事データ元はブログ作成フローの Canvas 完成形。外部データ元は要件に無い | 要件が出たとき |
| 一括送信の初回画面表示 | Q-002（2026-10-23）は、一括を MVP の実装に含め、画面には出さない。定数を `false` のままにする（BR-008）。feature flag は作らない | 依頼者が定数を `true` にして出してよい、と言ったとき |
| 公開・予約・固定ページの一括送信 | 一括で送れるのは下書きの投稿だけ（BR-008）。公開と予約は1件のダイアログ（Q-003）。固定ページは1件の送信先選択 | 一括で公開・予約・固定ページが必要だと分かったとき |
| アイキャッチ画像・本文中の画像のアップロード（`POST /wp/v2/media`） | Canvas の完成形はテキストと見出しで、画像を含まない。アップロードは multipart と失敗時の後始末が増える。アイキャッチは WordPress 側で付ける運用で成立する（利用シナリオ1） | 記事生成が画像を出すようになったとき |
| タグ（`tags`）の指定 | 要件に無い。カテゴリは既存の取込が `wp_categories` を持ち一覧の絞り込みにも使うが、タグは GrowMate 側に対応物が無い | 利用者の要望が出たとき |
| SEO プラグイン（Yoast 等）のメタディスクリプション・タイトルタグ | WordPress コアの REST に無く、プラグインごとに API が違う（`content-pdca-semi-auto-execution-spec.md` Non-goals と同じ判断） | プラグインを1つに決められたとき |
| 抜粋（`excerpt`）の入力欄 | Q-007（2026-10-23）で入れないと決定した。抜粋は SEO の説明文にならず、欄があると誤解される。WordPress 側で付けられる | マーケターが WordPress 標準の抜粋を GrowMate から入れる、と要件が変わったとき |
| ダイアログ内の連携先（サイト URL）の表示 | 連携先はユーザーにつき1つ（`wordpress_settings` は 1 ユーザー 1 行）で、取り違えが起きない。送り先の確認は `/setup/wordpress` で足りる | 複数サイト連携ができたとき |
| Gutenberg ブロック形式（`<!-- wp:paragraph -->`）への変換 | 素の HTML でも WordPress は「クラシック」ブロックとして表示・編集できる。ブロック変換は見出し・表・リストごとの対応が要り、崩れたときの被害が本文全体に及ぶ | 利用者から「ブロックで編集したい」が出たとき |
| 公開済み記事の本文更新・元に戻す | `content-pdca-semi-auto-execution-spec.md`（修正ログ・差分確認付き）の範囲。本書は未公開（下書き・予約）の更新までにする（BR-004） | 同仕様の実装時に統合を検討 |
| カスタム投稿タイプ（製品、施工実績、お客様の声など）と、添付ファイル・リビジョン・ナビゲーションメニュー・カスタム CSS・チェンジセットへの送信 | 依頼者が 2026-10-23 に「投稿と固定ページだけにする」と明示した。カスタム投稿はサイトごとに REST のベースとタクソノミーが違う。内部タイプは WordPress のシステムデータで、既存の `BLOCKED_WORDPRESS_CONTENT_TYPES`（`wordpressContentTypes.ts`）も取込から外している | 特定のカスタム投稿タイプを1つに決めて送る要件が出たとき |
| 固定ページの親（`parent`）の選択 | 固定ページは親なしの最上位として作れば REST として成立する。親の候補は `GET /wp/v2/pages` の追加になり、階層の選び方は今回の依頼に無い | 固定ページを既存ページの下に置きたい、と分かったとき |
| 投稿と固定ページのあいだの移し替え | 作成後にタイプを変えるには WordPress 側で削除して作り直す。削除は本書の対象外（BR-007） | なし |
| 投稿ダイアログ内の本文プレビュー | 本文の確認は Canvas で済ませる前提（BR-003）。同じ本文を2か所で見せると「どちらが送られるか」で迷う（`growmate-ui-ux` 足さない・迷わせない） | なし |
| WordPress 認証情報の暗号化 | 既存の別計画 `docs/plans/oauth-credential-encryption-design.md` の範囲 | 同計画の実施時 |
| WordPress 側からの投稿削除・取り下げ | 要件に無い。削除は WordPress 管理画面で行う | なし |
| 送信履歴テーブル・監視ダッシュボード | MVP 方針。結果はトーストと `wp_post_status` で足りる。更新は再送できる。作成の成否が不明なときはユーザーが WordPress の投稿一覧を確認する | 送信失敗の問い合わせが続いたとき |

## 5. 開発工数（概算）

### 前提

- 換算: 8時間 = 1人日
- 見積の状態: `仮置き`（2026-10-23。Q-001〜Q-007 は回答済み。Q-004 / Q-006 / Q-007 は工数を変えない）。人の作業の合計は 47 時間のまま。実施の枠は依頼者が 2026-10-23 に 5 人日（40 時間）とした
- 含めるもの: §4 対象範囲の実装、`WordPressService` の単体テスト、Markdown → HTML 変換の単体テスト、migration、UI 手動確認
- 含めないもの: 仕様レビュー往復、クライアント確認待ち、本番リリース作業、`spec-review` の図解 HTML

### 工数サマリー

| フェーズまたは区分 | 目的・主な成果物 | 工数（時間） | 人日 |
| --- | --- | ---: | ---: |
| DB・型 | `wp_post_status` の migration、`database.types.ts` / pending types、取込側の `publish` 書き込み | 3 | 0.4 |
| WordPress 呼び出し | `createPost` / `updatePost` / `fetchPost` は `posts` と `pages` のパスを引数で切り替える。`fetchCategories` は `posts` のときだけ。エラー分類、WordPress.com トークン更新、POST 用 `rest_route`、単体テスト | 10 | 1.25 |
| 本文変換 | `markdownToWordPressHtml`（見出し・段落・リスト・表・リンク・強調。生 HTML のエスケープとリンク先の制限）、単体テスト | 5 | 0.6 |
| Server Action | 既定値取得、カテゴリ取得、送信（ロール・所有者検証、更新前の実態確認、`content_annotations` 更新）、`upsertContentAnnotationBySession` の保持修正 | 7 | 0.9 |
| UI | 投稿ダイアログ（送信先の2択を含む）、チャットのメニュー項目、一覧の操作ボタンとバッジ、`ui-text.md` 追記 | 11 | 1.4 |
| 一括下書き（非表示） | 1件送信の直列。`draft` と `posts` 固定。ツールバーボタンは実装しマウントしない。単体テスト（BR-008） | 6 | 0.8 |
| 検証 | `npm run verify`、セルフホストと WordPress.com の実サイトで下書き・公開・予約の手動確認 | 5 | 0.6 |
| **合計** |  | **47** | **5.9** |

幅: 47〜52 時間。幅の理由: R-003（予約投稿の実機挙動）で `date` / `date_gmt` の扱いを直す可能性。R-007（予約投稿の取込漏れ）で取込側に補完を足すと +3 時間。一括の件数で `maxDuration = 800` に当たり、打ち切りの実装が増える可能性。

実施の枠（2026-10-23、依頼者「5日にする」）: 5 人日 = 40 時間。人の仮置き 47 時間を同じ作業のまま 40 時間に書き換えた数字ではない。範囲は削らない（一括下書きの 6 時間も残す）。前提は、承認済みの仕様を渡して実装する進め方で、上の表のうち実装と単体テストの 42 時間を約 3 割減らし、検証の 5 時間はそのまま見る（約 34 時間）。40 時間との差は約 6 時間で、R-007 の +3 時間までをこの枠で見る。公開の二重作成や権限の手戻りで 40 時間を超えた分は、この枠では終わらない。本番リリース作業は、これまでどおり枠の外。

### カレンダー上の前提（工数外）

- 仕様レビュー・承認の見込み: Q-001〜Q-007 は 2026-10-23 に書き戻した。cycle 3 の spec-review は通過し、ステータスは `approved`
- クライアント確認・見た目の見込み: 項目は §6。並びは同節の ASCII と対照表。色・余白・部品は `growmate-ui-ux` の既存写し。別の見た目承認はしない（依頼者、2026-10-23）
- 希望リリース時期との関係: 未定。実施の枠は 5 人日（40 時間。2026-10-23）。Instagram ブログ化（Phase 2）のリリース後に続けるのが自然（同機能の手作業の最終工程を埋めるため）

## 6. 機能要件

| ID | 機能要件 | 優先度 | 根拠・出典 | 受け入れ条件 |
| --- | --- | --- | --- | --- |
| FR-001 | チャット画面の step7 で「その他の操作」メニューから「WordPress に投稿」を選ぶと投稿ダイアログが開く | Must | 依頼文「チャット画面で自動投稿」 | S-01 |
| FR-002 | コンテンツ一覧の行（`session_id` あり、`wp_post_status` が NULL または `draft` / `future`、取込由来でない）の操作列に「WordPress に投稿」が出て、押すと同じ投稿ダイアログが開く | Must | 依頼文「コンテンツ一覧画面で自動投稿」 | S-02 |
| FR-003 | 投稿ダイアログで、送信先（投稿 / 固定ページ。既定は投稿。未送信のときだけ変更可）、タイトル（自動入力・必須）、公開状態（下書き・公開・予約。未送信の既定は下書き。再送は現在の下書き / 予約と予約済み日時を初期値にする。Q-003）、公開日時（予約のとき必須）、カテゴリ（投稿のときだけ。複数選択・任意）、スラッグ（任意）を指定できる | Must | 2026-10-23 の回答（Q-003、Q-005、Q-008） | S-01, S-03, S-05, S-15 |
| FR-004 | 送信すると Canvas の完成形（Markdown）を HTML に変換し、選んだ送信先（`posts` または `pages`）へ作成する。成功したら `content_annotations` に `wp_post_id` / `wp_post_title` / `wp_post_status` / `wp_post_type` を保存し、`publish` のときは `canonical_url` も保存する。完了トーストは結果の文だけを表示し、WordPress へのリンク（URL）は付けない | Must | 目的「URL の手入力が要らなくなる」、Q-008 | S-01, S-03, S-04, S-15 |
| FR-005 | 送信済み（`draft` / `future`）の行で再度送信すると、新規作成ではなく保存済みの `wp_post_type`（投稿または固定ページ）を更新する。更新前に WordPress 側の現在の状態を確認し、公開済みなら更新せず行を同期し、お知らせ（info）として表示する（赤いエラーにしない）。応答 JSON の `code` が `rest_post_invalid_id` のときだけ行の紐づけを外して次の送信を新規作成に戻す。それ以外の 404 は紐づけを残す | Must | BR-004（重複の防止・公開済みの上書き防止）、Q-008 | S-05, S-13, S-14 |
| FR-006 | コンテンツ一覧のタイトル列に、`wp_post_status` が `draft` なら「下書き」、`future` なら「予約」のバッジを出す。`publish` はバッジ無し（URL は従来どおり URL 列のリンク） | Must | 利用シナリオ3 | S-06 |
| FR-007 | WordPress 未連携、連携切れ（401）、権限不足（403）、サイト側障害（5xx・タイムアウト）、完成形なし、のそれぞれで原因と次の操作を表示し、`content_annotations` は変更しない。未連携と完成形なしはフォームの上に `Alert variant="destructive"` を出し、フォームは表示したまま送信不可にする | Must | 外部 API 依存機能の失敗時表示（`spec-review` C 観点）、Q-008 | S-07, S-08 |
| FR-008 | WordPress 側で下書き・予約が公開されたあと、既存の日次 WordPress 取込が同じ行の `canonical_url` / `wp_post_title` / `wp_post_status = 'publish'` を埋める | Must | BR-005 | S-09 |
| FR-009 | カテゴリ一覧の取得に失敗しても、カテゴリ未選択のまま送信できる（失敗理由を欄の下に表示） | Should | カテゴリは任意。取得失敗で投稿自体を止めない | S-10 |
| FR-010 | 送信済みの下書き・予約の行は、チャットの登録情報パネルで WordPress 投稿 URL を空のまま保存しても `wp_post_id` / `wp_post_status` が保持される | Must | BR-004（他の保存経路との整合） | S-12 |
| FR-011 | 一覧の未送信と `draft` だけを下書きの投稿として直列に送る。`future`・`publish`・取込由来・固定ページと、タイトルが空の行は送らずスキップする。成功、スキップ理由、時間切れの残りを分けて返す。ツールバーボタンは実装し、初回リリースではマウントしない | Must | Q-002（2026-10-23）。BR-008 | S-16 |

### 入力・出力・状態遷移

- 入力値・形式・必須条件:
  - `annotationId`（UUID、必須。コンテンツ一覧から）または `sessionId`（チャットから。`content_annotations.session_id` で行を引く。行が無ければ `upsertContentAnnotationBySession`（`src/server/actions/wordpress.actions.ts`）と同じ経路で、`main_kw` をセッションのキーワードから埋めて作る。`ensureAnnotationChatSession`（L741）は逆方向、つまり一覧の行からチャットセッションを作る関数で、ここでは使わない）
  - `contentType`: `posts` または `pages`。既定 `posts`。`wp_post_id` がある再送信では送らず、保存済みの `wp_post_type` を使う（BR-007）
  - `title`: 1〜200 文字、必須。既定値は完成形 Markdown の最初の `# ` 見出し、無ければ `wp_post_title`。どちらも空なら空のままにし、`main_kw` は入れない（Q-004、2026-10-23）。「タイトル・説明文生成」の出力も入れない。空のままでは送信できない。行を新規作成するときのキーワード（`upsertContentAnnotationBySession` がセッションの `main_kw` を埋める）は、送信タイトルとは別で、従来どおり
  - `status`: `draft` / `publish` / `future`。未送信の既定は `draft`。再送時は現在の `draft` / `future` を初期値にする
  - `scheduledAt`: `status = future` のとき必須。再送時は予約済み日時を初期値に入れる（WordPress の `date_gmt` をブラウザのローカル壁時計へ変換して表示する）。`datetime-local` の値はブラウザのローカル壁時計とする。ブラウザで末尾 `Z` の UTC ISO 8601 に変換してから Server Action へ渡す。サーバーはその文字列をサーバーのタイムゾーンで解釈し直さない。`date_gmt` にはその文字列を載せる。「現在時刻より後」の比較も、変換前の同じ壁時計で行う。トーストの時刻は、変換前に利用者が入れた壁時計を出す。既存の日付表示は `src/lib/date-utils.ts` の `formatDateTime` が `timeZone: 'Asia/Tokyo'` 固定で、ブラウザが日本以外のときは、その表示と予約の壁時計がずれる。
  - `categoryIds`: 整数配列、任意。`contentType` が `posts` のときだけ送り、`fetchCategories` の結果に含まれる ID だけを通す。`pages` のときは空として扱い、カテゴリは送らない
  - `slug`: 任意。空なら送らない（WordPress が生成）。空でなければそのまま `slug` に載せる。文字種の拒否はしない（WordPress 側に任せる）。長さの上限を足すならタイトルと同じ 200 文字（§9。Posts schema の slug は "An alphanumeric identifier for the post unique to its type." で、上限の記載は無い。確認日 2026-10-22）
  - Zod スキーマは新規の `src/server/actions/wordpressPublish.actions.ts` の近くに置き、Server Action の入口で検証する（`nextjs-server` 規約）
- 正常時の出力: `{ success: true, data: { wpPostId, status, link } }`。トースト「WordPress に下書きを送信しました」「WordPress で公開しました」「WordPress に予約しました（10/28 10:00）」を結果の文だけで表示し、WordPress へのリンク（URL）は付けない。応答の `link` は DB の同期に使う。予約トーストの「10/28 10:00」は、UTC へ変換する前の壁時計である
- エラー・お知らせの出力（エラーは `ServerActionResult` の `error`。公開済み同期はエラーにせず、お知らせ（info）として扱う）:

  | 原因 | ユーザー向け表示 | 表示方法 | 次の操作 | DB |
  | --- | --- | --- | --- | --- |
  | `wordpress_settings` 行なし | WordPress と連携していません | フォームの上に `Alert variant="destructive"` | 「連携を開始」→ `/setup/wordpress` | 変更なし |
  | 完成形なし（`session_combined_contents` に `is_latest` 行が無い） | 完成した記事がありません。チャットで step7 の完成形を保存してください | フォームの上に `Alert variant="destructive"` | 一覧から開いたときだけ「チャットを開く」。遷移先は既存と同じ `/chat?session={sessionId}&initialStep=step7`（`src/components/AnalyticsTable.tsx` L929〜L933。`session` は行の `session_id`）。`/chat` 上ではこの文だけ出し、「チャットを開く」は出さない | 変更なし |
  | 401（Application Password 失効・WordPress.com トークン失効・更新失敗） | WordPress との連携が切れています | フォームの上に `Alert variant="destructive"` | 「再連携する」→ `/setup/wordpress` | 変更なし |
  | 403（ユーザーに `edit_posts` / `publish_posts`、または固定ページなら `edit_pages` / `publish_pages` が無い、WAF） | WordPress のユーザーに投稿または固定ページの権限がありません。WordPress の権限か、サイトのセキュリティ設定を確認してください | フォームの上に `Alert variant="destructive"` | 閉じる | 変更なし |
  | 更新前の確認で WordPress 側が `publish`（S-13） | すでに WordPress で公開されています。公開後の変更は WordPress 側で行ってください | フォームの上にお知らせ（info）の `Alert variant="default"`（赤いエラーにしない） | 閉じる（完了トーストは出さない。フォームは送信不可にし、元画面の該当行も再取得） | `wp_post_status = 'publish'`、`canonical_url = link`、`wp_post_title` を同期 |
  | 更新前の確認で JSON の `code` が `rest_post_invalid_id`（S-14） | WordPress 側で投稿が削除されていました。もう一度送信すると新しい投稿を作ります | フォームの上に `Alert variant="destructive"` | 「もう一度送信」（ダイアログは開いたまま、送信ボタンが新規作成の文言に戻る） | `wp_post_id` / `wp_post_title` / `wp_post_status` を NULL |
  | 更新前の確認で、上記以外の 404 | WordPress に接続できませんでした。紐づけは残しています。時間をおいて再度お試しください | フォームの上に `Alert variant="destructive"` | 「再試行」 | 変更なし |
  | 同じ行の送信権を取れなかった | この記事は送信中です。しばらくしてから再度お試しください | フォームの上に `Alert variant="destructive"` | 閉じる | 変更なし（先のリクエストの印は残る） |
  | 作成（POST）で 5xx・タイムアウト（60 秒）・ネットワーク | WordPress から応答がありませんでした。WordPress 側に下書きが作られている場合があります。WordPress の投稿一覧を確認してから、もう一度お試しください | フォームの上に `Alert variant="destructive"` | 閉じる（自動の「再試行」ボタンは出さない。作成済みか分からない状態で再送すると重複するため） | 変更なし |
  | 更新（POST `/{id}`）で 5xx・タイムアウト・ネットワーク | WordPress が応答しませんでした。時間をおいて再度お試しください | フォームの上に `Alert variant="destructive"` | 「再試行」（更新は同じ ID への再送で重複しない） | 変更なし |
  | WordPress 成功、`content_annotations` 更新失敗 | WordPress には送信できましたが、コンテンツ一覧への反映に失敗しました。WordPress の投稿一覧を確認し、コンテンツの「編集」で WordPress 投稿 URL を入れてください | フォームの上に `Alert variant="destructive"` | 閉じる | `console.error` に `wpPostId` と行 ID を出す。再送すると `wp_post_id` が無いので新規作成になる（R-002） |

- 状態と遷移条件（`content_annotations.wp_post_status`。行単位の状態機械）:

  ```text
  NULL（未送信。取込由来の行は wp_post_id ありで NULL のまま）
    --送信(draft)-->   draft
    --送信(future)-->  future
    --送信(publish)--> publish
  draft   --再送信(draft/future/publish)--> 選んだ状態（同じ wp_post_id を更新）
  future  --再送信(draft/future/publish)--> 選んだ状態（同じ wp_post_id を更新）
  draft / future --WordPress 側で公開 → 日次取込--> publish（canonical_url が埋まる）
  draft / future --再送信時の確認で WordPress 側が publish--> publish（canonical_url を同期。更新はしない）
  draft / future --再送信時の確認で code が rest_post_invalid_id--> NULL（wp_post_id も NULL。次の送信は作成）
  draft / future --それ以外の 404--> 状態は変えない
  publish --本機能からは遷移しない（BR-004 例外）
  ```

  取込（`importWordPressContent`）は挿入・更新の両方で `wp_post_status = 'publish'` を書くため、リリース後に取込が触った行は NULL ではなく `publish` になる。NULL のまま残るのは、リリース前に取り込まれて以後更新されていない行と、未送信の行だけ。

  「WordPress に投稿」ボタンの表示条件は `session_id` あり、かつ（`wp_post_id` が NULL、または `wp_post_status` が `draft` / `future`）。`wp_post_id` ありで `wp_post_status` が NULL（取込由来）か `publish` の行には出さない。`/analytics` は `PAID_FEATURE_REQUIRED_PATHS`（`src/lib/role-access.ts`）に入っており `trial` は画面に入れないため、一覧側の表示条件にロール判定は足さない。
- 冪等性・重複実行時の挙動:
  - 同じ行への送信は `wp_post_id` の有無で作成と更新を分ける（BR-004）。ダイアログの送信ボタンは送信中 disabled にし、同一タブの連打を防ぐ（`growmate-ui-ux` 連打防止）。別タブや並行の Server Action は、この disabled では止まらない。
  - 作成の POST の前に、対象行の送信権を条件付き UPDATE で1件だけ取る。列は `content_annotations.wp_publish_claimed_at timestamptz null`（今回の migration に足す。新しいテーブルは作らない）。条件は、`wp_post_id` が NULL、かつ印が空または 120 秒より前。更新できたリクエストだけが POST する。できなかったリクエストは POST せず「この記事は送信中です」を返す（S-17）。リクエストが終わったら印を消す。成功時は `wp_post_id` を書いてから消す。失敗時も消す。120 秒を過ぎた印は、リクエストが落ちたときの失効で、次の送信は作成できる。接続をまたいで `SELECT ... FOR UPDATE` を保持しない（プールされた接続が HTTP のあいだロックを保てないため）。作成成功のあと DB 更新だけ失敗する窓は R-002 のまま残し、WordPress 側の検索は足さない。
  - 作成（POST）の 5xx・タイムアウトは「WordPress 側に作られたかどうか分からない」状態なので、自動リトライも「再試行」ボタンも出さない。ユーザーに WordPress の投稿一覧の確認を案内する（§6 エラー表）。更新（POST `/{id}`）は同じ ID への再送で重複しないので「再試行」を出す。
  - 作成に成功して DB 更新に失敗したとき、次の送信は `wp_post_id` が無いので新規作成になり、WordPress に下書きが2件できる。発生頻度と被害（下書きが1件余る。公開は既定ではない）から、送信前に WordPress を検索して突合する仕組みは作らない（R-002）。
  - `rest_route` フォールバック: 既存の `fetchRestResource`（GET 用。`src/server/services/wordpressService.ts` L161〜L187）は JSON の 404 以外のすべての非 2xx で `index.php?rest_route=` に再送する。POST でこれを使うと、1回目の 5xx（WordPress 側で作成処理が走ったあとにエラーになった場合を含む）で作成済みかもしれない投稿を2回目で重複させる。POST 用の呼び出しは、1回目が **JSON でない 403 / 404**（WAF やパーマリンク設定で `/wp-json/` が塞がれている典型）のときだけフォールバックし、5xx・タイムアウト・JSON のエラー応答では再送しない（R-006）。301（WordPress.com のカスタムドメインへのリダイレクトを含む）も POST の再送条件にしない（BR-006。作成の重複を避ける）。
  - 更新は確認の GET と POST の直列で、各リクエストは `REST_FETCH_TIMEOUT_MS`（60 秒）まで待つ。呼び出し元ページの `maxDuration` はこの合計より大きくする（§8）。`/chat` が 60 秒未満で切れると、作成済みか不明のまま関数が落ち、上の「応答がありませんでした」に乗らない。

### 画面設計

#### UI 既存パターン対照表

| 今回の UI 要素 | 同種の既存 UI（`file:line`） | 採る方法 | 変える点と根拠 |
| --- | --- | --- | --- |
| チャット step7 のメニュー項目「WordPress に投稿」 | `app/chat/components/StepActionBar.tsx` の「その他の操作」`DropdownMenuItem`（「タイトル・説明文生成」「ブログ記事取得」。L390〜L422） | 共通化（同ファイル内で `DropdownMenuItem` + アイコン + `Loader2` の組み合わせをメニュー項目部品として切り出して export し、既存2項目と新項目で使う） | 既存項目のクラスには生の色（`bg-white text-gray-900` 等）があり、`eslint-suppressions.json` に同ファイルの抑止が 33 件ある（L222〜L227）。そのまま写すと抑止件数が増えるため、部品に閉じ込めて新規の違反を出さない。アイコンは lucide `Send`。文言は本書の用語 |
| コンテンツ一覧の行ボタン「WordPress に投稿」 | `src/components/AnalyticsTable.tsx` の操作列ボタン群（「編集」L1375〜L1382、「詳細」L1457〜L1485。`variant="outline" size="sm" className="flex items-center gap-2"`） | 写す | アイコンは lucide `Send`。「編集」の右、「詳細」の左に置く。表示条件は本節の状態遷移どおり |
| コンテンツ一覧の「下書き」「予約」バッジ | `src/components/AnalyticsTable.tsx` の `<Badge variant="outline">サンプリング</Badge>`（L1579） | 写す | 文言のみ。タイトル列（`case 'wp_post_title'` L1683〜L1690。現状はプレーンテキストで、URL リンクは `case 'url'` L1702〜L1719 の別列）のタイトルの右に置く |
| 投稿ダイアログの枠 | `src/components/AnalyticsTable.tsx` の「コンテンツ情報を編集」`Dialog`（L1374〜L1453。`DialogTrigger` / `DialogContent` / `DialogHeader` / `DialogFooter`、キャンセルと主操作の並び、送信中の `Loader2` + 「保存中...」） | 写す | 幅は `max-w-2xl`（編集ダイアログの `max-w-4xl` は項目数が多いため。本ダイアログの入力は6項目） |
| フォーム項目（ラベル・入力・補足文） | shadcn の `Label` / `Input` / `Textarea`（`src/components/ui/label.tsx` / `input.tsx` / `textarea.tsx`）。既存の同種の並びは `src/components/WordPressSettingsForm.tsx`（`Input` を import し、ラベル + 入力 + 補足文で組んでいる） | そのまま使う | `src/components/AnnotationFormFields.tsx`（L127〜L141）は生の `<label>` / `<input>` に生の色クラスを当てており、投稿ダイアログのマークアップとしては写さない（抑止件数が増えるため） |
| 登録情報の WordPress 投稿 URL の補足文 | `src/components/AnnotationFormFields.tsx` L126〜L129（「空欄の場合は連携を解除します。」） | 既存の文を更新 | マークアップとクラスは変えない。下書き・予約で URL が空のときは紐づけを残す。公開 URL が入っている行を空にして保存したときは従来どおり解除する。`ui-text.md` にはこの2文を実装時に足す（§4） |
| 公開状態の選択 | `src/components/WordPressSettingsForm.tsx` L355〜L361 の shadcn `Select`（連携方式の選択。`src/components/ui/select.tsx`） | 写す | 3択なので `Select`。ラジオ部品は `src/components/ui/` に無いため新造しない。既存はラベルが生の `<label>` なので、本ダイアログは shadcn `Label` に揃える |
| 送信先の選択 | 同じ `Select`（公開状態の行） | 写す | 2択（投稿 / 固定ページ）。既定は投稿。文言は「投稿」「固定ページ」で固定し、「ブログ」「ページ」と揺らさない |
| カテゴリの複数選択 | `src/components/CategoryFilter.tsx` L232〜L244 のチェックボックス行（`Checkbox`（`src/components/ui/checkbox.tsx`）+ ラベル） | 共通化（`CategoryFilter.tsx` 内のチェックボックス行を部品として export し、本ダイアログで使う） | 絞り込みではなく選択なので見出し「カテゴリ」。並びは WordPress の `name` 昇順 |
| 日時入力 | `<input type="datetime-local">`（最小実装ラダー 4。既存の `<input type="date">` は Instagram タブの期間入力） | 新規（grep `datetime-local` で既存なし） | 日付のみの `date` では予約時刻を指定できないため |
| 結果通知 | Sonner トースト（`src/components/ui/sonner.tsx`。既存の一括操作と同じ） | そのまま使う | なし |

#### 画面一覧

| 画面 | パス | 新規/既存 | 概要・変更点 |
| --- | --- | --- | --- |
| チャット | `/chat` | 既存 | step7 の「その他の操作」に「WordPress に投稿」を追加。投稿ダイアログを開く |
| コンテンツ一覧（ブログタブ） | `/analytics` | 既存 | 操作列に「WordPress に投稿」を追加。タイトル列に「下書き」「予約」バッジ |
| 投稿ダイアログ | （`/chat`・`/analytics` 上のモーダル） | 新規 | 送信先・公開状態・タイトル・カテゴリ等を指定して送信 |

#### 画面ごとの詳細

##### 投稿ダイアログ（`src/components/WordPressPublishDialog.tsx`）

- 概要: 記事1本を WordPress へ送る。開いた時点で既定値（タイトル候補・カテゴリ一覧・送る本文の概要）をサーバーから取る。再送時は保存済みタイプの `fetchPost` で現在の状態と予約済み日時も取得し、下書き / 予約と予約済み日時を初期値にする。送信直前の状態確認（BR-004）も行う。
- レイアウト: 項目の順は下の ASCII。色・余白・部品は `growmate-ui-ux` に従い、上の対照表の既存 UI を写す。新しい画面パターンは作らない。見た目の実装前ゲートは置かない（依頼者、2026-10-23）。

  ```text
  ┌ WordPress に投稿 ───────────────────────────────┐
  │ 送る本文: 見出し 8 本・約 4,200 文字（Canvas の最新の完成形）│
  │                                                 │
  │ 送信先              [ 投稿 ▼ ]（投稿 / 固定ページ）        │
  │ タイトル            [ 自動入力されたタイトル            ] │
  │ 公開状態            [ 下書き ▼ ]（下書き / 公開 / 予約投稿）│
  │ 公開日時（予約のみ）  [ 2026-10-28T10:00 ]               │
  │ カテゴリ（投稿のみ）  ☐ お知らせ  ☐ コラム  ☑ 解体補助金    │
  │                     （固定ページではこの欄は出さない）      │
  │ スラッグ（任意）      [                              ] │
  │                                                 │
  │                           [キャンセル] [下書きとして送信] │
  └─────────────────────────────────────────────────┘
  ```

- 項目定義:

  | 項目 | 型・形式 | 必須 | 初期値 | 表示条件・活性条件 |
  | --- | --- | --- | --- | --- |
  | 送る本文の概要 | テキスト（見出し数・文字数） | 表示のみ | サーバーの既定値取得で算出 | 常時。完成形が無いときはフォームの上に `Alert variant="destructive"` を表示し、フォームは表示したまま送信不可にする。一覧では「完成した記事がありません」と「チャットを開く」（遷移先は §6 エラー表）。`/chat` 上では文だけで「チャットを開く」は出さない |
  | 送信先 | `Select`（投稿 / 固定ページ） | 必須 | 未送信は投稿。`wp_post_type` が残っていればそれを初期値 | `wp_post_id` が NULL のときだけ変更可。再送信（ID あり）は保存済みタイプを表示し、選択は出さない |
  | タイトル | `Input`、1〜200 文字 | 必須 | 完成形の最初の `# ` 見出し → `wp_post_title`。どちらも空なら空。`main_kw` は入れない（Q-004） | 常時 |
  | 公開状態 | `Select`（下書き / 公開 / 予約投稿） | 必須 | 未送信は下書き。再送時は現在の下書き / 予約 | 常時 |
  | 公開日時 | `<input type="datetime-local">` | 予約投稿のとき必須 | 未送信は空。再送時は予約済み日時をブラウザのローカル壁時計に変換した値 | 公開状態が「予約投稿」のときだけ表示。比較は変換前の壁時計。現在より前なら欄の下にエラー |
  | カテゴリ | チェックボックス群 | 任意 | 行の `wp_categories`（あれば）。無ければ未選択 | 送信先が投稿のときだけ。取得失敗時は理由の文と未選択で続行。固定ページでは出さない |
  | スラッグ | `Input` | 任意 | 空 | 常時 |
  | 送信ボタン | `Button` | 必須 | 文言は公開状態で変わる: 下書き→「下書きとして送信」、公開→「公開する」、予約投稿→「予約する」。更新（`wp_post_id` あり）のときは末尾に「（更新）」 | 未連携・完成形なし・公開済み同期後は disabled。送信中は disabled + `Loader2` + 「送信中...」 |

- 状態別UI:

  | 内部状態 | ユーザー向け表示 | 主操作 | 操作制限 |
  | --- | --- | --- | --- |
  | 既定値取得中 | skeleton と「読み込み中...」 | なし | 送信不可 |
  | WordPress 未連携 | フォームの上に `Alert variant="destructive"` で「WordPress と連携していません」 | 「連携を開始」（`/setup/wordpress`） | フォームは表示したまま送信不可 |
  | 完成形なし | フォームの上に `Alert variant="destructive"` で「完成した記事がありません。チャットで step7 の完成形を保存してください」 | 一覧: 「チャットを開く」（`/chat?session={sessionId}&initialStep=step7`。`src/components/AnalyticsTable.tsx` L929〜L933）。`/chat` 上: なし | フォームは表示したまま送信不可 |
  | 入力中 | フォーム | 送信ボタン | タイトル空・予約日時不正では送信不可 |
  | 送信中 | 送信ボタンが「送信中...」 | なし | 全項目 disabled |
  | 成功 | ダイアログを閉じ、完了トーストは結果の文だけ（WordPress へのリンク・URL なし） | なし | なし |
  | WordPress 側で公開済み（S-13） | フォームの上にお知らせ（info）の `Alert variant="default"` で「すでに WordPress で公開されています。公開後の変更は WordPress 側で行ってください」。DB と元画面の該当行を公開済みに同期 | 閉じる（完了トーストは出さない） | フォームは送信不可 |
  | 失敗 | フォームの上に `Alert variant="destructive"`（編集ダイアログの「保存に失敗しました」と同形）で原因と次の操作 | 原因ごとの次の操作（§6 エラー表）。「再試行」は更新前の確認での接続障害と更新の 5xx 等。作成の 5xx 等は閉じる | 入力は保持 |

- 画面遷移: `/chat`（step7 その他の操作）→ 本ダイアログ / `/analytics`（行の「WordPress に投稿」）→ 本ダイアログ / 本ダイアログ（未連携）→ `/setup/wordpress` / 本ダイアログ（成功）→ 閉じて元画面（一覧は該当行を再取得してバッジと URL を更新）
- UI用語: 実装時に `ui-text.md` へ追記する語は次のとおり（`ui-text.md` 自体は実装時に書く）。「WordPress に投稿」（ボタン・メニュー。「投稿する」「公開」「送る」と揺らさない。`WordPress` の後ろに助詞が来るので半角スペースを入れる）、「送信先」「投稿」「固定ページ」（送信先の2択。ボタン名の「投稿」とは別）、「下書き」「公開」「予約投稿」（公開状態の3択）、「下書きとして送信」「公開する」「予約する」（送信ボタン）、「予約」（一覧バッジ。「予約投稿」の短縮。列幅のため）。登録情報の補足は2文。「下書き・予約で URL が空のときは、空のまま保存しても紐づけを残します。」「公開 URL が入っている行を空にして保存したときは、従来どおり連携を解除します。」既存の「連携」「再連携」「送信中...」はそのまま使う。

##### `/chat`（既存。変更点のみ）

- 概要: step7 の「その他の操作」メニューに「WordPress に投稿」を追加する。
- 項目定義:

  | 項目 | 型・形式 | 必須 | 初期値 | 表示条件・活性条件 |
  | --- | --- | --- | --- | --- |
  | WordPress に投稿 | `DropdownMenuItem` | 該当なし | 該当なし | step7 のとき表示（「ブログ記事取得」と同じ `showLoadButton` 条件）。`hasPaidFeatureAccess` が偽（`trial` 等）なら出さない。見出し生成中・チャット送信中は disabled（既存の `isDisabled || isHeadingFlowBusy` と同じ） |

- 画面遷移: メニュー選択 → 投稿ダイアログ。成功後はチャット画面に留まる（完了トーストは結果の文だけで、WordPress へのリンク・URL なし）。

##### `/analytics`（既存。変更点のみ）

- 概要: 行の操作列に「WordPress に投稿」を追加し、タイトル列にバッジを出す。
- 項目定義:

  | 項目 | 型・形式 | 必須 | 初期値 | 表示条件・活性条件 |
  | --- | --- | --- | --- | --- |
  | WordPress に投稿 | `Button variant="outline" size="sm"` | 該当なし | 該当なし | 操作列展開時。`session_id` あり、かつ（`wp_post_id` NULL、または `wp_post_status` が `draft` / `future`）。ロール判定は足さない（`/analytics` は有料画面で、`trial` は入れない） |
  | 下書き / 予約 バッジ | `Badge variant="outline"` | 該当なし | 該当なし | タイトル列。`wp_post_status` が `draft` → 「下書き」、`future` → 「予約」。`publish` / NULL は出さない |

- 画面遷移: ボタン → 投稿ダイアログ。成功後は該当行を再取得。

#### 誤読しやすい罠

- 「WordPress に投稿」は「WordPress で公開」ではない。未送信の既定は下書きで、再送は現在の下書き / 予約を使う。公開は公開状態で「公開」を選んだときだけ。ボタン文言が「下書きとして送信」「公開する」「予約する」に変わるのはこのため。
- ボタン名の「投稿」は操作の名前である。WordPress の投稿タイプはダイアログの「送信先」で、投稿か固定ページかを選ぶ。既定は投稿。一度送った行は、そのタイプのまま更新する。
- 取込由来の行（`wp_post_id` あり、`wp_post_status` NULL）と公開済みの行（`publish`）はどちらも「WordPress に投稿」が出ない。URL はタイトル列ではなく URL 列（`case 'url'`）に出る。タイトル列はプレーンテキストのまま。
- 下書き・予約の行は `canonical_url` が空のため、URL 列は空で、タイトル列にバッジだけ付く。GA4・GSC の数値が「—」なのは未公開だからで、取得失敗ではない。
- Canvas で編集したあと保存せずに「WordPress に投稿」を押すと、保存済みの完成形が送られる（BR-003）。ダイアログの「送る本文の概要」の文字数で気づける。

### 権限

新規機能の対象ロールは `admin` / `paid`（Q-006、2026-10-23）。`trial` / `unavailable` は対象外（バッジもボタンも出さない）。`/analytics` は `PAID_FEATURE_REQUIRED_PATHS`（`src/lib/role-access.ts` L6〜L11）に入っており、`trial` は `/unauthorized` へ退避する。チャット（`/chat`）は `trial` も開けるため、メニュー項目の出し分けが要る。Server Action の入口では画面に依存せず `hasPaidFeatureAccess(role)`（`src/types/user.ts`）で判定し、対象外は `ERROR_MESSAGES` の権限エラーを返す。対象の `content_annotations` 行と `chat_sessions` が呼び出しユーザーの所有であることも Server Action で確認する（`SupabaseService` は Service Role のため RLS に頼らない）。

| ロール | 閲覧（バッジ・ボタン） | 作成・実行（送信） | 更新（再送信） | 削除・解除 |
| --- | --- | --- | --- | --- |
| admin | 可 | 可 | 可（`draft` / `future` のみ） | 対象外（WordPress 側で行う） |
| paid | 可 | 可 | 可（`draft` / `future` のみ） | 対象外 |
| trial | 不可（一覧に入れない。チャットのメニューにも出さない） | 不可 | 不可 | 対象外 |
| unavailable | 不可（画面自体に入れない） | 不可 | 不可 | 対象外 |

## 7. Gherkin受け入れ条件

```gherkin
Feature: 完成した記事を WordPress へ送る

  Rule: 送信はユーザーが押したときだけ行い、未送信の既定は下書き、再送は現在の状態にする

  Scenario: S-01 チャットから下書きとして送る
    Given ロールが paid のユーザーが WordPress 連携済みである
    And チャットで step7 の完成形が保存されている
    When 「その他の操作」から「WordPress に投稿」を選び、公開状態を変えずに「下書きとして送信」を押す
    Then WordPress に下書きの投稿が1件できる
    And コンテンツ一覧の該当行に WordPress の投稿 ID とタイトルと「下書き」が記録され、公開 URL は空のままである
    And 完了トーストに「WordPress に下書きを送信しました」とだけ表示され、WordPress へのリンク・URL は付かない

  Scenario: S-02 コンテンツ一覧から送る
    Given ロールが paid のユーザーが WordPress 連携済みである
    And コンテンツ一覧に、チャットがあり WordPress に未送信の行がある
    When その行の「WordPress に投稿」を押す
    Then S-01 と同じ投稿ダイアログが開く

  Scenario: S-03 予約投稿する
    Given S-01 の前提
    When 公開状態で「予約投稿」を選び、未来の日時を入れ、カテゴリを1つ選んで「予約する」を押す
    Then WordPress に予約済みの投稿が、指定した日時と選んだカテゴリで1件できる
    And 入れた日時はブラウザの壁時計で、末尾 `Z` の UTC ISO 8601 にしてから送り、トーストは変換前の壁時計を出す
    And 「現在より後」の判定も、その壁時計で行う
    And 該当行に「予約」が記録され、公開 URL は空のままである
    And 完了トーストに WordPress へのリンク・URL は付かない

  Scenario: S-04 公開する
    Given S-01 の前提
    When 公開状態で「公開」を選び「公開する」を押す
    Then WordPress に公開済みの投稿が1件できる
    And 該当行に公開 URL とタイトルと「公開」が記録される
    And 完了トーストに WordPress へのリンク・URL は付かない

  Scenario Outline: S-05 再送は現在の状態と予約済み日時を初期値にし、重複を作らない
    Given ある行が「<状態>」として送信済みである
    When 同じ行から再度「WordPress に投稿」を開く
    Then 公開状態の初期値は WordPress 側の現在の「<公開状態>」である
    And 予約の場合、公開日時の初期値は予約済み日時をブラウザのローカル壁時計へ変換した値である
    When 状態と日時を変えずに「<送信ボタン>」を押す
    Then WordPress の投稿は増えず、同じ投稿のタイトルと本文が更新される
    And 予約の場合、予約済み日時は維持される

    Examples:
      | 状態   | 公開状態 | 送信ボタン                 |
      | 下書き | 下書き   | 下書きとして送信（更新）   |
      | 予約   | 予約投稿 | 予約する（更新）           |

  Scenario: S-06 一覧で下書き止まりの記事が分かる
    Given 「下書き」として送信済みの行と、公開済みの行がある
    When コンテンツ一覧を開く
    Then 下書きの行のタイトルの横に「下書き」が付く
    And 公開済みの行のタイトルにはバッジが付かず、URL 列に公開 URL のリンクが出る

  Rule: 失敗したときは原因と次の操作を出し、コンテンツ一覧は変えない

  Scenario Outline: S-07 WordPress の連携が利用できない
    Given WordPress の連携状態が「<連携状態>」である
    When <操作>
    Then フォームの上に Alert で「<表示>」と「<次の操作>」が表示される
    And 未連携の場合、フォームは表示されたまま送信不可である
    And コンテンツ一覧の行は変わらない

    Examples:
      | 連携状態                       | 操作                           | 表示                                 | 次の操作   |
      | Application Password が失効済み | 「下書きとして送信」を押す     | WordPress との連携が切れています     | 再連携する |
      | 未連携                         | 「WordPress に投稿」を開く     | WordPress と連携していません         | 連携を開始 |

  Scenario: S-08 完成形が無い
    Given チャットが step6 までしか進んでいない
    When コンテンツ一覧の行から「WordPress に投稿」を押す
    Then フォームの上に Alert で「完成した記事がありません。チャットで step7 の完成形を保存してください」と「チャットを開く」が表示される
    And フォームは表示されたまま送信不可で、コンテンツ一覧の行は変わらない
    And 「チャットを開く」は `/chat?session={sessionId}&initialStep=step7` を開く（`src/components/AnalyticsTable.tsx` L929〜L933。`session` は行の `session_id`）
    And `/chat` 上で完成形が無いときもフォームの上に同じ Alert が出て送信不可となり、「チャットを開く」は出ない

  Scenario: S-09 WordPress 側で公開したら URL が埋まる
    Given 「下書き」として送信済みの行がある
    And ユーザーが WordPress 管理画面でその下書きを公開した
    When 日次の WordPress 取込が走る
    Then 該当行の公開 URL が URL 列に埋まり、タイトル横の「下書き」が消える

  Scenario: S-10 カテゴリが取れなくても送れる
    Given WordPress のカテゴリ一覧の取得が失敗する
    When 投稿ダイアログを開く
    Then カテゴリ欄に「カテゴリを取得できませんでした。未選択のまま送信できます」と出る
    And 「下書きとして送信」を押すとカテゴリ未指定で投稿ができる

  Scenario: S-11 trial ロールは送れない
    Given ロールが trial のユーザーである
    When チャットの step7 を開く
    Then 「その他の操作」に「WordPress に投稿」は出ない
    And コンテンツ一覧（/analytics）は開けず、権限外の画面へ移る
    And Server Action を直接呼んでも権限エラーになる
    And コンテンツ一覧の行は変わらない

  Scenario: S-12 登録情報の保存で送信済みの下書きが消えない
    Given ある行が「下書き」として送信済みで、公開 URL は空である
    When チャットの登録情報パネルで WordPress 投稿 URL を空のまま保存する
    Then その行の WordPress 投稿 ID と「下書き」は残る
    And 次に「WordPress に投稿」を送ると、新しい投稿は作られず同じ投稿の更新になる

  Scenario: S-13 再送信の前に WordPress 側の状態を見る
    Given ある行が「下書き」として送信済みである
    And その投稿は WordPress 側で公開済みである
    When 同じ行から「下書きとして送信（更新）」を押す
    Then WordPress の本文は変わらない
    And フォームの上にお知らせ（info）の Alert で「すでに WordPress で公開されています」と表示され、赤いエラーにはならない
    And フォームは送信不可で、閉じる操作ができ、完了トーストは出ない
    And 該当行の公開状態とタイトルと公開 URL が WordPress 側の値に同期され、URL 列に公開 URL が入る。タイトル列の「下書き」は消える

  Scenario: S-14 WordPress 側で削除されていたら紐づけを外す
    Given ある行が「下書き」として送信済みである
    And 更新前の GET が 404 で、JSON の code が rest_post_invalid_id である
    When 同じ行から送信する
    Then 「WordPress 側で投稿が削除されていました。もう一度送信すると新しい投稿を作ります」と表示される
    And 該当行の WordPress 投稿 ID と公開状態が空になる
    And もう一度「下書きとして送信」を押すと新しい下書きが1件できる
    And 行の送信先（`wp_post_type`）は空にならない

  Scenario: S-14 の接続障害では紐づけを残す
    Given ある行が「下書き」として送信済みである
    And 更新前の GET が 404 で、JSON の code は rest_post_invalid_id ではない
    When 同じ行から送信する
    Then 「WordPress に接続できませんでした。紐づけは残しています」と表示される
    And 該当行の WordPress 投稿 ID と公開状態は残る

  Scenario: S-15 固定ページを選ぶとページの下書きが1件できる
    Given S-01 の前提
    And その行はまだ送信していない
    When 送信先で「固定ページ」を選び、公開状態を変えずに「下書きとして送信」を押す
    Then WordPress に固定ページの下書きが1件でき、投稿は増えない
    And カテゴリ欄は出ておらず、カテゴリは送られない
    And 該当行の送信先は固定ページとして残り、公開 URL は空のままである
    And もう一度ダイアログを開くと送信先は固定ページのままで、選び直せない

  Scenario: S-16 一括下書きは実装され、初回の画面には出ない
    Given ロールが paid のユーザーがコンテンツ一覧を開いている
    And チャットがあり WordPress に未送信の行が2件ある
    When その2件を選択する
    Then 「評価サイクルを開始」と「AIで要約」は出る
    And 「下書きとして一括送信」は出ない
    And 一括送信用の処理を呼ぶと、未送信の2件は WordPress の投稿の下書きになる
    And `future`・`publish`・取込由来・固定ページ・タイトル空は送らずスキップし、成功、スキップ理由、時間切れの残りを分けて返す

  Scenario: S-17 同じ行への並行送信は作成を1件にする
    Given ある行はまだ送信していない
    When その行への送信が2つ同時に始まる
    Then WordPress への作成は1件だけで、もう一方は「この記事は送信中です」と出て作成しない
    And 予約を下書きに戻すのは、1件ダイアログで公開状態を「下書き」にしたときだけである
```

### シナリオ対応表

| シナリオ | 対応する機能要件 | 対応する決定事項 |
| --- | --- | --- |
| S-01 | FR-001, FR-003, FR-004 | BR-001, BR-002, BR-003, BR-005, ALT-001, ALT-002 |
| S-02 | FR-002 | ALT-006 |
| S-03 | FR-003, FR-004 | BR-005, ALT-004 |
| S-04 | FR-003, FR-004 | BR-005 |
| S-05 | FR-003, FR-005 | BR-004, ALT-003 |
| S-06 | FR-006 | ALT-003 |
| S-07 | FR-007 | 連携ライフサイクル（§9） |
| S-08 | FR-007 | BR-003 |
| S-09 | FR-008 | BR-005, R-007 |
| S-10 | FR-009 | ALT-005 |
| S-11 | 権限（§6） | AGENTS.md Core Rules |
| S-12 | FR-010 | BR-004 |
| S-13 | FR-005 | BR-004 |
| S-14 | FR-005 | BR-004 |
| S-15 | FR-003, FR-004 | BR-007, Q-005 |
| S-16 | FR-011 | BR-008, Q-002 |
| S-17 | FR-004 | BR-004 |

## 8. 非機能要件

| 分類 | 要件・目標値 | 検証方法 | 状態・根拠 |
| --- | --- | --- | --- |
| 性能・レイテンシ | 新規作成は WordPress への POST 1回（`/posts` または `/pages`）。更新は確認の `GET /wp/v2/{type}/{id}?context=edit` 1回のあと POST 1回（直列。`{type}` は保存済みの `wp_post_type`）。既定値取得は `session_combined_contents` 1行と、送信先が `posts` のときだけ `GET /wp/v2/categories`（`per_page=100`、`X-WP-TotalPages` に従い最大5ページ）。固定ページではカテゴリ取得をしない。WordPress 1リクエストの上限は既存の `REST_FETCH_TIMEOUT_MS`（60 秒）。送信アクションの予算は WordPress 待ち 60 秒に DB 更新を足した秒数。更新時は GET と POST で 60 秒が2回。`/analytics` は既存の `maxDuration = 800`（`app/analytics/page.tsx`）で足りる。`/chat` には同じ送信を載せる `app/chat/page.tsx` へ `export const maxDuration` を足し、60 秒の2回分より大きくする。新しい feature flag や停止テーブルは足さない（§13）。LLM は呼ばない | 実 WordPress で計測 | 案 |
| 可用性・信頼性 | 更新の失敗は再送で回復する（同じ ID）。作成の 5xx・タイムアウトは自動リトライも「再試行」も出さない（作成済みか分からず重複するため）。POST の `rest_route` 再送は JSON でない 403 / 404 のときだけ | S-05, S-07 | 案 |
| セキュリティ・プライバシー | 認証情報は `wordpress_settings` から Server Action 内でだけ読む。クライアントへ返すのは既定値（タイトル候補、見出し数、文字数、カテゴリ名と ID）と送信結果（`wpPostId` / `status` / `link`）だけ。サイト URL と認証情報は返さない。本文 HTML の防御は GrowMate 側だけが担う。`unfiltered_html` の根拠（確認日 2026-10-22。<https://wordpress.org/documentation/article/roles-and-capabilities/>。全文は §9）: "Allows user to post HTML markup or even JavaScript code in pages, posts, comments and widgets." 単一サイトでは Editor も持つ（Editor の能力一覧に "unfiltered_html (not with Multisite)"）。"Note: In WordPress Multisite, only Super Admins have the `unfiltered_html` capability." 解釈: 主体は管理者に限らない。コアの `wp_kses_post` が `<script>` を落とす保証は無い。エスケープとリンク先の制限は変えない。`marked` 18 は出力 HTML をサニタイズしない（README の警告。sanitize オプションは無い）。`markdownToWordPressHtml` は raw HTML トークンをエスケープしてテキストとして出し、リンクの href は `http:` / `https:` / `mailto:` と相対パスだけを通す。`<script>` と `javascript:` を単体テストで固定する | 単体テスト | 案 |
| 認証・認可 | `admin` / `paid`。Server Action で `hasPaidFeatureAccess` と行の所有者検証。§6 権限 | S-11 | 案 |
| 監査・ログ | 送信の成否と `wpPostId`・行 ID を `console.info` / `console.error` に残す（本文・認証情報は出さない）。専用テーブルは作らない | ログ確認 | 案（Non-goals） |
| 障害対応 | 更新の失敗と更新の 5xx は再送で対応する。作成の 5xx・タイムアウトは WordPress 側の投稿一覧をユーザーが確認する。作成成功・DB 更新失敗は R-002 | S-07, S-14 | 案 |
| バックアップ・復旧 | 対象外（WordPress 側のデータは WordPress の責務。GrowMate 側は `wp_post_status` 1列で、取込で再生成できる） | 該当なし | 対象外 |
| 運用・監視 | 対象外（MVP。失敗はユーザーに即時表示され、再送できる） | 該当なし | 対象外 |
| 拡張性・互換性 | WordPress 5.6 以降（Application Passwords 同梱）。WordPress.com は既存の OAuth（scope `global`）で `posts` 権限を含む | 公式ドキュメント（§9） | 確認済み |
| アクセシビリティ | ダイアログは shadcn `Dialog`（フォーカストラップ・Esc）。項目は `Label` と関連付け。一覧の操作ボタン（`size="sm"`）とチャットの「その他の操作」（`app/chat/components/StepActionBar.tsx` L380 の `size="sm"`。メニュー項目は既存の `DropdownMenuItem`）は既存の高さを写し、変えない。`src/components/ui/button.tsx` の `sm` は `h-8`、`lg` は `h-10` で、44px の size は無い。新規ダイアログの主操作だけ、既存の編集ダイアログの保存ボタン（`Button` の default。`src/components/AnalyticsTable.tsx` L1438〜L1450）に合わせる。44px を新規サイズとして要求しない | 手動確認 | 案 |
| コスト | WordPress API は無料。LLM 呼び出しなし | 該当なし | 確認済み |

### AI機能の追加観点

本機能は LLM を呼ばない（送る本文は既に生成済みの完成形）。したがって出力品質・禁止事項・モデル障害・トークン上限・レイテンシの各項目は対象外。人間の確認は BR-002（既定が下書き）で担保する。

## 9. データ・外部連携

### データ

- 作成・更新・削除するデータ:
  - `content_annotations` に `wp_post_status text null` と `wp_publish_claimed_at timestamptz null` を追加。CHECK `wp_post_status in ('draft', 'future', 'publish')`。送信成功時に `wp_post_id` / `wp_post_title` / `wp_post_status` / 既存の `wp_post_type` /（`publish` のときだけ）`canonical_url` を更新。`wp_post_type` は新列ではない（`20251103090000_extend_wordpress_content_types.sql`。`text not null default 'posts'`）。404 で紐づけを外すときも NULL にしない。`wp_categories` と `wp_category_names` は送信先が `posts` のときだけ更新する（選んだ ID と、取得した一覧から引いた名前。取込と同じ列を埋め、一覧の絞り込みに乗せる）。`pages` ではカテゴリを送らず、この2列も書き換えない
  - 既存の WordPress 取込（`src/server/services/wordpressImportService.ts` L272〜L289 の `data`）に `wp_post_status: 'publish'` を1項目足す。この `data` は更新（L286）と挿入（L289）の両方に使う。取込は `status=publish` の投稿だけを取るため常に `publish`
  - チャットから送るとき `content_annotations` 行が無ければ作る（`upsertContentAnnotationBySession` の既存経路）
- データの所有者: `content_annotations.user_id`
- 保持期間・削除条件: 行の削除に従う（既存どおり）
- 移行・既存データとの互換性:
  - 既存行は `wp_post_status = NULL` のまま。NULL の行は「取込由来または未送信」として扱い、バッジは出さない。`wp_post_id` ありかつ NULL の行に「WordPress に投稿」を出さない（取込由来の公開済み記事を本機能で上書きしない）。既存行の概数は数千〜1万行超（取込仕様の前提）で、バックフィルはしない（次回の日次取込で更新される行から順に `publish` が入る。入らなくても表示は変わらない）
  - 再設定・再連携は不要
- RLS・Service Role・ユーザー境界: SELECT は `content_annotations_select_own_or_owner`（`20260107000002_update_rls_policies.sql` L21〜L23。`get_accessible_user_ids` で本人と、オーナーなら従業員、従業員ならオーナーの行を読める）。INSERT / UPDATE / DELETE は本人の行だけ（`20260102000003_add_content_annotations_rls.sql` の `content_annotations_insert_own` / `update_own` / `delete_own`）。列追加のみでポリシー変更なし。Server Action は Service Role で読むため `user_id` を明示して絞る。従業員がオーナーの行を送信できるようにはしない（書き込みポリシーと同じく本人の行だけ）

### 外部連携

| 連携先 | 用途 | API・権限 | 失敗時の挙動 | 公式根拠 |
| --- | --- | --- | --- | --- |
| セルフホスト WordPress | 投稿または固定ページの作成・更新・更新前の確認 | `POST /wp/v2/{type}`、`POST /wp/v2/{type}/{id}`、`GET /wp/v2/{type}/{id}?context=edit`。`{type}` は `posts` または `pages`。Basic 認証（Application Passwords）。posts は `edit_posts`、pages は `edit_pages` を要求しうる。`publish_posts` が無いユーザーは投稿の下書き保存に限られる（公開・予約を `publish_posts` 側に置くのは解釈。`publish_pages` の節には同じ文が無い。不足は §6 の 403）。`context=edit` でなければ `status` が欠ける、とは書かない。`status` の schema は Context: `view`, `edit`。HTTPS 必須 | §6 エラー表 | 下記 |
| セルフホスト WordPress | カテゴリ一覧 | `GET /wp/v2/categories?per_page=100&orderby=name&order=asc`。`X-WP-TotalPages` まで最大5ページ | 未選択で続行（FR-009）。5ページを超えた分は出さない（R-004） | 下記 |
| WordPress.com | 同上 | 既存 `WordPressService.baseUrl`（`https://public-api.wordpress.com/wp/v2/sites/{site}`。保存済み site id）に `/posts` または `/pages` を付ける。サイト種別ごとのベース URL は新設しない。Bearer（既存 OAuth、scope `global`）。301 は POST の再送条件にしない | 同上（401 / 403 / 5xx。301 の再送はしない） | 下記（2026-10-22 追記、パスは 2026-10-23） |

#### 公式ドキュメント照合（2026-10-21 取得）

- WordPress REST API Reference: Posts <https://developer.wordpress.org/rest-api/reference/posts/>（Last modified: October 14, 2026）
  - 引用（Create a Post / Definition）: `POST /wp/v2/posts`
  - 引用（Update a Post / Definition）: `POST /wp/v2/posts/`（`id` 引数「Unique identifier for the post.」）
  - 引用（Schema `status`）: "A named status for the post. … One of: `publish`, `future`, `draft`, `pending`, `private`"
  - 引用（Schema `date_gmt`）: "The date the post was published, as GMT. JSON data type: string or null, Format: datetime"
  - 引用（Schema `link`）: "URL to the post. … Read only"
  - 引用（Schema `categories`）: "The terms assigned to the post in the category taxonomy. JSON data type: array"
  - 引用（Schema `excerpt`）: "The excerpt for the post. JSON data type: object"、（Schema `slug`）: "An alphanumeric identifier for the post unique to its type."
  - 解釈: 本書の `status` 3値、`date_gmt`、`categories`（ID 配列）、`slug` は公式の引数名と一致する。`excerpt` は公式にあるが本書では送らない（Non-goals）。`link` は読み取り専用なので、公開 URL はレスポンスから取る。`slug` は空なら送らず、空でなければそのまま載せる。文字種の拒否はしない（WordPress 側に任せる）。長さの上限を足すならタイトルと同じ 200 文字。確認日 2026-10-22。上の schema 文は文字種の説明で、上限は書いていない。更新前の確認は `GET /wp/v2/posts/{id}?context=edit` でよい。`context` の意味は次の Retrieve 引数。`future` のときに `date_gmt` が必須かどうか、および過去日時を渡したときに WordPress が `status` を書き換えるかどうかは、このページに記述が無い。**公式未記載・実機確認が必要**（R-003）
  - 引用（Retrieve a Post の引数 `context`。確認日 2026-10-22）: "Scope under which the request is made; determines fields present in response." / "Default: `view`" / "One of: `view`, `embed`, `edit`"
  - 引用（Schema `status` の Context。確認日 2026-10-22）: "Context: `view`, `edit`"
  - 解釈: `context=edit` でなければ `status` が欠ける、とは書かない。`status` は `view` と `edit` の両方の context に含まれる。権限は Global Parameters ではなく Roles and Capabilities に書く。
- WordPress REST API Reference: Pages <https://developer.wordpress.org/rest-api/reference/pages/>（Last modified: October 14, 2026。確認日 2026-10-23）
  - 引用（Create a Page / Definition）: `POST /wp/v2/pages`
  - 引用（Update a Page / Definition）: `POST /wp/v2/pages/`（引数 `id`「Unique identifier for the post.」）
  - 引用（Retrieve a Page / Definition）: `GET /wp/v2/pages/`
  - 引用（Schema `status`）: "A named status for the post." / "One of: `publish`, `future`, `draft`, `pending`, `private`" / "Context: `view`, `edit`"
  - 引用（Schema `date_gmt`）: "The date the post was published, as GMT."
  - 引用（Schema `parent`）: "The ID for the parent of the post." / "JSON data type: integer" / "Context: `view`, `edit`"
  - 引用（Schema `slug`）: "An alphanumeric identifier for the post unique to its type."
  - 引用（Retrieve a Page の引数 `context`）: "Scope under which the request is made; determines fields present in response." / "Default: `view`" / "One of: `view`, `embed`, `edit`"
  - 解釈: 固定ページの作成・更新・更新前の確認は Posts と同じ動詞で、パスだけ `pages` に替える。`status` の3値、`date_gmt`、`slug`、`context` は Posts と同じ読みでよい。このページの schema に `categories` は無い。カテゴリは送らず、取得もしない（BR-007）。`parent` は公式の引数だが本書では送らない。未指定の固定ページは最上位として作る（Non-goals）。`future` の日時必須と過去日時の扱いは Posts と同様、このページにも記述が無い（R-003）。WordPress.com へ送る URL は、既存 `baseUrl` に `/pages` を足したまま変えない。専用のベース URL は新設しない。サイト付きの `/pages`（`.../sites/{site}/pages`）は、下の Namespaces の引用からの解釈である（確認日 2026-10-23）。
- WordPress REST API Handbook: Authentication <https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/>（Last modified: October 14, 2026）
  - 引用: "As of 5.6, WordPress has shipped with Application Passwords, which can be generated from an Edit User page (wp-admin -> Users -> Edit User)."
  - 引用: "The credentials can be passed along to REST API requests served over https:// using Basic Auth / RFC 7617"
  - 解釈: 既存の `WordPressService.getAuthHeaders()`（Basic）と一致。HTTPS でないサイトでは Application Passwords が使えないため、連携時点で弾かれる（本書で新たに扱わない）
- WordPress REST API Handbook: Pagination <https://developer.wordpress.org/rest-api/using-the-rest-api/pagination/>（Last updated: October 14, 2026）
  - 引用: "`?per_page=`: specify the number of records to return in one request, specified as an integer from 1 to 100."
  - 引用: "Large queries can hurt site performance, so `per_page` is capped at 100 records. If you wish to retrieve more than 100 records, for example to build a client-side list of all available categories, you may make multiple API requests and combine the results within your application."
  - 引用: "`X-WP-TotalPages`: the total number of pages encompassing all available records"
  - 解釈: カテゴリは `per_page=100` で取り、レスポンスの `X-WP-TotalPages` まで繰り返す。上限は5ページ（500件）。6ページ目以降は取らず、欄の下に「先頭 500 件を表示しています」と出す（R-004）。Categories リファレンスの `per_page` 説明は "Default: 10" だけで上限の記載が無いため、上限は本ページを正とする
- WordPress REST API Reference: Categories <https://developer.wordpress.org/rest-api/reference/categories/>（Last modified: October 14, 2026）
  - 引用（List Categories / Definition）: `GET /wp/v2/categories`。引数 `per_page`: "Maximum number of items to be returned in result set. Default: 10"、`orderby`: "Default: name"
  - 解釈: 並びの既定は `name`。本書は `orderby=name&order=asc` を明示する。件数の上限は Pagination のページに従う
- WordPress.com OAuth2 <https://developer.wordpress.com/docs/oauth2/>（Last updated: January 22, 2026）
  - 引用（Available Scopes）: "posts: View and manage posts"、（Special Scopes）: "global: Grants comprehensive access to user data across all WordPress.com services and connected sites"
  - 解釈: 既存の OAuth 開始（`app/api/wordpress/oauth/start/route.ts` L57 `scope: 'global'`）は `global` の引用どおり包括アクセスで、投稿と固定ページの両方を含むと読む。`posts` スコープの引用は投稿の文言だけなので、固定ページ用のスコープ追加や再連携はしない

#### 公式ドキュメント照合の追記（確認日 2026-10-22）

引用と解釈は分ける。

- Global Parameters <https://developer.wordpress.org/rest-api/using-the-rest-api/global-parameters/>（Last updated: October 14, 2026）
  - このページの目次は `_fields` / `_embed` / `_method` / `_envelope` / `_jsonp` のみで、`context` は無い。`context` の根拠にはしない。
- Roles and Capabilities <https://wordpress.org/documentation/article/roles-and-capabilities/>（Last updated: September 2, 2026）
  - 引用: "Other REST API endpoints can perform their own capability checks. For example, endpoints dealing with posts or pages may require capabilities such as:" の箇条書きに "`edit_posts`" と "`edit_pages`"
  - 引用（`publish_posts`）: "See and use the “publish” button when editing their post (otherwise they can only save drafts)"
  - 引用（`edit_pages`。確認日 2026-10-23）: "Allows access to Administration Screens options: Pages Pages > Add New"
  - 引用（`publish_pages`。確認日 2026-10-23）: "Since 2.1"（この節に下書き制限の文は無い）
  - 引用（`unfiltered_html`）: "Allows user to post HTML markup or even JavaScript code in pages, posts, comments and widgets."
  - 引用: "Note: In WordPress Multisite, only Super Admins have the `unfiltered_html` capability."
  - 引用（Editor の能力一覧）: "unfiltered_html (not with Multisite)"
  - 解釈: posts のエンドポイントは `edit_posts`、pages のエンドポイントは `edit_pages` を要求しうる。`publish_posts` が無いユーザーは投稿の下書き保存に限られる。固定ページの公開・予約を `publish_pages` 側に置くのは `publish_posts` からの類推で、`publish_pages` の節には同じ文が無い。この権限と、`context=edit` の有無は別である。`unfiltered_html` は単一サイトの Editor も持つ。Multisite では Super Admin だけが持つ。主体は管理者に限らない。本文のエスケープとリンク先の制限は変えない（§8）。403 の文言は「WordPress のユーザーに投稿または固定ページの権限がありません」（§6）。
- WordPress.com REST API <https://developer.wordpress.com/docs/api/>（Last updated: October 07, 2025）
  - 引用: "Note that this API is also enabled on WordPress.com, but the URL structure on WordPress.com is slightly different than for self-hosted sites."
  - 解釈: このページはパスを定義しない。送信 URL の根拠にはしない。
- WordPress.com REST API Namespaces <https://developer.wordpress.com/docs/api/namespaces/>（Last updated: October 01, 2025。確認日 2026-10-23）
  - 引用: "The /wp/ namespace implements the official WordPress REST API specification, ensuring full compatibility with both WordPress.com and self-hosted WordPress sites."
  - 引用: "Base URL: `https://public-api.wordpress.com/wp/v2/`"
  - 引用（Key Features）: "Standard WordPress resources (posts, pages, comments, taxonomies, users, media)"
  - 引用（Example Endpoints）: "`/wp/v2/posts`"、"`/wp/v2/pages`"、"`/wp/v2/users`"、"`/wp/v2/media`"、"`/wp/v2/sites/{site}/posts`"
  - 解釈: public-api の `/wp/v2/sites/{site}/posts` はコア互換ネームスペースの例として実在する。比較表の「常にその1本」ではない。Example Endpoints に `/wp/v2/pages` がある。サイト付きの例は posts だけなので、`.../sites/{site}/pages` は、上の `/wp/` の互換の引用と `/wp/v2/pages` からの解釈である。送る URL は既存 `baseUrl` に `/pages` を足したままで、変えない。
- REST API URLs by Site Type <https://developer.wordpress.com/docs/rest-api-urls-by-site-type/>（Last updated: September 21, 2026）
  - 引用: "For these sites, you must use the WordPress.com public API proxy"
  - 引用: "The general URL format is: `https://public-api.wordpress.com/wp/v2/sites/<your-custom-domain.com>/`"
  - 引用（ホスティング有効）: "The general URL format is: `https://<your-custom-domain.com>/wp-json/`"
  - 引用: "any requests to this endpoint are automatically redirected with a `301 Moved Permanently` response to the corresponding endpoint on the site’s custom domain"
  - 解釈: カスタムドメインかつホスティング無し、の行だけが public-api を必須にしている。ホスティング有効サイトの推奨はカスタムドメインの `/wp-json/` で、`.wordpress.com/wp-json/wp/v2/posts` は 301 になる。本書の送信は既存クライアントの public-api（保存済み site id。`wordpressService.ts` L116 と L130）に載せ、サイト種別ごとのベース URL を新設しない（既存取込と同じ経路。MVP）。public-api の POST が失敗したときは §6 の 401 / 403 / 5xx に乗せ、301 を POST の再送条件にしない（R-006 と同じ。作成の重複を避ける）。

#### 連携ライフサイクル（失効・剥奪・切断）

- Application Password の失効・WordPress.com トークンの失効・`resolveWpComAccessToken` の `auth_expired`: 送信時の **401** で検知し、「WordPress との連携が切れています」と「再連携する」（`/setup/wordpress`）を出す（S-07）。既存の `getRestErrorMessage`（`wordpressService.ts` L191〜L193）は 401 と 403 を同じ `REST_API_ACCESS_DENIED` にまとめる。送信の分類はこの関数の文言を使わず、ステータスコードで 401 と 403 を分ける。保存済みの認証情報はこの機能からは消さない。日次取込が翌日に同じ 401 を受けて `wp_auto_import_status = 'auth_expired'` にし、ホームの「WordPress の再連携が必要です」（`src/lib/home-today.ts`）に出る。本機能で `wp_auto_import_status` を書き換えない（取込の状態を表す列であり、意味を混ぜない）
- ユーザーが WordPress 側で連携を解除した場合: 上と同じ 401 として現れる。検知手段は送信時のエラーだけ（WordPress からの通知は無い）
- 権限の縮小（Application Password のユーザーが投稿者から購読者に変わった等）: 403 で「WordPress のユーザーに投稿または固定ページの権限がありません」。再連携では直らないので、WordPress 側の権限確認を案内する
- 外部アカウント・サイト自体の削除: 404 / 5xx として現れる。取得済みの `content_annotations` は残す（取込と同じ扱い）。投稿 GET の 404 で紐づけを外すのは、JSON の `code` が `rest_post_invalid_id` のときだけ（S-14）
- 再連携後: 送信をやり直すだけでよい。欠けたデータの埋め戻しは無い（送信は都度操作のため）

## 10. 制約・前提・依存関係

### 技術前提

- 既存システム・ライブラリ・社内標準: Next.js App Router / Server Actions、Supabase（`SupabaseService` Service Role）、shadcn/ui、Sonner、`marked`（`package.json` 既存依存）
- 再利用する既存実装:
  - 再利用: `WordPressService`（認証ヘッダー、`baseUrl`）。`createPost` / `updatePost` / `fetchPost` / `fetchCategories` を同クラスに足す（`src/server/services/wordpressService.ts`）。GET 用の `fetchRestResource`（非 2xx の大半で再送する）と `getRestErrorMessage`（401 と 403 を同じ文言にする）は POST と送信のエラー分類には使わない（§6 冪等性、§9 連携ライフサイクル）
  - 再利用: 送信の直前に `resolveWpComAccessToken`（`src/server/services/wordpressContentSync.ts`）を通し、返ったトークンを `wpSettings.wpAccessToken` に載せる。そのあと `buildWordPressServiceFromSettings` を、`wpcom_oauth_token` を返さない cookie getter で呼ぶ（BR-006）。`resolveWordPressContext` にリクエスト cookie を渡して組み立てない
  - 再利用: `headingFlowService.getLatestCombinedContent(sessionId)`（`src/server/services/headingFlowService.ts`）で完成形を取る
  - 再利用: `upsertContentAnnotationBySession` / `updateContentAnnotationFields`（`src/server/actions/wordpress.actions.ts`）。送信成功時の `wp_post_status` 更新を足す。あわせて、URL が空のまま変わらず `wp_post_status` が `draft` / `future` の行では `wp_post_id` / `wp_post_title` / `wp_post_status` を消さない（BR-004、S-12。現状の空 URL 解決は L195〜L196、書き込みは L694〜L698）
  - 再利用: `diagnoseWordPressError`（`src/domain/errors/wordpress-error-diagnostics.ts`）と `ERROR_MESSAGES.WORDPRESS`（`src/domain/errors/error-messages.ts`）。投稿用のメッセージを追加
  - 再利用: `hasPaidFeatureAccess`（`src/types/user.ts`）と `ServerActionResult`（`src/lib/async-handler.ts`）
  - 再利用: `isWordPressLinked`（`src/lib/wordpress-link.ts`）は「ID か公開 URL がある」判定で、下書き（ID あり・URL なし）でも true になる。一覧の「WordPress に投稿」はこれの逆にしない。未送信（ID も URL も無い）でも出す。条件は §6 の状態遷移（`session_id` があり、`wp_post_id` が NULL、または `wp_post_status` が `draft` / `future`）。`AnalyticsTable.tsx` L1313〜L1315 の同名ローカル変数は編集ダイアログ向けで、ボタン条件には流用しない
  - 再利用: `extractHeadingsFromMarkdown`（`src/lib/heading-extractor.ts`）で「送る本文の概要」の見出し数、`countContentChars`（`src/lib/content-text.ts`）で文字数
  - 拡張: 日次取込の更新データに `wp_post_status: 'publish'`（`src/server/services/wordpressImportService.ts`）
  - 新規が必要: `markdownToWordPressHtml`（`src/lib/markdown-to-wordpress-html.ts`）。既存の `canvas-content.ts` は HTML → Markdown（読み込み方向）で、逆方向は無い。`marked` で見出し・段落・リスト・表・リンク・強調を HTML にし、raw HTML はエスケープする。リンク先は `http:` / `https:` / `mailto:` と相対パスに限る（§8）
  - 新規が必要: `WordPressPublishDialog`（`src/components/WordPressPublishDialog.tsx`）。同種の「外部サービスへ送る」ダイアログは無い（grep `DialogTitle` で「編集」「削除確認」「フィールド構成」のみ）
  - 採用しない: `axios`（`fetch` で足りる）、新しいジョブテーブル（送信は同期 1 リクエスト。ALT-001）

### 制約条件

- 納期・予算・人員: 未定
- 法令・契約・審査: なし
- 変更できない既存仕様: `content_annotations` の `unique (user_id, wp_post_id)`（重複の検知にも使う）。WordPress の投稿と固定ページは同じ `wp_posts` の ID 空間なので、タイプが違ってもこの一意制約で足りる。`(user_id, wp_post_id, wp_post_type)` の複合ユニークは足さない。日次取込の `status=publish` 前提
- 既知のずれ（本機能では直さない）: `supabase/migrations/20250902090000_create_content_annotations.sql` は `wp_post_id bigint not null` だが、`src/types/database.types.ts` は `number | null` で、現行コードは NULL を書く（`resolveCanonicalAndWpPostId` の空 URL）。S-14 も NULL に戻す。本機能の migration で NOT NULL を外す修正は混ぜない。実装時に本番の列が NULL を受け付けることを確認し、受け付けなければ別件で nullable にする。受け付けないまま S-14 を実装すると紐づけ解除が失敗する

### 依存関係

| 依存対象 | 前提条件 | 完了確認 | 未完了時の影響 |
| --- | --- | --- | --- |
| WordPress 連携（`/setup/wordpress`） | 既存。利用者が連携済み | 本番で稼働中 | 未連携ユーザーは「連携を開始」へ誘導 |
| ブログ作成フロー step7 の完成形保存 | 既存。`session_combined_contents` に `is_latest` 行 | 本番で稼働中 | 完成形が無い記事は送れない（S-08） |
| 日次 WordPress 取込（`wordpress-diff-import`） | 既存。公開後の URL 埋めに使う（FR-008）。管理画面での公開（`modified_gmt` が進む）は拾える。予約の自動公開は R-007 | 本番で稼働中 | 取込が止まっていると、管理画面で公開したあとも URL が空のまま残る。手動の一括インポートも同じ差分条件なら、漏れた予約公開は埋まらない |
| Instagram ブログ化 Phase 2 | 任意。先に出ていると本機能の価値が上がる | `docs/specs/instagram-high-engagement-blog-draft-spec.md` | 無くてもチャットで作った記事に使える |

## 11. トレードオフ判断

### ALT-001: 送信の実行方式

- 判断: 送信を同期の Server Action 1 回で行うか、ジョブテーブル + cron（Instagram ブログ化と同じ形）にするか
- 比較した案:
  - 案A: 同期の Server Action。ダイアログの送信 → WordPress POST → DB 更新 → 結果を返す
  - 案B: `wordpress_publish_jobs` テーブルに積み、cron が送る。進捗は一覧で見せ、完了をメールで知らせる
- 採用案: 案A
- 採用理由: 送信は WordPress への呼び出し（新規は POST 1 回、更新は GET と POST の直列。LLM なし）。通常は数秒で返り、待ちの上限は §8。ユーザーは結果をその場で知りたい（公開 URL を開いて確認する）。ジョブ化はテーブル・cron・メールが増え、MVP 方針に反する。一括は下書きの直列で、ジョブテーブルにはしない。初回はマウントしない（Q-002）
- 却下した案と理由: 案B。Q-001 は押したときだけ、Q-002 の一括は1件送信の直列で、どちらもジョブにしない
- 影響: 実装が小さい。送信アクションの予算は WordPress 待ち 60 秒に DB 更新を足した秒数。更新時は GET と POST の直列。`/analytics` は既存の `maxDuration = 800`（`app/analytics/page.tsx`）で足りる。`/chat` には同じ送信を載せる `app/chat/page.tsx` へ `export const maxDuration` を足し、60 秒の2回分より大きくする。新しい feature flag や停止テーブルは足さない（§13）。一括も同じ予算の中で直列に送り、超えそうなら残りを止める（BR-008）
- 将来変更する条件: 1回の一括が `maxDuration = 800` に常に当たり、直列では足りないと分かったとき
- 判断者・判断日: 起票者案（2026-10-21）

### ALT-002: 本文の変換形式

- 判断: Canvas の Markdown を WordPress にどの形で送るか
- 比較した案:
  - 案A: `marked` で HTML にし、`content` に素の HTML を入れる（WordPress 側では「クラシック」ブロック）
  - 案B: Gutenberg ブロック形式（`<!-- wp:heading -->` 等）に変換する
  - 案C: Markdown のまま送る（WordPress 側に Markdown プラグインが要る）
- 採用案: 案A
- 採用理由: `marked` は既存依存で新パッケージ不要。WordPress は素の HTML を表示・編集できる。既存の「ブログ記事取得」が HTML → Markdown（`htmlToMarkdownForCanvas`）で読み込む方向を持っており、往復の形が対になる
- 却下した案と理由: 案B は要素ごとの変換表と検証が要り、崩れたときの影響が本文全体。案C はサイト側の前提を増やす
- 影響: WordPress のブロックエディタでは「クラシック」ブロックとして表示され、利用者が「ブロックに変換」を押せばブロックになる。この点はダイアログに書かず、リリース時の案内に留める
- 将来変更する条件: 利用者から「ブロック単位で編集したい」が出たとき
- 判断者・判断日: 起票者案（2026-10-21）

### ALT-003: 送信状態の保存先

- 判断: 下書き・予約・公開を GrowMate 側でどう持つか
- 比較した案:
  - 案A: `content_annotations.wp_post_status` を1列足す。`wp_post_id` / `canonical_url` / `wp_post_title` は既存列を使う
  - 案B: 送信履歴テーブル（`wordpress_publish_logs`: 行 ID、`wp_post_id`、状態、送信日時、送った本文）を新設
  - 案C: 何も足さず `wp_post_id` の有無だけで判定
- 採用案: 案A
- 採用理由: 一覧で「下書き止まり」を見分ける（利用シナリオ3）と、再送信を更新に振り分ける（BR-004）には状態が1つ要る。1列で足りる。既存の取込・一覧・絞り込みが `content_annotations` を正本にしており、別テーブルは結合が増える
- 却下した案と理由: 案B は履歴の要件が無い（Non-goals）。案C は下書きと取込由来の公開済みを区別できず、再送信で公開済み記事を上書きする事故につながる
- 影響: migration 1 本。取込側に 1 項目追加
- 将来変更する条件: 送信履歴・元に戻すの要件が出たとき（`content-pdca-semi-auto-execution-spec.md` の修正ログと統合）
- 判断者・判断日: 起票者案（2026-10-21）

### ALT-004: 公開状態の選択肢

- 判断: MVP で「下書き」だけにするか、「公開」「予約」も出すか
- 比較した案:
  - 案A: 下書き・公開・予約の3択。未送信の既定は下書き。再送は現在の下書き / 予約と予約済み日時
  - 案B: 下書きだけ。公開は WordPress 側で行う
- 採用案: 案A
- 採用理由: マーケターの公開作業は「曜日・時刻を決めて予約する」が標準で、予約が無いと結局 WordPress 管理画面を開くことになり、画面またぎが残る。公開も同じ。安全側は既定値（下書き）と送信ボタンの文言（BR-002）で担保する
- 却下した案と理由: 案B。誤公開の防止にはなるが、目的「画面またぎ0回」を満たさない
- 影響: `date_gmt` の扱いと実機確認（R-003）が増える
- 将来変更する条件: 誤公開の報告が出たとき（公開の選択肢だけ外す）
- 判断者・判断日: 依頼者（2026-10-23、Q-003）。起票時の案Aを採った

### ALT-005: カテゴリの扱い

- 判断: カテゴリを選べるようにするか
- 比較した案:
  - 案A: WordPress からカテゴリ一覧を取り、複数選択。取得失敗でも送れる
  - 案B: カテゴリは送らない（WordPress 既定の「未分類」）
- 採用案: 案A
- 採用理由: 「未分類」のまま公開される記事は、マーケターがあとで必ず直す。既存の取込が `wp_categories` / `wp_category_names` を持ち、一覧の絞り込みに使っているので、送信時に埋めると一覧の整合も取れる
- 却下した案と理由: 案B。画面またぎが残る
- 影響: `GET /wp/v2/categories` 1 回とチェックボックス UI
- 将来変更する条件: なし
- 判断者・判断日: 起票者案（2026-10-21）

### ALT-006: コンテンツ一覧のボタン表示条件

- 判断: 「完成形があるか」を一覧の表示条件に含めるか
- 比較した案:
  - 案A: `session_id` と `wp_post_status` だけで出す。完成形の有無はダイアログを開いたときにサーバーが判定する（無ければ S-08 の表示）
  - 案B: 一覧の RPC `get_filtered_content_annotations` に「完成形あり」のフラグを足し、無い行にはボタンを出さない
- 採用案: 案A
- 採用理由: RPC 変更（`session_combined_contents` との結合）を避ける。完成形が無い行でボタンを押しても、理由が出るので迷わない。一覧では次の操作「チャットを開く」で `/chat?session={sessionId}&initialStep=step7` を開く。`/chat` 上ではそのボタンは出さない（§6）
- 却下した案と理由: 案B。RPC と `database.types.ts` の変更が増え、一覧の取得コストも増える
- 影響: step7 未到達の行にもボタンが出る
- 将来変更する条件: 「押したのに送れない」が多いと分かったとき
- 判断者・判断日: 起票者案（2026-10-21）

## 12. リスク・確認質問・未決定事項

### リスク

| ID | リスク | 発生条件・影響 | 対策 | 担当 | 状態 |
| --- | --- | --- | --- | --- | --- |
| R-001 | LLM が書いた本文を確認せずに公開してしまう | 公開状態で「公開」を選んだとき。誤情報の公開 | 既定を下書きにし、送信ボタンの文言を「公開する」に変える（BR-002） | 開発 | 対策済み（仕様） |
| R-002 | WordPress 作成成功・DB 更新失敗で、次の送信が新規作成になり WordPress に下書きが2件できる | DB 障害時。被害は余分な下書き1件（公開ではない） | `console.error` に `wpPostId` と行 ID を残す。ユーザーには「WordPress の投稿一覧を確認し、コンテンツの編集で WordPress 投稿 URL を入れてください」と出す（「再試行すれば同じ投稿を更新する」とは書かない。`wp_post_id` が残っていないため更新にならない）。送信前の WordPress 検索（slug 突合）は作らない | 開発 | 受容 |
| R-003 | 予約投稿で `date_gmt` の扱いが想定と違う（`future` で日時必須か、過去日時で `publish` に変わるか） | 実機でしか分からない。公式未記載 | 実装時にセルフホストと WordPress.com の両方で確認し、結果を §9 に追記。想定と違えばレスポンスの `status` を正としてトーストと `wp_post_status` に反映する | 開発 | 未着手 |
| R-004 | カテゴリが 500 件を超えるサイトで選択肢が足りない | `per_page=100` を最大5ページ | 5ページ（500件、名前順）まで取る。超えたら欄の下に「先頭 500 件を表示しています」と出す。不足の報告が出たら上限を上げる | 開発 | 受容 |
| R-005 | Markdown → HTML の変換で表・入れ子リストが崩れる | Canvas の完成形に表がある記事 | `marked` の GFM テーブル対応を有効にし、代表的な完成形で単体テスト。崩れは WordPress 側で直せる（下書き既定） | 開発 | 未着手 |
| R-006 | セルフホストの WAF が `POST /wp-json/` をブロックする。GET 用フォールバックを POST に流用すると 5xx の再送で投稿が重複する | Xserver 等。取込（GET）は通っても POST が 403。作成 POST の 5xx 再送 | POST は、1回目が JSON でない 403 / 404 のときだけ `index.php?rest_route=` に再送する。5xx・タイムアウト・JSON のエラーでは再送しない。それでも 403 なら「サイトのセキュリティ設定を確認してください」（§6） | 開発 | 対策済み（仕様） |
| R-007 | 予約投稿が WordPress 側で自動公開されても、日次取込が URL を埋めない | `modified_gmt` が進まず、`date_gmt` も取込基準より前（missed schedule を含む）。FR-008 が欠ける | 実装時にセルフホストと WordPress.com で、予約時刻を過ぎた投稿の `modified_gmt` が変わるかを見る。変わらなければ、取込で `wp_post_status = future` の行だけ、保存済みの `wp_post_type` で `GET /wp/v2/{type}/{id}` する補完を足す。手動の一括インポートは同じ差分条件なので、これの代わりにならない | 開発 | 未着手 |

### 確認質問

| ID | 確認質問 | 回答が必要な理由 | 回答者 | 期限 | 状態 | 回答 | 回答日 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Q-001 | 送信は常にユーザーが押す（BR-001）でよいか。それとも記事完成時・Instagram ブログ化完了時に自動で「下書き」として送るか | 人の承認点の位置がクライアント未確定（`client-vision-from-lark.md` §1.12.6）。自動送信にすると BR-001・ALT-001 と工数が変わる。起票者の推奨は「まず押す方式。自動化は下書き自動送信までを次の段で」 | 依頼者 | 2026-10-23 | 回答済み | 押したときだけ送る。入口はチャット（`/chat`）step7 の「その他の操作」と、コンテンツ一覧（`/analytics` ブログタブ）の行。完成時・Instagram 完了時の自動送信はしない | 2026-10-23 |
| Q-002 | コンテンツ一覧の一括送信（チェック → ツールバー）は MVP に入れるか。入れる場合は下書きのみに限るか | 一括を出すと誤公開の件数と工数が増える | 依頼者 | 2026-10-23 | 回答済み | MVP に含める。画面には出さない（定数 `false` でマウントしない。feature flag は作らない）。処理は下書きの投稿だけ。公開・予約・固定ページの一括はしない。定数を `true` にすればすぐ使える（BR-008） | 2026-10-23 |
| Q-003 | GrowMate から直接「公開」「予約」できてよいか。それとも下書きだけにして公開は WordPress 側で行うか | ALT-004。誤公開のリスク（R-001）と画面またぎの削減のどちらを取るか | 依頼者 | 2026-10-23 | 回答済み | 1件のダイアログは下書き・公開・予約の3択。未送信の既定は下書き。再送は現在の状態と予約済み日時（Q-008）。一括では公開も予約も送らない（Q-002） | 2026-10-23 |
| Q-004 | タイトルの既定値は「完成形の最初の `# ` 見出し → `wp_post_title` → `main_kw`」でよいか。「タイトル・説明文生成」の出力を自動で入れる要望はあるか | 生成結果はチャットのメッセージで構造化されていないため、自動で入れるには保存形式の変更が要る。要望が無ければ手入力（コピー）で進める | 依頼者 | 2026-10-23 | 回答済み | 見出し → `wp_post_title` まで。どちらも空なら空のままにし、送信はタイトル必須のため不可。`main_kw` はタイトルに使わない。「タイトル・説明文生成」の出力も入れない | 2026-10-23 |
| Q-005 | 送信先の投稿タイプは `posts`（投稿）固定でよいか | 取込は複数タイプを扱う。固定ページとカスタム投稿を全部出せば選択 UI と REST の分岐が増える | 依頼者 | 2026-10-23 | 回答済み | 投稿（`posts`）と固定ページ（`pages`）だけ。既定は投稿。作成後は変えない。同日の追認「投稿と固定ページだけにする」で、カスタム投稿タイプは出さない。添付・リビジョン・メニュー・カスタム CSS も対象外。固定ページの親は選ばない（最上位として作る） | 2026-10-23 |
| Q-006 | 送信対象ロールは `admin` / `paid` でよいか（`trial` に体験させる意図はないか） | AGENTS.md の既定。`trial` に出す場合は理由と承認が要る。`/analytics` は現状 `trial` が入れない | 依頼者 | 2026-10-23 | 回答済み | `admin` と `paid` だけ。`trial` には出さない。チャットはメニューを隠し、Server Action でも止める。WordPress.com 連携の保存が `admin` だけの既存制限は変えない | 2026-10-23 |
| Q-007 | 投稿ダイアログに抜粋（`excerpt`）を入れるか | 起票時は入れていた。SEO の説明文と誤解され、要件にも無いため Non-goals に移した。マーケターが WordPress 標準の抜粋を GrowMate から入れたいなら戻す | 依頼者 | 2026-10-23 | 回答済み | 入れない。抜粋は WordPress 側で付ける | 2026-10-23 |
| Q-008 | 送信 UI の公開済み表示・再送初期値・未連携と完成形なしの表示・完了トーストのリンクをどうするか | 状態別 UI とエラー表、受入条件をそろえるため | 依頼者 | 2026-10-23 | 回答済み | WordPress 側で公開済みなら DB を同期し、お知らせ（info）で表示。再送は現在の下書き / 予約と予約済み日時を初期値。未連携・完成形なしはフォームの上に Alert。完了トーストに WordPress へのリンク（URL）は付けない。OPEN-001 は決着 | 2026-10-23 |

### 未決定事項・決着済み事項

| ID | 論点・状態 | 判断・理由 | 決定日・決めるタイミング | 決める人 |
| --- | --- | --- | --- | --- |
| OPEN-001 | 決着済み: 完了トーストに WordPress へのリンク（URL）を付けない | 依頼者の決定。公開 URL・編集画面 URL のどちらもトーストには出さず、結果の文だけ表示する | 2026-10-23 に決着 | 依頼者 |
| OPEN-002 | 「ブロックに変換」の案内をダイアログに書くか | 初回だけ知ればよい情報で、毎回出すと補足が増える（`growmate-ui-ux` 足さない） | リリース時の案内文を書くとき | 開発 |
| OPEN-003 | `content-pdca-semi-auto-execution-spec.md` の `WordPressService.updatePost` と本書の `updatePost` の統合 | どちらが先に実装されるか未定。先に実装した側のシグネチャに合わせる | どちらかの `spec-to-pr` 着手時 | 開発 |
| OPEN-004 | 下書き・予約の行を AI 要約と「未要約」絞り込みの対象に含めるか | どちらも `wp_post_id` が正、または公開 URL がある、で「WordPress 連携済み」を見ている（`contentAnnotationSummaryService.ts` L143〜L146 のローカル `isWordPressLinked`、`20261013233000_narrow_get_filtered_content_annotations_working_set.sql` L123〜L124 の `or`）。下書きは ID があり URL が空なので要約対象に入る。本書の送信には妨げにならないので、直さず受容する | 要約の対象から下書きを外したいと分かったとき | 依頼者 |

## 13. テスト・リリース・ロールバック

### テスト方針

- 単体・統合・E2E・実画面確認:
  - 単体: `markdownToWordPressHtml`（見出し h1〜h4、段落、箇条書き・番号付き・入れ子、GFM 表、リンク、強調、コードブロック。raw HTML の `<script>` がテキストとしてエスケープされること。`javascript:` のリンクが落ちること。`https:` のリンクが残ること）。`WordPressService.createPost` / `updatePost` / `fetchPost` / `fetchCategories` のリクエスト組み立て（URL は `posts` と `pages` を引数で切り替える。`pages` では `categories` を載せず `fetchCategories` を呼ばない。メソッド・ヘッダー・ボディ）とエラー分類（401 と 403 を分ける、404、5xx、タイムアウト）。POST は JSON でない 403 / 404 のときだけ `rest_route` に再送し、5xx では再送しないこと。カテゴリは `X-WP-TotalPages` まで最大5ページ。Server Action の入力検証（Zod）、権限・所有者判定、更新前の `publish` 同期と、`code` が `rest_post_invalid_id` の 404 だけ紐づけ解除（それ以外の 404 は残す）。送信権は条件付き UPDATE が1件のときだけ作成する、`upsertContentAnnotationBySession` が空 URL でも `draft` / `future` の `wp_post_id` を消さないこと
  - 実画面: `/chat` step7 のメニューからの送信、`/analytics` の行からの送信、タイトル列のバッジと URL 列のリンク、エラー表示（未連携・401・完成形なし）
- Gherkinシナリオとの対応: S-01〜S-06・S-10・S-13・S-14・S-15 は実 WordPress（セルフホストと WordPress.com の両方）で手動確認。S-07・S-08・S-11・S-12・S-16・S-17 は単体テストと手動確認。S-16 の画面は「一括ボタンが出ない」こと。一括処理そのものは単体テスト。S-17 は送信権の条件付き UPDATE の単体テスト。S-09 は日次取込の手動実行で確認し、予約の自動公開は R-007 の結果を添える。予約の `scheduledAt` は、末尾 `Z` の文字列をサーバーがタイムゾーン変換しないことを単体テストする
- 外部API・失敗系・境界条件: タイトル 200 文字、予約日時が現在以前、カテゴリ 0 件・500 件超、完成形が空文字、WordPress 側で投稿が公開済み（S-13）、削除済み（S-14）、固定ページの下書き作成と作成後のタイプ固定（S-15）
- セキュリティ・権限・RLS: `trial` で Server Action を直接呼ぶと権限エラー。他ユーザーの `annotationId` を渡すと所有者エラー。認証情報とサイト URL がレスポンスに含まれない。`<script>` と `javascript:` の単体テスト
- 非機能要件の測定: 送信 1 回の所要時間を実 WordPress で計測し §8 を更新

### リリース方針

- リリース単位・段階展開: 1 PR。段階展開なし
- Feature Flag / allowlist: 作らない（AGENTS.md。壊れたときはボタンの非表示かデプロイ巻き戻しで止められる。誤った外部送信が「続く」構造ではない。送信は都度ユーザー操作）
- データベース変更の適用順序: migration（`wp_post_status` 追加）→ デプロイ。列追加のみで既存コードに影響しない
- 本番確認項目: 本番の自分のサイトで下書き送信 1 件 → WordPress に下書きがある → 一覧に「下書き」→ WordPress で公開 → 翌日の取込で URL が埋まる

### ロールバック方針

- アプリケーションの戻し方: デプロイを戻す。送信済みの WordPress 投稿はそのまま残る（WordPress 側で扱う）
- DB変更の戻し方・逆マイグレーション: `alter table content_annotations drop column wp_post_status;`。旧コードは列を参照しないので先に戻してもよい
- データ不整合時の復旧: `wp_post_status` が実態とずれた行は、日次取込（公開済みなら `publish` に更新）か、コンテンツの「編集」で WordPress 投稿 URL を入れ直す既存操作で直す
- ロールバック判断者: 開発リード

## 14. 実装手順・チェックポイント

### 手順

1. 要件定義（本ドキュメント）作成・レビュー
2. 確認質問 Q-001〜Q-007 は 2026-10-23 に書き戻した。回答反映後の spec-review は cycle 3 で通過した
3. 仕様レビュー通過（ステータス `approved`。2026-10-23。Cloud の spec-review ループ。`takt -w spec-review` のラン記録は無い）
4. 実装（`takt -w spec-to-pr`）。順序: migration と型 → `markdownToWordPressHtml` と単体テスト → `WordPressService` の 4 メソッド（`createPost` / `updatePost` / `fetchPost` / `fetchCategories`）と単体テスト → Server Action（1件と、一括下書き） → ダイアログ → チャットのメニュー項目 → 一覧のボタンとバッジ → 一括ボタンは実装しマウントしない → 登録情報の補足文 → 取込の `publish` 書き込み → `app/chat/page.tsx` の `maxDuration` → `ui-text.md`
5. 品質ゲート通過（`npm run verify`、`npm run verify:ui-text`）
6. PR作成・レビュー・マージ

### チェックポイント

| チェックポイント | 確認内容 | 確認者 | 状態 |
| --- | --- | --- | --- |
| 承認点の確定 | Q-001 は押したときだけ。Q-003 は下書き・公開・予約で未送信の既定は下書き。再送は現在の状態と予約済み日時（Q-008） | 依頼者 | 2026-10-23 に決定 |
| 見た目の正本 | §6 の対照表と ASCII。色・余白・部品は `growmate-ui-ux` の既存写し。別の見た目承認はしない | 依頼者 | 2026-10-23 に決定 |
| 予約投稿の実機挙動 | R-003 と R-007 の確認結果を §9 に追記 | 開発 | 未確認 |
| 実 WordPress での通し確認 | S-01・S-03・S-04・S-09・S-13・S-15 をセルフホストと WordPress.com で | 開発 → 依頼者 | 未確認 |

## 15. 完了条件

- Definition of Done（すべて満たして完了）:
  - S-01〜S-17 が通る（S-01〜S-06・S-09・S-10・S-13・S-14・S-15 は実 WordPress の記録付き。S-16 は一括ボタンが画面に無いことと、一括処理の単体テスト。S-17 は送信権の単体テスト）
  - `npm run verify` と `npm run verify:ui-text` が緑
  - `content_annotations.wp_post_status` の migration が適用され、`database.types.ts` が更新されている
  - `ui-text.md` に本書の用語が入っている
  - 本書 §9 に R-003 と R-007 の実機確認結果が追記され、ステータスが `implemented` になっている
- 検証方法・証跡（テスト結果・画面確認・ログ等）:
  - 単体テストの結果、実 WordPress の投稿一覧のスクリーンショット（下書き・予約・公開）、コンテンツ一覧のバッジと URL のスクリーンショット
- 完了確認者・確認日: 未定

## 16. レビュー記録・承認・変更履歴

### レビュー記録

| 回 | 日付 | 指摘件数（🔴 / 🟡 / 🟢） | 反映状況 | 残置合意した論点と理由 |
| --- | --- | --- | --- | --- |
| 0 | 2026-10-21 | 🔴 1 / 🟡 8 / 🟢 6。起票直後の読み合わせ（readonly。コードと公式ドキュメントの照合）。正式な `takt -w spec-review` でも `spec-audit` でもない | 本改訂で反映 | 正式レビューは回1に進んだ。OPEN-004（下書きが要約対象に入る）は受容 |
| 1 | 2026-10-22 | 🔴 0 / 🟡 6 / 🟢 4。正式 audit（`docs/plans/.workflow/wordpress-auto-publish-spec/review/02-audit.md`） | 本改訂で反映 | Q-001〜Q-007 は未回答のまま。回答が無いのでステータスは `draft`（`approved` にしない）。OPEN-004 の受容は維持。残置合意の 🟡 は無し |
| 2 | 2026-10-22 | 🔴 0 / 🟡 0 / 🟢 0。再監査（`02-audit-r2.md`）。判定 `approved_with_questions` | F-001〜F-010 は closed。finalize しない | Q-001〜Q-007 が未回答。回答を書き戻したあと spec-review ループを再実行する |
| 3 | 2026-10-23 | 🔴 0 / 🟡 2 / 🟢 3。audit（`02-audit-r3.md`）。判定 `needs_fix`。再確認（`02-audit-r3b.md`）は 🔴 0 / 🟡 0 / 🟢 0 で `approved` | F-011〜F-015 は反映済みで closed。finalize でステータスを `approved` にした | 残置合意の 🟡 は無し |

反映した指摘:

- 🔴 チャットの登録情報保存が、空の WordPress 投稿 URL で送信済み下書きの `wp_post_id` を消す（S-12）
- 🟡 更新前に `GET ?context=edit`。公開済みは同期のみ、削除済みは紐づけを外す（S-13、S-14）
- 🟡 予約の自動公開が日次取込の差分から漏れる（R-007）
- 🟡 作成 POST の 5xx は再試行も `rest_route` 再送もしない
- 🟡 `trial` は一覧に入れない。チャットのメニューと Server Action で止める（S-11）
- 🟡 チャットのメニュー項目は `StepActionBar.tsx` 内で共通化し、`eslint-suppressions.json` を増やさない
- 🟡 フォームは shadcn の `Label` / `Input`。`Select` は `WordPressSettingsForm.tsx`、カテゴリ行は `CategoryFilter.tsx` を正とする
- 🟡 本文 HTML は GrowMate 側でエスケープし、リンク先を制限する（`marked` はサニタイズしない。`unfiltered_html`。主体の範囲は回1で訂正）
- 🟢 SELECT はオーナーと従業員、書き込みは本人の行
- 🟢 WordPress.com は送信前にトークンを更新する。401 と 403 を分ける。連携保存は `admin` のみ
- 🟢 カテゴリは Pagination のページに従い、最大5ページ
- 🟢 抜粋と連携先表示は MVP から外す（Q-007）
- 🟢 バッジはタイトル列、URL は URL 列
- 🟢 下書き送信が AI 要約と未要約絞り込みに入ることは OPEN-004 として残す

#### 公式ドキュメント照合

- 実施
- 参照 URL と確認日: §9「公式ドキュメント照合（2026-10-21 取得）」のとおり（Posts / Authentication / Pagination / Categories / WordPress.com OAuth2）

回1で反映した指摘（F-001〜F-010）:

- F-001 🟡 WordPress.com の送信は既存 public-api。サイト種別ごとのベース URL は新設しない。301 は POST の再送条件にしない
- F-002 🟡 `context` は Posts の Retrieve 引数。権限は `edit_posts` と `publish_posts` に分ける。`context=edit` でなければ `status` が欠ける、とは書かない
- F-003 🟡 空 URL の補足文を2文に分ける。サーバー側の保持条件（BR-004 / S-12）は変えない。`ui-text.md` は実装時に追記する
- F-004 🟡 送信の予算は WordPress 待ち 60 秒に DB 更新を足した秒数。`/chat` のページに `maxDuration` を足す。停止機構は足さない
- F-005 🟡 一覧とチャットの操作は既存の `size="sm"` の高さのまま。ダイアログの主操作は編集ダイアログの保存ボタン（`Button` の default）。44px の新規サイズは要求しない
- F-006 🟡 一覧の「チャットを開く」は `/chat?session={sessionId}&initialStep=step7`。`/chat` 上では出さない
- F-007 🟢 `WordPressService` は 4 メソッド
- F-008 🟢 「WordPress 連携済み」は `wp_post_id` が正、または公開 URL がある。OPEN-004 の受容は維持
- F-009 🟢 `unfiltered_html` は単一サイトの Editor も持つ。Multisite では Super Admin だけ。エスケープとリンク先制限は変えない
- F-010 🟢 スラッグは空でなければそのまま送る。文字種の拒否はしない。長さの上限を足すなら 200 文字

#### 公式ドキュメント照合（回1）

- 実施（確認日 2026-10-22）
- 参照 URL: §9「公式ドキュメント照合の追記（確認日 2026-10-22）」（Global Parameters は `context` の根拠にしない / Roles and Capabilities / WordPress.com REST API / Namespaces / REST API URLs by Site Type）。Posts の `context` と `status` と `slug` は同じ Posts ページを 2026-10-22 に追記

#### 公式ドキュメント照合（Q-005、確認日 2026-10-23）

- 実施。cycle 2 の再監査ではない
- 参照 URL: Pages <https://developer.wordpress.org/rest-api/reference/pages/>（Last modified: October 14, 2026）。Roles and Capabilities の `edit_pages` と `publish_pages`（Last updated: September 2, 2026）。引用と解釈は §9

#### 公式ドキュメント照合（cycle 3、確認日 2026-10-23）

- 実施（`02-audit-r3.md`）
- 参照 URL: Namespaces <https://developer.wordpress.com/docs/api/namespaces/>（Last updated: October 01, 2025）。Example Endpoints と Key Features の引用、サイト付き `/pages` の解釈は §9。送る URL は変えていない

cycle 3 で反映した指摘（F-011〜F-015）:

- F-011 🟡 予約の `datetime-local` はブラウザの壁時計。末尾 `Z` の UTC ISO 8601 にしてから Server Action へ渡す。サーバーは解釈し直さない。トーストと比較は変換前の壁時計。`Asia/Tokyo` 固定の既存表示との差を1行
- F-012 🟡 一括の対象は未送信と `draft` だけ。`future`・`publish`・取込由来・固定ページとタイトル空はスキップ。予約を下書きに戻すのは1件ダイアログだけ。成功・スキップ理由・時間切れの残りを分ける
- F-013 🟢 ALT-001 の採用理由は、一括は下書きの直列でジョブにしない。初回はマウントしない（Q-002）
- F-014 🟢 Namespaces の Example Endpoints に `/wp/v2/pages` がある。サイト付き `/pages` は解釈。送る URL は変えない
- F-015 🟢 §2 の Q-001、R-001、§5 の工数注釈を、回答済みの事実にした。ID を明示した

### 承認

| 役割 | 氏名 | 判定 | 日付 | コメント |
| --- | --- | --- | --- | --- |
| 要件承認者 |  | 未承認 |  |  |
| 技術レビュー |  | 未承認 |  |  |

### 変更履歴

| 日付 | 変更内容 | 変更理由 | 変更者 |
| --- | --- | --- | --- |
| 2026-10-21 | 初版起票 | 依頼「ワードプレス自動投稿機能の仕様書を先に作る」 | 開発（Cursor Cloud Agent） |
| 2026-10-21 | 読み合わせの指摘を反映。更新前の実態確認、登録情報保存での ID 保持、作成失敗時の再送禁止、権限、HTML のエスケープ、カテゴリのページング、抜粋と連携先表示の対象外、R-007 | 起票直後のコード照合（§16 回 0）。正式 spec-review の前 | 開発（Cursor Cloud Agent） |
| 2026-10-22 | 正式 audit 回1（🔴 0 / 🟡 6 / 🟢 4）を反映。WordPress.com は既存 public-api、`context` と権限の分離、空 URL の補足文、`maxDuration`、44px を新規サイズにしない、チャット遷移先、4 メソッド、連携済み判定、`unfiltered_html` の主体、スラッグ | `02-audit.md` の F-001〜F-010。Q-001〜Q-007 は未回答のためステータスは `draft` | 開発（Cursor Cloud Agent） |
| 2026-10-22 | cycle 2 の再監査結果を記録。判定は `approved_with_questions`。本文の追加修正は無し | F-001〜F-010 は closed。未回答の Q があるため finalize しない | 開発（Cursor Cloud Agent） |
| 2026-10-23 | Q-005 を回答済みにした。送信先は投稿（`posts`）か固定ページ（`pages`）。既定は投稿。作成後は変えない。カテゴリは投稿だけ。親ページは送らない。カスタム投稿タイプと内部タイプは Non-goal。シナリオ S-15。Pages の公式引用を §9 に追加 | 依頼「投稿と固定選べるイメージ」（2026-10-23）。cycle 2 の判定は回答前のものなので、残りの Q を書き戻したあと spec-review を再実行する | 開発（Cursor Cloud Agent） |
| 2026-10-23 | Q-005 の回答を依頼者の明示に合わせた。送信先は投稿と固定ページだけ。カスタム投稿タイプは出さない | 依頼「投稿と固定ページだけにする」。前の行は会話の解釈。この行で対象外を確定した | 開発（Cursor Cloud Agent） |
| 2026-10-23 | Q-001、Q-002、Q-003 を回答済みにした。送信は押したときだけ（チャットと一覧）。1件は下書き・公開・予約で既定は下書き。一括下書きは実装し初回は画面に出さない。見積は 47 時間 | 依頼者の決定（2026-10-23）。「公開しない」は、画面に出さないことと、一括では公開・予約・固定ページを送らないことの両方として書いた | 開発（Cursor Cloud Agent） |
| 2026-10-23 | Q-004、Q-006、Q-007 を回答済みにした。タイトル既定は見出し → `wp_post_title` まで（`main_kw` は使わない）。ロールは `admin` / `paid`。抜粋欄は入れない。確認質問はこれで全部回答済み | 依頼「全部一番推奨度の高いものでOK。004は見出し → wp_post_title まで」 | 開発（Cursor Cloud Agent） |
| 2026-10-23 | cycle 3 の指摘（F-011〜F-015）を反映した。予約の壁時計、一括は未送信と `draft` だけ、ALT-001、Namespaces の `/pages`、回答済みの文。再監査はまだ。ステータスは `draft` | `02-audit-r3.md`。`approved` にしない | 開発（Cursor Cloud Agent） |
| 2026-10-23 | spec-review 通過。F-011〜F-015（予約の壁時計、一括対象から future を外す、ALT-001、Namespaces の pages 例、回答済み文の残存）は解消済み | 仕様レビュー | spec-review |
| 2026-10-23 | 見た目の実装前ゲートを外した。並びは §6 の ASCII と対照表。色・余白・部品は `growmate-ui-ux` の既存写し。別の見た目承認はしない | 依頼者の「OK」（2026-10-23）。スキルは既存を写す範囲だけを決め、未確認のチェックポイント行は `spec-to-pr` の入口を止めていた | 開発（Cursor Cloud Agent） |
| 2026-10-23 | 実施の枠を 5 人日（40 時間）にした。人の仮置き 47 時間（幅 47〜52）は残す。範囲は削らない | 依頼者「5日にする」（2026-10-23）。40 時間は、仕様を渡して実装し、実装側 42 時間を約 3 割減、検証 5 時間はそのまま、とした枠。手戻りで 40 時間を超える分と本番リリースは枠外 | 開発（Cursor Cloud Agent） |
| 2026-10-23 | PR #691 の未解決指摘を仕様へ反映。404 の解除は `rest_post_invalid_id` だけ。並行送信は `wp_publish_claimed_at` で1件に制限。WordPress.com は更新済みトークンを cookie より優先。予約のタイムゾーンは F-011 のまま | Codex と Bugbot のレビューコメント。工数の 47 時間と 5 人日の枠は変えない | 開発（Cursor Cloud Agent） |
| 2026-10-23 | 送信 UI の未決事項4点を反映。公開済みは DB 同期と info 表示、再送は現在の状態と予約済み日時を初期値、未連携・完成形なしはフォーム上の Alert、完了トーストはリンクなし。FR・状態別 UI・エラー表・S-01 / S-03 / S-04 / S-05 / S-07 / S-08 / S-13 を同期し、Q-008 を回答済み、OPEN-001 を決着済みにした | 依頼者の決定（2026-10-23） | 開発（Codex） |
