# WordPress 自動投稿（完成した記事を WordPress へ送る）仕様書

## メタデータ

- 文書名: WordPress 自動投稿（完成した記事を WordPress へ送る）
- ステータス: `draft`
- 作成日: 2026-10-21
- 最終更新日: 2026-10-21
- 作成者: 開発（Cursor Cloud Agent 起票）
- 承認者: 未定
- 対象リリース: 未定（「今後開発予定」として先に仕様化）
- 関連する依頼・Issue・PR: 2026-10-21 開発依頼「ワードプレス自動投稿機能を今後開発予定の為に先に仕様書を作りましょうか。コンテンツ一覧画面とチャット画面で自動投稿できるのが良さそう。UI/UX はマーケター思考も入れてね」（会話）。参考資料として依頼者から WordPress REST API への `POST /wp-json/wp/v2/posts` と Application Passwords の概説が共有された

## 現在地と次の一手

- 現在の工程: 仕様書ドラフト作成（Grill Me 未実施。依頼文・既存コード調査・WordPress 公式ドキュメント照合から起票）
- 止まっている理由・待っている人: §12 の確認質問 Q-001〜Q-006 が未回答（依頼者／クライアント）
- 次の一手: Q に回答をもらい本書へ書き戻す → `takt -w spec-review -t "docs/plans/wordpress-auto-publish-spec.md をレビューしてください"`
- 未確認事項: §12 確認質問のとおり。§12 リスク R-003（`future` の日時指定の実機挙動）は実装時に実 WordPress で確認する
- 関連ブランチ・PR: `cursor/wordpress-auto-publish-spec-f040`（仕様書のみ）
- 更新日・更新した工程: 2026-10-21 起票

## 0. 依頼時の参考資料との差分（先に読む）

依頼時に共有された参考資料は「Node.js プロジェクトをゼロから作り、Application Password を発行し、`axios` で `POST /wp-json/wp/v2/posts` を叩く」構成だった。GrowMate には同等の土台がすでにあるため、本書は**土台を作らず、投稿メソッドと UI を足す**設計にする。

| 参考資料の項目 | GrowMate の現状 | 本書の扱い |
| --- | --- | --- |
| Application Password の発行・保存 | `wordpress_settings.wp_username` / `wp_application_password`（セルフホスト）と WordPress.com OAuth トークン（`wp_access_token`）を `/setup/wordpress` で保存済み。`WordPressService.getAuthHeaders()` が Basic / Bearer を出し分ける（`src/server/services/wordpressService.ts`） | 再利用。新しい認証画面・保存先は作らない |
| HTTP クライアント（`axios`） | `fetch` と `rest_route` フォールバック（`WordPressService.fetchRestResource`）、`REST_FETCH_TIMEOUT_MS = 60_000` | 再利用。`axios` は入れない（最小実装ラダー 5） |
| `POST /wp/v2/posts` | 取得系（`findExistingContent` / `fetchRestCollection`）のみ。作成・更新は無い | **新規**: `WordPressService.createPost` / `updatePost` / `fetchCategories` |
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
| 管理者・承認者 | クライアント（カオルさん） | 「人の承認を残す箇所」（公開はユーザーが押すか、自動か）を決める（Q-001） |
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
  → ダイアログ: タイトル（自動入力・編集可）/ 公開状態（下書き・公開・予約）/ 公開日時 / カテゴリ / スラッグ / 抜粋
  → ［下書きとして送信］［公開する］［予約する］のいずれか1回
  → （自動）Canvas の完成形（Markdown）を HTML に変換し、WordPress へ POST
  → （自動）コンテンツ一覧の行に wp_post_id / タイトル / 公開状態を保存。公開なら URL も保存
  → コンテンツ一覧に「下書き」「予約」のバッジ、公開済みは従来どおり URL リンク
  → WordPress 側で下書きを公開した場合は、日次の WordPress 取込（既存）が URL を埋める
```

### 業務ルール

- ルール ID: BR-001（送信はユーザーが押したときだけ）
  - ルール: WordPress への送信は、ユーザーが［WordPress に投稿］を押し、ダイアログで送信ボタンを押したときだけ行う。記事の完成・Instagram ブログ化の完了・日次 cron をきっかけに自動で送らない（人の承認点。Q-001 で「完成時に自動で下書き送信」を採る場合はここを改める）。
  - 例外: なし。
- ルール ID: BR-002（既定は下書き）
  - ルール: 公開状態の既定値は「下書き」。「公開」「予約」はユーザーが選んだときだけ送る。送信ボタンの文言は選んだ公開状態に合わせて変える（§6 画面設計）。LLM が書いた本文を確認なしで公開する事故を、既定値で防ぐ。
  - 例外: なし。
- ルール ID: BR-003（送る本文は Canvas の最新の完成形）
  - ルール: 送る本文は `session_combined_contents` の `is_latest = true` の行（Canvas の step7 完成形）。チャットのメッセージ本文や見出し単体（`session_heading_sections`）からは組み立てない。完成形が無いセッションは送れない（「完成した記事がありません」）。
  - 例外: なし。Canvas で編集中の未保存内容は含めない（Canvas の保存で完成形が更新されてから送る）。
- ルール ID: BR-004（1記事1投稿。2回目以降は更新）
  - ルール: 1つのコンテンツ行（`content_annotations`）に対する WordPress 投稿は1件。行に `wp_post_id` が無ければ作成（`POST /wp/v2/posts`）、あれば更新（`POST /wp/v2/posts/{id}`）にする。同じ記事を2回送っても WordPress に重複投稿を作らない。
  - 例外: 行の `wp_post_status` が `publish`（公開済み）の場合、本機能からは更新しない（公開後の本文書き換えは `content-pdca-semi-auto-execution-spec.md` の範囲。公開済みの記事を Canvas の内容で上書きすると WordPress 側の手直しが消える）。WordPress 取込で入った行（`wp_post_status` が NULL で `wp_post_id` あり）も同じく対象外。
- ルール ID: BR-005（公開 URL は公開されてから保存する）
  - ルール: `canonical_url` は WordPress が返した `status` が `publish` のときだけ、レスポンスの `link` で保存する。`draft` / `future` のときは `canonical_url` を空のままにする（下書きの `link` は `?p=123` 形式の仮 URL で、公開時のパーマリンクと一致しない。GSC・GA4 の URL 突合を汚さない）。
  - 例外: なし。WordPress 側で公開されたあとの URL は、既存の日次 WordPress 取込（`src/server/lib/wordpress-diff-import.ts` → `importWordPressContent`）が `wp_post_id` 一致の行を更新して埋める（`src/server/services/wordpressImportService.ts` の `existingByPostId`）。
- ルール ID: BR-006（セルフホストと WordPress.com の両方に同じ操作）
  - ルール: `wordpress_settings.wp_type` が `self_hosted` でも `wordpress_com` でも同じダイアログ・同じ結果にする。差は `WordPressService` の `baseUrl` と認証ヘッダーだけに閉じる（既存の取込と同じ）。
  - 例外: なし。

## 4. 対象範囲と Non-goals

> **判断軸: GrowMate は MVP 開発を最優先とする**（`AGENTS.md` Core Rules）。要件に無い機能は入れない。作らないと決めたものは下の Non-goals に理由付きで書く。

### 対象範囲

- 画面・操作:
  - チャット画面（`/chat`）: step7 の「その他の操作」メニュー（`app/chat/components/StepActionBar.tsx`）に「WordPress に投稿」を追加し、投稿ダイアログを開く
  - コンテンツ一覧（`/analytics` ブログタブ）: 行の操作列（`src/components/AnalyticsTable.tsx` の `AnalyticsOpsCell`）に「WordPress に投稿」を追加し、同じ投稿ダイアログを開く。タイトル列に「下書き」「予約」のバッジを出す
  - 投稿ダイアログ（新規共通コンポーネント `src/components/WordPressPublishDialog.tsx`）: タイトル・公開状態・公開日時・カテゴリ・スラッグ・抜粋
- API・外部連携:
  - `WordPressService` に `createPost` / `updatePost` / `fetchCategories` を追加（`POST /wp/v2/posts`、`POST /wp/v2/posts/{id}`、`GET /wp/v2/categories`）
  - Server Action `src/server/actions/wordpressPublish.actions.ts`: 投稿の既定値取得、カテゴリ取得、送信
  - Markdown → HTML 変換の純関数 `src/lib/markdown-to-wordpress-html.ts`（既存依存 `marked` を使う）
- データ・DB:
  - `content_annotations.wp_post_status text null`（CHECK: `draft` / `future` / `publish`）を追加
  - 既存の日次 WordPress 取込が更新する行に `wp_post_status = 'publish'` を書く（取込は `status=publish` の投稿だけを取る）
- 権限・ロール: `admin` / `paid`。UI と Server Action の両方で判定（§6 権限）
- 運用・監視: 送信結果は Sonner トーストで返す。失敗は Server Action のエラーメッセージで原因と次の操作を返す。新しい監視・ログテーブルは作らない
- README: `🚀主な機能` の WordPress 連携の記述に「投稿」が増える可能性がある（最終判断は `spec-to-pr` の `readme_sync`）
- UI 用語: `.agents/skills/growmate-ui-ux/ui-text.md` に「WordPress に投稿」「下書き」「予約投稿」「公開」を追記する（§6 UI 用語）

### Non-goals（今回の対象外）

| 対象外にするもの | 対象外にする理由 | 将来検討する条件・時期 |
| --- | --- | --- |
| 記事完成時・Instagram ブログ化完了時の**自動送信**（ユーザーが押さない） | 人の承認点をどこに置くかがクライアント未確定（`client-vision-from-lark.md` §1.12.6「人の承認を残す箇所 未確定」）。既定を下書き送信にしても、WordPress 側に意図しない下書きが溜まる運用影響がある | Q-001 の回答。採る場合も「完成時に下書きとして自動送信」までにし、自動公開はしない |
| GrowMate 側の cron・node-cron・GitHub Actions による定期投稿 | 予約投稿は WordPress の `status: future` + `date_gmt` で WordPress 自身が公開する。GrowMate が投稿を保持して時刻に送る仕組みは二重管理になる | WordPress 以外の配信先ができたとき |
| CSV・スプレッドシート・RSS・外部 AI（OpenAI 等）からの記事取り込み | GrowMate の記事データ元はブログ作成フローの Canvas 完成形。外部データ元は要件に無い | 要件が出たとき |
| 複数行の一括送信（チェック → ツールバー） | 公開操作の一括実行は誤公開の被害が大きい。下書きの一括送信も、まず1件ずつの送信で「下書きが WordPress に溜まる運用」が受け入れられるかを見る | Q-002 の回答。採る場合は既存の一括操作（［評価サイクルを開始］［AIで要約］）と同じチェック → ツールバーの形にし、下書きだけに限る |
| アイキャッチ画像・本文中の画像のアップロード（`POST /wp/v2/media`） | Canvas の完成形はテキストと見出しで、画像を含まない。アップロードは multipart と失敗時の後始末が増える。アイキャッチは WordPress 側で付ける運用で成立する（利用シナリオ1） | 記事生成が画像を出すようになったとき |
| タグ（`tags`）の指定 | 要件に無い。カテゴリは既存の取込が `wp_categories` を持ち一覧の絞り込みにも使うが、タグは GrowMate 側に対応物が無い | 利用者の要望が出たとき |
| SEO プラグイン（Yoast 等）のメタディスクリプション・タイトルタグ | WordPress コアの REST に無く、プラグインごとに API が違う（`content-pdca-semi-auto-execution-spec.md` Non-goals と同じ判断）。本書の「抜粋」は WordPress 標準の `excerpt` | プラグインを1つに決められたとき |
| Gutenberg ブロック形式（`<!-- wp:paragraph -->`）への変換 | 素の HTML でも WordPress は「クラシック」ブロックとして表示・編集できる。ブロック変換は見出し・表・リストごとの対応が要り、崩れたときの被害が本文全体に及ぶ | 利用者から「ブロックで編集したい」が出たとき |
| 公開済み記事の本文更新・元に戻す | `content-pdca-semi-auto-execution-spec.md`（修正ログ・差分確認付き）の範囲。本書は未公開（下書き・予約）の更新までにする（BR-004） | 同仕様の実装時に統合を検討 |
| 固定ページ・カスタム投稿タイプへの投稿 | ブログ記事は `posts`。取込は複数タイプを扱うが、投稿先の選択は要件に無い | 要件が出たとき |
| 投稿ダイアログ内の本文プレビュー | 本文の確認は Canvas で済ませる前提（BR-003）。同じ本文を2か所で見せると「どちらが送られるか」で迷う（`growmate-ui-ux` 足さない・迷わせない） | なし |
| WordPress 認証情報の暗号化 | 既存の別計画 `docs/plans/oauth-credential-encryption-design.md` の範囲 | 同計画の実施時 |
| WordPress 側からの投稿削除・取り下げ | 要件に無い。削除は WordPress 管理画面で行う | なし |
| 送信履歴テーブル・監視ダッシュボード | MVP 方針。結果はトーストと `wp_post_status` で足りる。失敗は再送できる（BR-004 の冪等性） | 送信失敗の問い合わせが続いたとき |

## 5. 開発工数（概算）

### 前提

- 換算: 8時間 = 1人日
- 見積の状態: `仮置き`（2026-10-21 起票時。Q-001〜Q-006 の回答で変わる）
- 含めるもの: §4 対象範囲の実装、`WordPressService` の単体テスト、Markdown → HTML 変換の単体テスト、migration、UI 手動確認
- 含めないもの: 仕様レビュー往復、クライアント確認待ち、本番リリース作業、`spec-review` の図解 HTML

### 工数サマリー

| フェーズまたは区分 | 目的・主な成果物 | 工数（時間） | 人日 |
| --- | --- | ---: | ---: |
| DB・型 | `wp_post_status` の migration、`database.types.ts` / pending types、取込側の `publish` 書き込み | 3 | 0.4 |
| WordPress 呼び出し | `createPost` / `updatePost` / `fetchCategories`、エラー分類（401 / 403 / 404 / 5xx / タイムアウト）、WordPress.com と `rest_route` フォールバックの両対応、単体テスト | 8 | 1.0 |
| 本文変換 | `markdownToWordPressHtml`（見出し・段落・リスト・表・リンク・強調）、単体テスト | 4 | 0.5 |
| Server Action | 既定値取得、カテゴリ取得、送信（ロール・所有者検証、冪等性、`content_annotations` 更新） | 6 | 0.75 |
| UI | 投稿ダイアログ、チャットのメニュー項目、一覧の操作ボタンとバッジ、`ui-text.md` 追記 | 10 | 1.25 |
| 検証 | `npm run verify`、セルフホストと WordPress.com の実サイトで下書き・公開・予約の手動確認 | 5 | 0.6 |
| **合計** |  | **36** | **4.5** |

幅: 36〜44 時間。幅の理由: Q-002（一括送信）を採ると UI と Server Action に +6〜8 時間。R-003（予約投稿の実機挙動）で `date` / `date_gmt` の扱いを直す可能性。

### カレンダー上の前提（工数外）

- 仕様レビュー・承認の見込み: Q-001〜Q-006 の回答後に `spec-review` 1往復
- クライアント確認・たたき台合意の見込み: 投稿ダイアログの項目（§6）と Q-001 の承認点はクライアント確認が要る
- 希望リリース時期との関係: 未定。Instagram ブログ化（Phase 2）のリリース後に続けるのが自然（同機能の手作業の最終工程を埋めるため）

## 6. 機能要件

| ID | 機能要件 | 優先度 | 根拠・出典 | 受け入れ条件 |
| --- | --- | --- | --- | --- |
| FR-001 | チャット画面の step7 で「その他の操作」メニューから「WordPress に投稿」を選ぶと投稿ダイアログが開く | Must | 依頼文「チャット画面で自動投稿」 | S-01 |
| FR-002 | コンテンツ一覧の行（`session_id` あり、`wp_post_status` が NULL または `draft` / `future`、取込由来でない）の操作列に「WordPress に投稿」が出て、押すと同じ投稿ダイアログが開く | Must | 依頼文「コンテンツ一覧画面で自動投稿」 | S-02 |
| FR-003 | 投稿ダイアログで、タイトル（自動入力・必須）、公開状態（下書き・公開・予約。既定は下書き）、公開日時（予約のとき必須）、カテゴリ（複数選択・任意）、スラッグ（任意）、抜粋（任意）を指定できる | Must | 依頼文「UI/UX はマーケター思考」。公開作業の標準項目 | S-01, S-03 |
| FR-004 | 送信すると Canvas の完成形（Markdown）を HTML に変換し、WordPress に投稿を作成する。成功したら `content_annotations` に `wp_post_id` / `wp_post_title` / `wp_post_status` を保存し、`publish` のときは `canonical_url` も保存する | Must | 目的「URL の手入力が要らなくなる」 | S-01, S-03, S-04 |
| FR-005 | 送信済み（`draft` / `future`）の行で再度送信すると、新規作成ではなく同じ WordPress 投稿を更新する | Must | BR-004（重複投稿の防止） | S-05 |
| FR-006 | コンテンツ一覧のタイトル列に、`wp_post_status` が `draft` なら「下書き」、`future` なら「予約」のバッジを出す。`publish` は従来どおり URL リンクだけ | Must | 利用シナリオ3 | S-06 |
| FR-007 | WordPress 未連携、連携切れ（401）、権限不足（403）、サイト側障害（5xx・タイムアウト）、完成形なし、のそれぞれで原因と次の操作を表示し、`content_annotations` は変更しない | Must | 外部 API 依存機能の失敗時表示（`spec-review` C 観点） | S-07, S-08 |
| FR-008 | WordPress 側で下書き・予約が公開されたあと、既存の日次 WordPress 取込が同じ行の `canonical_url` / `wp_post_title` / `wp_post_status = 'publish'` を埋める | Must | BR-005 | S-09 |
| FR-009 | カテゴリ一覧の取得に失敗しても、カテゴリ未選択のまま送信できる（失敗理由を欄の下に表示） | Should | カテゴリは任意。取得失敗で投稿自体を止めない | S-10 |

### 入力・出力・状態遷移

- 入力値・形式・必須条件:
  - `annotationId`（UUID、必須。コンテンツ一覧から）または `sessionId`（チャットから。`content_annotations.session_id` で行を引く。行が無ければ `ensureAnnotationChatSession` 相当で作る）
  - `title`: 1〜200 文字、必須。既定値は完成形 Markdown の最初の `# ` 見出し、無ければ `wp_post_title`、無ければ `main_kw`
  - `status`: `draft` / `publish` / `future`。既定 `draft`
  - `scheduledAt`: `status = future` のとき必須。現在時刻より後。`datetime-local` で入力し、サーバーで UTC の ISO 8601 に変換して `date_gmt` に送る
  - `categoryIds`: 整数配列、任意。`fetchCategories` の結果に含まれる ID だけを通す
  - `slug`: 任意。空なら送らない（WordPress が生成）
  - `excerpt`: 任意、0〜300 文字
  - Zod スキーマは `src/server/actions/wordpressPublish.actions.ts` の近くに置き、Server Action の入口で検証する（`nextjs-server` 規約）
- 正常時の出力: `{ success: true, data: { wpPostId, status, link } }`。トースト「WordPress に下書きを送信しました」「WordPress で公開しました」「WordPress に予約しました（10/28 10:00）」と、`link` を開くリンク
- エラー時の出力（`ServerActionResult` の `error` と、ダイアログ内の表示）:

  | 原因 | ユーザー向け表示 | 次の操作 | DB |
  | --- | --- | --- | --- |
  | `wordpress_settings` 行なし | WordPress と連携していません | 「連携を開始」→ `/setup/wordpress` | 変更なし |
  | 完成形なし（`session_combined_contents` に `is_latest` 行が無い） | 完成した記事がありません。チャットで step7 の完成形を保存してください | 「チャットを開く」 | 変更なし |
  | 401（Application Password 失効・WordPress.com トークン失効） | WordPress との連携が切れています | 「再連携する」→ `/setup/wordpress` | 変更なし |
  | 403（ユーザーに `publish_posts` / `edit_posts` が無い、WAF） | WordPress のユーザーに投稿の権限がありません。WordPress の権限か、サイトのセキュリティ設定を確認してください | 閉じる | 変更なし |
  | 404（更新対象の投稿が WordPress 側で削除済み） | WordPress に投稿が見つかりません。新しい投稿として送るには、コンテンツの編集で WordPress 投稿 URL を空にしてください | 閉じる | 変更なし |
  | 5xx・タイムアウト（60 秒）・ネットワーク | WordPress が応答しませんでした。時間をおいて再度お試しください | 「再試行」 | 変更なし |
  | WordPress 成功、`content_annotations` 更新失敗 | WordPress には送信できましたが、コンテンツ一覧への反映に失敗しました。もう一度送信すると WordPress の同じ投稿を更新します | 「再試行」 | `console.error` に `wpPostId` と行 ID を出す。再試行時は `wp_post_id` が無いので新規作成になりうる（R-002 で扱う） |

- 状態と遷移条件（`content_annotations.wp_post_status`。行単位の状態機械）:

  ```text
  NULL（未送信。取込由来の行は wp_post_id ありで NULL のまま）
    --送信(draft)-->   draft
    --送信(future)-->  future
    --送信(publish)--> publish
  draft   --再送信(draft/future/publish)--> 選んだ状態（同じ wp_post_id を更新）
  future  --再送信(draft/future/publish)--> 選んだ状態（同じ wp_post_id を更新）
  draft / future --WordPress 側で公開 → 日次取込--> publish（canonical_url が埋まる）
  publish --本機能からは遷移しない（BR-004 例外）
  ```

  「WordPress に投稿」ボタンの表示条件は `session_id` あり、かつ（`wp_post_id` が NULL、または `wp_post_status` が `draft` / `future`）。`wp_post_id` ありで `wp_post_status` が NULL（取込由来）か `publish` の行には出さない。
- 冪等性・重複実行時の挙動:
  - 同じ行への送信は `wp_post_id` の有無で作成と更新を分ける（BR-004）。ダイアログの送信ボタンは送信中 disabled にし、二重送信を防ぐ（`growmate-ui-ux` 連打防止）。
  - 作成に成功して DB 更新に失敗したとき、次の送信は `wp_post_id` が無いので新規作成になり、WordPress に下書きが2件できる。発生頻度と被害（下書きが1件余る。公開は既定ではない）から、送信前に WordPress を検索して突合する仕組みは作らない（R-002）。

### 画面設計

#### UI 既存パターン対照表

| 今回の UI 要素 | 同種の既存 UI（`file:line`） | 採る方法 | 変える点と根拠 |
| --- | --- | --- | --- |
| チャット step7 のメニュー項目「WordPress に投稿」 | `app/chat/components/StepActionBar.tsx` の「その他の操作」`DropdownMenuItem`（「タイトル・説明文生成」「ブログ記事取得」。L390〜L422） | 写す（同じ `DropdownMenuItem` と `Loader2` の組み合わせ、`bg-white text-gray-900` の「ブログ記事取得」側のクラス） | アイコンは lucide `Send`。文言は本書の用語 |
| コンテンツ一覧の行ボタン「WordPress に投稿」 | `src/components/AnalyticsTable.tsx` の操作列ボタン群（「編集」L1375〜L1382、「詳細」L1457〜L1485。`variant="outline" size="sm" className="flex items-center gap-2"`） | 写す | アイコンは lucide `Send`。「編集」の右、「詳細」の左に置く。表示条件は本節の状態遷移どおり |
| コンテンツ一覧の「下書き」「予約」バッジ | `src/components/AnalyticsTable.tsx` の `<Badge variant="outline">サンプリング</Badge>`（L1579） | 写す | 文言のみ。タイトル列（`case 'wp_post_title'` L1683）のタイトルの右に置く |
| 投稿ダイアログの枠 | `src/components/AnalyticsTable.tsx` の「コンテンツ情報を編集」`Dialog`（L1364〜L1454。`DialogContent` / `DialogHeader` / `DialogFooter`、キャンセルと主操作の並び、送信中の `Loader2` + 「保存中...」） | 写す | 幅は `max-w-2xl`（編集ダイアログの `max-w-4xl` は項目数が多いため。本ダイアログは6項目） |
| フォーム項目（ラベル・入力・補足文） | `src/components/AnnotationFormFields.tsx` の「WordPress投稿URL（任意）」（L127〜L135。`Label` + `Input` + 補足の `p`） | 写す | なし |
| 公開状態の選択 | `src/components/ui/select.tsx`（shadcn `Select`）。既存の同種は `src/components/FieldConfigurator.tsx` 等 | そのまま使う | 3択なので `Select`。ラジオ部品は `src/components/ui/` に無いため新造しない |
| カテゴリの複数選択 | `src/components/CategoryFilter.tsx` の `StatusFilterOption`（チェックボックス行）と `src/components/ui/checkbox.tsx` | 共通化（`CategoryFilter.tsx` 内のチェックボックス行を export して使う） | 絞り込みではなく選択なので見出し「カテゴリ」。並びは WordPress の `name` 昇順 |
| 日時入力 | `<input type="datetime-local">`（最小実装ラダー 4。既存の `<input type="date">` は Instagram タブの期間入力） | 新規（grep `datetime-local` で既存なし） | 日付のみの `date` では予約時刻を指定できないため |
| 結果通知 | Sonner トースト（`src/components/ui/sonner.tsx`。既存の一括操作と同じ） | そのまま使う | なし |

#### 画面一覧

| 画面 | パス | 新規/既存 | 概要・変更点 |
| --- | --- | --- | --- |
| チャット | `/chat` | 既存 | step7 の「その他の操作」に「WordPress に投稿」を追加。投稿ダイアログを開く |
| コンテンツ一覧（ブログタブ） | `/analytics` | 既存 | 操作列に「WordPress に投稿」を追加。タイトル列に「下書き」「予約」バッジ |
| 投稿ダイアログ | （`/chat`・`/analytics` 上のモーダル） | 新規 | 公開状態・タイトル・カテゴリ等を指定して送信 |

#### 画面ごとの詳細

##### 投稿ダイアログ（`src/components/WordPressPublishDialog.tsx`）

- 概要: 記事1本を WordPress へ送る。開いた時点で既定値（タイトル候補・カテゴリ一覧・送る本文の概要）をサーバーから取る。
- レイアウト:

  ```text
  ┌ WordPress に投稿 ───────────────────────────────┐
  │ 送る本文: 見出し 8 本・約 4,200 文字（Canvas の最新の完成形）│
  │                                                 │
  │ タイトル            [ 自動入力されたタイトル            ] │
  │ 公開状態            [ 下書き ▼ ]（下書き / 公開 / 予約投稿）│
  │ 公開日時（予約のみ）  [ 2026-10-28T10:00 ]               │
  │ カテゴリ            ☐ お知らせ  ☐ コラム  ☑ 解体補助金    │
  │                     （取得できないときは「カテゴリを取得できませんでした。未選択のまま送信できます」）│
  │ スラッグ（任意）      [                              ] │
  │ 抜粋（任意）         [                              ] │
  │                     抜粋は WordPress の「抜粋」に入ります。SEO プラグインの説明文には入りません │
  │                                                 │
  │ WordPress との連携: セルフホスト https://example.com      │
  │                           [キャンセル] [下書きとして送信] │
  └─────────────────────────────────────────────────┘
  ```

- 項目定義:

  | 項目 | 型・形式 | 必須 | 初期値 | 表示条件・活性条件 |
  | --- | --- | --- | --- | --- |
  | 送る本文の概要 | テキスト（見出し数・文字数） | 表示のみ | サーバーの既定値取得で算出 | 常時。完成形が無いときはダイアログ本体の代わりにエラー表示（「完成した記事がありません」と「チャットを開く」） |
  | タイトル | `Input`、1〜200 文字 | 必須 | 完成形の最初の `# ` 見出し → `wp_post_title` → `main_kw` | 常時 |
  | 公開状態 | `Select`（下書き / 公開 / 予約投稿） | 必須 | 下書き | 常時 |
  | 公開日時 | `<input type="datetime-local">` | 予約投稿のとき必須 | 空 | 公開状態が「予約投稿」のときだけ表示。現在より前なら欄の下にエラー |
  | カテゴリ | チェックボックス群 | 任意 | 行の `wp_categories`（あれば）。無ければ未選択 | 取得成功時。失敗時は理由の文と未選択で続行 |
  | スラッグ | `Input` | 任意 | 空 | 常時 |
  | 抜粋 | `Textarea`、0〜300 文字 | 任意 | 行の `wp_excerpt`（あれば） | 常時 |
  | 連携先の表示 | テキスト（`wp_type` とサイト URL / サイト ID） | 表示のみ | `wordpress_settings` から | 常時。送り先を取り違えない判断材料 |
  | 送信ボタン | `Button` | 必須 | 文言は公開状態で変わる: 下書き→「下書きとして送信」、公開→「公開する」、予約投稿→「予約する」。更新（`wp_post_id` あり）のときは末尾に「（更新）」 | 送信中は disabled + `Loader2` + 「送信中...」 |

- 状態別UI:

  | 内部状態 | ユーザー向け表示 | 主操作 | 操作制限 |
  | --- | --- | --- | --- |
  | 既定値取得中 | skeleton と「読み込み中...」 | なし | 送信不可 |
  | WordPress 未連携 | 「WordPress と連携していません」 | 「連携を開始」（`/setup/wordpress`） | フォームを出さない |
  | 完成形なし | 「完成した記事がありません。チャットで step7 の完成形を保存してください」 | 「チャットを開く」 | フォームを出さない |
  | 入力中 | フォーム | 送信ボタン | タイトル空・予約日時不正では送信不可 |
  | 送信中 | 送信ボタンが「送信中...」 | なし | 全項目 disabled |
  | 成功 | ダイアログを閉じ、トースト（結果と `link`） | トーストのリンク | なし |
  | 失敗 | ダイアログ内上部に `Alert variant="destructive"`（編集ダイアログの「保存に失敗しました」と同形）で原因と次の操作 | 再試行 / 再連携 / 閉じる | 入力は保持 |

- 画面遷移: `/chat`（step7 その他の操作）→ 本ダイアログ / `/analytics`（行の「WordPress に投稿」）→ 本ダイアログ / 本ダイアログ（未連携）→ `/setup/wordpress` / 本ダイアログ（成功）→ 閉じて元画面（一覧は該当行を再取得してバッジと URL を更新）
- UI用語: `ui-text.md` に追記する語は次のとおり。「WordPress に投稿」（ボタン・メニュー。「投稿する」「公開」「送る」と揺らさない。`WordPress` の後ろに助詞が来るので半角スペースを入れる）、「下書き」「公開」「予約投稿」（公開状態の3択）、「下書きとして送信」「公開する」「予約する」（送信ボタン）、「予約」（一覧バッジ。「予約投稿」の短縮。列幅のため）。既存の「連携」「再連携」「送信中...」はそのまま使う。

##### `/chat`（既存。変更点のみ）

- 概要: step7 の「その他の操作」メニューに「WordPress に投稿」を追加する。
- 項目定義:

  | 項目 | 型・形式 | 必須 | 初期値 | 表示条件・活性条件 |
  | --- | --- | --- | --- | --- |
  | WordPress に投稿 | `DropdownMenuItem` | 該当なし | 該当なし | step7 のとき表示（「ブログ記事取得」と同じ `showLoadButton` 条件）。ロールが `admin` / `paid` 以外なら出さない。見出し生成中・チャット送信中は disabled（既存の `isDisabled || isHeadingFlowBusy` と同じ） |

- 画面遷移: メニュー選択 → 投稿ダイアログ。成功後はチャット画面に留まる（トーストに `link`）。

##### `/analytics`（既存。変更点のみ）

- 概要: 行の操作列に「WordPress に投稿」を追加し、タイトル列にバッジを出す。
- 項目定義:

  | 項目 | 型・形式 | 必須 | 初期値 | 表示条件・活性条件 |
  | --- | --- | --- | --- | --- |
  | WordPress に投稿 | `Button variant="outline" size="sm"` | 該当なし | 該当なし | 操作列展開時。`session_id` あり、かつ（`wp_post_id` NULL、または `wp_post_status` が `draft` / `future`）。ロールが `admin` / `paid` 以外なら出さない |
  | 下書き / 予約 バッジ | `Badge variant="outline"` | 該当なし | 該当なし | タイトル列。`wp_post_status` が `draft` → 「下書き」、`future` → 「予約」。`publish` / NULL は出さない |

- 画面遷移: ボタン → 投稿ダイアログ。成功後は該当行を再取得。

#### 誤読しやすい罠

- 「WordPress に投稿」は「WordPress で公開」ではない。既定は下書きで、公開は公開状態で「公開」を選んだときだけ。ボタン文言が「下書きとして送信」「公開する」「予約する」に変わるのはこのため。
- 取込由来の行（`wp_post_id` あり、`wp_post_status` NULL）とチャット由来で公開済みの行（`publish`）はどちらも「WordPress に投稿」が出ない。見た目は同じ「URL リンクあり」で、区別は不要。
- 下書き・予約の行は `canonical_url` が空のため、タイトル列はリンクにならずバッジだけ付く。GA4・GSC の数値が「—」なのは未公開だからで、取得失敗ではない。
- Canvas で編集したあと保存せずに「WordPress に投稿」を押すと、保存済みの完成形が送られる（BR-003）。ダイアログの「送る本文の概要」の文字数で気づける。

### 権限

新規機能の既定対象ロールは `admin` / `paid`。`trial` / `unavailable` は対象外。UI の出し分けに加え、Server Action の入口で `hasPaidFeatureAccess(role)`（`src/types/user.ts`）で判定し、対象外は `ERROR_MESSAGES` の権限エラーを返す。対象の `content_annotations` 行と `chat_sessions` が呼び出しユーザーの所有であることも Server Action で確認する（`SupabaseService` は Service Role のため RLS に頼らない。`supabase` skill 運用ルール）。

| ロール | 閲覧（バッジ・ボタン） | 作成・実行（送信） | 更新（再送信） | 削除・解除 |
| --- | --- | --- | --- | --- |
| admin | 可 | 可 | 可（`draft` / `future` のみ） | 対象外（WordPress 側で行う） |
| paid | 可 | 可 | 可（`draft` / `future` のみ） | 対象外 |
| trial | バッジのみ可（ボタンは出さない） | 不可 | 不可 | 対象外 |
| unavailable | 不可（画面自体に入れない） | 不可 | 不可 | 対象外 |

## 7. Gherkin受け入れ条件

```gherkin
Feature: 完成した記事を WordPress へ送る

  Rule: 送信はユーザーが押したときだけ行い、既定は下書きにする

  Scenario: S-01 チャットから下書きとして送る
    Given ロールが paid のユーザーが WordPress 連携済みである
    And チャットで step7 の完成形が保存されている
    When 「その他の操作」から「WordPress に投稿」を選び、公開状態を変えずに「下書きとして送信」を押す
    Then WordPress に下書きの投稿が1件できる
    And コンテンツ一覧の該当行に WordPress の投稿 ID とタイトルと「下書き」が記録され、公開 URL は空のままである
    And 「WordPress に下書きを送信しました」と表示される

  Scenario: S-02 コンテンツ一覧から送る
    Given ロールが paid のユーザーが WordPress 連携済みである
    And コンテンツ一覧に、チャットがあり WordPress に未送信の行がある
    When その行の「WordPress に投稿」を押す
    Then S-01 と同じ投稿ダイアログが開く

  Scenario: S-03 予約投稿する
    Given S-01 の前提
    When 公開状態で「予約投稿」を選び、未来の日時を入れ、カテゴリを1つ選んで「予約する」を押す
    Then WordPress に予約済みの投稿が、指定した日時と選んだカテゴリで1件できる
    And 該当行に「予約」が記録され、公開 URL は空のままである

  Scenario: S-04 公開する
    Given S-01 の前提
    When 公開状態で「公開」を選び「公開する」を押す
    Then WordPress に公開済みの投稿が1件できる
    And 該当行に公開 URL とタイトルと「公開」が記録される

  Scenario: S-05 送信済みの記事をもう一度送っても重複しない
    Given ある行が「下書き」として送信済みである
    When 同じ行から再度「WordPress に投稿」を開き「下書きとして送信（更新）」を押す
    Then WordPress の投稿は増えず、同じ投稿のタイトルと本文が更新される

  Scenario: S-06 一覧で下書き止まりの記事が分かる
    Given 「下書き」として送信済みの行と、公開済みの行がある
    When コンテンツ一覧を開く
    Then 下書きの行のタイトルの横に「下書き」が付き、公開済みの行には付かず URL リンクが出る

  Rule: 失敗したときは原因と次の操作を出し、コンテンツ一覧は変えない

  Scenario: S-07 連携が切れている
    Given WordPress の Application Password が WordPress 側で失効している
    When 「下書きとして送信」を押す
    Then 「WordPress との連携が切れています」と「再連携する」が表示される
    And コンテンツ一覧の行は変わらない

  Scenario: S-08 完成形が無い
    Given チャットが step6 までしか進んでいない
    When コンテンツ一覧の行から「WordPress に投稿」を押す
    Then 「完成した記事がありません」と「チャットを開く」が表示され、送信ボタンは出ない

  Scenario: S-09 WordPress 側で公開したら URL が埋まる
    Given 「下書き」として送信済みの行がある
    And ユーザーが WordPress 管理画面でその下書きを公開した
    When 日次の WordPress 取込が走る
    Then 該当行の公開 URL が埋まり、「下書き」の表示が消えて URL リンクになる

  Scenario: S-10 カテゴリが取れなくても送れる
    Given WordPress のカテゴリ一覧の取得が失敗する
    When 投稿ダイアログを開く
    Then カテゴリ欄に「カテゴリを取得できませんでした。未選択のまま送信できます」と出る
    And 「下書きとして送信」を押すとカテゴリ未指定で投稿ができる

  Scenario: S-11 trial ロールには出ない
    Given ロールが trial のユーザーである
    When チャットの step7 とコンテンツ一覧を開く
    Then 「WordPress に投稿」はどちらにも出ない
    And Server Action を直接呼んでも権限エラーになる
```

### シナリオ対応表

| シナリオ | 対応する機能要件 | 対応する決定事項 |
| --- | --- | --- |
| S-01 | FR-001, FR-003, FR-004 | BR-001, BR-002, BR-003, BR-005, ALT-001, ALT-002 |
| S-02 | FR-002 | ALT-006 |
| S-03 | FR-003, FR-004 | BR-005, ALT-004 |
| S-04 | FR-003, FR-004 | BR-005 |
| S-05 | FR-005 | BR-004, ALT-003 |
| S-06 | FR-006 | ALT-003 |
| S-07 | FR-007 | 連携ライフサイクル（§9） |
| S-08 | FR-007 | BR-003 |
| S-09 | FR-008 | BR-005 |
| S-10 | FR-009 | ALT-005 |
| S-11 | 権限（§6） | AGENTS.md Core Rules |

## 8. 非機能要件

| 分類 | 要件・目標値 | 検証方法 | 状態・根拠 |
| --- | --- | --- | --- |
| 性能・レイテンシ | 送信1回 = WordPress への POST 1回（更新時も1回）。既定値取得 = `session_combined_contents` 1行 + `GET /wp/v2/categories` 1回（`per_page=100`、1ページ）。WordPress 1リクエストの上限は既存の `REST_FETCH_TIMEOUT_MS`（60 秒）。LLM は呼ばない | 実 WordPress で計測 | 案 |
| 可用性・信頼性 | 失敗は再送で回復（BR-004）。自動リトライは入れない（WordPress 側で作成済みかの判定ができず、重複を生むため） | S-05, S-07 | 案 |
| セキュリティ・プライバシー | 認証情報は `wordpress_settings` から Server Action 内でだけ読む。クライアントへ返すのは `wp_type` とサイト URL / サイト ID だけ。送る本文はユーザー自身の記事。本文 HTML は WordPress 側の `kses` サニタイズに任せ、GrowMate 側は `marked` の出力に生 HTML を通さない設定にする | コードレビュー | 案 |
| 認証・認可 | `admin` / `paid`。Server Action で `hasPaidFeatureAccess` と行の所有者検証。§6 権限 | S-11 | 案 |
| 監査・ログ | 送信の成否と `wpPostId`・行 ID を `console.info` / `console.error` に残す（本文・認証情報は出さない）。専用テーブルは作らない | ログ確認 | 案（Non-goals） |
| 障害対応 | WordPress 側障害は再送で対応。作成成功・DB 更新失敗は R-002 | S-07 | 案 |
| バックアップ・復旧 | 対象外（WordPress 側のデータは WordPress の責務。GrowMate 側は `wp_post_status` 1列で、取込で再生成できる） | 該当なし | 対象外 |
| 運用・監視 | 対象外（MVP。失敗はユーザーに即時表示され、再送できる） | 該当なし | 対象外 |
| 拡張性・互換性 | WordPress 5.6 以降（Application Passwords 同梱）。WordPress.com は既存の OAuth（scope `global`）で `posts` 権限を含む | 公式ドキュメント（§9） | 確認済み |
| アクセシビリティ | ダイアログは shadcn `Dialog`（フォーカストラップ・Esc）。項目は `Label` と関連付け。ボタンは 44px タッチターゲット | 手動確認 | 案 |
| コスト | WordPress API は無料。LLM 呼び出しなし | 該当なし | 確認済み |

### AI機能の追加観点

本機能は LLM を呼ばない（送る本文は既に生成済みの完成形）。したがって出力品質・禁止事項・モデル障害・トークン上限・レイテンシの各項目は対象外。人間の確認は BR-002（既定が下書き）で担保する。

## 9. データ・外部連携

### データ

- 作成・更新・削除するデータ:
  - `content_annotations` に `wp_post_status text null` を追加。CHECK `wp_post_status in ('draft', 'future', 'publish')`。送信成功時に `wp_post_id` / `wp_post_title` / `wp_post_status` /（`publish` のときだけ）`canonical_url` を更新。`wp_categories` は送信時に選んだ ID を保存し、`wp_category_names` は取得したカテゴリ一覧から名前を引いて保存する（取込と同じ列を埋め、一覧の絞り込みに乗せる）
  - 既存の WordPress 取込（`src/server/services/wordpressImportService.ts` の `data`）に `wp_post_status: 'publish'` を1項目足す（取込は `status=publish` の投稿だけを取るため常に `publish`）
  - チャットから送るとき `content_annotations` 行が無ければ作る（`upsertContentAnnotationBySession` の既存経路）
- データの所有者: `content_annotations.user_id`
- 保持期間・削除条件: 行の削除に従う（既存どおり）
- 移行・既存データとの互換性:
  - 既存行は `wp_post_status = NULL` のまま。NULL の行は「取込由来または未送信」として扱い、バッジは出さない。`wp_post_id` ありかつ NULL の行に「WordPress に投稿」を出さない（取込由来の公開済み記事を本機能で上書きしない）。既存行の概数は数千〜1万行超（取込仕様の前提）で、バックフィルはしない（次回の日次取込で更新される行から順に `publish` が入る。入らなくても表示は変わらない）
  - 再設定・再連携は不要
- RLS・Service Role・ユーザー境界: `content_annotations` の現行ポリシーは本人の行だけ（`20260107000002_update_rls_policies.sql` 以降）。列追加のみでポリシー変更なし。Server Action は Service Role で読むため `user_id` を明示して絞る

### 外部連携

| 連携先 | 用途 | API・権限 | 失敗時の挙動 | 公式根拠 |
| --- | --- | --- | --- | --- |
| セルフホスト WordPress | 投稿の作成・更新 | `POST /wp/v2/posts`、`POST /wp/v2/posts/{id}`。Basic 認証（Application Passwords）。WordPress ユーザーに `publish_posts`（公開・予約）と `edit_posts`（下書き）の権限が要る。HTTPS 必須 | §6 エラー表 | 下記 |
| セルフホスト WordPress | カテゴリ一覧 | `GET /wp/v2/categories?per_page=100&orderby=name&order=asc` | 未選択で続行（FR-009） | 下記 |
| WordPress.com | 同上 | `https://public-api.wordpress.com/wp/v2/sites/{site}/posts`。Bearer（既存 OAuth、scope `global`） | 同上 | 下記 |

#### 公式ドキュメント照合（2026-10-21 取得）

- WordPress REST API Reference: Posts <https://developer.wordpress.org/rest-api/reference/posts/>（Last modified: October 14, 2026）
  - 引用（Create a Post / Definition）: `POST /wp/v2/posts`
  - 引用（Update a Post / Definition）: `POST /wp/v2/posts/`（`id` 引数「Unique identifier for the post.」）
  - 引用（Schema `status`）: "A named status for the post. … One of: `publish`, `future`, `draft`, `pending`, `private`"
  - 引用（Schema `date_gmt`）: "The date the post was published, as GMT. JSON data type: string or null, Format: datetime"
  - 引用（Schema `link`）: "URL to the post. … Read only"
  - 引用（Schema `categories`）: "The terms assigned to the post in the category taxonomy. JSON data type: array"
  - 引用（Schema `excerpt`）: "The excerpt for the post. JSON data type: object"、（Schema `slug`）: "An alphanumeric identifier for the post unique to its type."
  - 解釈: 本書の `status` 3値、`date_gmt`、`categories`（ID 配列）、`slug`、`excerpt` は公式の引数名と一致する。`link` は読み取り専用なので、公開 URL はレスポンスから取る。`future` のときに `date_gmt` が必須かどうか、および過去日時を渡したときに WordPress が `status` を書き換えるかどうかは、このページに記述が無い。**公式未記載・実機確認が必要**（R-003）
- WordPress REST API Handbook: Authentication <https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/>（Last modified: October 14, 2026）
  - 引用: "As of 5.6, WordPress has shipped with Application Passwords, which can be generated from an Edit User page (wp-admin -> Users -> Edit User)."
  - 引用: "The credentials can be passed along to REST API requests served over https:// using Basic Auth / RFC 7617"
  - 解釈: 既存の `WordPressService.getAuthHeaders()`（Basic）と一致。HTTPS でないサイトでは Application Passwords が使えないため、連携時点で弾かれる（本書で新たに扱わない）
- WordPress REST API Reference: Categories <https://developer.wordpress.org/rest-api/reference/categories/>（Last modified: October 14, 2026）
  - 引用（List Categories / Definition）: `GET /wp/v2/categories`。引数 `per_page`: "Maximum number of items to be returned in result set. Default: 10"、`orderby`: "Default: name"
  - 解釈: `per_page` の上限はこのページに明記が無い。既存の取込が `per_page` を 100 で運用している（`collectContentByTypes` の `Math.min(options.perPage ?? 100, 100)`）ので同じ 100 を使う。100 件を超えるカテゴリを持つサイトは2ページ目以降を取らず、先頭 100 件（名前順）だけを選択肢にする（R-004）
- WordPress.com OAuth2 <https://developer.wordpress.com/docs/oauth2/>（Last updated: January 22, 2026）
  - 引用（Available Scopes）: "posts: View and manage posts"、（Special Scopes）: "global: Grants comprehensive access to user data across all WordPress.com services and connected sites"
  - 解釈: 既存の OAuth 開始（`app/api/wordpress/oauth/start/route.ts` L57 `scope: 'global'`）で投稿権限を含む。スコープの追加や再連携は不要

#### 連携ライフサイクル（失効・剥奪・切断）

- Application Password の失効・WordPress.com トークンの失効: 送信時の 401 で検知し、「WordPress との連携が切れています」と「再連携する」（`/setup/wordpress`）を出す（S-07）。保存済みの認証情報はこの機能からは消さない。日次取込が翌日に同じ 401 を受けて `wp_auto_import_status = 'auth_expired'` にし、ホームの「WordPress の再連携が必要です」（`src/lib/home-today.ts`）に出る。本機能で `wp_auto_import_status` を書き換えない（取込の状態を表す列であり、意味を混ぜない）
- ユーザーが WordPress 側で連携を解除した場合: 上と同じ 401 として現れる。検知手段は送信時のエラーだけ（WordPress からの通知は無い）
- 権限の縮小（Application Password のユーザーが投稿者から購読者に変わった等）: 403 で「WordPress のユーザーに投稿の権限がありません」。再連携では直らないので、WordPress 側の権限確認を案内する
- 外部アカウント・サイト自体の削除: 404 / 5xx として現れる。取得済みの `content_annotations` は残す（取込と同じ扱い）
- 再連携後: 送信をやり直すだけでよい。欠けたデータの埋め戻しは無い（送信は都度操作のため）

## 10. 制約・前提・依存関係

### 技術前提

- 既存システム・ライブラリ・社内標準: Next.js App Router / Server Actions、Supabase（`SupabaseService` Service Role）、shadcn/ui、Sonner、`marked`（`package.json` 既存依存）
- 再利用する既存実装:
  - 再利用: `WordPressService`（認証ヘッダー、`baseUrl`、`fetchRestResource` の `rest_route` フォールバック、`getRestErrorMessage`）。`createPost` / `updatePost` / `fetchCategories` を同クラスに足す（`src/server/services/wordpressService.ts`）
  - 再利用: `buildWordPressServiceFromSettings` / `resolveWordPressContext`（`src/server/services/wordpressContext.ts`）で設定から `WordPressService` を組み立てる
  - 再利用: `headingFlowService.getLatestCombinedContent(sessionId)`（`src/server/services/headingFlowService.ts`）で完成形を取る
  - 再利用: `upsertContentAnnotationBySession` / `updateContentAnnotationFields`（`src/server/actions/wordpress.actions.ts`）の行更新。`wp_post_status` の更新を足す
  - 再利用: `diagnoseWordPressError`（`src/domain/errors/wordpress-error-diagnostics.ts`）と `ERROR_MESSAGES.WORDPRESS`（`src/domain/errors/error-messages.ts`）。投稿用のメッセージを追加
  - 再利用: `hasPaidFeatureAccess`（`src/types/user.ts`）
  - 再利用: `extractHeadingsFromMarkdown`（`src/lib/heading-extractor.ts`）で「送る本文の概要」の見出し数、`countContentChars`（`src/lib/content-text.ts`）で文字数
  - 拡張: 日次取込の更新データに `wp_post_status: 'publish'`（`src/server/services/wordpressImportService.ts`）
  - 新規が必要: `markdownToWordPressHtml`（`src/lib/markdown-to-wordpress-html.ts`）。既存の `canvas-content.ts` は HTML → Markdown（読み込み方向）で、逆方向は無い。`marked` で見出し・段落・リスト・表・リンク・強調を HTML にし、生 HTML ブロックは通さない
  - 新規が必要: `WordPressPublishDialog`（`src/components/WordPressPublishDialog.tsx`）。同種の「外部サービスへ送る」ダイアログは無い（grep `DialogTitle` で「編集」「削除確認」「フィールド構成」のみ）
  - 採用しない: `axios`（`fetch` で足りる）、新しいジョブテーブル（送信は同期 1 リクエスト。ALT-001）

### 制約条件

- 納期・予算・人員: 未定
- 法令・契約・審査: なし
- 変更できない既存仕様: `content_annotations` の `unique (user_id, wp_post_id)`（重複投稿の検知にも使う）。日次取込の `status=publish` 前提

### 依存関係

| 依存対象 | 前提条件 | 完了確認 | 未完了時の影響 |
| --- | --- | --- | --- |
| WordPress 連携（`/setup/wordpress`） | 既存。利用者が連携済み | 本番で稼働中 | 未連携ユーザーは「連携を開始」へ誘導 |
| ブログ作成フロー step7 の完成形保存 | 既存。`session_combined_contents` に `is_latest` 行 | 本番で稼働中 | 完成形が無い記事は送れない（S-08） |
| 日次 WordPress 取込（`wordpress-diff-import`） | 既存。公開後の URL 埋めに使う（FR-008） | 本番で稼働中 | 取込が止まっていると下書き → 公開後も URL が空のまま。手動の「WordPress 記事を一括インポート」でも埋まる |
| Instagram ブログ化 Phase 2 | 任意。先に出ていると本機能の価値が上がる | `docs/specs/instagram-high-engagement-blog-draft-spec.md` | 無くてもチャットで作った記事に使える |

## 11. トレードオフ判断

### ALT-001: 送信の実行方式

- 判断: 送信を同期の Server Action 1 回で行うか、ジョブテーブル + cron（Instagram ブログ化と同じ形）にするか
- 比較した案:
  - 案A: 同期の Server Action。ダイアログの送信 → WordPress POST → DB 更新 → 結果を返す
  - 案B: `wordpress_publish_jobs` テーブルに積み、cron が送る。進捗は一覧で見せ、完了をメールで知らせる
- 採用案: 案A
- 採用理由: 送信は WordPress への POST 1 回（LLM なし、数秒）。ユーザーは結果をその場で知りたい（公開 URL を開いて確認する）。ジョブ化はテーブル・cron・メールが増え、MVP 方針に反する。一括送信を採らない（Non-goals）ので長時間処理も無い
- 却下した案と理由: 案B。一括送信や完成時の自動送信（Q-001・Q-002）を採るときに初めて必要になる
- 影響: 実装が小さい。Vercel の Server Action 上限内（WordPress 60 秒タイムアウト）
- 将来変更する条件: Q-002 で一括送信を採り、1回の操作で 10 件以上を送るとき
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
  - 案A: 下書き・公開・予約の3択。既定は下書き
  - 案B: 下書きだけ。公開は WordPress 側で行う
- 採用案: 案A
- 採用理由: マーケターの公開作業は「曜日・時刻を決めて予約する」が標準で、予約が無いと結局 WordPress 管理画面を開くことになり、画面またぎが残る。公開も同じ。安全側は既定値（下書き）と送信ボタンの文言（BR-002）で担保する
- 却下した案と理由: 案B。誤公開の防止にはなるが、目的「画面またぎ0回」を満たさない
- 影響: `date_gmt` の扱いと実機確認（R-003）が増える
- 将来変更する条件: 誤公開の報告が出たとき（公開の選択肢だけ外す）
- 判断者・判断日: 起票者案（2026-10-21）。Q-003 で確認

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
- 採用理由: RPC 変更（`session_combined_contents` との結合）を避ける。完成形が無い行でボタンを押しても、理由と次の操作（チャットを開く）が出るので迷わない
- 却下した案と理由: 案B。RPC と `database.types.ts` の変更が増え、一覧の取得コストも増える
- 影響: step7 未到達の行にもボタンが出る
- 将来変更する条件: 「押したのに送れない」が多いと分かったとき
- 判断者・判断日: 起票者案（2026-10-21）

## 12. リスク・確認質問・未決定事項

### リスク

| ID | リスク | 発生条件・影響 | 対策 | 担当 | 状態 |
| --- | --- | --- | --- | --- | --- |
| R-001 | LLM が書いた本文を確認せずに公開してしまう | 公開状態で「公開」を選んだとき。誤情報の公開 | 既定を下書きにし、送信ボタンの文言を「公開する」に変える（BR-002）。Q-003 でクライアント確認 | 開発 | 対策済み（仕様） |
| R-002 | WordPress 作成成功・DB 更新失敗で、次の送信が新規作成になり WordPress に下書きが2件できる | DB 障害時。被害は余分な下書き1件（公開ではない） | `console.error` に `wpPostId` を残し、エラー文で「同じ投稿を更新する」と案内する。送信前の WordPress 検索（slug 突合）は作らない | 開発 | 受容 |
| R-003 | 予約投稿で `date_gmt` の扱いが想定と違う（`future` で日時必須か、過去日時で `publish` に変わるか） | 実機でしか分からない。公式未記載 | 実装時にセルフホストと WordPress.com の両方で確認し、結果を §9 に追記。想定と違えばレスポンスの `status` を正としてトーストと `wp_post_status` に反映する | 開発 | 未着手 |
| R-004 | カテゴリが 100 件を超えるサイトで選択肢が足りない | `per_page=100` の1ページだけ取る | 先頭 100 件（名前順）を出し、欄の下に「先頭 100 件を表示しています」と出す。不足の報告が出たら2ページ目を取る | 開発 | 受容 |
| R-005 | Markdown → HTML の変換で表・入れ子リストが崩れる | Canvas の完成形に表がある記事 | `marked` の GFM テーブル対応を有効にし、代表的な完成形で単体テスト。崩れは WordPress 側で直せる（下書き既定） | 開発 | 未着手 |
| R-006 | セルフホストの WAF が `POST /wp-json/` をブロックする | Xserver 等。取込（GET）は通っても POST が 403 | 既存の `rest_route` フォールバックを POST でも使う。それでも 403 なら「サイトのセキュリティ設定を確認してください」（§6 エラー表） | 開発 | 対策済み（仕様） |

### 確認質問

| ID | 確認質問 | 回答が必要な理由 | 回答者 | 期限 | 状態 | 回答 | 回答日 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Q-001 | 送信は常にユーザーが押す（BR-001）でよいか。それとも記事完成時・Instagram ブログ化完了時に自動で「下書き」として送るか | 人の承認点の位置がクライアント未確定（`client-vision-from-lark.md` §1.12.6）。自動送信にすると BR-001・ALT-001 と工数が変わる。起票者の推奨は「まず押す方式。自動化は下書き自動送信までを次の段で」 | クライアント（カオルさん）／依頼者 | spec-review 前 | 未回答 |  |  |
| Q-002 | コンテンツ一覧の一括送信（チェック → ツールバー）は MVP に入れるか。入れる場合は下書きのみに限るか | Non-goals に置いた。Instagram ブログ化で 10 件まとめて作る運用なら一括の下書き送信に価値がある。入れると +6〜8 時間 | 依頼者 | spec-review 前 | 未回答 |  |  |
| Q-003 | GrowMate から直接「公開」「予約」できてよいか。それとも下書きだけにして公開は WordPress 側で行うか | ALT-004。誤公開のリスク（R-001）と画面またぎの削減のどちらを取るか | クライアント（カオルさん） | spec-review 前 | 未回答 |  |  |
| Q-004 | タイトルの既定値は「完成形の最初の `# ` 見出し → `wp_post_title` → `main_kw`」でよいか。「タイトル・説明文生成」の出力を自動で入れる要望はあるか | 生成結果はチャットのメッセージで構造化されていないため、自動で入れるには保存形式の変更が要る。要望が無ければ手入力（コピー）で進める | 依頼者 | spec-review 前 | 未回答 |  |  |
| Q-005 | 送信先の投稿タイプは `posts`（投稿）固定でよいか | 取込は複数タイプを扱うが、ブログ記事の送信先は投稿が通常。固定ページ・カスタム投稿が要るなら選択 UI が増える | 依頼者 | spec-review 前 | 未回答 |  |  |
| Q-006 | 送信対象ロールは `admin` / `paid` でよいか（`trial` に体験させる意図はないか） | AGENTS.md の既定。`trial` に出す場合は理由と承認が要る | 依頼者 | spec-review 前 | 未回答 |  |  |

### 未決定事項（今は決めない）

| ID | 未決定事項 | 今決めない理由 | 決めるタイミング | 決める人 |
| --- | --- | --- | --- | --- |
| OPEN-001 | 成功トーストのリンク先を公開 URL（`link`）にするか、WordPress の編集画面（`/wp-admin/post.php?post={id}&action=edit`）にするか | 編集画面 URL は REST に無く、セルフホストと WordPress.com で形が違う。まず `link` で出し、下書きの `link`（仮 URL）が使いにくいと分かってから決める | リリース後、利用者の反応を見て | 依頼者 |
| OPEN-002 | 「ブロックに変換」の案内をダイアログに書くか | 初回だけ知ればよい情報で、毎回出すと補足が増える（`growmate-ui-ux` 足さない） | リリース時の案内文を書くとき | 開発 |
| OPEN-003 | `content-pdca-semi-auto-execution-spec.md` の `WordPressService.updatePost` と本書の `updatePost` の統合 | どちらが先に実装されるか未定。先に実装した側のシグネチャに合わせる | どちらかの `spec-to-pr` 着手時 | 開発 |

## 13. テスト・リリース・ロールバック

### テスト方針

- 単体・統合・E2E・実画面確認:
  - 単体: `markdownToWordPressHtml`（見出し h1〜h4、段落、箇条書き・番号付き・入れ子、GFM 表、リンク、強調、コードブロック、生 HTML が素通りしないこと）。`WordPressService.createPost` / `updatePost` / `fetchCategories` のリクエスト組み立て（URL・メソッド・ヘッダー・ボディ）とエラー分類（401 / 403 / 404 / 5xx / タイムアウト / `rest_route` フォールバック）を `fetch` モックで。Server Action の入力検証（Zod）と権限・所有者判定
  - 実画面: `/chat` step7 のメニューからの送信、`/analytics` の行からの送信、バッジ表示、エラー表示（未連携・401・完成形なし）
- Gherkinシナリオとの対応: S-01〜S-06・S-10 は実 WordPress（セルフホストと WordPress.com の両方）で手動確認。S-07・S-08・S-11 は単体テストと手動確認。S-09 は日次取込の手動実行で確認
- 外部API・失敗系・境界条件: タイトル 200 文字、抜粋 300 文字、予約日時が現在以前、カテゴリ 0 件・100 件超、完成形が空文字、WordPress 側で投稿が削除済み（404）
- セキュリティ・権限・RLS: `trial` で Server Action を直接呼ぶと権限エラー。他ユーザーの `annotationId` を渡すと所有者エラー。認証情報がレスポンスに含まれない
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
2. Q-001〜Q-006 の回答を本書へ書き戻す
3. 仕様レビュー通過（`takt -w spec-review`）
4. 実装（`takt -w spec-to-pr`）。順序: migration と型 → `markdownToWordPressHtml` と単体テスト → `WordPressService` の 3 メソッドと単体テスト → Server Action → ダイアログ → チャットのメニュー項目 → 一覧のボタンとバッジ → 取込の `publish` 書き込み → `ui-text.md`
5. 品質ゲート通過（`npm run verify`、`npm run verify:ui-text`）
6. PR作成・レビュー・マージ

### チェックポイント

| チェックポイント | 確認内容 | 確認者 | 状態 |
| --- | --- | --- | --- |
| 承認点の確定 | Q-001・Q-003（押す方式か自動か、公開・予約を出すか） | クライアント／依頼者 | 未確認 |
| ダイアログたたき台 | §6 のレイアウトと項目（追加・削除の有無） | 依頼者 | 未確認 |
| 予約投稿の実機挙動 | R-003 の確認結果を §9 に追記 | 開発 | 未確認 |
| 実 WordPress での通し確認 | S-01・S-03・S-04・S-09 をセルフホストと WordPress.com で | 開発 → 依頼者 | 未確認 |

## 15. 完了条件

- Definition of Done（すべて満たして完了）:
  - S-01〜S-11 が通る（S-01〜S-06・S-09・S-10 は実 WordPress の記録付き）
  - `npm run verify` と `npm run verify:ui-text` が緑
  - `content_annotations.wp_post_status` の migration が適用され、`database.types.ts` が更新されている
  - `ui-text.md` に本書の用語が入っている
  - 本書 §9 に R-003 の実機確認結果が追記され、ステータスが `implemented` になっている
- 検証方法・証跡（テスト結果・画面確認・ログ等）:
  - 単体テストの結果、実 WordPress の投稿一覧のスクリーンショット（下書き・予約・公開）、コンテンツ一覧のバッジと URL のスクリーンショット
- 完了確認者・確認日: 未定

## 16. レビュー記録・承認・変更履歴

### レビュー記録

| 回 | 日付 | 指摘件数（🔴 / 🟡 / 🟢） | 反映状況 | 残置合意した論点と理由 |
| --- | --- | --- | --- | --- |
| 0 | 2026-10-21 | 起票時セルフレビュー（Cloud Agent の `spec-audit` 相当）。結果は本節下の「起票時セルフレビュー」 | 全件反映 | なし |

#### 公式ドキュメント照合

- 実施
- 参照 URL と確認日: §9「公式ドキュメント照合（2026-10-21 取得）」のとおり（Posts / Authentication / Categories / WordPress.com OAuth2）

### 承認

| 役割 | 氏名 | 判定 | 日付 | コメント |
| --- | --- | --- | --- | --- |
| 要件承認者 |  | 未承認 |  |  |
| 技術レビュー |  | 未承認 |  |  |

### 変更履歴

| 日付 | 変更内容 | 変更理由 | 変更者 |
| --- | --- | --- | --- |
| 2026-10-21 | 初版起票 | 依頼「ワードプレス自動投稿機能の仕様書を先に作る」 | 開発（Cursor Cloud Agent） |
