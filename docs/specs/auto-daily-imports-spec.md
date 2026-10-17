# GSC・GA4・WordPress の毎日の自動取込

## メタデータ

- 文書名: GSC・GA4・WordPress の毎日の自動取込
- ステータス: `implemented`
- 作成日: 2026-10-13
- 最終更新日: 2026-10-17
- 作成者: shoma-endo（Claude Code で作成）
- 承認者: 未承認
- 対象リリース: 未定
- 関連する依頼・Issue・PR:
  - 依頼: 繁田薫さん（クライアント）から「手動で行っている各インポートを毎日決まった時刻に自動実行したい。事前にシステムの負荷を知りたい」。負荷見込みを返信したうえで、WordPress について「ありがとうございます。新しい記事コンテンツのみ取り込む、でお願いします。」と回答を得た（2026-10-13、Lark）。
  - 要件確認: `takt -w grill-to-gherkin` run `20261013-030146-gsc-ga4-wordpress-gsc-ga4-w`（`01-grill.md`〜`06-estimate-confirmation.md`）
  - 置き換える仕様: `docs/plans/ga4-sync-cron-spec.md`（ステータス `review`・未実装）。置き換える理由は ALT-001。
  - 関連 PR: #627（週次DB統計の Lark レポート。容量の増え方を毎週確認できる）、#630（takt を 0.70.0 に固定）

## 現在地と次の一手

- 現在の工程: `FR-011 本番反映済み・一部確認待ち`
- 止まっている理由・待っている人: shoma-endo（FR-011 のカードの文言と判定ルールの確認）
- 次の一手: FR-011 の文言と判定ルールを確認してもらう。本番に出ているのは PR #654・#656 の形（GA4 は「理由が付かない PERMISSION_DENIED」だけを権限切れにし、結果の記録をプロパティで絞らない）。§6 の今の判定ルールと「取込に使ったプロパティの行にだけ書く」は PR #657 の形で、develop → main のマージ待ち。本番で確かめたことと確かめていないことは次のとおり。
  - 確かめたこと（2026-10-17、PR #656 の本番反映後に手動で日次取込を起動）: DB の `gsc_credentials` に、GSC の権限切れの1人が `gsc_auto_import_status = permission_denied`、GSC・GA4 の取込に成功した利用者が `succeeded` で記録された。admin の `/` に、正常な連携では新しいカードが出ないこと（画面）。マイグレーション `20261017005449_add_google_auto_import_status.sql` の適用（ユーザー承認後、advisors の新しい指摘0件）
  - 確かめていないこと: 権限切れのカードが本番の画面に出ること（本人のアカウントでしか見られない。単体テストで代えている）。GA4 の権限切れ（本番でまだ一度も起きていない。判定は GA4 の実際の応答で確かめていない）
- 未確認事項: FR-011 のカードの文言（§6 画面設計）と、権限切れの判定ルール（§6 状態遷移）。どちらも Claude案・未確認。FR-012 のカードの文言はユーザー確認済み（2026-10-17）
- WordPress の未確認事項: WordPress の cron を1800秒にしてから初めての定時実行（2026-10-18 JST 04:45）で `batch_completed` が出て、残り0人になること。500件ずつの書き込みが失敗した原因（R-004）は、Supabase のログで確かめた（2026-10-17。DB の再起動と重なっていた）
- 関連ブランチ・PR: `feature/auto-daily-imports`、PR #636（実装済み）。FR-011 は `feat/google-property-access-denied-card`、PR #654・#656（本番反映済み）
- 更新日・更新した工程: 2026-10-17・FR-012（WordPress の取込が止まっているカード）を追加

## 1. 背景・目的・成功指標

### 背景・解決したい課題

- 現在、誰が、どの業務で困っているか:
  - GSC 日次指標（`/gsc-import`）、GA4 同期（`/setup/ga4` の同期ボタン）、WordPress 記事一括取込（`/wordpress-import`）は、どれも手動でしか動かない。
    - 例外 1：GSC は、記事の評価日を迎えた人の分だけ、毎時の `gsc-evaluate` が直前30日を取り込んでいる（`gscEvaluationService.ts:80-88`）。
    - 例外 2：GA4 は、`ga4-content-evaluate` が評価日を迎えた人の分だけ `syncUser` を呼んでいる。
  - 2026-08-21 の実測では、GA4 を連携した `paid` / `admin` 17人のうち15人の取込が止まっていた（`ga4-sync-cron-spec.md` §1）。
  - WordPress の一括取込は、毎回全記事（最大1,000件）を本文ごと取り直す。そのため、そのまま毎日動かすと、ユーザーさんの WordPress に毎日まとまったアクセスが発生する。
- 放置した場合の影響: ユーザーがボタンを押し続けない限り、ダッシュボードと評価の土台になるデータが古いまま残る。

### 目的

- この開発で実現する状態:
  - `paid` / `admin` のユーザーについて、GSC・GA4・WordPress のデータが、操作なしで毎朝更新される。
  - 連携が切れて止まったときは、本人がマイホームで気づける。
- 利用者・事業にとっての価値:
  - 手動で取り込む手間がなくなる。
  - 取込忘れによるデータの欠けや古さがなくなる。

### 成功指標

【仮置き・目標値は OPEN-004 で決める】依頼にも Grill にも成功指標は無いため、次を仮置きした。実装は目標値に左右されない。

| 指標 | 現状 | 目標 | 測定方法 | 測定時期 |
| --- | --- | --- | --- | --- |
| 毎朝の自動取込の成功率（取込元ごと） | 自動取込なし | 連携が正常な対象ユーザーの全員が、毎朝の起動で成功する（連携切れのユーザーは分母から除く。そのためには、1回の起動で対象者全員を処理できること＝OPEN-001 の制約） | 各 cron の `count-batch` 応答の `success` / `failed`、`cron_run_logs` | リリース後7日間 |
| 連携が正常な対象ユーザーの最新データ日 | 手動依存のため不揃い | GA4 は前日。GSC は起動時点の PT の当日（JST の前日と同じ日付。速報値を含む。FR-001） | `ga4_page_metrics_daily` / `gsc_page_metrics` のユーザーごとの最大 `date` | リリース後7日目 |

## 2. 利用者・関係者・利用シナリオ

| 区分 | 対象 | 期待すること・責任 |
| --- | --- | --- |
| 利用者 | `paid` / `admin` のうち、GSC・GA4・WordPress のいずれかを連携しているユーザー | 操作なしで毎朝データが更新される。連携が切れたら、マイホームの表示に従って再連携する |
| 運用担当 | 開発（shoma-endo） | 失敗を Vercel ログ・`cron_run_logs`・週次DB統計（#627）で確認する |
| 管理者・承認者 | PO（shoma-endo）、クライアント（繁田薫さん） | 対象範囲と取込方式を承認する |
| 外部サービス・連携先 | Google Search Console API、GA4 Data API、WordPress REST API（セルフホスト／WordPress.com） | 毎朝1回、ユーザーごとに問い合わせを受ける |

### 主な利用シナリオ

1. **paid のユーザー**が、**朝に GrowMate を開いた**とき、**前日までのデータがそろったダッシュボードと記事一覧を、取込の操作なしで見たい**。
2. **Google または WordPress の連携が切れたユーザー**が、**マイホーム（`/`）で、取込が止まっていることと再連携が必要なことを確認する**。

## 3. 業務要件と業務フロー

### 現状（As-Is）

```text
ユーザー → /gsc-import で期間を指定して取込
ユーザー → /setup/ga4 で同期ボタン（前回の続きから前日まで）
ユーザー → /wordpress-import で一括取込（毎回全記事を本文ごと取得）
（例外）評価日を迎えた記事がある人だけ、毎時の評価 cron が GSC・GA4 を取り込む
```

### 導入後（To-Be）

```text
JST 04:05 GSC cron     → paid/admin で GSC 連携済みの全員：PT の当日（＝JST の前日の日付）を含む直近3日分を、速報値込みで取り直して上書き
JST 04:25 GA4 cron     → paid/admin で GA4 連携済みの全員：カーソルを起点に直近3日分を含めて取り直して上書き
JST 04:45 WordPress cron → paid/admin で WordPress 連携済みの全員：前回の取込以降に公開・更新された記事だけ取込
                         （まだ一度も取り込んでいない人は全件）
連携切れ → マイホームに「再連携が必要です」カード → 再連携するとカードが消える
手動の一括取込（/wordpress-import）も差分取込になる
```

### 業務ルール

- BR-01: 自動取込の対象は `paid` / `admin` のみ（D-03）。`trial` / `unavailable` は対象外。
- BR-02: GSC・GA4 は、毎回直近3日分を取り直して上書きする（D-04）。同じ日のデータは1日分のまま。GSC の日付は PT 基準（FR-001）。
- BR-03: WordPress は、前回の取込より後に新しく公開された記事と更新された記事だけを取り込む（D-02）。「前回の取込」は、自動か手動かを区別しない（合意済みの解釈）。
  - 例外: 一度も取り込んでいないユーザーは、公開済みの記事をすべて取り込む（D-08）。
- BR-04: 取込をきっかけに、AI 要約・評価を自動で始めない（D-07）。
- BR-05: 起動時刻は、既存の定期実行の起動時刻と重ねない（D-06）。重なりは起動時刻だけで判定する。

## 4. 対象範囲と Non-goals

> **判断軸: GrowMate は MVP 開発を最優先とする**（`AGENTS.md` Core Rules）。

### 対象範囲

- 画面・操作:
  - マイホーム（`/`）に「WordPress の再連携が必要です」カードを追加する（D-09）。
    - これにより、`docs/specs/home-today-spec.md` の「本画面では WordPress を扱わない」（§10 リスク・§4 Non-goal）が変わる。実装の PR で、同仕様の該当箇所も更新する。
  - Google の再連携カードは、既存のものをそのまま使う（D-05）。
  - マイホームに「Google Search Console のプロパティにアクセスできません」「Google Analytics 4 のプロパティにアクセスできません」カードを足す（FR-011）。
  - `/wordpress-import` の手動一括取込を差分取込に変える（D-02）。画面の見た目は変えない。
- API・外部連携:
  - cron ルートを3本追加する：GSC、GA4、WordPress。
  - WordPress REST API の一覧取得に、差分の指定（`modified_after` と `after`）を足す（FR-003。Q-010 は回答済み）。
- データ・DB:
  - `wordpress_settings` に次の列を足すマイグレーションを作る。新しいテーブルは作らない。
    - 差分の基準（前回の取込日時）
    - 自動取込の結果（D-09 の判定に使う）
  - GSC・GA4 は既存の upsert をそのまま使い、取込のための列は足さない（ALT-003）。FR-011 の判定に使う結果の列だけを `gsc_credentials` に足す。
- 権限・ロール: 自動取込の対象一覧を作るクエリで、`paid` / `admin` に絞る（サーバー側）。
- 運用・監視: 既存の cron 観測（`cron-observability.ts`、`cron_run_logs`）と、手動実行用の workflow matrix に登録する。

### Non-goals（今回の対象外）

| 対象外にするもの | 理由 | 将来検討する条件・時期 |
| --- | --- | --- |
| 取り込んだ記事の AI 要約・評価の自動開始 | 合意済みの対象外（D-07）。API 費用が増える | クライアントから改めて要望が出たとき |
| 利用者向けの新しい通知（メール・Lark）、Kill Switch、監視ダッシュボード、専用のリトライ基盤 | 要件に無い（MVP 方針）。失敗は既存の Vercel ログ・`console.error`・`cron_run_logs` で確認できる。止めたいときは `vercel.json` から該当の1行を消す | 失敗に気づけない事故が実際に起きたとき |
| WordPress 側で削除・非公開になった記事の反映 | D-02 が求めるのは新規公開と更新だけ。今の一括取込も削除は反映していない（合意済み） | 削除記事が評価対象に残って困るとき |
| 手動の一括取込を実行できるロールの変更（今は `trial` も実行できる） | D-03 は自動取込の対象ロールの話（合意済み） | 手動導線の権限を見直すとき |
| GSC・GA4 の手動導線の期間・挙動の変更（`/gsc-import`、`/setup/ga4` の同期、`/ga4-dashboard` の「過去90日を再取込」） | 依頼に無い | — |
| GA4 の初回取込日数（`INITIAL_SYNC_DAYS = 30`）の変更 | 依頼に無い | — |
| Instagram・Google Ads の自動取込 | 依頼に無い | — |
| WordPress 5.7 未満のサイトで、差分取得によって WordPress へのアクセス量を減らすこと | `modified_after` は 5.7 で追加された（Q-010）。5.7 未満でこの指定がどう扱われるかは公式に記載が無い（R-008）。指定が無視されても、GrowMate 側で基準より後の記事だけを処理するので、取り込む結果は正しい（FR-003）。アクセス量が今の全件取得と同じになるだけ | 5.7 未満のユーザーから負荷の相談が来たとき |
| `/setup/*` に残る「再認証」を「再連携」へ直すこと | `home-today-spec.md` で既に範囲外。今回の依頼にも無い | 文言をまとめて直すとき |
| Google 側で権限を戻しただけのとき、FR-011 のカードをすぐ消すこと | 権限の回復は GrowMate の外で起きる。検知するには画面を開くたびに Google の API を呼ぶことになり、FR-011 の判定方法（保存した結果を読む）と合わない。翌朝の自動取込が成功すれば消える | 翌朝まで残ることへの問い合わせが来たとき |
| `docs/plans/ga4-sync-cron-spec.md` の実装 | 本仕様で置き換える（ALT-001）。旧仕様は毎時実行・GitHub Actions を前提にしていて、今回の毎日実行・Vercel Cron と合わない | — |

## 5. 開発工数（概算）

### 前提

- 換算: 8時間 = 1人日
- 見積の状態: `合意済み`（2026-10-13、`06-estimate-confirmation.md` で着手承認、shoma-endo。spec-review の反映後に見直し、同日 shoma-endo が承認）
- 含めるもの: 設計・実装・単体テスト・`npm run verify`・spec-review での照合・本番確認
- 含めないもの: spec-review の往復、PO・クライアントの確認待ち、本番で初回の起動を待つ日数

### 工数サマリー

| フェーズまたは区分 | 目的・主な成果物 | 工数（時間） | 人日 |
| --- | --- | ---: | ---: |
| 設計 | 本仕様書（EST-001） | 4〜8 | 0.5〜1.0 |
| 実装 | cron 3本・GA4・GSC・WordPress 差分・マイホーム表示（EST-002〜007） | 50〜90 | 6.25〜11.25 |
| テスト | `npm run verify`・全シナリオの照合（EST-008） | 4〜8 | 0.5〜1.0 |
| レビュー | spec-review での公式ドキュメント照合（EST-009） | 2〜6 | 0.25〜0.75 |
| リリース準備 | 本番での起動・表示の確認（EST-010） | 2〜6 | 0.25〜0.75 |
| **合計** |  | **62〜118** | **7.75〜14.75** |

- 着手承認時の概算は 7.25〜15.25人日。spec-review の反映後に、次の2点で見直した。
  - 増えた作業（FR-001・FR-003 に追加された分）
    - WordPress を `after` と `modified_after` の2通りで取って合わせる処理、GrowMate 側の絞り込み、本文も含めた上書き
    - 取込済み記事を range ページングで全件読む修正（GSC の突合用と WordPress 用）
    - GSC の PT 基準の日付・`dataState: "all"`・上限行数
    - WordPress の件数上限の撤廃
  - 減った不確実性
    - Q-010 が回答済みになり、`modified_after` が使えない環境向けの別方式が要らなくなった（EST-005 の上限側）。
    - D-09 の判定方法を B（取込の結果を保存）に決めた（EST-007 の上限側）。
- 幅の主な原因は EST-005。中心処理の切り出しの範囲（OPEN-003）しだいで変わる。

### 内訳

| 区分 | 内容 | 工数（人日） |
| --- | --- | ---: |
| EST-002 | cron 3本の登録（ルート・`vercel.json`・`CRON_CONFIGS`・workflow matrix・整合性テスト） | 0.5〜1.0 |
| EST-003 | GA4 自動同期（ロール絞り込み・3日分の取り直し・`count-batch` 化） | 0.75〜1.5 |
| EST-004 | GSC 自動取込（対象一覧の新設・ユーザーごとのループ・PT 基準の3日間・`dataState: "all"`・上限行数・`loadAnnotationUrlMap` の全件読み） | 1.25〜2.5 |
| EST-005 | WordPress 差分取込（中心処理の切り出し・マイグレーション・`after` / `modified_after` の取得と絞り込み・本文を含む上書き・件数上限の撤廃・取込済み記事の全件読み・手動も差分化・初回全件） | 2.75〜4.5 |
| EST-006 | マイホームの Google 再連携表示（既存の確認とテスト追加） | 0〜0.25 |
| EST-007 | マイホームの WordPress 再連携表示（D-09。取込の結果を保存して読む） | 1.0〜1.5 |

### カレンダー上の前提（工数外）

- 仕様レビュー・承認の見込み: spec-review で1〜2往復
- クライアント確認・たたき台合意の見込み: WordPress の差分取込は合意済み（2026-10-13）
- 希望リリース時期との関係: 未定。1人で稼働日2〜4週間の見込み

## 6. 機能要件

| ID | 機能要件 | 優先度 | 根拠・出典 | 受け入れ条件 |
| --- | --- | --- | --- | --- |
| FR-001 | GSC の日次指標を毎日 JST 04:05 に自動で取り込む。対象は `paid` / `admin` で GSC プロパティを設定済みのユーザー。直近3日分を取り直し、既存の値を上書きする。<br>・**日付は PT 基準**（Search Console API の日付は PT）。終了日は起動時点の PT の当日、開始日はその2日前。UTC 19:05 の起動時点では、PT の当日は JST の前日と同じ日付になる。<br>・**`dataState: "all"` を指定**し、確定前の速報値も取る（指定しないと確定済みのデータしか返らず、終了日付近の日が取り込まれない）。ページ指標・クエリ指標の両方の取得に付ける。<br>・**ページ指標の `maxRows` は 25,000**（公式の上限）。上限に達した（`pageMetricsHitLimit`）ら `console.error` に userId と期間を出す。<br>・`dataState` と `maxRows` は自動取込が渡すときだけ効く。手動の `/gsc-import` と `gsc-evaluate` の取得は変えない（Non-goal）。<br>・**記事との突合**：指標の行を記事に結び付けるための取込済み記事の読み込み（`gscImportService.ts` の `loadAnnotationUrlMap`）を、range ページングで全件読む形にする（`db-max-rows` 1,000 で切れるため。§9 データ）。共通の関数を1か所で直すので、手動の `/gsc-import` と `gsc-evaluate` にも効く。これは取りこぼしの修正で、期間・取得の挙動は変えないので、上の Non-goal と矛盾しない | Must | D-01 / D-03 / D-04 / D-06、ALT-003 | §7 の「毎日の実行時刻になると…」「ロールが…」「直近3日分の値が…」「重複して保存されない」 |
| FR-002 | GA4 を毎日 JST 04:25 に自動で同期する。対象は `paid` / `admin` で GA4 プロパティを設定済みのユーザー。取得の開始日は「カーソルの翌日」と「前日の2日前」の早い方、終了日は前日とする。こうして直近3日分を取り直し、上書きする。<br>・カーソルが無い（まだ一度も同期していない）ユーザーは、既定の初回取込日数（`INITIAL_SYNC_DAYS` = 30日）と同じ範囲を取る。直近3日だけを取ってカーソルを進めると、残りの日を二度と取れなくなるため。<br>・この開始日の計算は、自動取込が `syncUser` に渡すオプションにだけ効く。`resolveGa4SyncRange` の既定の計算は変えない（手動同期 `/api/ga4/sync` と、`ga4-content-evaluate` が呼ぶ `syncUser(userId)` の取込範囲は今のまま。Non-goal）。<br>・1回の起動で対象者全員を処理する（人数の上限で打ち切らない。OPEN-001） | Must | D-01 / D-03 / D-04 / D-06、ALT-003、初回の扱いは PR #636 の PC-1 | 同上（GA4） |
| FR-003 | WordPress の記事を毎日 JST 04:45 に自動で取り込む。対象は `paid` / `admin` で WordPress を連携済みのユーザー。前回の取込より後に公開・更新された記事だけを取り込み、既存の記事は内容を置き換える。<br>・**取得**：差分の基準（§9）を UTC のオフセット付き ISO8601 にして、`modified_after`（更新）と `after`（公開）の2通りで一覧を取り、合わせて重複を除く。`after` も使うのは、予約投稿が公開されるときは更新日時が変わらず、`modified_after` だけでは拾えないため（§9 外部連携の公式根拠）。<br>・**GrowMate 側の絞り込み**：取得した記事のうち、`modified_gmt` か `date_gmt` が基準より後のものだけを処理する。指定が無視される環境（R-008）でも結果が正しくなるようにするため。<br>・**上書き**：処理対象の既存記事は、本文（`wp_content_text`）を含めて無条件に上書きする。既存の一括取込の「変更なし」判定（タイトル・抜粋・カテゴリ・投稿タイプ・画像数だけを比べる）では読み飛ばさない。本文が取れなかった記事で既存の本文を消さない扱いは今のまま。<br>・**件数上限**：既存の一括取込の1,000件上限（取得の `maxItems` と `slice(0, 1000)`）を外す（FR-004 と同じ理由）。<br>・**取込済み記事との突合**：新規か既存かを判定するための取込済み記事（`content_annotations`）の読み込みを、range ページングで全件読む形にする（§9 データ）。今は1回の select で読んでおり、`db-max-rows` 1,000 で切れる。そのままだと、1,001件目以降の取込済み記事を新規と誤判定し、insert が一意制約に当たって取込全体が失敗し、差分の基準が進まないまま毎日失敗する | Must | D-01 / D-02 / D-03 / D-06 | §7 の WordPress の Rule |
| FR-004 | 一度も WordPress の記事を取り込んでいないユーザー（差分の基準が無い人）は、公開済みの記事をすべて取り込む。1,000件の上限は設けない。上限を残すと、それを超える記事が取り込まれず、差分の基準を進めた後は二度と取り込まれない（クライアントは1,000〜2,000本規模の運用を想定）。処理時間の上限で途中で打ち切られた回は基準を進めない（§9）ので、翌日以降の起動で取り直す | Must | D-08 | §7「一度も WordPress の記事を取り込んでいないユーザーは…」 |
| FR-005 | 手動の一括取込（`/wordpress-import`）も FR-003 と同じ差分取込にする（件数上限を外すことも含む）。手動と自動は同じ「前回の取込」の基準を共有し、手動の取込も基準を進める。ただし、自動取込の結果（FR-008 の状態）は書かない（§6 状態遷移） | Must | D-02、合意済みの解釈 | §7「手動の一括取込も…」 |
| FR-006 | 3本の cron の起動時刻を、既存の定期実行の起動時刻と重ねない。GSC は UTC 19:05、GA4 は UTC 19:25、WordPress は UTC 19:45（いずれも JST では翌日の 04:05 / 04:25 / 04:45） | Must | D-06、CON-001 の回答 2-1 | §7「起動時刻は既存の定期実行の起動時刻と重ならない」 |
| FR-007 | Google 連携が切れて取込が止まったら、マイホームに既存の GSC / GA4 再連携カードを出す。正常なら出さず、再連携したら消す | Must | D-05 | §7 Google の3シナリオ |
| FR-008 | WordPress の認証が切れて自動取込が止まったら、マイホームに「WordPress の再連携が必要です」カードを出す。正常なら出さず、再連携したら消す。判定は、自動取込が保存した結果を読んで行う（画面を開くたびに WordPress へ接続しない）。結果を書くのは自動取込だけ（認証切れの判定条件は §6 状態遷移） | Must | D-09、D-09 の判定方法（ユーザー判断 2026-10-13） | §7 WordPress の3シナリオ |
| FR-009 | 取込をきっかけに、AI 要約・評価を始めない | Must | D-07 | §7「AI 要約と評価は始まらない」 |
| FR-010 | 3本の cron を、既存の cron 基盤（`CRON_CONFIGS`・観測・手動実行用の workflow matrix）に登録する | Must | 既存パターン | 整合性テスト `tests/unit/server/lib/cron-config-consistency.test.ts` が通る |
| FR-011 | GSC・GA4 の自動取込が、トークンは有効なのにプロパティの権限が無くて止まったら（Google API が権限不足の 403 を返す。判定は §6 状態遷移）、マイホームに「<サービス名> のプロパティにアクセスできません」カードを出す。正常なら出さず、設定を保存し直すか再連携すると消える。判定は、自動取込が保存した結果を読んで行う（FR-008 と同じ形。画面を開くたびに Google の API を呼ばない）。トークン失効（FR-007）のカードが出ているときは出さない | Must | R-003 が実際に起きた（2026-10-17、GSC の日次取込で1人が毎回 403。最後に同期できたのは 2026-06-18）。ユーザー判断 2026-10-17（Q-012） | §7 FR-011 の3シナリオ |
| FR-012 | WordPress の自動取込が「一時的な失敗」のまま3日以上取り込めていなかったら、マイホームに「WordPress の記事の取込に失敗しています」カードを出す。最後に最後まで取り込めた回（差分の基準）から数え、一度も取り込めていなければ連携した日（`wordpress_settings.created_at`）から数える。次に取り込めれば消える（手動の一括インポートで最後まで取り込めた場合も、基準が進むので消える）。既知の誤表示：サイトを変えるか投稿タイプを足すと基準が NULL に戻るが、連携した日（`created_at`）は変わらないので、その後の初回全件取込が1回失敗しただけでカードが出る（列を足さないと「一度も成功していない」と区別できないため受け入れる。文言に日数を書かないのはこのため）。認証切れ（FR-008）のカードが出ているときは出さない。判定は自動取込が保存した結果と基準を読んで行い、列は足さない | Must | R-003 が WordPress でも実際に起きた（2026-10-17、kurupika24.com が一覧取得の 500 で毎日失敗し、記事0件のまま本人に何も表示されなかった）。ユーザー判断 2026-10-17（WordPress だけを対象にする） | §6 画面設計の FR-012 のカード |
| FR-013 | 毎朝 JST 05:30 に、その日（JST 04:00 以降・本番の記録だけ）の日次取込（GSC・GA4・WordPress）を運営向けに確かめ、問題があれば Lark（CI 通知と同じ `CI_WEBHOOK_URL`）に送る。問題が無い日は送らない。<br>・**取込の実行**：各 cron の直近の回が、起動していない・`batch_failed` などで止まった・`batch_completed` が無い（強制終了の可能性）・利用者の失敗や未処理がある、のどれかなら書く。止まった・強制終了・未処理があるときは赤、利用者の失敗だけなら橙。<br>・**止まっている利用者**：paid / admin で、WordPress が認証切れか一時的な失敗、GSC・GA4 がプロパティの権限切れの人を、氏名と記録の日時で一覧にする。Google のトークン失効は結果を記録していないので出ない（本人のマイホームには FR-007 のカードが出る）。<br>・集計そのものが失敗した日も、そのことを送る。<br>・GitHub Actions の定時実行（`.github/workflows/daily-import-failures.yml`、`scripts/notify-daily-import-failures.cjs`）で行い、アプリには手を入れない。定時実行は main に入ってから始まる。<br>・**同じ問題を毎朝送らない**：月曜（JST）は続いている問題も含めて全部を送る。それ以外の日は、前日から増えた問題（新しく止まった利用者、失敗した人数が増えた cron、取込が止まった cron）だけを送り、続いている問題は件数だけ添える。前回送った内容は GitHub Actions のキャッシュに残す。キャッシュが切れた日は全部を送る（ユーザー判断 2026-10-17）。<br>・知っておくこと：止まっている利用者が直さない限り、月曜には毎週送られる（運営が利用者に声をかけるきっかけにするため、意図どおり）。GitHub の定時実行は遅れたり抜けたりすることがあり、抜けた日は何も届かない。各 cron はその日の最後の回だけを見る | Must | cron は利用者ごとの失敗でも HTTP 200 を返すので、Vercel の表示では気づけない（2026-10-17、外部の確認で指摘）。ユーザー判断 2026-10-17（運営向けの通知、送り先は CI と同じチャンネル） | — |

### 入力・出力・状態遷移

- 入力値・形式・必須条件:
  - cron ルートは `Authorization: Bearer ${CRON_SECRET}` が必須（既存の cron と同じ）。
  - 手動の一括取込は、今と同じ Server Action を使う。
- 正常時の出力: 各 cron は既存の `count-batch` の形で、処理人数・成功・失敗・スキップを返し、`cron_run_logs` に記録する（詳細は OPEN-002）。
- エラー時の出力:
  - ユーザー単位の失敗は `console.error` に記録し、次のユーザーへ進む（`feedback_error_handling_logging` の方針）。
  - WordPress の認証切れは、FR-008 の結果として保存する。
- 状態と遷移条件（WordPress の自動取込の結果。`wordpress_settings` に保存）:

  | 状態 | 遷移の条件 | マイホーム |
  | --- | --- | --- |
  | 未実行（NULL） | 初期値。まだ一度も自動取込が動いていない | カードなし |
  | 成功 | 取込が最後まで終わり、記事の insert / update が1件も失敗しなかった | カードなし |
  | 認証切れ | 認証切れの判定条件（下記）に当たった | 「WordPress の再連携が必要です」カード |
  | 一時的な失敗 | ネットワーク・5xx・タイムアウト・処理時間の上限での打ち切り・記事の insert / update の一部失敗など、認証以外の失敗。候補 URL の片方がサイトの失敗（0・5xx）なら、もう片方が 403 でもここに入れる（401 は認証切れ） | カードなし（翌日に再試行）。3日以上取り込めていなければ FR-012 のカード |

  - 結果を書くのは自動取込だけ。手動の一括取込は結果を書かない（成功しても「認証切れ」は消えない）。
    - 理由：手動の WordPress.com 取込は cookie のトークンを優先する（`wordpressContext.ts:37`）。手動で成功しても、自動取込が使う DB のトークンが有効だとは限らない。
  - 認証切れの判定条件（GrowMate 側の判定ルール。認証情報が失効したときのステータスコードは公式に記載が無い。R-008）:
    - 一覧取得で試す候補 URL（`wordpressService.ts` の `buildRestFetchCandidates`。最大3つ）のどれかが 401 を返し、成功した候補が無いとき。403 は、ほかの候補にサイトの失敗（0・5xx）が無いときだけ認証切れにする（あれば一時的な失敗。その形式がファイアウォール等で使えないだけのことがある）。最後に試した候補のステータスだけでは判定しない（最後の候補は 404 を返しうる）。
    - WordPress.com のトークンが無いとき、またはトークン更新が拒否されたとき（リフレッシュトークンの失効など）。
    - 例外：トークン更新が通信エラー・5xx・429 で失敗したときは「一時的な失敗」にする。再連携では直らず、誤って再連携カードを出さないため。
  - 「認証切れ」から抜けるのは、次のどちらかのとき。
    - 自動取込が成功したとき。
    - `/setup/wordpress` で連携情報を保存し直したとき、または WordPress.com の OAuth を完了したとき。このとき結果を未実行（NULL）に戻す。
  - 再連携を終えたら、翌朝の自動取込を待たずにカードが消える（§7「再連携を終えたユーザーには…」）。
- 状態と遷移条件（GSC・GA4 の自動取込の結果。`gsc_credentials` に GSC・GA4 別々に保存。FR-011）:

  | 状態 | 遷移の条件 | マイホーム |
  | --- | --- | --- |
  | 未実行（NULL） | 初期値。まだ一度も自動取込が動いていない | カードなし |
  | 成功 | GSC はそのユーザーの取込が例外なく終わったとき（ページ指標の保存の一部失敗・クエリ指標の取得失敗は例外にしないので、そのときも成功。ページ指標を取得できた時点で権限はある）。GA4 は `syncUser` が成功を返したとき（未連携・同期済みで何もしなかった回は書かない） | カードなし |
  | 権限切れ | Google の API が権限不足の 403 を返した（判定ルールは下記） | 「<サービス名> のプロパティにアクセスできません」カード（トークン失効のカードが出ているときは出さない） |

  - WordPress と違い「一時的な失敗」は持たない。権限切れ以外の失敗（トークン更新の失敗・5xx・通信エラー・例外になる書き込みの失敗）では状態を書き換えない。権限が戻ったかどうかの判断材料にならないため。トークン失効は FR-007 のカードが担う。
  - 権限切れの判定ルール（GrowMate 側の判定。Claude案・未確認）: 403 でも、API の無効化や割り当て超過はプロパティの選び直しや再連携で直らないので含めない。
    - GSC（Search Analytics）: 403 で、`error.errors[].reason` に `forbidden` があるとき（2026-10-17 の本番ログで、権限が無いサイトへの応答がこの形だった）。`rateLimitExceeded`・`accessNotConfigured` などは含めない。
    - GA4（Data API の runReport）: 403 で `error.status` が `PERMISSION_DENIED`、かつ `error.details[].reason` が `SERVICE_DISABLED`（API 無効化）でも `ACCESS_TOKEN_SCOPE_INSUFFICIENT`（スコープ不足）でもないとき。公式のエラー一覧（https://developers.google.com/analytics/devguides/reporting/data/v1/errors）は、権限が無いときの例として "User does not have sufficient permissions for this property." を挙げるだけで、details に何が付くかは書いていない。そのため「理由が付かないこと」を条件にせず、直らない理由だけを除く（Google が理由を付けるようになってもカードが黙って出なくならないようにするため）。GA4 の権限切れの実際の応答は、本番でまだ確かめていない。
  - 結果を書くのは自動取込だけ。手動の `/gsc-import`・`/setup/ga4` の同期・`ga4-content-evaluate` は書かない。
  - 結果は、取込に使ったプロパティがまだ選ばれている行にだけ書く（GSC は `property_uri`、GA4 は `ga4_property_id` を条件にする）。取込の最中に別のプロパティへ保存し直されたら、古いプロパティの結果で未実行（NULL）を上書きしない。
  - 「権限切れ」から抜けるのは、次のどれかのとき。
    - 自動取込が成功したとき（Google 側で権限を戻しただけなら、翌朝の取込で消える）。
    - Google の OAuth を完了したとき（GSC・GA4 とも NULL に戻す）。
    - `/setup/gsc` でプロパティを保存したとき（GSC を NULL に戻す）。`/setup/ga4` で設定を保存したとき（GA4 を NULL に戻す。プロパティが同じでも戻す。Google 側で権限を戻した利用者が保存し直したらカードが消えるようにするため）。
    - OAuth の完了や保存し直しで NULL に戻したあと、まだ権限が無ければ、翌朝の自動取込で再び「権限切れ」になりカードが出る。
- 差分の基準（`wordpress_settings` に保存。定義は §9）の遷移:
  - 自動・手動とも、取込が最後まで終わり、記事の insert / update が1件も失敗しなかった回だけ進める。それ以外（認証切れ・一時的な失敗・打ち切り・一部失敗）は据え置く。
  - 次の場合も、取り込んだ記事は保存したうえで基準は据え置く（次回も全件取得になる）。
    - 初回の全件取得で、投稿タイプごとの取得件数（記事 ID の重複を除く）が WordPress の総数（`X-WP-Total`）に届かなかった。取りこぼした記事を差分で二度と拾えなくなるのを防ぐ。取得時は `orderby=id&order=asc` で並びを固定し、同日時の記事がページ間で入れ替わるのを避ける。
    - 取込を始めた時点から、差分の基準・サイト URL・サイト ID のどれかが変わっていた（取込中に再連携された）。基準は、これらが取込開始時と同じ行だけを条件付きで更新する。投稿タイプの変更は条件に含めないので、初回取込の最中に投稿タイプだけを変えられた場合は防げない。
  - サイト（`wp_type` / `wp_site_url` / `wp_site_id`）が変わるか、取込対象の投稿タイプ（`wp_content_types`）が足されたら、NULL に戻す（次回は全件取込）。タイプを外すだけなら戻さない（残りのタイプは差分取込を続けられる）。保存経路はどれも `supabaseService.ts` の `createOrUpdateWordPressSettings` / `createOrUpdateSelfHostedWordPressSettings` / `updateWordPressContentTypes` を通る。
- 冪等性・重複実行時の挙動:
  - GSC・GA4 は upsert なので、同じ起動が2回届いても結果は変わらない。
  - WordPress は、二重に起動すると新規の insert が一意制約に当たりうる（R-005）。

### 画面設計

#### 画面一覧

| 画面 | パス | 新規/既存 | 概要・変更点 |
| --- | --- | --- | --- |
| マイホーム | `/` | 既存 | 「今日の確認」に WordPress の再連携カードを足す（FR-008）。Google の再連携カードは変えず、Google のプロパティにアクセスできないカード2枚を足す（FR-011）。WordPress の取込が3日以上止まっているカードを足す（FR-012） |
| WordPress 記事一括インポート | `/wordpress-import` | 既存 | 押したときの取込が差分になる（FR-005）。説明文の「既に登録されているURLはスキップされます。」を「前回の取込以降に公開・更新された記事だけを取り込みます（初回はすべての記事）。」に直す（挙動が変わり、元の文が事実と食い違うため）。1,000件の上限に達したときの警告は、上限を外したので消す。差分取込で対象の記事が0件だった回（WordPress が返した候補がすべて基準時刻以前で「変更なし」になった回を含む）は、結果の1行目を「前回の取込以降に公開・更新された記事はありませんでした。」にする（「0件の記事を取得しました」だけだと、壊れたように見えるため）。ほかの見た目は変えない |

#### 画面ごとの詳細

##### `/`（マイホーム）

- 概要: 既存の「今日の確認」（`app/_components/TodayChecklist.tsx`、項目は `src/lib/home-today.ts` の `buildHomeToday`）に、WordPress の再連携項目を1件足す。
- UI 既存パターン対照表（`.agents/skills/growmate-ui-ux/SKILL.md` に従う）:

  | 要素 | 既存の同種 UI | 扱い |
  | --- | --- | --- |
  | カードの種類・並び | `gsc-reauth` / `ga4-reauth` / `google-ads-reauth` / `instagram-reauth`（`kind: 'reauth'`。異常を先に並べる） | そのまま使う。`kind: 'reauth'` の項目として同じ並びに入れる |
  | 見出し | 「Google Search Console の再連携が必要です」など「<サービス名> の再連携が必要です」 | 同じ型で「WordPress の再連携が必要です」 |
  | 説明 | 「検索順位の取得が止まっています。」「投稿データの取得が止まっています。」（既存4件はすべて「〜の取得が止まっています。」。`home-today.ts:89,100,117,126`） | 同じ型で「記事の取得が止まっています。」 |
  | ボタン | 「再連携する」→ 各 `/setup/<サービス>` | 同じ文言で、遷移先は `/setup/wordpress` |
  | 表示の条件 | `hasPaidFeatureAccess(role)` かつ再連携が必要 | 同じ。`paid` / `admin` のみ |

  - 文言は `src/domain/errors/error-messages.ts` ではなく、既存カードと同じく `home-today.ts` の項目定義に置く（既存の4件と揃える）。
  - 新しい用語は無い（`ui-text.md` の辞書の「再連携」を使う）。
- 状態別UI:

  | 内部状態（WordPress の自動取込の結果） | ユーザー向け表示 | 主操作 | 操作制限 |
  | --- | --- | --- | --- |
  | 未実行 / 成功 / 一時的な失敗（3日未満） | カードなし | — | — |
  | 認証切れ | 「WordPress の再連携が必要です／記事の取得が止まっています。」 | 「再連携する」→ `/setup/wordpress` | `trial` / `unavailable` には出さない |
  | 一時的な失敗が3日以上（FR-012） | 「WordPress の記事の取込に失敗しています／サイトが表示されるかと、WordPress 側の設定を確認してください。」 | 「連携設定を開く」→ `/setup/wordpress` | `trial` / `unavailable` には出さない。認証切れのカードと重ねない |
  | WordPress 未連携 | カードなし（未連携は「変化」ではない。既存方針どおり） | — | — |

  | 内部状態（GSC・GA4 の自動取込の結果。FR-011） | ユーザー向け表示 | 主操作 | 操作制限 |
  | --- | --- | --- | --- |
  | 未実行 / 成功 | カードなし | — | — |
  | 権限切れ（トークンは有効） | 「<サービス名> のプロパティにアクセスできません」（画面設計の FR-011 のカード） | 「プロパティを選ぶ」→ `/setup/gsc`・`/setup/ga4` | `trial` / `unavailable` には出さない |
  | 権限切れ＋トークン失効 | トークン失効の再連携カードだけ（FR-007。2枚重ねない） | 「再連携する」 | 同上 |

- 画面遷移: `/` →「再連携する」→ `/setup/wordpress` → 保存または OAuth 完了 → `/` に戻るとカードが消えている
- FR-011 のカード（文言は Claude案・未確認）:

  | 項目 | GSC | GA4 |
  | --- | --- | --- |
  | 見出し | 「Google Search Console のプロパティにアクセスできません」 | 「Google Analytics 4 のプロパティにアクセスできません」 |
  | 説明 | 「連携中の Google アカウントから権限が外れ、検索順位の取得が止まっています。Google Search Console 側で権限を戻すか、別のプロパティを選んでください。」 | 「連携中の Google アカウントから権限が外れ、アクセス解析の取得が止まっています。Google Analytics 4 側で権限を戻すか、別のプロパティを選んでください。」 |
  | ボタン | 「プロパティを選ぶ」→ `/setup/gsc`（既存の `ga4-unselected` と同じ語） | 「プロパティを選ぶ」→ `/setup/ga4` |
  | 見た目 | 既存の再連携カードと同じ（`kind: 'reauth'`、警告の色） | 同じ |
  | 表示の条件 | `hasPaidFeatureAccess(role)`、GSC が連携済み、トークン失効でない、結果が権限切れ | 同じ（GA4） |

  - 遷移先の `/setup/gsc`・`/setup/ga4` には権限切れの表示を足さない。次にやること（権限を戻すか、別のプロパティを選ぶ）はカードの説明に書く。
- UI用語: `ui-text.md` の「再連携」を使う。辞書への追加は無い。

#### 誤読しやすい罠

- Google のカードは、マイホームを開くたびにトークンを更新して判定している（`home-google-credential.ts`）。一方、WordPress のカードは自動取込が保存した結果で判定する。判定の仕方が違うので、「WordPress も開くたびに接続確認する」形に寄せない（FR-008、D-09 の判定方法）。
- 「一時的な失敗」で翌日に直るものにはカードを出さない。3日以上取り込めていないときだけ FR-012 のカードを出す（文言はユーザー確認済み 2026-10-17。ボタンは行き先が GrowMate の連携設定だと分かるよう「連携設定を開く」にした。遷移先の `/setup/wordpress` には失敗の表示が無く、接続テストは一覧の取得が 500 でも通ることがある。MVP として受け入れる。見た目は既存の再連携カードと同じ `kind: 'reauth'`）。GSC・GA4 の一時的な失敗は記録していないので対象外（ユーザー判断 2026-10-17）。
- Google のカードは2種類あり、判定の仕方が違う。トークン失効（FR-007）は開くたびのトークン更新で、プロパティの権限切れ（FR-011）は自動取込が保存した結果で判定する。権限切れを「開くたびに Google の API を呼んで確かめる」形に寄せない。

### 権限

| ロール | 閲覧（マイホームのカード） | 作成・実行（自動取込の対象） | 更新（手動の一括取込） | 削除・解除 |
| --- | --- | --- | --- | --- |
| `admin` | ○ | ○ | ○（差分） | — |
| `paid` | ○ | ○ | ○（差分） | — |
| `trial` | × | × | ○（差分。ロールは変えない Non-goal） | — |
| `unavailable` | × | × | × | — |

- サーバー側の認可:
  - 自動取込の対象一覧は、各 cron のクエリでロールを絞る。
  - cron ルートは `CRON_SECRET` で認証する。
  - マイホームの項目は `hasPaidFeatureAccess` で絞る（既存）。

## 7. Gherkin受け入れ条件

承認済みの `02-gherkin.md`（`gherkin.2`、2026-10-13 ユーザー承認）をそのまま反映する。

```gherkin
Feature: GSC・GA4・WordPress の毎日の自動取込

  Rule: GSC・GA4・WordPress の取込を、毎日決まった時刻に利用者の操作なしで実行する

    Scenario Outline: 毎日の実行時刻になると <取込元> の取込が自動で実行される
      Given paid のユーザーが <取込元> を連携している
      And そのユーザーは取込の操作をしていない
      When 毎日の実行時刻になる
      Then そのユーザーの <取込元> の取込が実行される

      Examples:
        | 取込元                           |
        | Google Search Console の日次指標 |
        | Google Analytics 4               |
        | WordPress の記事                 |

    Scenario: 自動取込の起動時刻は既存の定期実行の起動時刻と重ならない
      Given 既存の定期実行の起動時刻が登録されている
      When 自動取込の毎日の起動時刻を登録する
      Then その起動時刻は、既存のどの定期実行の起動時刻とも重ならない

  Rule: 自動取込の対象は paid と admin のユーザーに限る

    Scenario Outline: ロールが <ロール> のユーザーは自動取込の対象<可否>
      Given ロールが <ロール> のユーザーが GSC・GA4・WordPress を連携している
      When 毎日の自動取込が実行される
      Then そのユーザーの取込は <結果>

      Examples:
        | ロール      | 可否       | 結果         |
        | admin       | になる     | 実行される   |
        | paid        | になる     | 実行される   |
        | trial       | にならない | 実行されない |
        | unavailable | にならない | 実行されない |

  Rule: GSC と GA4 は直近3日分を取り直し、既存の値を上書きする

    Scenario Outline: <取込元> の直近3日分の値が、取り直した値に置き換わる
      Given paid のユーザーの <取込元> のデータが、直近3日分の各日について取込済みである
      And <取込元> 側で、その3日分の値が取込済みの値から変わっている
      When 毎日の自動取込が実行される
      Then 直近3日分の各日の値が、<取込元> から取得し直した値に置き換わる

      Examples:
        | 取込元                |
        | Google Search Console |
        | Google Analytics 4    |

    Scenario Outline: <取込元> の取り直しで同じ日のデータが重複して保存されない
      Given paid のユーザーの <取込元> のデータが、直近3日分の各日について取込済みである
      When 毎日の自動取込が実行される
      Then 直近3日分の各日について、保存されているデータは1日分ずつのままである

      Examples:
        | 取込元                |
        | Google Search Console |
        | Google Analytics 4    |

  Rule: WordPress は新しく公開された記事と更新された記事だけを取り込む（自動取込・手動の一括取込とも）

    Scenario: 前回の取込より後に新しく公開された記事が取り込まれる
      Given paid のユーザーが前回の取込より後に WordPress で記事を新しく公開した
      When 毎日の自動取込が実行される
      Then その記事が GrowMate に取り込まれる

    Scenario: 前回の取込より後に更新された記事は、取込済みの内容が更新後の内容に置き換わる
      Given paid のユーザーの取込済みの記事が、前回の取込より後に WordPress で更新された
      When 毎日の自動取込が実行される
      Then GrowMate にあるその記事の内容が、更新後の内容に置き換わる

    Scenario: 前回の取込より後に変更されていない記事は取込の対象にならない
      Given paid のユーザーの取込済みの記事が、前回の取込より後に WordPress で変更されていない
      When 毎日の自動取込が実行される
      Then その記事は取込の対象にならない
      And GrowMate にあるその記事の内容は変わらない

    Scenario: 手動の一括取込も、新しく公開された記事と更新された記事だけを取り込む
      Given paid のユーザーが前回の取込より後に記事 A を新しく公開した
      And 取込済みの記事 B は前回の取込より後に変更されていない
      When ユーザーが WordPress 記事の一括取込を手動で実行する
      Then 記事 A が取り込まれる
      And 記事 B は取込の対象にならない

    Scenario: 一度も WordPress の記事を取り込んでいないユーザーは、公開済みの記事がすべて取り込まれる
      Given paid のユーザーが WordPress を連携しているが、記事を一度も取り込んでいない
      When 毎日の自動取込が実行される
      Then そのユーザーの公開済みの記事がすべて取り込まれる

  Rule: Google 連携が切れて自動取込が止まったら、そのユーザーのマイホームに止まった理由と再連携が必要なことを表示する

    Scenario: Google 連携が切れて自動取込が止まったユーザーのマイホームに、止まった理由と再連携が必要なことが表示される
      Given paid のユーザーの Google 連携が切れている
      And そのため、そのユーザーの GSC・GA4 の自動取込が止まっている
      When そのユーザーがマイホームを開く
      Then データの取得が止まっていることが表示される
      And その理由として、Google の再連携が必要であることが表示される

    Scenario: Google 連携が正常なユーザーには、再連携が必要という表示は出ない
      Given paid のユーザーの Google 連携が正常である
      When そのユーザーがマイホームを開く
      Then Google の再連携が必要という表示は出ない

    Scenario: 再連携を終えたユーザーには、再連携が必要という表示が出なくなる
      Given paid のユーザーのマイホームに、Google の再連携が必要という表示が出ていた
      When そのユーザーが Google の再連携を終えてマイホームを開く
      Then Google の再連携が必要という表示は出ない

  Rule: Google のプロパティの権限が無くて自動取込が止まったら、そのユーザーのマイホームにアクセスできないことを表示する

    Scenario Outline: プロパティの権限が無くて <取込元> の自動取込が止まったユーザーのマイホームに、アクセスできないことが表示される
      Given paid のユーザーの Google 連携のトークンは有効である
      And 連携中の Google アカウントに、選んだ <取込元> のプロパティの権限が無い
      And そのため、毎日の自動取込で <取込元> の取込が止まった
      When そのユーザーがマイホームを開く
      Then <取込元> のプロパティにアクセスできないことが表示される
      And Google の再連携が必要という表示は出ない

      Examples:
        | 取込元 |
        | GSC    |
        | GA4    |

    Scenario Outline: プロパティの権限があるユーザーには、アクセスできないという表示は出ない
      Given paid のユーザーの <取込元> の自動取込が成功している
      When そのユーザーがマイホームを開く
      Then <取込元> のプロパティにアクセスできないという表示は出ない

      Examples:
        | 取込元 |
        | GSC    |
        | GA4    |

    Scenario Outline: 設定を保存し直すか再連携したユーザーには、アクセスできないという表示が出なくなる
      Given paid のユーザーのマイホームに、<取込元> のプロパティにアクセスできないという表示が出ていた
      When そのユーザーが <操作> してマイホームを開く
      Then <取込元> のプロパティにアクセスできないという表示は出ない

      Examples:
        | 取込元 | 操作                                   |
        | GSC    | /setup/gsc でプロパティを保存          |
        | GA4    | /setup/ga4 で設定を保存                |
        | GSC    | Google の再連携（OAuth）を完了         |
        | GA4    | Google の再連携（OAuth）を完了         |

  Rule: WordPress の自動取込が認証以外の理由で3日以上取り込めていなかったら、そのユーザーのマイホームに取込に失敗していることを表示する

    Scenario: 3日以上取り込めていない paid のユーザーのマイホームに、取込に失敗していることが表示される
      Given paid のユーザーの WordPress の自動取込が、サイトの失敗などで最後に取り込めてから3日以上失敗し続けている
      When そのユーザーがマイホームを開く
      Then WordPress の記事の取込に失敗していることと、確認する場所（WordPress の設定）が表示される

    Scenario: 取り込めるようになったら、取込に失敗しているという表示は出なくなる
      Given paid のユーザーのマイホームに、WordPress の記事の取込に失敗しているという表示が出ていた
      When 次の自動取込か手動の一括インポートで最後まで取り込めて、そのユーザーがマイホームを開く
      Then 取込に失敗しているという表示は出ない

  Rule: WordPress の認証が切れて自動取込が止まったら、そのユーザーのマイホームに止まった理由と再連携が必要なことを表示する

    Scenario: WordPress の認証が切れて自動取込が止まったユーザーのマイホームに、止まった理由と再連携が必要なことが表示される
      Given paid のユーザーの WordPress の認証が切れている
      And そのため、そのユーザーの WordPress 記事の自動取込が止まっている
      When そのユーザーがマイホームを開く
      Then 記事の取込が止まっていることが表示される
      And その理由として、WordPress の再連携が必要であることが表示される

    Scenario: WordPress の連携が正常なユーザーには、再連携が必要という表示は出ない
      Given paid のユーザーの WordPress の連携が正常である
      When そのユーザーがマイホームを開く
      Then WordPress の再連携が必要という表示は出ない

    Scenario: WordPress の再連携を終えたユーザーには、再連携が必要という表示が出なくなる
      Given paid のユーザーのマイホームに、WordPress の再連携が必要という表示が出ていた
      When そのユーザーが WordPress の再連携を終えてマイホームを開く
      Then WordPress の再連携が必要という表示は出ない

  Rule: 取り込んだ記事の AI 要約・評価は、取込をきっかけに自動では始まらない

    Scenario: 自動取込で新しい記事が取り込まれても、AI 要約と評価は始まらない
      Given paid のユーザーが WordPress で記事を新しく公開した
      When 毎日の自動取込でその記事が取り込まれる
      Then 取込をきっかけに、その記事の AI 要約は開始されない
      And 取込をきっかけに、その記事の評価は開始されない
```

### シナリオ対応表

| シナリオ | 対応する機能要件 | 対応する決定事項 |
| --- | --- | --- |
| 毎日の実行時刻になると <取込元> の取込が自動で実行される | FR-001 / FR-002 / FR-003 | D-01 |
| 自動取込の起動時刻は既存の定期実行の起動時刻と重ならない | FR-006 / FR-010 | D-06 |
| ロールが <ロール> のユーザーは自動取込の対象… | FR-001 / FR-002 / FR-003 | D-03 |
| <取込元> の直近3日分の値が、取り直した値に置き換わる | FR-001 / FR-002 | D-04 |
| <取込元> の取り直しで同じ日のデータが重複して保存されない | FR-001 / FR-002 | D-04 |
| 前回の取込より後に新しく公開された記事が取り込まれる | FR-003 | D-02 |
| 前回の取込より後に更新された記事は…置き換わる | FR-003 | D-02 |
| 前回の取込より後に変更されていない記事は取込の対象にならない | FR-003 | D-02 |
| 手動の一括取込も、新しく公開された記事と更新された記事だけを取り込む | FR-005 | D-02 |
| 一度も WordPress の記事を取り込んでいないユーザーは… | FR-004 | D-08 |
| Google の3シナリオ | FR-007 | D-05 |
| WordPress の3シナリオ | FR-008 | D-09 |
| Google のプロパティ権限切れの3シナリオ | FR-011 | Q-012 |
| WordPress の取込が止まっている2シナリオ | FR-012 | ユーザー判断 2026-10-17 |
| 自動取込で新しい記事が取り込まれても、AI 要約と評価は始まらない | FR-009 | D-07 |

決定事項の一覧（`01-grill.md` に `03-confirmation.md` の判断を加えたもの）:
- D-01: GSC 日次指標・GA4 同期・WordPress 記事を、毎日決まった時刻に自動で実行する。
- D-02: WordPress は、新しく公開された記事と更新された記事だけを取り込む。手動の一括取込も差分にする。
- D-03: 自動取込の対象ロールは `paid` / `admin`。
- D-04: GSC・GA4 は、直近3日分を取り直して上書きする。
- D-05: Google 連携が切れて自動取込が止まったら、マイホームに表示する。
- D-06: 起動時刻は既存の cron と重ならないようにし、起動時刻だけで判定する。GSC は JST 04:05、GA4 は 04:25、WordPress は 04:45。
- D-07: AI 要約・評価の自動開始は対象外。
- D-08: 差分の基準が無いユーザーは、初回だけ全件を取り込む。
- D-09: WordPress の認証が切れて自動取込が止まったら、マイホームに表示する。判定方法は、自動取込の結果を保存して使う（2026-10-13 ユーザー判断）。

## 8. 非機能要件

| 分類 | 要件・目標値 | 検証方法 | 状態・根拠 |
| --- | --- | --- | --- |
| 性能・レイテンシ | 各 cron は `maxDuration` 内（GSC・GA4 は最大800秒、WordPress は拡張上限の1800秒）に終わる。人数の上限では打ち切らず、時間の上限でだけ打ち切る（OPEN-001）。時間の上限で処理し切れなかったユーザーは、翌日に回る（WordPress は差分の基準を進めない） | 本番の初回起動のログで所要時間を確認する | 未確定。人数は GA4 の17人（2026-08-21）以外は未確認。WordPress の初回全件取込は件数上限を外すので、1人あたりの時間が延びうる（R-004、OPEN-001） |
| 可用性・信頼性 | 1日1回の best effort。起動が抜けても、GSC・GA4 は翌日の3日分の取り直しで埋まる | — | Vercel Cron の仕様に従う（`vercel-cron-migration-spec.md`） |
| セキュリティ・プライバシー | cron ルートは `CRON_SECRET` 必須。WordPress のトークンは DB から読み、ログに出さない | 単体テスト（認証なしは 401） | 既存の cron と同じ |
| 認証・認可 | 対象一覧を作るクエリで、`paid` / `admin` に絞る。Service Role で読み書きするので、RLS は通らない。そのぶんクエリでユーザー境界を守る | 単体テスト（ロール別） | — |
| 監査・ログ | ユーザー単位の失敗は `console.error`（userId と失敗の種類）。cron 全体の結果は `cron_run_logs` | ログ確認 | 既存の `cron-observability.ts` を使う |
| 障害対応 | 利用者には、連携切れ・権限切れ・3日以上の取込失敗をマイホームのカードで知らせる（FR-008・FR-011・FR-012）。運営には、日次取込の失敗を毎朝 Lark に送る（FR-013）。詳細は Vercel ログ・`cron_run_logs` | `daily-import-failures.yml` の実行ログ | FR-013 |
| バックアップ・復旧 | 対象外。取込データは Google・WordPress から取り直せる | — | — |
| 運用・監視 | 止めるときは `vercel.json` から該当の1行を消してデプロイする。DB 容量は週次DB統計（#627）で確認する | — | 既存の手段で足りる |
| 拡張性・互換性 | 今の人数なら、1日1回・取込元ごとに1ルートで足りる見込み。1ルートの処理が上限（GSC・GA4 は800秒、WordPress は1800秒）を超え続けるようになったら、起動の回数か頻度を増やす | 本番ログ | R-004 |
| アクセシビリティ | マイホームのカードは既存の `TodayChecklist` の部品を使うので、既存と同等 | — | 新しい UI 部品なし |
| コスト | Google・WordPress の API 利用料はかからない。Vercel の関数実行は1日3回で、微増にとどまる。DB 容量は自動化で月150MB程度増える見込み（2026-10-12 の実測から推計） | 週次DB統計 | 調査結果（2026-10-12） |

### AI機能の追加観点

対象外。本機能は LLM を呼ばない（FR-009）。

## 9. データ・外部連携

### データ

- 作成・更新・削除するデータ:
  - `gsc_page_metrics` / `gsc_query_metrics`：直近3日分を upsert する（既存の onConflict）。
  - `ga4_page_metrics_daily`：直近3日分を upsert する（onConflict `user_id,property_id,date,normalized_path`）。`gsc_credentials.ga4_last_synced_at` のカーソルを更新する。
  - `content_annotations`：WordPress の新規記事を insert し、差分取得で返ってきた既存記事を本文ごと無条件に update する（FR-003。既存の一括取込の「変更なし」判定は使わない）。削除はしない。
  - 取込済み記事の読み込み（突合用）：Supabase（PostgREST）は1回の返却が `db-max-rows` 1,000 行で切れる（`docs/context/db-row-limits-and-data-truncation.md` §0。WordPress の記事が1,047本の口座が実在する）。次の2か所は、ユーザー単位で range ページングして全件を読む。順序はタイブレーク付きで決定的にする（例 `id` 順）。読み込みが失敗したら、そのユーザーのその回は失敗として扱う（WordPress は差分の基準を進めない）。
    - WordPress の一括取込（`wordpressImport.actions.ts:148-153`）
    - GSC の `loadAnnotationUrlMap`（`gscImportService.ts:799-818`。呼び出し元は同ファイルの `importMetrics`（L64）と `importQueryMetricsForUrl`（L285））
    - ページングには既存の `SupabaseService.fetchAllPaged`（`supabaseService.ts:137`）を使う。`protected` なので、呼び出せる形にする方法は実装時に決める（OPEN-003 と同じ扱い）。
  - `wordpress_settings`：次の列を追加する（マイグレーション）。列名は実装時に `project-naming` で決める。どちらも NULL 可。
    - 差分の基準：取込を**開始した時刻（UTC）**。その回が最後まで終わり、記事の insert / update が1件も失敗しなかったときだけ書く（§6 状態遷移）。完了時刻ではなく開始時刻を使うのは、取得中に WordPress で更新・公開された記事を次回の取得範囲に残すため。サイトが変わるか、投稿タイプが足されたら NULL に戻す（外すだけなら戻さない）。
    - 自動取込の結果：未実行（NULL）/ 成功 / 認証切れ / 一時的な失敗と、その日時。自動取込だけが書く。
  - `gsc_credentials`：GSC と GA4 の自動取込の結果（未実行（NULL）/ 成功 / 権限切れ）と、その日時を、それぞれ別の列で持つ（FR-011。マイグレーション）。どれも NULL 可。自動取込だけが書き、OAuth の完了と `/setup/gsc`・`/setup/ga4` の保存で NULL に戻す（§6 状態遷移）。
  - 差分の基準の送り方：`modified_after` / `after` には、基準を UTC のオフセット付き ISO8601（例 `2026-10-13T19:45:00+00:00`）で送る。オフセットの無い値がどのタイムゾーンとして扱われるかは公式に記載が無いため。
- データの所有者: 各ユーザー（`user_id`）。
- 保持期間・削除条件: 既存のテーブルに従う。追加する列は、連携を削除すると行ごと消える。
- 移行・既存データとの互換性:
  - 追加する列はすべて NULL 可で、既存の行は「差分の基準が無い」状態になる。そのため、各ユーザーの最初の取込は全件になる（D-08）。
  - 開発と本番は同じ Supabase なので、マイグレーションを適用した時点で本番にも反映される。列の追加だけなので、既存の処理は壊れない。
  - 生成型（`database.types.ts`）を更新する。
- RLS・Service Role・ユーザー境界:
  - cron は Service Role で動く。対象一覧と書き込みには、必ず `user_id` を条件に付ける。
  - `wordpress_settings` の RLS は変えない（本人だけが参照できる）。

### 外部連携

| 連携先 | 用途 | API・権限 | 失敗時の挙動 | 公式根拠 |
| --- | --- | --- | --- | --- |
| Google Search Console API | 日次指標の取得（`searchAnalytics.query`。自動取込は `dataState: "all"`、ページ指標の `rowLimit` 25,000） | 既存の OAuth（`gsc_credentials`） | そのユーザーを失敗として記録し、次へ進む。連携切れはマイホームの既存カードで分かる | 下の「公式根拠（GSC）」。確定までの遅れは R-002 |
| GA4 Data API | 日次レポートの取得（`runReport`） | 既存の OAuth（`gsc_credentials`、GA4 スコープ） | 同上 | 確定までの遅れは R-001 |
| WordPress REST API（セルフホスト `/wp-json/wp/v2` と、WordPress.com `public-api.wordpress.com/wp/v2/sites/{id}`） | 記事一覧の差分取得 | アプリケーションパスワード、または WordPress.com の OAuth（DB のトークンを使い、期限が切れていれば更新する） | 認証切れの判定条件（§6 状態遷移）に当たれば「認証切れ」として保存し、マイホームのカードを出す。それ以外は「一時的な失敗」 | 下の「公式根拠（WordPress）」。公式に記載が無い点は R-008 |

#### 公式根拠（GSC）

確認日はすべて 2026-10-13（spec-review audit が WebFetch で取得した本文の verbatim 引用）。

- https://developers.google.com/webmaster-tools/v1/searchanalytics/query
  - "Start date of the requested date range, in YYYY-MM-DD format, in PT time (UTC - 7:00/8:00)."
  - "If "final" (case-insensitive) or if this parameter is omitted, the returned data will include only finalized data."
  - "If "all" (case-insensitive), data will include fresh data."
  - "All values after the `first_incomplete_date` may still change noticeably."
  - "Valid range is 1–25,000; Default is 1,000."（`rowLimit`）
- https://developers.google.com/webmaster-tools/v1/how-tos/all-your-data
  - "Data is typically available after 2-3 days"
- 解釈（GrowMate 側）:
  - 日付は PT で数える。UTC 19:05 の起動時点で、PT の当日は JST の前日と同じ日付になる。
  - `dataState` を省略した既存の取得（`gscImportService.ts:398-404`）では、確定前の日は返らない。D-04 の「直近3日分を取り直して上書き」を満たすには `"all"` が要る。
  - ある日 X の値は、X・X+1・X+2（PT）の3回の起動で取り直され、その後は自動では取り直さない。3回目の後も値が変わりうる（R-002）。

#### 公式根拠（WordPress）

確認日はすべて 2026-10-13。

- https://developer.wordpress.org/rest-api/reference/posts/ （revise が WebFetch で取得）
  - `modified_after`: "Limit response to posts modified after a given ISO8601 compliant date."
  - `after`: "Limit response to posts published after a given ISO8601 compliant date."
  - `modified_gmt`: "The date the post was last modified, as GMT."
  - `date_gmt`: "The date the post was published, as GMT."
- https://developer.wordpress.org/rest-api/reference/pages/ （audit が確認）: pages にも `modified_after` がある。
- https://make.wordpress.org/core/2021/02/23/rest-api-changes-in-wordpress-5-7/ （audit が取得）
  - "Introduced in 50024 the REST API posts collection endpoints now accept modified_before and modified_after"
- https://developer.wordpress.com/docs/api/ （audit が取得）
  - "Note that this API is also enabled on WordPress.com."
- https://developer.wordpress.org/reference/functions/wp_publish_post/ （revise が WebFetch で取得）
  - "This function does not do anything except transition the post status."
  - 該当のソース行: `$wpdb->update( $wpdb->posts, array( 'post_status' => 'publish' ), array( 'ID' => $post->ID ) );`
- https://developer.wordpress.org/reference/functions/check_and_publish_future_post/ （revise が WebFetch で取得）
  - "Invoked by cron ‘publish_future_post’ event. This safeguard prevents cron from publishing drafts, etc."
  - 該当のソース行: `wp_publish_post( $post->ID );`
- 解釈（GrowMate 側）:
  - `modified_after` は WordPress 5.7 以上で使える（§10 前提）。
  - 予約投稿が公開されるときは `post_status` しか変わらず、更新日時は予約を設定した時点のまま。そのため `modified_after` だけでは、前回の取込より前に予約され、その後に公開された記事を拾えない。公開日時（`date_gmt`）で絞る `after` も使う（FR-003）。
  - 公式に記載が無いこと（R-008）：5.7 未満で `modified_after` が無視されるかエラーになるか／WordPress.com の `/wp/v2/sites/{site}` で `modified_after` / `after` が効くか／オフセットの無い日時の扱い／認証情報が失効したときのステータスコード。

## 10. 制約・前提・依存関係

### 技術前提

- 既存システム・ライブラリ・社内標準:
  - Vercel Cron（Pro）で起動し、`vercel.json` の時刻は UTC で書く。
  - 既存 cron の型に合わせる：1ルート1バッチ、`CRON_CONFIGS`、`cron-observability.ts`、手動実行用の `hourly-cron.yml` matrix、`scripts/invoke-cron.sh`。
  - WordPress は 5.7 以上を前提とする（`modified_after` が追加された版。§9 公式根拠（WordPress））。5.7 未満でも取り込む結果は正しいが、アクセス量は減らない（Non-goal）。
- 再利用する既存実装:

  | 対象 | 採用 | 根拠 path | 備考 |
  | --- | --- | --- | --- |
  | マイホームの Google 再連携カード（FR-007） | 再利用 | `src/lib/home-today.ts:84-102`、`app/page.tsx`、`src/server/lib/home-google-credential.ts:28-70` | FR-007 のトークン失効の判定は変えない。FR-011 のカードを同じ `buildHomeToday` に足し、トークン失効のカードを優先する |
  | GA4 の `runBatch()` / `syncUser()`（FR-002） | 拡張 | `src/server/services/ga4ImportService.ts:67-207`、`src/server/lib/ga4-sync-range.ts:19-43`、`supabaseService.ts:1707-1733` | ロールの絞り込みと3日分の取り直しを足す。3日分の取り直しは自動取込が渡すオプションにだけ効かせ、`resolveGa4SyncRange` の既定の計算（手動同期・`ga4-content-evaluate`）と手動の「過去90日を再取込」（`backfillDays`）は変えない |
  | cron 基盤（FR-010） | 再利用 | `vercel.json`、`src/server/lib/cron-definitions.ts`、`cron-observability.ts`、`.github/workflows/hourly-cron.yml`、`scripts/invoke-cron.sh`、`tests/unit/server/lib/cron-config-consistency.test.ts` | 3か所への登録手順は `hourly-cron.yml:4` |
  | GSC の `importMetrics`（FR-001） | 拡張 | `src/server/services/gscImportService.ts:45-92,233-256,369-429` | ロールで絞った対象一覧は新しく作る。`dataState` を渡せるようにし、自動取込だけが `"all"` と `maxRows` 25,000 を渡す。`loadAnnotationUrlMap`（`:799-818`）は range ページングで全件読む形にする（全呼び出し元に効く） |
  | WordPress の一括取込の中心処理（FR-003〜005） | 拡張＋一部新規 | `src/server/actions/wordpressImport.actions.ts:25-439`、`src/server/services/wordpressService.ts:497-628`、`src/server/services/wordpressContentSync.ts:129-153` | cookie に依存しない形に切り出す。WordPress.com のトークンは DB から読み、`refreshWpComAccessToken` で更新する。差分の指定（`modified_after` / `after`）・1,000件上限の撤廃・取込済み記事の range ページングでの全件読み込み・無条件の上書き・候補 URL ごとのステータスの保持（認証切れの判定用）を足す |
  | マイホームの項目定義（FR-008） | 拡張 | `src/lib/home-today.ts`（`buildHomeToday`）、`app/_components/TodayChecklist.tsx`、`app/page.tsx` | WordPress の状態を DB から読んで、項目を1件足す |

### 制約条件

- 納期・予算・人員: 未定。1人で進める。
- 法令・契約・審査: なし。
- 変更できない既存仕様:
  - 手動の GSC・GA4 導線の挙動（Non-goal）。
  - 開発と本番が同じ Supabase であること。

### 依存関係

| 依存対象 | 前提条件 | 完了確認 | 未完了時の影響 |
| --- | --- | --- | --- |
| `docs/plans/vercel-cron-migration-spec.md` | cron の起動元は Vercel Cron（実装済み） | `vercel.json` の `crons` が本番で動いている | — |
| `docs/plans/ga4-sync-cron-spec.md` の置き換え | 同仕様は本仕様で置き換える。`vercel-cron-migration-spec.md` §10 が同仕様を参照していた依存（起動元を Vercel Cron に読み替えること）は、本仕様が引き継ぐ | 同仕様の冒頭に、置き換え先として本仕様のパスを書く | 旧仕様のまま実装すると、毎時実行・GitHub Actions 前提のものになる |
| `docs/specs/home-today-spec.md` | 「本画面では WordPress を扱わない」が FR-008 で変わる | 実装の PR で同仕様を更新する | 仕様と実装が食い違う |

## 11. トレードオフ判断

### ALT-001: 仕様書の切り方

- 判断: GSC・GA4・WordPress の自動取込を、1本の仕様書にまとめる。
- 比較した案:
  - 案A: 新しい統合仕様（本仕様）を作り、`ga4-sync-cron-spec.md` を置き換える。
  - 案B: `ga4-sync-cron-spec.md` を毎日実行へ改訂し、GSC と WordPress は別の仕様にする。
  - 案C: 取込元ごとに3つの仕様にする。
- 採用案: A
- 採用理由: 実行時刻・3日分の取り直し・ロール・マイホーム表示は、3つの取込に共通する要件。1か所に書けば食い違わない。既存の GA4 仕様は未承認・未実装なので、置き換えても捨てる実装が無い。
- 却下した案と理由:
  - B: 毎時実行と GitHub Actions を前提にした判断を大きく書き直すことになる。共通要件も2つの仕様に分かれる。
  - C: 共通要件を3か所に重複して書くことになる。
- 影響: 仕様書は1本で長くなるが、レビューも1回で済む。
- 将来変更する条件: GA4 だけを先にリリースする必要が出たとき。
- 判断者・判断日: shoma-endo・2026-10-13（`03-confirmation.md` 回答 1）

### ALT-002: cron の単位

- 判断: 取込元ごとに、3つの cron ルートに分ける。
- 比較した案:
  - 案A: 1つのルートで、GSC・GA4・WordPress を順に処理する。
  - 案B: 取込元ごとに3つのルートにする。
- 採用案: B
- 採用理由:
  - 既存の cron はすべて「1ルート1バッチ」（`CRON_CONFIGS` の5件）。
  - ルートを分ければ、処理時間の上限と失敗の影響が取込元ごとに分かれる。
  - WordPress の初回の全件取込が、GSC・GA4 の処理時間を食わない。
- 却下した案と理由: A は処理時間の上限（`maxDuration`）を3つの取込で分け合うことになり、1つが遅いと他が打ち切られる。
- 影響: ルート・登録・テストが3本分になる（EST-002）。
- 将来変更する条件: 重ならない起動枠が1つしか取れないとき。
- 判断者・判断日: shoma-endo・2026-10-13（`03-confirmation.md` 回答 1）

### ALT-003: GSC・GA4 の「直近3日」の決め方

- 判断: GA4 はカーソルを起点にする。GSC は、前日を含む固定の3日間にする（GSC の日付は PT。「前日」は起動時点の PT の当日と同じ日付。FR-001）。
- 比較した案:
  - 案A: GA4 はカーソルを起点にする（開始日は「カーソルの翌日」と「前日の2日前」の早い方、終了日は前日）。GSC は、前日を含む固定の3日間にする。
  - 案B: 両方とも、固定の3日間にする。
  - 案C: GSC にもカーソルの列を新しく作る。
- 採用案: A
- 採用理由: GA4 にはカーソル（`ga4_last_synced_at`）が既にあり、起動が抜けても次の回で取り戻せる。GSC にはカーソルが無いので、マイグレーションの要らない固定の3日間が最小で済む。
- 却下した案と理由:
  - B: 起動が3日以上抜けると、GA4 はカーソルがあるのに欠損が残る。
  - C: 列を足すマイグレーションが要る。3日以上続けて起動が抜けることはまれで、欠けても手動の `/gsc-import` で埋められる。
- 影響: GSC は、起動が3日以上続けて抜けた分は自動では埋まらない（R-002 / R-004）。
- 将来変更する条件: GSC の欠損が実際に起きたとき。
- 判断者・判断日: shoma-endo・2026-10-13（`03-confirmation.md` 回答 1）

## 12. リスク・確認質問・未決定事項

### リスク

| ID | リスク | 発生条件・影響 | 対策 | 担当 | 状態 |
| --- | --- | --- | --- | --- | --- |
| R-001 | JST 04:05〜04:45 の時点で、前日分のデータが Google 側にそろっていない | 確定前の値を取り込むことになる | 3日分の取り直しで、翌日以降に正しい値へ置き換わる | 開発 | 受容 |
| R-002 | GSC の値は、3回目の取得（PT で X+2）の後も変わりうる | 公式は "All values after the `first_incomplete_date` may still change noticeably." "Data is typically available after 2-3 days" とする（§9 公式根拠（GSC））。ある日の値が、確定値とずれたまま残ることがある。日ごとの欠落ではなく、値のずれ | 手動の `/gsc-import` で期間を指定して上書きできる。ずれが問題になったら日数の変更を別途判断する | 開発 | 受容 |
| R-003 | トークンは有効なまま API の権限だけ失う（例：プロパティ権限を外されて 403 になる）。または、WordPress の特定の記事の insert / update が毎回失敗する | WordPress 側は「一時的な失敗」に分類されると、カードが出ない。記事の書き込みが毎回失敗すると、差分の基準が進まず、毎日同じ範囲を取り直す | Google 側は 2026-10-17 に実際に起きたので、FR-011 でカードを出す。WordPress 側は、失敗が `console.error` に残る。気づけない事故が起きたら表示を見直す。WordPress でも 2026-10-17 に実際に起きた（kurupika24.com。Elementor で一覧の取得が毎回 500 になり、記事0件のまま本人には何も表示されなかった）。原因は一覧の件数を減らす取り直し（R-004）で解消したが、3日以上取り込めていなければ FR-012 のカードで知らせる | 特定できない | Google は対応（FR-011）、WordPress は対応（FR-012） |
| R-004 | 1日1回の起動で、対象者全員を処理し切れない | 時間の上限で打ち切られたユーザーは翌日まで更新されない。GSC はこれが3日以上続くと欠損になる。WordPress の初回全件取込（件数上限なし）が1人で時間の上限を超えると、そのユーザーは基準が進まず毎日やり直しになる。2026-10-17 の初回起動では、約12,000件のサイトの全件取込で800秒に達して関数ごと強制終了し、後ろの16人が取り込まれず、結果も記録されなかった | WordPress の cron は `maxDuration` を拡張上限（Pro・ベータ）の1800秒にし、時間予算を1700秒にする。取込には締め切り（バッチ開始＋時間予算）を渡し、ページの取得前と書き込みの前に確かめて、過ぎたら一時的な失敗で終える（関数ごと止まらず、結果とバッチの完了を記録できる。基準は進めない）。WordPress への各リクエストは60秒（締め切りが近ければ締め切りまで）で打ち切る。一覧のページが重くてサイト側が失敗した（5xx・応答が途中で切れた・タイムアウト）ときは、1回に取る件数を100→20→5と減らして同じ位置から取り直す（ページビルダーを使うサイトで、100件の描画が PHP の実行時間上限を超えるため）。設定に残っている投稿タイプの REST の入り口がサイトに無い（1ページ目が `404 rest_no_route`）ときは、そのタイプを飛ばして残りを取り込み、そのタイプを利用者の設定から外す（取り込む記事が無いため。取込全体を失敗にすると、取れた記事まで保存されない。設定から外すのは、後でタイプを設定に戻したときに投稿タイプの変更として基準が NULL に戻り、全件取得でそれまでの記事を取りこぼさないようにするため）。受け入れたリスク（2026-10-17、MVP として直さない）：①タイプを外す直前の設定の読み直しが DB エラーになると、外さないまま基準が進み、後で入り口が戻っても基準以前の記事は取り込まれない。②`/wp-json` が `rest_no_route` を返し `index.php?rest_route=` が別の 404 を返すサイトでは、入り口が無いと判定できず、取込全体が失敗する。どちらも起きたら直す。画面の一括取込（`/wordpress-import`）は `maxDuration` 800秒のまま、700秒で締め切り、「記事が多いため、時間内に取り込み切れませんでした。有料プランでは毎朝の自動取込で取り込みます。」と出す。全件取得はページごとに正規化して本文HTMLを持ち続けない（1万件超のサイトでメモリを使い切るのを避ける）。書き込みは新規100件ずつ・既存の更新は同時20件までに分ける（1回の upsert が本文込みで大きくなり、一斉の UPDATE で接続が詰まるのを避ける。500件ずつでは、約12,000件のサイトの初回全件取込で8回目の書き込みが失敗した。Supabase のログでは、その書き込み（`POST /rest/v1/content_annotations`）が JST 07:06:14 に HTTP 520 で失敗し、07:06:37 に Postgres が `57P03 the database system is not accepting connections` を返していた。`pg_postmaster_start_time()` は 2026-10-16 22:06:36 UTC で、DB がこの時刻に再起動している。本文込み500件の書き込みでメモリが足りなくなり DB が落ちたと推定する（メモリ不足そのものはログで確かめられていない。DB は `shared_buffers` 224MB・`max_connections` 60 の小さい構成）。DB は開発と本番で共有しているので、この数十秒は全ユーザーが接続できなかった。100件ずつにした後は再発していない。本文の長い記事が集中すると100件でも重くなりうるので、再発したら件数ではなく送信サイズで区切る）。初回全件取込が必要なユーザー（基準が NULL）は、ほかのユーザーをすべて処理してから処理する（1人あたりの時間の上限が無いので、先に処理すると後ろのユーザーが時間予算で打ち切られる）。そうしたユーザーがいる日は、ほかのユーザーに時間予算の半分までしか使わせない（ほかのユーザーだけで予算を使い切る日が続いても、初回全件取込が一度も始まらない状態にしない）。投稿タイプを外すだけでは基準をリセットしない（残りのタイプは差分取込を続けられる。足したときだけ全件取得に戻す）。片方の候補 URL がサイトの失敗（0・5xx）なら、もう片方の 403 では認証切れにしない（その形式がファイアウォール等で使えないだけのことがあり、再連携では直らないため）。401 は常に認証切れにする。処理順の先頭を日ごとに1人ずつずらし、打ち切られた日の末尾のユーザーが毎日同じ位置で切られ続けないようにする（人数 n なら n 日に1回は先頭になる）。そのうえで本番の初回起動で所要時間を測り、OPEN-001 で時間の上限を調整する。1人の全件取込が1700秒でも終わらないサイトが出たら、全件取込を途中から再開できるようにする（進み具合を保存する列を足す。2026-10-17 に設計を検討し、まず1800秒で様子を見ることにした） | 開発 | 未確認 |
| R-005 | Vercel Cron が同じ起動を2回届ける | WordPress の新規 insert が一意制約 `(user_id, wp_post_id)` / `(user_id, canonical_url)` に当たり、エラーが見かけ上増える。GSC・GA4 は upsert なので影響しない | 新規登録は `upsert(onConflict: user_id,wp_post_id, ignoreDuplicates)` にし、同じ記事の二重登録は黙って捨てる。`canonical_url` だけが重なる場合は取込全体を失敗にし、基準を進めない（もう一方の起動が保存済み） | 開発 | 対応済み |
| R-006 | GA4 の `syncUser` は、取得が0行のときにカーソルを進めない（`ga4ImportService.ts:187-193`） | GA4 側にデータが無いユーザーは、取得期間が毎日1日ずつ伸び続ける | 今回は直さない。API 呼び出しの増加が目立ったら直す | 開発 | 受容 |
| R-007 | 更新日が変わらずに、表示内容だけが変わるページ（ショートコードや外部データで表示が変わるもの） | 差分取込では拾えず、内容が古いまま残る（今の全件取込も、本文だけの変更は「変更なし」と判定して反映していない） | 対象ユーザーがいれば、週1回の全件取得などを別途判断する | PO | 受容 |
| R-008 | WordPress の公式に記載が無い挙動（§9 公式根拠（WordPress）の「公式に記載が無いこと」） | ・5.7 未満や WordPress.com で差分の指定が無視されると、毎回全件が返り、アクセス量が減らない（GrowMate 側の絞り込みで結果は正しい）。エラーになる場合は「一時的な失敗」が続く。<br>・認証切れが 401 / 403 以外で返ると、カードが出ない（R-003 と同じ）。<br>・WordPress と GrowMate の時計がずれていると、基準の前後で記事を取りこぼしうる。<br>・予約投稿の公開が WordPress 側で遅れ、公開時に公開日時が前回の基準より前のままだと、拾えない | 本番の初回起動のログで、差分の件数と失敗を確認する。問題が出たら取得方式を別途判断する | 開発 | 受容 |

### 確認質問

| ID | 確認質問 | 回答が必要な理由 | 回答者 | 期限 | 状態 | 回答 | 回答日 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Q-001 | 自動取込の対象は？ | 範囲を決めるため | ユーザー | — | 回答済み | GSC 日次指標・GA4 同期・WordPress 記事を、毎日自動で取り込む | 2026-10-13 |
| Q-002 | WordPress はどこまで取り込むか？ | 取込方式を決めるため | ユーザー（クライアント回答に基づく） | — | 回答済み | 新しく公開された記事と更新された記事だけ。手動の一括取込も差分にする | 2026-10-13 |
| Q-003 | 対象ロールは？ | 認可を決めるため | ユーザー | — | 回答済み | `paid` / `admin` | 2026-10-13 |
| Q-004 | GSC・GA4 はどの期間を取り直すか？ | 取得範囲を決めるため | ユーザー | — | 回答済み | 直近3日分を取り直して上書きする | 2026-10-13 |
| Q-005 | 連携が切れたときの見せ方は？ | 画面を決めるため | ユーザー | — | 回答済み | マイホームに、止まった理由と再連携が必要なことを表示する | 2026-10-13 |
| Q-006 | 実行時刻の制約は？ | schedule を決めるため | ユーザー | — | 回答済み | 既存の cron と重ならない時刻 | 2026-10-13 |
| Q-007 | 対象外は？ | 範囲を決めるため | ユーザー | — | 回答済み | 取り込んだ記事の AI 要約・評価の自動開始 | 2026-10-13 |
| Q-008 | 「重ならない」の判定と、具体的な時刻は？ | `vercel.json` に書くため | ユーザー | — | 回答済み | 起動時刻だけで判定する。GSC が JST 04:05、GA4 が 04:25、WordPress が 04:45 | 2026-10-13 |
| Q-009 | WordPress の認証が切れたときもマイホームに出すか？ | 画面とシナリオを決めるため | ユーザー | — | 回答済み | 出す（D-09）。判定方法は、自動取込の結果を保存して使う | 2026-10-13 |
| Q-010 | WordPress REST API の `modified_after` は、どの WordPress の版から使えるか。WordPress.com（`public-api.wordpress.com/wp/v2`）でも使えるか。使えない環境では、この指定が無視されて全件が返るのか、エラーになるのか | FR-003 の取得方式と、使えない環境での扱い（全件取得になってよいか、別方式が要るか）を決めるため | 一次情報照合（spec-review の audit） | spec-review 完了まで | 回答済み（audit 2026-10-13） | 5.7 から（"Introduced in 50024 the REST API posts collection endpoints now accept modified_before and modified_after"、make.wordpress.org 2021-02-23 の記事）。WordPress.com での扱いと、5.7 未満で無視されるかエラーになるかは公式に記載が無い。どちらでも実装が変わらないよう、GrowMate 側でも基準より後の記事だけを処理する（FR-003）。5.7 未満でアクセス量を減らすことは Non-goal、記載が無い点は R-008 | 2026-10-13 |
| Q-011 | ALT-001〜003、D-08、合意済みの解釈2点、Non-goal 2点を承認するか？ | Claude 案を確定させるため | ユーザー | — | 回答済み | 承認 | 2026-10-13 |
| Q-012 | トークンは有効でプロパティの権限だけが外れた（R-003）とき、マイホームに出すか？ | 2026-10-17 に GSC の日次取込で1人が毎回 403 になり、本人が気づけない状態だった | ユーザー | — | 回答済み | 出す。仕様に追記してから実装する（FR-011）。GA4 も同じ形で扱う。文言は Claude案・未確認 | 2026-10-17 |

### 未決定事項（今は決めない）

| ID | 未決定事項 | 今決めない理由 | 決めるタイミング | 決める人 |
| --- | --- | --- | --- | --- |
| OPEN-001 | 1回の実行の時間の上限（GA4 の今の値は `MAX_USERS_PER_BATCH = 10`、`MAX_DURATION_MS = 280_000`。`supabaseService.ts:1714-1719` の `limit(10)` も同じ人数の上限）。**制約**：3本とも、人数の上限は対象人数（ロールで絞り込んだ後の人数。GA4 は17人、2026-08-21）より小さくしない。打ち切りは時間の上限（`maxDuration` 800秒に対する余裕）だけで行う。今の10人の上限のままだと、毎朝全員を処理できず FR-002 を満たせない。**決定済み（2026-10-17）**：人数の上限は置かない。時間予算は GSC・GA4 が700秒（`maxDuration` 800秒）、WordPress が1700秒（`maxDuration` 1800秒、Pro の拡張上限・ベータ） | 時間の上限の値は本番で実測して調整すれば足りる。人数の上限は上の制約で決まる | 実装時（spec-to-pr の plan） | 開発 |
| OPEN-002 | ユーザー単位の失敗の返し方（`count-batch` の集計項目、`console.error` の形式）と、連携が切れたユーザーを毎日試し続けるか | マイホームの表示は FR-008 の状態で決まり、これに左右されない。既存の型に合わせれば足りる | 実装時（spec-to-pr の plan） | 開発 |
| OPEN-003 | WordPress の取込処理を、cron と手動の両方から呼べるようにする切り出し方（cookie のトークンと DB のトークンの使い分け、`refreshWpComAccessToken` の公開の仕方） | 取得方式は FR-003 で決まった。切り出し方はコードの構造の判断で、外から見える挙動（FR-003〜005・§6 状態遷移）は変わらない | 実装時（spec-to-pr の plan） | 開発 |
| OPEN-004 | 成功指標（§1）の目標値 | 実装は目標値に左右されない。仮置きの値は §1 にある | リリース前 | shoma-endo |

## 13. テスト・リリース・ロールバック

### テスト方針

- 単体・統合・E2E・実画面確認:
  - **cron ルート**：認証なしは 401 になること。対象一覧がロールで絞られていること（admin / paid / trial / unavailable）。
  - **GSC**：
    - 期間が PT の日付で計算されること（UTC 19:05 の起動で、終了日が PT の当日＝JST の前日と同じ日付、開始日がその2日前。夏時間・冬時間の両方）。
    - 自動取込のリクエストに `dataState: "all"` と、ページ指標の `rowLimit` 25,000 が付くこと。手動の `/gsc-import` と `gsc-evaluate` のリクエストは今のまま（`dataState` なし、既定の行数）であること。
    - `pageMetricsHitLimit` のとき `console.error` が出ること。
    - upsert で同じ日のデータが1日分のままであること。
    - 取込済み記事が1,000件を超えるユーザーで、1,001件目以降の記事の指標も記事に結び付き、捨てられないこと。
  - **GA4**：
    - 自動取込の開始日が「カーソルの翌日」と「前日の2日前」の早い方になること。
    - 手動同期（`/api/ga4/sync`）・`ga4-content-evaluate` の `syncUser(userId)`・手動の `backfillDays` の取込範囲が変わらないこと。
    - 対象が10人を超えても、時間の上限内なら全員を処理すること（OPEN-001）。
  - **WordPress**：
    - 差分の基準が無いときは全件を取り込み、あるときは `modified_after` と `after` を UTC のオフセット付きで付けて取得すること。
    - 1,000件を超える記事を、初回にすべて取り込むこと（件数上限なし）。
    - 取込済み記事が1,000件を超えるユーザーで、既存の記事を新規と誤判定しないこと（一意制約のエラーにならず、既存の記事が update されること）。
    - 打ち切り（時間の上限）・記事の書き込みの一部失敗・認証切れ・一時的な失敗の回は、差分の基準を進めず、翌回に取り残しが出ないこと。
    - 成功した回は、差分の基準が取込の開始時刻になること。
    - 本文だけを更新した記事が、本文ごと置き換わること。
    - 予約投稿（更新日時が基準より前で、公開日時が基準より後）が取り込まれること。
    - 差分の指定が無視されて全件が返っても、基準より後の記事だけを処理すること。
    - 変更の無い記事（基準より後に更新も公開もされていない）を書き換えないこと。
    - 手動の一括取込も同じ基準を使って進め、自動取込の結果は書かないこと。
    - 候補 URL のどれかが 401 で、成功した候補が無いときは「認証切れ」、最後の候補が 404 でも「認証切れ」になること。403 はほかの候補にサイトの失敗（0・5xx）が無いときだけ「認証切れ」、あれば「一時的な失敗」（例：`[500, 403]`）になること。WordPress.com のトークン更新失敗も「認証切れ」。それ以外は「一時的な失敗」。
    - 連携を保存し直すと、結果が未実行に戻ること。サイト（`wp_type` / `wp_site_url` / `wp_site_id`）が変わるか投稿タイプを足すと、差分の基準が NULL に戻ること。投稿タイプを外すだけなら戻らないこと。
  - **マイホーム**：`tests/unit/lib/home-today.test.ts` に、WordPress の認証切れ × ロール別の表示と、正常・未実行・一時的な失敗（3日未満）では認証切れのカードが出ないことを足す。3日以上取り込めていなければ FR-012 のカードが出て、認証切れのカードと重ならないこと（`isWordPressImportStalled` は `tests/unit/server/lib/wordpress-diff-import.test.ts`）。
  - **Google のプロパティ権限切れ（FR-011）**：
    - 判定：GSC は 403 かつ `forbidden` だけ、GA4 は 403 `PERMISSION_DENIED` で理由が付かないときだけ権限切れになること。割り当て超過・API 無効化・スコープ不足は権限切れにならないこと。
    - 結果の保存：権限切れのユーザーは「権限切れ」、取込できたユーザーは「成功」を書き、権限切れ以外の失敗では書き換えないこと（GSC・GA4）。
    - マイホーム：権限切れでカードが出ること、トークン失効のときは再連携カードだけが出ること、`trial` には出ないこと。
    - リセット：OAuth の upsert は GSC・GA4 とも、`/setup/gsc` の保存は GSC だけ、`/setup/ga4` の保存は GA4 だけを未実行に戻すこと。
  - **整合性テスト**：`cron-config-consistency.test.ts` で、`vercel.json`・`CRON_CONFIGS`・workflow matrix が一致していること。
  - **実画面**：admin で `/` のカードの表示と遷移先を確かめる。`/wordpress-import` で、差分取込の結果の件数を確かめる。
- Gherkinシナリオとの対応: §7 のシナリオ対応表の FR ごとに、上の単体テストを当てる。
- 外部API・失敗系・境界条件:
  - WordPress の 401 / 403 / 5xx / タイムアウト。WordPress.com のトークン更新失敗。
  - GSC・GA4 のトークン切れ。
  - GSC・GA4 のプロパティ権限切れ（FR-011）。
  - 0件の差分。
- セキュリティ・権限・RLS:
  - cron の認証。ロールでの絞り込み。
  - Service Role の書き込みに `user_id` の条件が付いていること。
- 非機能要件の測定: 本番の初回起動の所要時間（R-004）。
- ドキュメント: README の「主な機能」・環境変数（`CRON_SECRET`）・「運用」の節に cron の一覧があり、影響しそう（`README.md:25,199,299`）。要否の判断は spec-to-pr の readme_sync が行う。

### リリース方針

- リリース単位・段階展開: 1つの PR で出す。cron は `vercel.json` に登録した時点で、翌朝から動く。
- Feature Flag / allowlist: 使わない（MVP。止めたいときは `vercel.json` の該当行を消す）。
- データベース変更の適用順序:
  1. マイグレーション（列の追加のみ）を適用する。開発と本番は同じ Supabase なので、本番にも反映される。
  2. 生成型を更新する。
  3. アプリをデプロイする。
- 本番確認項目（初回起動から24時間以内。Vercel のログは1日しか残らないため）:
  - 3本が JST 04:05 / 04:25 / 04:45 に起動していること。
  - 各 cron の処理人数・成功・失敗。
  - WordPress の初回全件取込の所要時間。
  - マイホームの表示（admin で確認する）。

### ロールバック方針

- アプリケーションの戻し方: Vercel で直前のデプロイに戻す。または `vercel.json` から該当の cron を消す。
- DB変更の戻し方・逆マイグレーション: 追加した列は NULL 可で、旧アプリは参照しないので、戻さなくても害は無い。必要なら列を drop する逆マイグレーションを用意する。
- データ不整合時の復旧: GSC・GA4 は、手動の取込や翌日の取り直しで上書きできる。WordPress は、差分の基準を NULL に戻せば次回に全件を取り直せる。
- ロールバック判断者: shoma-endo

## 14. 実装手順・チェックポイント

### 手順

1. 要件定義（本ドキュメント）作成・レビュー
2. Gherkin受け入れ条件の確定（`02-gherkin.md`、承認済み）
3. 仕様レビュー通過（`.takt/workflows/spec-review.yaml`）
4. 実装（`.takt/workflows/spec-to-pr.yaml`）
5. 品質ゲート通過（`npm run verify`）
6. PR作成・レビュー・マージ

### チェックポイント

| チェックポイント | 確認内容 | 確認者 | 状態 |
| --- | --- | --- | --- |
| spec-review の audit | Q-010 と R-002 の公式ドキュメント照合の結果で、FR-003 の方式が確定しているか | shoma-endo | 照合済み（audit 2026-10-13。FR-001 / FR-003 / R-002 / R-008 に反映） |
| マイグレーション適用前 | 追加する列名と型（本番の DB にそのまま反映されるため） | shoma-endo | 未確認 |
| 本番の初回起動の翌日 | §13 の本番確認項目 | shoma-endo | 未確認 |
| FR-011 のマイグレーション適用前 | `gsc_credentials` に足す列名と型（`gsc_auto_import_status`・`ga4_auto_import_status` と各 `_at`） | shoma-endo | 承認済み（2026-10-17。適用後の advisors に新しい指摘なし） |
| FR-011 の本番反映後 | 権限切れの結果の記録（DB）と、カードの文言・判定ルール | shoma-endo | 記録は確認済み（2026-10-17、手動の日次取込）。文言・判定ルールは未確認 |

## 15. 完了条件

- Definition of Done（すべて満たして完了）:
  - FR-001〜FR-012 を満たし、§7 の全シナリオに対応する単体テストが通っている。
  - `npm run verify` が通っている。
  - 本番で、3本の cron が JST 04:05 / 04:25 / 04:45 に起動し、対象ユーザーの取込が記録されている。
  - `docs/plans/ga4-sync-cron-spec.md` の冒頭に、置き換え先として本仕様が書かれている。
  - `docs/specs/home-today-spec.md` の WordPress の扱いが更新されている。
- 検証方法・証跡（テスト結果・画面確認・ログ等）:
  - `npm run verify` の結果。
  - 本番の `cron_run_logs` と Vercel ログ（初回起動から24時間以内）。
  - admin でのマイホームの画面確認。
- 完了確認者・確認日: shoma-endo・未定

## 16. レビュー記録・承認・変更履歴

### レビュー記録

| 回 | 日付 | 指摘件数（🔴 / 🟡 / 🟢） | 反映状況 | 残置合意した論点と理由 |
| --- | --- | --- | --- | --- |
| 1 | 2026-10-13 | 2 / 9 / 2 | 13件すべて revise で反映（下の「revise での判断」） | 残置合意した 🟡 は無い |
| 2 | 2026-10-13 | 1 / 0 / 0 | 1件を revise で反映（下の「audit 2回目」）。回1の13件は audit 2回目で resolved、revise の指摘外の追加2点も audit 2回目で確認済み | 残置合意した 🟡 は無い |

- 反映した指摘（finding_id）:
  - 🔴 SPEC-NEW-gsc-datastate-pt-window → FR-001・§3・BR-02・ALT-003・R-002・§9 公式根拠（GSC）・§13
  - 🔴 SPEC-NEW-wp-initial-full-1000cap → FR-003・FR-004・FR-005・§8・R-004・§13
  - 🟡 SPEC-NEW-wp-update-body-skipped → FR-003・§9 データ・R-007・§13
  - 🟡 SPEC-NEW-wp-baseline-definition → §6 状態遷移・§9 データ・§13
  - 🟡 SPEC-NEW-q010-wp-version-wpcom → FR-003・§10・Non-goals・Q-010・R-008
  - 🟡 SPEC-NEW-wp-baseline-reset-on-relink → §6 状態遷移・§9 データ・§13
  - 🟡 SPEC-NEW-wp-status-write-rules → FR-005・FR-008・§6 状態遷移・§13
  - 🟡 SPEC-NEW-ga4-batch-cap-vs-goal → FR-002・§8・OPEN-001・§13
  - 🟡 SPEC-NEW-ga4-range-shared-path → FR-002・§10 再利用・§13
  - 🟡 SPEC-NEW-gsc-maxrows → FR-001・§10 再利用・§13
  - 🟡 SPEC-NEW-success-metric-claude-unapproved → §1 成功指標・OPEN-004
  - 🟢 SPEC-NEW-ui-card-wording → §6 UI 既存パターン対照表・状態別UI
  - 🟢 SPEC-NEW-readme-forecast → §13
- revise での判断（audit が選択肢を示した指摘。再 audit で確認すること）:
  - SPEC-NEW-wp-initial-full-1000cap は (a) 上限を外す を採用。(b)「上限を残し、`modified_gmt` 昇順で基準を進める」は、投稿タイプを順に取る既存の取得（`wordpressService.ts:600-625`）では、上限に達した投稿タイプより後の投稿タイプが1件も取れず、基準を進めれば取り残し、進めなければ毎回同じ1,000件を取り直すことになる。(a) は承認済みの Gherkin「公開済みの記事がすべて取り込まれる」をそのまま満たす。打ち切り時は基準を進めない規則（SPEC-NEW-wp-baseline-definition）で取り残しを防ぐ。
  - SPEC-NEW-wp-baseline-definition は「取込を開始した時刻（UTC）」を採用。取得中に更新・公開された記事を次回の範囲に残せる。`modified_gmt` の最大値では、公開日時で拾う予約投稿（下記）に対応できない。時計のずれは R-008 に残す。
  - SPEC-NEW-wp-status-write-rules は「手動の一括取込は結果を書かない」を採用。手動の WordPress.com 取込は cookie のトークンを優先する（`wordpressContext.ts:37`）ため、手動の成功は自動取込が使う DB のトークンの有効性を示さない。
  - SPEC-NEW-gsc-datastate-pt-window は audit の推奨どおり `dataState: "all"` を採用。D-04・Gherkin・R-001（確定前の値を取り直しで置き換える）と一致するので、確認質問は立てない。
  - SPEC-NEW-success-metric-claude-unapproved は OPEN-004 へ移した（PO の承認は記録していない）。
- revise が追加した点（audit の指摘外。再 audit で確認すること）:
  - FR-003 の取得に `after`（公開日時）を足した。予約投稿は公開時に `post_status` だけが変わり、更新日時が変わらない（§9 公式根拠（WordPress）の `wp_publish_post` / `check_and_publish_future_post`）。`modified_after` だけでは、Gherkin「前回の取込より後に新しく公開された記事が取り込まれる」を予約投稿で満たせないため。
  - 差分の基準を NULL に戻す保存経路に、audit が挙げた2関数に加えて `updateWordPressContentTypes`（`supabaseService.ts:900`、`wordpressImport.actions.ts:79` から呼ばれる）を含めた。
- audit 2回目:
  - 🔴 SPEC-NEW-annotation-lookup-db-max-rows → FR-001・FR-003・§9 データ・§10 再利用・§13
  - revise での判断（audit が「range ページング」と「差分取得で返ってきた記事のキーだけを指定して読む」の2案を示した。再 audit で確認すること）: range ページングを採用。
    - 既存の `SupabaseService.fetchAllPaged`（`supabaseService.ts:137`）を再利用できる。
    - 初回の全件取込では、キーを指定する読み方でも指定するキーが全記事分になり、読む量が減らない。
    - GSC の `loadAnnotationUrlMap` は、ユーザーの全記事の URL 対応表を作る関数。`importMetrics`（`gscImportService.ts:64`。手動の `/gsc-import` の `gscImport.actions.ts:58` と `gsc-evaluate` の `gscEvaluationService.ts:83` から呼ばれる）と `importQueryMetricsForUrl`（同 L285）が使う。ページングなら呼び出し元の引数を変えずに1か所で直せる。WordPress と同じ読み方に揃えられる。

#### 公式ドキュメント照合

- 実施 / 未実施: 実施（spec-review audit 2026-10-13、WebFetch で本文を取得。revise でも WordPress の3ページを追加で取得）
- 参照 URL と確認日（YYYY-MM-DD）・引用: §9「公式根拠（GSC）」「公式根拠（WordPress）」に記載（すべて 2026-10-13）。
- 公式に記載が無かった事項: R-008 に記録。

### 承認

| 役割 | 氏名 | 判定 | 日付 | コメント |
| --- | --- | --- | --- | --- |
| 要件承認者 | shoma-endo | 未承認 |  |  |
| 技術レビュー |  | 未承認 |  |  |

### 変更履歴

| 日付 | 変更内容 | 変更理由 | 変更者 |
| --- | --- | --- | --- |
| 2026-10-13 | 仕様書を作成（grill-to-gherkin run `20261013-030146-gsc-ga4-wordpress-gsc-ga4-w` から反映）。D-09 の判定方法を「自動取込の結果を保存して使う」に決定 | 新規作成 | shoma-endo（Claude Code） |
| 2026-10-13 | spec-review audit 1回目の13件を反映（GSC の PT 日付と `dataState: "all"`、WordPress の件数上限撤廃・差分の基準の定義・無条件の上書き・`after` の追加・結果の書き手と認証切れの判定、GA4 の人数上限と範囲計算の適用先、Q-010 回答、OPEN-004 新設、R-008 新設） | spec-review | Claude Code（spec-review revise） |
| 2026-10-13 | spec-review audit 2回目の1件を反映（取込済み記事の読み込みを range ページングで全件読む形にする：WordPress の一括取込と GSC の `loadAnnotationUrlMap`） | spec-review | Claude Code（spec-review revise） |
| 2026-10-13 | spec-review 通過（audit 1回目・2回目の指摘を反映。最終 audit で未解消事項なし） | 仕様レビュー | spec-review |
| 2026-10-13 | §5 の概算を 7.25〜15.25人日から 7.75〜14.75人日に見直した（EST-004・005・007） | spec-review で作業が増え、Q-010 と D-09 の判定方法が決まって不確実性が減ったため | shoma-endo（Claude Code） |
| 2026-10-14 | 実装 PR 作成（feature/auto-daily-imports）。日次cron（GSC・GA4・WordPress）の追加、WordPress差分取込、再連携カードを実装 | 仕様に沿った実装 | spec-to-pr |
| 2026-10-14 | PR #636 のレビュー指摘を反映：GA4 のカーソル無しユーザーは初回30日分を取る（FR-002）。WordPress の基準は、初回の全件取得が総数に届かない回と、取込中に連携先が変わった回は進めない。トークン更新の通信エラーは「一時的な失敗」にする。二重起動の扱い（R-005）。`/wordpress-import` の説明文 | Codex Bot（PC-1）と、サブエージェントのレビュー | shoma-endo（Claude Code） |
| 2026-10-14 | R-004 の対策に、処理順の先頭を日ごとにずらすことを追加（`runDailyImportBatch`） | 固定順だと「翌日に回る」が成り立たず、末尾のユーザーが永久に取り込まれないため（PR #636 の PC-2） | shoma-endo（Claude Code） |
| 2026-10-14 | R-004 の対策に、`/wordpress-import` の `maxDuration` 800秒、全件取得のページごとの正規化、書き込みの分割（新規500件ずつ・既存の更新は同時20件まで）を追加 | 約12,000件のサイトの利用者から1,000件を超えて取り込みたいと依頼があり、初回の全件取得を1回で終えられるようにするため | shoma-endo（Claude Code） |
| 2026-10-16 | `/wordpress-import` で、差分取込の対象が0件だった回の結果の1行目を「前回の取込以降に公開・更新された記事はありませんでした。」にする（§6 画面設計） | プレビューで0件の結果を見て、壊れたように見えると指摘があったため | shoma-endo（Claude Code） |
| 2026-10-17 | R-004 の対策に、WordPress の cron の `maxDuration` 1800秒・時間予算1700秒、取込の締め切り（ページの取得前と書き込みの前に確認）、各リクエスト60秒のタイムアウト、画面の一括取込の700秒の締め切りと文言を追加（§8 性能・R-004） | 初回起動（10/17 04:45）で約12,000件のサイトの全件取込が800秒に達して強制終了し、16人が取り込まれなかったため。途中から再開する案（列の追加）は、1800秒で足りなかったときに回す | shoma-endo（Claude Code） |
| 2026-10-17 | R-004 の新規の書き込みを500件ずつから100件ずつに変え、取込失敗のログに DB エラーの中身（message・code・details・hint）を残す | 1800秒化後の手動実行で、約12,000件のサイトの初回全件取込が新規書き込みの8回目で失敗し、ログに中身が残らず原因を確定できなかったため | shoma-endo（Claude Code） |
| 2026-10-17 | R-004 に、一覧のページが重くてサイト側が失敗したときに1回の件数を100→20→5と減らして取り直すことを追加 | Elementor を使うサイト（kurupika24.com）で固定ページ100件の取得が PHP の30秒制限で毎回 500 になり、自動取込が毎日失敗して記事が0件のままだったため | shoma-endo（Claude Code） |
| 2026-10-17 | R-004 に、REST の入り口が無い投稿タイプ（`404 rest_no_route`）を飛ばし、設定から外すことを追加 | kurupika24.com の設定に残っていた `product` が `rest_no_route` になり、取れていた投稿・固定ページまで保存されず記事が0件のままだったため | shoma-endo（Claude Code） |
| 2026-10-17 | FR-011 を追加（GSC・GA4 のプロパティ権限切れをマイホームに出す）。§6 状態遷移・画面設計・誤読しやすい罠、§7 シナリオ、§9 データ、R-003、Q-012、Non-goal を更新。カードの文言は Claude案・未確認 | R-003 が実際に起きた（GSC の日次取込で1人が毎回 403。トークンは有効なのでカードが出ず、本人が気づけなかった）。ユーザー判断（Q-012） | shoma-endo（Claude Code） |
| 2026-10-17 | FR-011 のレビュー反映：権限切れの判定を権限不足の 403 に絞る（API 無効化・割り当て超過を除く）。カードの見出しを「プロパティ」にそろえ、説明に次の行動を足し、ボタンを「プロパティを選ぶ」にする。GA4 は設定を保存したら（プロパティが同じでも）NULL に戻す。成功の定義を明確にし、リセットのシナリオを足す | サブエージェントの self-review と UI/UX レビュー | shoma-endo（Claude Code） |
| 2026-10-17 | 一連の修正のレビューを反映：候補 URL の片方がサイトの失敗なら 403 では認証切れにしない（401 は認証切れ）、初回全件取込のユーザーを最後に回す、投稿タイプを外すだけでは基準をリセットしない（R-004・§6）。§8 の上限・OPEN-001 の決定・R-003 の実例・500件ずつの失敗の原因が未確定であることを反映 | サブエージェントによる経緯と修正内容のレビュー | shoma-endo（Claude Code） |
| 2026-10-17 | R-004 に、500件ずつの書き込みが失敗した原因（DB の再起動と重なっていたこと、メモリ不足と推定）を記録し、未確認事項から外す | Supabase のログ（Logs Explorer）と `pg_postmaster_start_time()` で確かめたため | shoma-endo（Claude Code） |
| 2026-10-17 | FR-011 を本番に反映し、手動の日次取込で結果の保存を確かめた（現在地を更新） | 本番での実証 | shoma-endo（Claude Code） |
| 2026-10-17 | FR-011 のレビュー反映：現在地を確かめた範囲だけに直す。§4・§6 画面一覧・状態別UIに FR-011 を足す。GA4 の判定を「直らない理由（API 無効化・スコープ不足）だけを除く」に戻し、公式の根拠の書き方を弱める。結果の記録は、取込に使ったプロパティがまだ選ばれている行にだけ書く。§14 にチェックポイントを足す | サブエージェントによる今日の対応全体のレビュー | shoma-endo（Claude Code） |
| 2026-10-17 | FR-012 を追加：WordPress の自動取込が一時的な失敗のまま3日以上取り込めていなければ、マイホームにカードを出す（§6 状態遷移・画面設計、R-003） | kurupika24.com が記事0件のまま本人に何も表示されなかったため。ユーザー判断（WordPress だけ、列は足さない） | shoma-endo（Claude Code） |
| 2026-10-17 | FR-012 のカードのボタンを「連携設定を開く」にし、文言を確認済みにした | 説明は「WordPress 側の設定」だが行き先は GrowMate の連携設定なので、取り違えないようにするため（ユーザー判断） | shoma-endo（Claude Code） |
| 2026-10-17 | FR-013 を追加：日次取込の失敗を毎朝 05:30 JST に運営向けに Lark へ送る（§8 障害対応、Non-goal を利用者向けの通知に限定） | cron が利用者ごとの失敗でも HTTP 200 を返し、Vercel の表示では気づけないため。ユーザー判断（送り先は CI と同じ `CI_WEBHOOK_URL`） | shoma-endo（Claude Code） |
| 2026-10-17 | FR-013 で、月曜以外は前日から増えた問題だけを送るようにした（月曜は全部） | 同じ問題が直るまで毎朝届くのを避けるため（ユーザー判断） | shoma-endo（Claude Code） |
