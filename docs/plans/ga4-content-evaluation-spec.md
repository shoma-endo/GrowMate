# GA4コンテンツ評価機能 仕様書（ドラフト）

## 1. 文書情報

| 項目 | 内容 |
|---|---|
| ステータス | レビュー指摘反映済み・確認質問回答待ち（Q-A / Q-B / Q-C / Q-D / Q1〜Q4 / Q7 / Q8 / D1 / D3 / D4） |
| 作成日 | 2026-08-12 |
| 対象 | GA4評価機能の初期実装 |
| 承認者 | **未承認**。owner-only MVP のみ合意済み（2026-08-13, Q6）。**UI方針は再合意待ち（D3）**、見積は合意待ち（D1） |
| 最終更新 | 2026-08-14 |
| 作成者 | GrowMate 開発チーム |
| 対象リリース | 未定（Q-A 回答後に確定） |
| 関連 Issue / PR | 未起票 |
| 重要な前提 | 繁田さんのシステムプロンプトは別途提供される |

この文書は、現時点の会議内容・既存コード・Google公式仕様をもとにした実装前の仕様ドラフトである。繁田さんのプロンプトで決まる評価観点・出力項目は、確定後に本書へ反映する。

## 2. 背景と目的

### 2.1 背景

GrowMateには、GA4とGSCのデータを使ってコンテンツの改善余地を評価する機能が必要である。既存のGA4取込では、ページ単位の日次データとイベントデータを一部取得できているが、評価結果を保存・履歴化し、改善提案として表示する機能は未完成である。

### 2.2 目的

記事ごとの複数指標をLLMに解釈させ、記事の課題・機会・次に取るべき改善行動を提示する。

評価の価値は、固定ルールで記事を分類して同じ提案を返すことではない。大量の記事について、GA4・GSC・記事情報を組み合わせ、数値の意味と記事内容の関係から提案を変えることにある。

### 2.3 成功条件

- 記事ごとに、評価状態・評価点数・評価パターン・根拠・改善提案を確認できる。
- GA4の数値が欠損している場合、0点や0件として誤評価しない。
- 同じ固定パターンを機械的に返さず、記事と指標に応じてLLMの提案内容が変わる。
- 評価に使用した期間・データ取得日時・プロンプトバージョンを追跡できる。
- GA4 APIの取得制約や再認証状態を、評価失敗と混同せず表示・記録できる。
- 未評価のコンテンツを一覧から発見できる（並び替え・絞り込み）。`docs/context/client-vision-from-lark.md` §1.9.5 の第1優先要求に対応する。

### 2.4 成功指標（KPI）

`docs/templates/requirement-definition.md` §1 成功指標表に相当。数値目標の最終確定は Q1/Q2 回答後。

| 指標 | 現状 | 目標 | 測定方法 | 測定時期 |
|---|---|---|---|---|
| 評価結果の保存成功率 | 機能なし（0%） | 評価実行リクエストのうち、スキーマ適合結果が `evaluated` で保存される割合 ≥ 95%（プロンプト確定後に再設定可） | DB 集計 + E2E | ステージング実データ検証 |
| 欠損値の誤評価 | 未計測 | 0 件（欠損を 0 として LLM 投入しない） | AC-03 + 単体テスト | CI |
| 評価停止の即時性 | 未計測 | DB Kill Switch 変更後、次リクエストから評価 API が停止 | AC-06 + 手動検証 | リリース前 |
| 二重実行 | 未計測 | 同一 `(user_id, content_annotation_id)` の同時評価 0 件 | AC-07 + DB 制約テスト | CI |

### 2.5 利用者・関係者

| 区分 | 対象 | 期待すること・責任 |
|---|---|---|
| 利用者 | GrowMate `paid` / `admin` ユーザー | `/analytics` で対象記事を探し、記事詳細で評価実行・結果確認・再実行 |
| プロンプト提供者 | 繁田さん | 評価軸・システムプロンプト・出力 JSON 契約の提供（§15 繁田確認 #1–5） |
| 開発・運用 | GrowMate 開発チーム | 実装、Kill Switch 運用、実データ検証 |
| 外部連携 | Google（GA4 Data API / GSC Search Analytics API） | 指標データの提供（読み取り専用 scope） |

### 2.6 業務フロー（As-Is / To-Be）

#### As-Is（現状）

```text
/analytics 一覧
  -> GA4/GSC 数値を目視確認
  -> 改善判断・優先順位付けは属人化
  -> 評価結果の履歴化・提案の体系的管理なし
```

#### To-Be（導入後）

```text
/analytics 一覧（get_filtered_content_annotations）
  -> 未評価フィルタ / 評価状態・点数・パターン確認
  -> 記事詳細の「コンテンツ評価」タブへ遷移
  -> GA4/GSC 指標・検索クエリ・記事情報を LLM へ構造化投入
  -> 点数・診断・提案を DB 保存（最新 + 履歴）
  -> 記事詳細で結果確認・再実行 -> 改善アクション
```

定期一括評価（Cron）はMVP対象外とし、手動の単記事評価のみを提供する（§3.2）。

### 2.7 業務ルール

`docs/templates/requirement-definition.md` §3「業務ルール」に相当する。本節は**新しい意思決定を導入しない**。本文各所に既出の不変条件へ ID を与え、受入条件・テストとの対応を追えるようにしたものである（本文が正本であり、齟齬がある場合は各ルールの「本文の定義箇所」を優先する）。

| ID | ルール | 例外 | 本文の定義箇所 | 対応する AC / テスト |
|---|---|---|---|---|
| BR-01 | terminal 状態になった評価履歴は不変とし、直接 UPDATE を許可しない。状態変更は専用 RPC 経由にする | なし。stale 実行を `evaluation_failed` + `evaluation_stale` として確定する操作は、terminal に到達させる操作であり本ルールに反しない | §7.1 / §7.4 / §3.3 削除行 | AC-07（stale）／§13 DBテスト |
| BR-02 | 欠損値を `0` に変換して評価を続行しない。欠損は欠損として明示する | **一覧の表示値としては** 0 フォールバックを維持する（`fetchGa4Summaries` は `analyticsContentService.ts:344-345` で `sessions = 0` のとき直帰率を `0` として返す。フェーズ0の特性テストで現状のまま固定する。§3.4）。**評価入力へ流用する際は 0 フォールバックを適用せず、`sessions = 0` の期間の直帰率を欠損として渡す**（§5.1 / §5.4 / §6.3.2 #2） | §6.5 / §5.1 | AC-03／§13 単体テスト（`sessions = 0` の直帰率が評価入力で欠損になる） |
| BR-03 | 新しい評価に失敗しても、既存の正常な評価結果と履歴を上書きしない | なし | §6.5 / §11 AI観点 | AC-04 / AC-09／§13 サービステスト |
| BR-04 | 同一 `(user_id, content_annotation_id)` で実行中の評価は同時に1件までとする | `lease_expires_at`（開始から15分TTL）を過ぎた実行は stale とみなし、旧 run を失敗として確定したうえで新しい `evaluation_run_id` を発行する | §8.1 / §7.4 | AC-07／§13 DBテスト（同時実行・stale回復） |
| BR-05 | Kill Switch が明示的に有効（`enabled IS TRUE`）でない限り、評価 API を実行しない。行なし・DB読取失敗も停止として扱う | 実行中の run は強制キャンセルせず、完了結果の保存だけを許可する（§8.1） | §8.2 | AC-06／§13 DBテスト（デフォルトfalse・権限） |
| BR-06 | Service Role 経路のクエリで `.eq('user_id', userId)` と対象記事IDの明示指定を省略しない | なし（RLS は当該経路で評価されないため代替にならない） | §7.2 / §7.5 | §13 DBテスト（ユーザー間の参照遮断）／R-04 |

## 3. 対象範囲

### 3.1 MVPで対象とするもの

- フェーズ0（事前リファクタリング）完了後の手動評価MVP。フェーズ0は利用者向け挙動を変更しない。
- GA4日次ページ指標の評価用取得。
- GSCページ指標の評価用取得・GA4との組み合わせ。
- 記事単位の評価実行、結果保存、履歴保存。
- 評価状態（未評価、評価可能、評価済み、データ不足、取得失敗、再認証必要）の表示。
- 評価点数・評価パターン・診断・根拠・改善提案の表示。
- 既存の記事詳細画面（`/gsc-dashboard?annotationId=...`）に「コンテンツ評価」タブを追加し、そこで評価の実行・結果・履歴を表示する。
- **（Q-A 回答待ち）** `engagementRate` と `screenPageViews` のGA4取込拡張。クライアント提示のパターン1〜3はPVとエンゲージメント率を条件に使うが、既存取込が固定する `landingPage` 軸で取得できる `screenPageViews` は「その記事に着地したセッションが閲覧した全ページの表示回数」であり、記事自体のPVと一致しない可能性がある（§4.1.1 / §16「公式未確認」）。**Q-A が回答されるまでMVP対象として確定しない。**
- 繁田さんのシステムプロンプトをDBのプロンプトテンプレートから読み込み、`system`ロールでLLMへ渡す処理。
- 評価結果の再実行。

### 3.2 MVPで対象外とするもの

- GA4取込時に全記事を自動評価する処理。2026-08-05 定例で「後回し」に合意済み（`docs/context/client-vision-from-lark.md` §1.9.5）。「実装難易度が最も高いと開発側が判断。評価が走っていないものをソートできれば手動運用で代替可能」という整理による。ただし代替手段とされた並び替えは未実装のため §10.2 で対象化する。
- LLMによる記事本文の自動編集・公開。
- 改善提案の自動メール送信（クライアント文脈 §1.9.4 との整合は Q4 で確認。確定までは Non-goal）。
- ヒートマップの導入・独自イベント設計。データが既存の入力に含まれる場合だけ、将来拡張できる入力項目として扱う。
- 固定ルールによる評価点数・パターン・提案文の算出。
- `app/ga4-dashboard/` の改修。`/ga4-dashboard` はサイト全体のGA4可視化画面（集計・ランキング・時系列）であり、記事単位のGA4/GSC評価・履歴・改善提案を持たせる画面ではないため、評価機能の対象外とする。
- 定期Cron・非同期ジョブによる一括評価。claim RPC、ジョブキュー、バッチ時間予算はMVPに含めない。MVPは手動の単記事評価のみとする。
- 記事詳細画面の新ルート化（`/analytics/[annotationId]`）と `/gsc-dashboard` からの移設、旧URL redirect、戻り先クエリの引き継ぎ。要件に画面配置の指定はなく、成功条件 §2.3 は既存画面へのタブ追加で満たせるため、画面構成の見直しは別チケットとする。
- 記事詳細画面の情報階層の再設計、レスポンシブ・アクセシビリティの新規要件定義。評価タブは既存画面の作りに従う。

### 3.3 認可とアクセス制御

既存実装 `canAccessGa4`（`src/server/lib/ga4-permissions.ts:7` の `['admin','paid']`）を正とする。許可ロールは `admin` と `paid` のみ。

**経路ごとのガードの実測（2026-08-14）:**

- `/analytics` は `proxy.ts:10` の `PAID_FEATURE_REQUIRED_PATHS = ['/analytics']` に含まれ、`proxy.ts:176-178` の `requiresPaidFeatureAccess` で `/unauthorized` へリダイレクトされる。
- **`/gsc-dashboard` は `PAID_FEATURE_REQUIRED_PATHS` に含まれない。** `app/gsc-dashboard/page.tsx:1-30` にロール判定はなく、`src/server/actions/gscDashboard.actions.ts` は `getAuthUserId` で `role` を取得するものの `canAccessGa4` を呼んでいない（同ファイルに 0 ヒット）。つまり `trial` 等のロールでも `/gsc-dashboard` に到達できる。

評価タブは `/gsc-dashboard` に置くため、**タブのデータ取得と Server Action / Route Handler の入口で `canAccessGa4` を必須検証し、許可されないロールにはタブ自体を描画しない**（採用理由・却下案は §15.4）。`proxy.ts` の `PAID_FEATURE_REQUIRED_PATHS` は変更しない。変更対象ファイルは §17、受入条件は AC-12 とする。

| 操作 | admin | paid | その他（trial 等） | 実装根拠 |
|---|---|---|---|---|
| 評価一覧・結果の閲覧（`/analytics`） | 可 | 可 | 不可 | `proxy.ts:10,176-178` の有料機能パス判定 + `canAccessGa4` |
| 評価タブの閲覧（`/gsc-dashboard`） | 可 | 可 | 不可 | 本機能で新設するタブ側の `canAccessGa4` 検証（`proxy.ts` は `/gsc-dashboard` を保護していない） |
| 評価の手動実行 | 可 | 可 | 不可 | Server Action / Route Handler の入口で `canAccessGa4` |
| 評価の再実行 | 可 | 可 | 不可 | 同上 |
| 評価結果・履歴の削除 | 不可 | 不可 | 不可 | MVPでは利用者・管理者とも削除操作を提供しない。ユーザー削除時の `ON DELETE CASCADE` による追随のみ。terminal履歴の直接UPDATEも許可しない（§7.4） |

GA4評価の共有ユーザー（スタッフ等）閲覧はMVP対象外とし、owner-onlyで実装する。共有閲覧が必要になった場合は、既存の共有モデルを流用せず、actorとownerを分けた別仕様・別migrationで設計する（§7.5）。

### 3.4 実装フェーズと概算工数

MVPはフェーズ0とフェーズ1のみとする。概算は8時間を1人日とした開発工数であり、仕様確定・レビュー待ち時間は別途である。

| フェーズ | 目的 | 主な成果物 | 工数 |
|---|---|---|---:|
| 0. 事前リファクタリング | 既存挙動を維持したまま、評価実装の境界を整理する | データ集約境界、LLM構造化出力アダプター、状態/エラー型、回帰テスト | 30〜45h |
| 1. 手動評価MVP | 1記事単位の評価・保存・表示を提供する | 現在状態projection・履歴・settingsのmigration/RLS、所有者検証trigger、`start_`/`finish_ga4_content_evaluation` RPCとDBテスト、一覧RPCへの成功履歴JOINと未評価フィルタ・並び替え、評価サービス、手動API、DB Kill Switch、stale回復、打ち切り検知（D4 次第）、評価タブの認可ガード、一覧の評価状態列、記事詳細の「コンテンツ評価」タブ、実データ検証 | 113〜158h |

MVP合計は **143〜203時間（18〜26人日）**。GA4取込拡張（12〜20h）は Q-A 回答待ちのため合計に含めていない。取込追加が確定した場合は §4.1.2 の後方互換対応と合わせて別途積む。フェーズ0では、GSC・GA4の全体的な共通化、無関係な既存サービスの再設計、画面仕様の変更を行わない。

#### フェーズ1の内訳

| 区分 | 内容 | 工数 |
|---|---|---:|
| DB | projectionと履歴の分離、settings、所有者検証trigger、開始/完了RPC 2本、同時実行DBテスト、一覧RPCへの成功履歴JOIN | 30〜42h |
| 評価サービス | 評価Context組立、GA4/GSC突合、LLM呼び出し、Zod検証、stale回復、Kill Switch判定、手動API | 40〜54h |
| 打ち切りへの対処 | 上表の 2〜4h は **D4 の (b)（`count:'exact'` 突合・`data_quality_json` への伝播・一覧側の部分取得表示。§10.2 / §11 / AC-13）を選んだ場合の見積**である。**(a) 現状維持**を選ぶ場合は不要となり合計から 2〜4h を減じる。**(c) `range` ページングでの全行回収**と **(d) 期間上限の導入**は作業内容が異なり、本書では未見積もりである（D4 確定時に再見積もる） | 2〜4h（(b) の場合） |
| 認可ガード | 評価タブのデータ取得・Server Action 入口での `canAccessGa4` 検証とタブ非描画（§3.3 / AC-12） | 1〜2h |
| UI（追加分） | 一覧の並び替え（評価状態・点数・最終評価日時）。現状 `AnalyticsTable.tsx` にソート機構が存在しないため新規実装 | 4〜6h |
| UI | 一覧の評価状態列・未評価フィルタ、記事詳細の「コンテンツ評価」タブ（状態・主操作・点数・診断・提案・根拠・履歴） | 20〜30h |
| 実データ検証 | 実GA4/GSCデータで画面値・保存値・API応答を突合 | 16〜20h |

`engagementRate` / `screenPageViews` の取込拡張（12〜20h）は、Q-A で `landingPage` 軸の値が要件を満たすと確認できた場合にのみ積む。確定していないため上表とMVP合計には含めない。**この12〜20hには、`ga4Service.ts` への `checkCompatibility` 経路の新設（現在未実装。取得指標を変更する前の互換性確認に使う。§9.2 / §17）を含む。**取込追加を決める場合は §4.1.2 の後方互換（既存レコードの再取込、リリース直後の評価可否）も同時に見積もる。

#### フェーズ0の代替案（採否の記録）

フェーズ0は §5.4 のとおり「既存の公開メソッドの入出力は維持する」改修であり、利用者から見た変化がない作業にMVP全体の20〜30%を割く。次の代替案と比較した結果、フェーズ0を維持する。

| 案 | 内容 | 却下・採用理由 |
|---|---|---|
| A（採用） | 先に `analyticsContentService` の責務を分離し、評価用の入力境界を新設する | 評価固有ロジックが既存サービスへ滲み出すのを防ぐ。特性テストを先に置くことでフェーズ1の回帰を検知できる |
| B（却下） | 既存サービスを触らず、フェーズ1で評価専用の取得経路を新設する | 期間集計・URL正規化・欠損判定が一覧側と評価側で二重化し、値の食い違いが利用者に見える形で発生する |

なお着手前の特性テスト追加は案Bを採る場合も必要である（既存テストは `tests/unit/server/services/analyticsContentService.test.ts:26,46,60` のRPC引数検証3件のみで、GA4集計値を検証していない）。

#### フェーズ0の完了条件

- **リファクタリング着手前に、現状の挙動を固定する特性テストを追加してある。** 既存の `analyticsContentService` テストはRPCへ渡す引数の検証3件のみで、GA4集計値を検証するテストが存在しない。責務分離で集計ロジックを移動しても型チェック・Lint・ビルド・既存テストは通ってしまうため、着手前に次を固定する。
  - GA4集計値: 直帰率がセッション数による**重み付き平均**であること（単純平均でないこと）、**分母0のときの直帰率は `null` ではなく `0` にフォールバックする**こと、CTRが `impressions > 0` のときのみ算出され0件時は **`null`**（0ではない）であること、**保存済みの `ctr` 列は読まず `search_clicks / impressions` から再計算する**こと、`normalized_path` 単位の日次合算、`is_sampled` / `is_partial` の **OR集約**、`(user_id, property_id)` 組でのフィルタ。
  - 早期returnの境界: `startDate > endDate`、日付未指定、有効な `canonical_url` が0件、GA4プロパティ未設定のとき空の集計を返すこと。
  - ページングと既存フィルタ: カテゴリ、未分類、未読提案、GSC評価未開始の各条件とページ番号の組み合わせ。
- 上記の特性テストがリファクタリング前後で同一結果を返す。
- `/analytics` の既存レスポンス、ページング、GA4集計値、既存フィルタの挙動が変更されていない。
- データ取得・期間集計・評価入力組立の責務が分離され、フェーズ1から評価専用の入力境界を利用できる。
- LLM呼び出し、JSON抽出、Zod検証、再試行、機密情報のログ出力制御を共通アダプターとして利用できる。
- 評価状態・エラーコードの型と状態遷移テストが追加されている。
- 既存テスト、型チェック、Lint、ビルドが通る。

フェーズ0で既存コードに手を入れるのは `src/server/services/analyticsContentService.ts` のみである。同サービスの利用箇所は `app/analytics/page.tsx` の `getPage` と `getAvailableCategoryNames` だけで、`fetchGa4Summaries` は private のため外部参照がない。したがって影響範囲は `/analytics` 一覧に閉じるが、影響がないことは上記の特性テストで確認する。

## 4. 指標とデータソース

### 4.1 評価候補指標

| 指標 | 正本データソース | 既存取込の実態 | MVP方針 |
|---|---|---|---|
| 滞在時間 | GA4 `userEngagementDuration` → `ga4_page_metrics_daily.engagement_time_sec` | `landingPage` 軸で日次取得済み | 利用する |
| エンゲージメント率 | GA4 `engagementRate` | **未取得**（DB列なし） | **Q-A 回答待ち**。パターン2・3の条件に含まれるが、`landingPage` 軸との組み合わせ可否・意味論が未確認（§16「公式未確認」） |
| オーガニック検索 ROI | 費用・売上データ | 未連携 | **未確定（Q3）**。確定までは評価入力に含めない |
| 表示回数 | GSC `impressions` → `gsc_page_metrics` | GSC Search Analytics API から取得済み | 利用する |
| CTR | GSC `ctr` → `gsc_page_metrics` | 同上 | 利用する |
| PV数 | GA4 `screenPageViews` | **未取得**（`page_views` 型定義のみ、migration 0件。リモートDBに列が実在する可能性あり → Q-D） | **Q-A 回答待ち**。パターン1・2・3すべての条件に含まれるが、`landingPage` 軸で取れる値は着地セッション基準（§4.1.1 / §16「公式未確認」） |
| 直帰率 | GA4 `bounceRate` → `ga4_page_metrics_daily.bounce_rate` | `landingPage` 軸で日次取得済み | 利用する |
| CV数 | GA4 `eventCount` → `ga4_page_metrics_daily.cv_event_count` | CV イベント名はユーザー設定依存 | 利用する（イベント定義は §15 繁田確認 #5） |
| ヒートマップ情報 | 外部サービス | なし | MVP対象外 |

#### 4.1.1 PV・エンゲージメント率を確定できない理由（Q-A）

既存取込は `landingPage` 軸に固定されている（`ga4ImportService.ts:257-267`）。この軸に `screenPageViews` を足した値の意味は、公式定義から次のように読める。

- `landingPage` は「セッション最初のページビューに紐づくページパス」（公式定義は §16 の verbatim 引用を参照）。ディメンションのスコープはセッションである。
- `screenPageViews` は「ユーザーが閲覧したアプリ画面またはWebページの数（`screen_view` + `page_view` イベント）」。計測単位はページ／画面の表示イベントである。

したがって `landingPage × screenPageViews` は「その記事に着地したセッションが閲覧した**全ページ**の表示回数」を意味し、記事自体のPVとは異なる可能性がある。

**根拠の限界（2026-08-14 再確認）:** 両者の組み合わせ可否について、Google 公式には**可・不可のいずれの明示記述も見つかっていない**。公式レポートの構成（どのレポートがどのディメンションと指標を組むか）を記載したページも特定できていない（§16「公式未確認」表）。したがって「公式レポートで組み合わされていない」という間接証拠を根拠にはできず、**公式に未記載であること自体**を理由に断定を避ける。パターン1〜3の判定根拠そのものが変わるため、**Q-A の回答と Compatibility API・実データでの実測の前に、取込追加をMVPへ確定しない**。

#### 4.1.2 追加指標の後方互換（Q-A 確定後に必要となる前提）

取込追加をMVPに含めると決めた場合、次を同時に決める必要がある。現時点では未定である。

| 論点 | 現状 | 必要な決定 |
|---|---|---|
| 既存レコードの値 | `20260207100000_add_ga4_daily_metrics.sql:113-133` に両列がなく、migration 後も既存行は NULL のまま | 過去分の再取込を行うか、行わないなら評価可能期間の下限をどう扱うか |
| リリース直後の評価可否 | §9.2.1 が「レポート0回（DBキャッシュ利用）」のため、取込開始日以前は両指標が欠損。AC-03 により `insufficient_data` となり**ほぼ全記事が評価不能**になる | 再取込計画、または取込開始日以前を対象外とする明示 |
| `page_views` 列のドリフト | `src/types/database.types.ts:241` に `page_views: number` があるが `supabase/migrations/` に定義が0件 | 既存列を使うか別名で追加するか、`ADD COLUMN IF NOT EXISTS` とするか、NOT NULL 制約の食い違いをどう扱うか（→ Q-D） |

**生成型からリモートDBの実在を推論しない（2026-08-14 実測）。** 生成型と `supabase/migrations/` は双方向にずれている。逆方向のドリフトの実例として、`prompt_versions.change_summary` は migration（`20250701000000_create_prompt_templates.sql:22`）に存在するが `src/types/database.types.ts` の `prompt_versions` Row には**存在しない**。したがって「生成型にある＝リモートに実在する」は根拠にならない。Q-D は**リモートDB（本番／ステージング）の実スキーマ照会**で確認する。

### 4.2 GA4/GSC データ契約（既存実装に固定）

#### 4.2.1 GA4 取込軸

既存 `ga4ImportService` は **`landingPage` ディメンション**（セッションスコープ）で日次指標を保存する。`pagePath` ではない。

- 保存先: `ga4_page_metrics_daily`（キー: `user_id`, `property_id`, `date`, `normalized_path`）
- 取得指標: `sessions`, `userEngagementDuration`, `bounceRate`, CV/scroll イベントの `eventCount`
- CVR 分母: `totalUsers` は `landingPage` と非互換のため **`sessions` を充てる**（既存実装コメント通り）

#### 4.2.2 使用しない列（死データ）

`ga4_page_metrics_daily` の `search_clicks`, `impressions`, `ctr` は、GA4 API 制約により **`landingPage` 軸では取得不可**のため取込時に **0 または NULL で保存**される。評価入力では **これらの GA4 列を使わない**。検索表示回数・CTR・クリック数の正本は GSC のみとする。

`landingPage` × 検索指標の非互換について、Google 公式 API スキーマ本文に明示的な記述は未確認である（§16「公式未確認」）。**Compatibility API による事前確認は現時点で未実装である**（`src/server/services/ga4Service.ts` の公開メソッドは `listProperties`（`:38` → `accountSummaries`）／`listKeyEvents`（`:82` → `keyEvents`）／`runReport`（`:114` → `:runReport`）の3本のみで、`:checkCompatibility` を呼ぶ経路がない。`src/` と `app/` に `checkCompatibility` は0ヒット。2026-08-14 実測）。

したがって現時点の根拠は `ga4ImportService.ts:257-259` のコードコメントのみであり、**公式正本ではない**（§16「公式未確認」の注記と同じ扱い）。Compatibility による確認は、**Q-A で取込追加が確定した場合に取得指標を変更する前に新規実装して実施する**ものであり（§9.2 / §17）、既存の検証実績として扱わない。MVP の評価実行経路では呼ばない（§9.2.1）。

#### 4.2.3 GSC 正本

検索表示回数・クリック数・CTR・掲載順位は `gscImportService` → `gsc_page_metrics` の値を正本とする。URL 突合キーは `normalizeUrl`（GSC 側）と `normalizeToPath`（GA4 側）の **2 系統**であり、評価サービスは両方を明示的に使い分ける（§5.1）。

#### 4.2.4 データ鮮度

- GA4: 公式に処理遅延が定義されている。「Data processing can take 24-48 hours. During that time, data in your reports may change.」（確認日 2026-08-13、§16 参照）。Standard プロパティは Intraday 2〜6時間 / Daily 12時間。したがって**直近48時間の値は後から変動しうる**。評価結果の点数変動が「記事の変化」か「GA4の後追い確定」かを区別できるよう、`ga4_data_fetched_at` に加えて評価対象期間の終端が取得時刻から48時間以内かを `data_quality_json` に記録する。鮮度指標としては `ga4_page_metrics_daily.imported_at` と評価結果の `source_data_fetched_at` を併用する。
- GSC: Search Analytics API の `dataState`（`final`（既定） / `all` / `hourly_all`）は**現状リポジトリに実装がない**（`gscImportService.ts` は `rowLimit` / `startRow` のみ）。MVPでは既定の `final`（確定データのみ）で取り込み、`dataState` の明示指定と記録は行わない（§3.2）。GA4側との非対称は §4.2.4 の GA4 側記録で補う。

## 5. 現行実装との関係

### 5.1 既存の再利用（必須）

以下は新規実装せず、既存経路を拡張して再利用する。

| コンポーネント | パス | GA4評価での使い方 |
|---|---|---|
| GA4 日次取込 | `src/server/services/ga4ImportService.ts` | 評価前のデータ鮮度確認（再取込は行わない。§9.2.1）。軸は `landingPage` 固定。**`engagementRate` / `screenPageViews` の取得追加は Q-A 回答後に対象化する（§3.1 / §4.1.1）。MVP では既存指標のみを使う** |
| GA4 一覧集計 | `src/server/services/analyticsContentService.ts` → `fetchGa4Summaries` | 記事 URL と `ga4_page_metrics_daily` の突合。評価入力の GA4 部分はこの集計ロジックを流用する。**流用するのは日次合算・セッション数による加重平均・`is_sampled`/`is_partial` の OR 集約であり、`sessions = 0` のときに直帰率を `0` とする欠損フォールバック（`analyticsContentService.ts:344-345`）は評価入力では適用しない**（BR-02 / AC-03）。この分岐がない実装は BR-02 違反とする |
| GSC 取込 | `src/server/services/gscImportService.ts` | 評価期間の GSC 指標取得 |
| 既存の記事詳細画面 | `app/gsc-dashboard/` + `gscDashboard.actions.ts` | 既存の3タブ（概要・検索クエリ分析・評価履歴）を変更せず、「コンテンツ評価」タブを追加する。ルート・URL・既存導線は変更しない |
| コンテンツ一覧 RPC | `get_filtered_content_annotations` | 次を追加して再作成する。**DROP FUNCTION → 再作成 → REVOKE/GRANT** の手順を踏む。<br>追加パラメータ: `p_has_unstarted_ga4_evaluation boolean`、`p_sort_key text`（`evaluation_status` / `score` / `last_evaluated_at` / 既定 `updated_at`）、`p_sort_order text`（`asc` / `desc`）。<br>追加JOIN: `ga4_content_evaluations`（`user_id` + `content_annotation_id`）、およびその `last_success_history_id` 経由で `ga4_content_evaluation_history`。<br>追加返却フィールド（`items` jsonb 内）: `ga4_evaluation_status`、`ga4_score`、`ga4_pattern`、`ga4_last_evaluated_at`。<br>`eligible` の判定は行わない（§6.5） |
| 未評価フィルタ UI | `AnalyticsTable.tsx` / `CategoryFilter.tsx` | 既存 GSC 未評価フィルタ（`p_has_unstarted_gsc_evaluation`）と同パターンで GA4 版を追加 |
| URL 正規化（GA4） | `normalizeToPath`（`src/lib/ga4-utils.ts`） | `ga4_page_metrics_daily.normalized_path` との突合 |
| URL 正規化（GSC） | `normalizeUrl`（`src/lib/normalize-url.ts`） | `gsc_page_metrics` との突合 |
| Google トークン | `googleTokenService.ensureValidAccessToken` | 再認証検知 |
| プロンプト管理 | `PromptService` + `prompt_templates` | GA4 評価用テンプレートを追加 |
| LLM 呼び出し | `llmChat`（`src/server/services/llmService.ts`） | 構造化出力の JSON 抽出・Zod 検証は `contentAnnotationSummaryService` パターンを踏襲 |
| 権限チェック | `canAccessGa4` | Server Action / Route Handler の入口で検証 |

### 5.2 再利用しないもの

GSCの`gsc_article_evaluations`と`gsc_article_evaluation_history`は掲載順位の改善判定を中心とした設計であり、GA4評価の点数・診断・提案を保存する用途には流用しない。GA4評価専用テーブルを追加する。

### 5.3 共通点と差分

共通点は、外部データを取込し、記事単位に評価を実行し、結果と履歴を保存する流れである。

差分は、GSC評価が順位変化の機械的な結果判定に近いのに対し、GA4評価はGA4・GSC・記事情報をLLMが総合解釈し、記事ごとに改善提案を生成する点である。GA4評価では、評価点数やパターンを固定条件分岐で決めない。

### 5.4 フェーズ0で行う事前リファクタリング

フェーズ0は既存機能の挙動を変えず、フェーズ1の実装に必要な境界だけを整理する。既存GSC評価のドメインロジックや、GA4/GSCのURL正規化仕様を無理に統合しない。

| 対象 | 方針 | 完了条件 |
|---|---|---|
| `analyticsContentService` | コンテンツ一覧ページングとGA4期間集計を責務分離する。既存の公開メソッドの入出力は維持する | 既存一覧、ページング、フィルタ、GA4表示値の回帰テストが通る |
| 評価入力 | GA4/GSC/記事情報を評価用Contextへ組み立てる境界を新設する。GA4は`normalizeToPath`、GSCは`normalizeUrl`を引き続き使い分ける。**一覧向けの欠損フォールバック（`sessions = 0` 時の直帰率 `0`）を評価入力へ持ち込まない分岐をこの境界に置く** | 欠損、期間、鮮度、データ品質がContextに明示される。**`sessions = 0` の期間の直帰率が `0` ではなく欠損として Context に載ることが単体テストで固定されている**（BR-02 / AC-03） |
| LLM呼び出し | `contentAnnotationSummaryService`等の実装を参考に、**既存サービスを変更せず**、GA4評価用の構造化LLMアダプターを新設する。JSON抽出、Zod検証、タイムアウト、再試行、ログ秘匿を呼出し境界に集約する | ドメイン固有の出力スキーマと評価結果保存は共通化せず、新規アダプターをフェーズ1から利用できる |
| 評価状態・エラー | `unassessed`等の状態、外部API/LLMエラーコード、既存結果保持の状態遷移を共通型・純関数として整理する | 状態遷移と異常系の単体テストがある |
| テスト基盤 | まず `analyticsContentService` の特性テスト（GA4集計値・早期return境界・ページング・既存フィルタ）を着手前に追加する。続いてGA4/GSC入力、欠損値、ユーザー分離、LLM不正出力、既存結果保持のfixtureを追加する | 特性テストがリファクタ前後で同一結果を返し、フェーズ1で同じfixtureを再利用できる |

フェーズ0では、GSC評価テーブルの流用、GSC評価ロジックの全面共通化、既存APIの変更、既存LLMサービスの変更、データベーススキーマ変更、UI変更を行わない。フェーズ0のfixtureは型・純関数レベルに限定し、評価テーブルを使うDB fixtureはフェーズ1で追加する。

## 6. 機能仕様

### 6.1 評価対象の決定

1. ユーザーに紐づくコンテンツ一覧から評価対象記事を取得する。入口は `get_filtered_content_annotations` RPC（`analyticsContentService.getPage`）。
2. 記事 URL を正規化し、GA4 ページデータと GSC ページデータを同一記事へ紐づける。
   - GA4 突合: `normalizeToPath(canonical_url)` ↔ `ga4_page_metrics_daily.normalized_path`
   - GSC 突合: `normalizeUrl(canonical_url)` ↔ GSC ページ指標
3. GA4 または GSC のデータがない場合は、欠損理由を保持する。GA4 の `search_clicks` / `impressions` / `ctr` 列は欠損ではなく **使用禁止（死データ）** として扱う。
4. 打ち切りの警戒対象は `fetchGa4Summaries` の日次行取得とする。一覧RPC（`get_filtered_content_annotations`）は `RETURNS TABLE(items jsonb, total_count bigint)` で**常に1行を返す**構造であり、`p_per_page` もサーバ側で `GREATEST(1, LEAST(100, ...))` にクランプされるため、PostgRESTの1000行上限の問題は発生しない。一方 `fetchGa4Summaries`（`analyticsContentService.ts:239,286-291`）は `ga4_page_metrics_daily` から日次行を `.in('normalized_path', …)` の1クエリで取得するが、`.limit()`・`range` ページング・`count:'exact'` のいずれも使っておらず、`app/analytics/page.tsx` の期間検証も書式のみで**期間長に上限がない**。正本 `docs/context/db-row-limits-and-data-truncation.md` が「`items.length >= limit` での検知は不可。必ず `count:'exact'` の総件数と比較する」と定めるとおり、現状は打ち切りを検知する手段がない。<br>ただし現行のページサイズは `app/analytics/page.tsx:50` で**10件固定**であり、**100日までは 1,000行に到達しない**（10記事 × 100日 = 1,000行）。一方で一覧の期間には上限がないため、**101日以上を指定すれば到達しうる**（§11）。対処方式（検知を実装するか、`range` ページングにするか、期間上限を設けるか、現状維持か）は D4 で確定する。
5. データ期間、最終取込日時、最小データ条件を確認し、評価可能な記事だけを LLM 評価へ進める。

フェーズ1では、フェーズ0で分離した評価用Context組立境界を利用する。`analyticsContentService`の内部実装や具体的な新規ファイル名を評価サービスから直接参照しない。

### 6.2 LLM評価

評価点数・評価パターン・改善提案は、固定ルールではなく繁田さんのシステムプロンプトに従って生成する。

実装側の責務は次に限定する。

- 指標と記事情報を正規化する。
- 欠損値とデータ期間を明示する。
- システムプロンプトとユーザー入力を分離する。
- LLMの構造化出力をスキーマ検証する。
- 不正な出力、タイムアウト、APIエラーを評価失敗として保存する。

パターン1〜3は、改善提案を一意に決める分岐ではなく、繁田さんのプロンプトにおける評価観点・出力分類として扱う。クライアント文脈（`docs/context/client-vision-from-lark.md` §1.9.2）に提示表があるが、**名称・条件・必須性の確定権はプロンプト受領後**（Q1）。確定前は実装契約に固定分岐を入れない。

**クライアント提示表の分類数（2026-08-14 実測）:** `client-vision-from-lark.md` §1.9.2 の見出しは「評価パターン（クライアント提示の 3 分類）」だが、**表は4行**あり、4行目に「全指標良好 / 条件 — / 順位が下がっていても広告出稿に耐える」がある。本書がこれまで扱ってきた「パターン1〜3」はこの4行目を含まない。`pattern` の列挙値と §7.3 の CHECK 制約が3値か4値かで変わり、4分類目に該当する記事がどのパターンにも当たらなくなるため、分類数そのものを Q1 で確定する（§15.2）。3行目の表記揺れ（表では「3（発言上は「パターン C」）」）も Q1 に含める。

### 6.3 LLM入力契約

#### 6.3.1 システムプロンプト

- 保存先: `prompt_templates` の GA4 評価用テンプレート。
- LLM へのロール: `system`。
- バージョン追跡: 評価履歴に `prompt_template_id`、既存 `prompt_versions(id)` への参照（`prompt_version_id`）、`version`、更新日時、プロンプト本文のSHA-256を保存する（§7.3）。`prompt_versions` は `supabase/migrations/20250701000000_create_prompt_templates.sql` で**既に存在する**ため新規テーブルを作らない。`prompt_templates` / `prompt_versions` 側への**ハッシュ列追加も行わず**、hashは評価履歴側で保持する。
- 内容: 繁田さんが定義する評価目的、評価観点、点数・パターン・提案の出力ルール。**プロンプト未受領は実装ブロッカー**。

#### 6.3.2 Context Assembly Contract

| # | 入力要素 | 取得経路 | 上限（MVP 固定値） | 超過時の削減順序 | 注入条件 | ログ/禁止 |
|---|---|---|---|---|---|---|
| 1 | 記事メタ（ID, URL, タイトル, 要約） | `content_annotations` | 本文系合計 **80,000 文字**（`CONTENT_ANNOTATION_SUMMARY_MAX_CONTENT_CHARS` と同値を暫定採用。ただし既存実装での意味は**超過時に処理を拒否する閾値**であり、本仕様では**削減を開始する予算**として使う。セマンティクスが異なる点に注意し、確定時はGA4評価専用の定数を新設する） | (a) `wp_content_text` 省略 → (b) `wp_excerpt` のみ → (c) タイトル+URL のみ | 常時 | プロンプト全文・記事全文を通常ログに出さない |
| 2 | GA4 期間集計 | `fetchGa4Summaries` 相当（**`sessions = 0` 時の直帰率 `0` フォールバックは適用せず欠損として渡す**。§5.1 / BR-02） | 期間 **最大 90 日**、日次推移 **最大 90 行/記事** | (a) 日次推移省略 → (b) 期間集計のみ | GA4 連携済み | `search_clicks`/`impressions`/`ctr` 死列は注入しない |
| 3 | GSC 期間集計 | `gsc_page_metrics` | 同上 | 同上 | GSC 連携済み | — |
| 4 | CV イベント定義 | ユーザー設定 + GA4 イベント名 | イベント名 **最大 10 件** | 件数超過は `data_quality_json` に partial を記録 | CV 評価に使う場合 | — |
| 5 | データ品質 | サービス層で組み立て | — | — | 常時 | 生 API レスポンス全文は注入しない |
| 6 | システムプロンプト | `prompt_templates.content` | LLM モデル上限に依存 | — | テンプレート有効時 | アクセストークン・Service Role キーを注入しない |

**実装ブロッカー（プロンプト受領まで固定不可）:** 出力 JSON の必須フィールド・列挙値、点数の意味、パターン名、記事本文を渡す場合の最終上限、提案数。

#### 6.3.3 ユーザー入力（JSON ドラフト）

JSON ブロックとして次の情報を渡す。具体的な必須項目と上限の最終確定は、繁田さんのプロンプトとトークン予算に合わせて確定する（上表の固定値を起点とする）。

- 記事識別子、URL、タイトル、記事の要約または評価に必要な記事情報。
- 評価対象期間、データ取得日時、データの鮮度（§4.2.4）。
- GA4 の期間集計値と必要な推移。
- GSC の期間集計値と必要な推移。
- CV イベント名と、その定義が確認済みかどうか。
- 欠損指標、取得失敗、サンプル数不足などのデータ品質情報。

LLM へアクセストークン、個人情報、不要な生ログ、全記事本文を無制限に渡さない。

#### 6.3.4 出力契約（ドラフト）

```json
{
  "score": 0,
  "pattern": "pattern_1",
  "diagnosis": "",
  "evidence": [
    { "metric": "", "value": "", "interpretation": "" }
  ],
  "recommendations": [
    { "title": "", "action": "", "priority": "high" }
  ],
  "llm_data_quality": "sufficient"
}
```

上記のフィールド名、列挙値、点数の意味、提案数はドラフトであり、繁田さんのプロンプト受領後に確定する。実装では確定した契約をZod等で検証し、検証失敗時は結果を公開状態にしない。

**出力形式の要件:** 踏襲対象の抽出実装（`contentAnnotationSummaryService.ts` の `JSON_BLOCK_REGEX`）は ```json フェンスで囲まれたブロックのみを抽出し、フォールバックを持たない。したがってシステムプロンプトは **単一の ```json フェンスブロックで出力する**ことを要求しなければならない。フェンスなしで返るプロンプトが渡されると抽出が常に失敗し、全評価が `evaluation_failed` になる。

### 6.4 評価点数

評価点数は、改善優先度を利用者が把握するための補助情報である。クライアント文脈 §1.9.2 では「70点以下の一覧化」が言及されているが、**Must か任意かは Q2 で確定**。確定前は、70点等の閾値を UI フィルタ・並び替えに使うことは可能とし、閾値から提案内容を決定しない。

点数の算出根拠、上限・下限、データ不足時の扱いは、繁田さんのシステムプロンプトで確定する。

### 6.5 評価状態

最低限、次の状態を持つ。

| 状態 | 意味 |
|---|---|
| `unassessed` | 評価履歴がなく、評価可否をまだ判定していない表示上の状態。DBには永続化しない |
| `eligible` | 評価履歴がないが、表示時のデータ品質判定で必要データが揃っている表示上の状態。DBには永続化しない |
| `evaluated` | 最新評価が利用可能 |
| `insufficient_data` | データ期間・件数・指標が不足 |
| `import_failed` | 外部API取込に失敗 |
| `needs_reauth` | Google連携の再確認が必要。**DBには永続化せず、既存実装（`ga4-status.ts` / `gsc-status.ts`）と同じく読み取り時に導出する**表示上の状態 |
| `evaluation_failed` | LLMまたは出力検証に失敗 |
| `evaluating` | 評価処理中（手動実行中） |

欠損値を`0`に変換して評価を続行しない。新しい評価に失敗した場合、既存の正常な評価結果と履歴を上書きしない。

状態は永続と非永続に分ける。**`needs_reauth` を永続化してはならない。**既存実装では `needsReauth` は DB列ではなく読み取り時に導出される（`src/server/lib/ga4-status.ts`、`gsc-status.ts`）。永続化すると、再連携に成功しても `status` が `needs_reauth` のまま残り、§10.4 の操作制限（評価開始を無効化）により評価できず、評価しないと `status` が更新されないというデッドロックになる。

| 区分 | 状態 | 導出元 |
|---|---|---|
| 永続（`ga4_content_evaluations.status`） | `evaluated` / `insufficient_data` / `import_failed` / `evaluation_failed` / `evaluating` | 評価実行の結果 |
| 非永続（表示時に導出） | `unassessed` / `eligible` | 評価履歴の有無とデータ品質判定 |
| 非永続（表示時に導出） | `needs_reauth` | Google連携状態（`ga4-status.ts` / `gsc-status.ts`） |
| 非永続（表示時に被せる） | Kill Switch停止中 | `ga4_content_evaluation_settings.enabled` |

表示優先順位は 上から Kill Switch停止中 → `needs_reauth` → `evaluating` → 永続状態 とする。再連携が成功すれば `needs_reauth` は次の描画で自動的に解消し、直前の永続状態（`evaluated` 等）が表示される。

`unassessed` / `eligible` の導出責任は次のとおり分ける。大量一覧で記事ごとの追加クエリを発生させない。

- 一覧（`/analytics`）: 一覧RPCが永続状態・最後の成功結果（点数・パターン・最終評価日時）・`unassessed` の別を返す。**`eligible` は一覧では導出しない**（記事ごとのデータ品質判定をSQL内で行わないため）。評価履歴がなければ一律 `unassessed`（表示は「未評価」）とする。
- 記事詳細（「コンテンツ評価」タブ）: 評価履歴がない記事について、その場でデータ品質を判定し `unassessed` / `eligible` を区別する。**詳細画面の `unassessed` は「評価履歴がなく、かつ必要データが不足している」状態を指す**（データが揃っていれば `eligible` になるため）。

したがって同じ `unassessed` でも一覧と詳細で母集合が異なる。一覧で「未評価」と表示された記事を開くと、詳細では「評価可能」または「未評価（データが不足）」のどちらかに分かれる。**ユーザー向け表示を同一文言にしない**（§10.4）。

| 画面 | `unassessed` の意味 | ユーザー向け表示 |
|---|---|---|
| 一覧 `/analytics` | 評価履歴がない（データ品質は判定しない） | 未評価 |
| 記事詳細タブ | 評価履歴がなく、必要データも不足 | 未評価（データが不足） |

評価開始・stale回復・完了・失敗はDB RPCで原子的に行い、同じ `evaluation_run_id` を条件に古い実行が新しい評価を上書きできないようにする。

## 7. データ設計（案）

### 7.1 新規テーブルの役割

テーブル名は以下で固定する。`ga4_content_evaluations` は評価結果そのものではなく、記事ごとの現在状態を持つprojectionとする。

- `ga4_content_evaluations`: 記事ごとに1行。評価状態、実行中のrun、最後に成功した履歴への参照を持つ。評価本文・JSONの正本は持たない。
- `ga4_content_evaluation_history`: 評価実行1回につき1行。成功・失敗・staleを含む全runのスナップショットを保存する。terminal状態になった行は原則不変とする。
- `ga4_content_evaluation_settings`: Kill Switchを管理する単一行設定。`id smallint`（常に1）、`enabled boolean`（デフォルトfalse）、`updated_at`、`updated_by uuid nullable`を持つ。MVPでは設定画面を追加せず、許可された運用手順または管理者専用経路から更新する。

GA4評価の改善提案はMVPでは既存のGSC未読通知・`unread_suggestion`フィルタへ統合しない。GA4評価用の既読管理・通知は別仕様とする。

### 7.2 現在状態テーブル `ga4_content_evaluations`

- `id` (`uuid`, PK)
- `user_id` (`uuid`, NOT NULL, FK → `public.users(id)` ON DELETE CASCADE)
- `content_annotation_id` (`uuid`, NOT NULL, FK → `public.content_annotations(id)` ON DELETE CASCADE)
- `status` (`text`, NOT NULL, CHECKで状態を限定)
- `active_run_id` (`uuid`, nullable。評価中のみ設定。`ga4_content_evaluation_history.evaluation_run_id`を参照)
- `last_success_history_id` (`uuid`, nullable。最後に成功した履歴を参照。履歴削除時はNULL化)
- `last_success_evaluated_at` (`timestamptz`, nullable)
- `evaluation_started_at` (`timestamptz`, nullable。stale判定の正本)
- `lease_expires_at` (`timestamptz`, nullable。DB時刻で15分TTLを管理)
- `last_error_code` (`text`, nullable)
- `last_error_message` (`text`, nullable。ユーザー表示可能なsanitized値のみ)
- `created_at`, `updated_at` (`timestamptz`)

評価点数、パターン、診断、根拠、改善提案、期間、データ品質は `last_success_history_id` から履歴を取得する。一覧RPCでは最後の成功履歴をJOINして、点数・パターン・最終評価日時を返す。現在の失敗状態と過去の成功結果を同じ列群へ混在させない。

`content_annotations.user_id` は既存仕様上 `text`、新規テーブルの `user_id` は `uuid` FKとする。型をまたぐため、評価テーブルへのINSERT/UPDATE時に、DB triggerで `content_annotations.user_id = NEW.user_id::text` を検証する。

**所有者境界の一次防衛線はアプリケーション層の明示スコープである。** 本機能の実行経路は §7.5 のとおり `SupabaseService`（Service Role）経由であり、`.agents/skills/supabase/rls.md` が「`SupabaseService` 経由の Server Action / Route Handler は Service Role Client を使用するため、RLS は適用されません」と定めるとおり、§7.5 の RLS ポリシーはこの経路では評価されない。したがって次のように責任を分ける。

| 操作 | 一次防衛線 | 補助 |
|---|---|---|
| INSERT / UPDATE | DB trigger（`content_annotations.user_id = NEW.user_id::text`） | アプリ層の `.eq('user_id', userId)` |
| SELECT / DELETE | **アプリ層の `.eq('user_id', userId)` と対象記事IDの明示指定**（trigger は INSERT/UPDATE のみで発火せず、この経路を守らない） | RLS（anon / session 経路への多層防御としてのみ機能） |

**MVP では DELETE 経路をアプリケーションに実装しない**（§3.3）。行が消えるのはユーザー削除時の `ON DELETE CASCADE` のみである。上表と §7.5 の DELETE に関する記述は、将来 DELETE を提供する場合に備えた多層防御の設計であり、MVP に削除操作が存在することを意味しない。

`.eq('user_id', userId)` を省略してはならない（`.agents/skills/supabase/service-usage.md`「RLS が効かないため、アプリケーション層での明示的な ID チェックを省略してはなりません」）。SELECT / DELETE の所有者検証は §8.1 の評価サービスおよび一覧RPC呼び出し側の責務とする。

migration前に既存 `content_annotations.user_id` がUUID文字列表現であることを確認し、違反行がある場合は評価テーブルの適用を停止する（手順は §14 リリース順序、テストは §13 DBテスト）。

### 7.3 履歴テーブル `ga4_content_evaluation_history`

履歴は成功・失敗・staleを含む論理評価runごとに1行保存する。LLMの再試行は同じrun内の `attempt_count` で記録し、stale回復時は旧runを失敗履歴として確定して新しいrunを作成する。

- 識別・所有: `id uuid PK`、`evaluation_run_id uuid NOT NULL UNIQUE`、`user_id uuid NOT NULL FK → public.users(id) ON DELETE CASCADE`、`content_annotation_id uuid NOT NULL FK → public.content_annotations(id) ON DELETE CASCADE`
- 状態・時刻: `status NOT NULL`、`started_at`、`completed_at`、`attempt_count NOT NULL DEFAULT 0`
- 結果: `score`、`pattern`、`diagnosis`、`evidence_json`、`recommendations_json`、`data_quality_json`（サービス層が組み立てた**入力側**のデータ品質。LLM出力の `llm_data_quality` スカラーは同JSON内の独立キーとして格納する。UIの「データの品質」表示はサービス層側を正とする）
- 対象: `period_start`、`period_end`、`canonical_url_snapshot`、`title_snapshot`
- データ追跡: `ga4_property_id`、`gsc_property_uri`、`ga4_data_fetched_at`、`gsc_data_fetched_at`、`context_schema_version`、`input_fingerprint`
- プロンプト追跡: `prompt_template_id uuid`、`prompt_version_id uuid`（いずれもnullable、`prompt_versions(id)`への参照は`ON DELETE SET NULL`）、`prompt_version integer`、`prompt_captured_at timestamptz`、`prompt_content_sha256 text`
- 失敗: `error_code`、`error_message`（APIキー、トークン、生レスポンス、プロンプト本文を含まないsanitized値）
- 監査: `created_at`、`updated_at`

`period_start <= period_end`、terminal状態では`completed_at IS NOT NULL`、`evaluated`では結果項目が存在することを制約または保存処理で保証する。`score`の範囲・`pattern`の列挙値はQ1のプロンプト契約確定後にCHECK制約を追加する。

既存の `prompt_versions` を評価時点のバージョン識別に利用する。履歴はプロンプト削除で失われないよう、履歴側の参照は `ON DELETE SET NULL` とし、version・取得時刻・本文hashを別途保存する。

- `prompt_content_sha256` は **`prompt_versions.content`（変数展開前のテンプレート原文）の UTF-8 バイト列に対する SHA-256 を小文字 hex** で保存する。変数展開後の実送信文字列は保存もハッシュもしない（記事ごとに変わりバージョン追跡にならないため）。
- `prompt_versions` の実列は `id, template_id, version, content, change_summary, created_by, created_at` であり **`updated_at` は存在しない**（`20250701000000_create_prompt_templates.sql:17-25`）。よって更新日時は保存せず、評価がそのテンプレートを読み出した時刻を `prompt_captured_at` として記録する。

### 7.4 制約・インデックス

- `(user_id, content_annotation_id)`に現在状態の一意制約を設ける。
- `(user_id, content_annotation_id, evaluation_run_id)`に履歴の一意制約を設ける。`evaluation_run_id`単体にも一意制約を設ける。
- 現在状態: `(user_id, status, updated_at DESC)`、`evaluating`用の部分インデックス、`content_annotation_id`参照用インデックス。
- 履歴: `(user_id, content_annotation_id, created_at DESC)`、`evaluation_run_id`検索用インデックス。
- `updated_at`は自動更新triggerで更新する。terminal履歴の直接UPDATEは許可せず、評価状態変更は専用RPC経由にする。
- JSONは表示用に保存し、一覧の検索・並び替えに使う値は履歴の通常列または一覧RPCのJOIN結果として扱う。
- `ga4_content_evaluation_settings` は `id smallint PRIMARY KEY CHECK (id = 1)` とし、migration適用時に`id=1, enabled=false`を作成する。行がない場合も安全側で停止する。

### 7.5 RLS・アクセス制御

**本機能の実行経路では RLS はバイパスされる。** Server Action / Route Handler は `SupabaseService`（Service Role）経由でアクセスするため、下記の RLS ポリシーは評価されない（`.agents/skills/supabase/rls.md`）。RLS は anon / session 経路からの直接アクセスに対する多層防御として設定する。**所有者境界の一次防衛線は §7.2 のアプリケーション層の明示スコープと DB trigger である。**

- 現行MVPはowner-onlyとする。評価結果・履歴テーブルはRLSを有効化し、SELECT/INSERT/UPDATE/DELETEすべてで `user_id = (SELECT auth.uid())` を検証する。**MVP ではアプリケーションから DELETE を実行しないため、DELETE ポリシーは将来の多層防御として置くものである**（§3.3 / §7.2）。共有ユーザー対応は別仕様・別migrationとし、`get_accessible_user_ids`を新規評価機能へ持ち込まない。
- 各評価テーブルで `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` を実行し、`PUBLIC`、`anon`、`authenticated`への不要なtable権限をREVOKEする。Server Action/Route Handlerは`SupabaseService`経由でアクセスし、必ず対象`user_id`と記事IDを明示する。
- `ga4_content_evaluation_settings` は直接のSELECT/INSERT/UPDATE/DELETEを`PUBLIC`、`anon`、`authenticated`に許可しない。Service Roleまたは明示的に認可された管理者経路だけが扱う。`updated_by`はService Roleの`auth.uid()`がNULLになり得るため、呼出し元で検証済みの管理者IDを明示的に保存する。
- `start_ga4_content_evaluation`、`finish_ga4_content_evaluation`等のRPCは`SECURITY DEFINER`またはService Role専用経路とし、`SET search_path = public`、テーブルのスキーマ修飾、`auth.role() = 'service_role'`検証、`PUBLIC`/`anon`/`authenticated`からのEXECUTE REVOKE、`service_role`へのGRANTを行う。
- migrationにはロールバック用の`DROP POLICY`、権限戻し、テーブル・インデックス・trigger・RPC削除手順をコメントで残す。

### 7.6 データの所有者・保持期間・削除条件

`docs/templates/requirement-definition.md` §8「データ」に相当する。

| 項目 | 内容 |
|---|---|
| 作成・更新・削除するデータ | `ga4_content_evaluations`（記事ごとの現在状態）、`ga4_content_evaluation_history`（run ごとの履歴）、`ga4_content_evaluation_settings`（Kill Switch 単一行） |
| データの所有者 | `user_id` の GrowMate ユーザー（owner-only、§7.5）。設定行は運用者 |
| 保持期間 | **MVP では評価結果・履歴に保持期間の上限を設けない**（無期限保持）。ロールバック時も削除しない（§14）。件数増加時の削除・アーカイブ方針は別チケットとする |
| 削除条件 | ユーザー削除・記事削除に伴う `ON DELETE CASCADE` のみ。利用者・管理者向けの削除操作は提供しない（§3.3）。terminal 履歴の直接UPDATEも許可しない（§7.4） |
| 既存データとの互換性 | 新規テーブルのみで既存テーブルのスキーマを変更しないため、既存レコードへの移行は発生しない。追加指標を取り込む場合の既存行の扱いは §4.1.2（Q-A 確定後） |
| ユーザー境界 | §7.2 のアプリ層明示スコープと DB trigger が一次、RLS が補助（§7.5） |

## 8. 評価実行フロー

```text
記事一覧（/analytics, get_filtered_content_annotations）
  -> 評価対象・データ期間を決定
  -> GA4/GSCデータを狙い撃ち取得（fetchGa4Summaries / gsc_page_metrics）
  -> データ品質を検証
  -> システムプロンプト + 構造化ユーザー入力をLLMへ送信
  -> 出力スキーマを検証（Zod, contentAnnotationSummaryService パターン）
  -> 最新評価と履歴を保存
  -> 画面へ表示
```

### 8.1 手動評価の実行設計

Server ActionまたはRoute Handlerから単記事評価を実行する。評価対象の決定、データ品質確認、LLM呼び出し、最新状態・履歴保存を1記事単位で行う。開始処理は複数のSupabase呼び出しで代用せず、`start_ga4_content_evaluation` RPCで原子的に行う。RPCは対象行を`FOR UPDATE`でロックし、`(user_id, content_annotation_id)`ごとに実行中runが1件だけになること、記事所有者が一致すること、Kill Switchが有効であることを同一トランザクション内で確認する。評価行がない場合の作成、履歴の`evaluating`行作成、`active_run_id`設定、`evaluation_run_id`生成もRPC内で行う。

`lease_expires_at` が現在時刻を過ぎている実行は stale とみなし、`start_ga4_content_evaluation` RPCが旧runを`evaluation_failed`・`error_code='evaluation_stale'`として履歴に確定してから、新しい`evaluation_run_id`を発行する。TTLは開始時刻から15分とする。`finish_ga4_content_evaluation` RPCは開始時の`evaluation_run_id`が現在の`active_run_id`と一致する場合だけ完了・失敗を保存する。これにより、プロセス異常終了後の固着と、古い実行による結果上書きを防ぐ。

手動評価の実行経路は `maxDuration=180秒`、LLM 1回あたりのタイムアウトは45秒、試行回数は初回を含めて最大3回、試行間隔は2秒とする。`llmChat` の既定は `timeoutMs ?? 300000`（5分）・`maxTokens ?? 3000` でいずれも呼出し側が上書き可能なため、**`timeoutMs: 45000` と `maxTokens` を明示的に渡す**。既定のままでは45秒制約が効かず `maxDuration` を超える。実装するRPCは単記事用の開始・完了2本のみで、定期Cron、複数記事用の`FOR UPDATE SKIP LOCKED` claim RPC、ジョブキューは対象外とする（§3.2）。Kill Switchを実行開始時に確認し、実行中のrunは強制キャンセルせず、完了結果の保存だけを許可する。

1回あたりのコスト上限と月あたりの想定評価件数はQ8で確定する。

### 8.2 Kill Switch（外部依存停止）

既存の feature flag 基盤は存在しない（`src/lib/constants.ts` の「Feature Flags」は AI モデル設定用）。MVPでは専用の `ga4_content_evaluation_settings` テーブルを使用し、DBの`enabled`をKill Switchとする。環境変数は使わない。

| DB設定 | 意味 | 停止時 UI |
|---|---|---|
| 行なし / DB読取失敗 | **停止**（安全側。未設定 = 未有効化） | 記事詳細の「コンテンツ評価」タブに「評価機能は現在停止中です」を表示し、評価・再評価を無効化する。`/analytics` 一覧は評価状態を停止中として表示する（一覧に評価実行ボタンは置かない）。文言と操作制限は §10.4 を正本とする |
| `enabled=false` | **停止** | 同上 |
| `enabled=true` | 評価実行を許可（ロール `admin`/`paid` は別途必須） | 通常表示 |

**判定ロジック:** 各評価リクエストで `ga4_content_evaluation_settings.enabled IS TRUE` を確認した場合のみ許可する。設定変更は次のリクエストから反映し、アプリの再デプロイを必要としない。DB読取失敗時も評価APIは実行しない。

**表示の合成規則:** Kill Switch の判定はページ側のデータ取得で1回だけ読み、画面表示に被せる。**一覧RPCは `ga4_content_evaluation_settings` を参照しない。** 停止中は評価状態列のみ「停止中」に上書きし、評価点数・パターン・最終評価日時は保存値をそのまま表示する。`evaluating` と停止中が同時に成立する場合は §6.5 の優先順位に従い停止中を優先する。

**Kill Switch は評価処理だけを止め、既存の取込経路は止めない**（§14 ロールバックと整合）。既存取込の実態は次のとおり（2026-08-14 実測）。

| 取込 | 起動経路 | Kill Switch の影響 |
|---|---|---|
| GSC 取込 | `app/api/cron/gsc-evaluate`（`gscEvaluationService.ts:81` 経由で間接実行）。スケジューラは `.github/workflows/hourly-cron.yml`（`vercel.json` は存在しない） | 停止しない |
| GA4 取込 | **Cron は存在しない。** `ga4ImportService` の呼出は `app/api/ga4/sync/route.ts` のユーザー起動 POST のみ | 停止しない |

`app/api/cron/` に存在するのは `gsc-evaluate` / `gsc-suggestions` / `google-ads-negative-keywords-suggestion` の3本で、GA4 取込 Cron は含まれない。したがって「GA4 取込 Cron を止めない」という表現は使わない。

## 9. 外部API・エラー仕様

### 9.1 Google認証・OAuth スコープ

必要スコープ（既存正本: `src/lib/constants.ts`）:

| 用途 | スコープ |
|---|---|
| GA4 Data API | `https://www.googleapis.com/auth/analytics.readonly` |
| GSC Search Analytics API | `https://www.googleapis.com/auth/webmasters.readonly` |
| ユーザー識別 | `https://www.googleapis.com/auth/userinfo.email`、`openid` |

実装では上記4スコープが `GOOGLE_SEARCH_CONSOLE_SCOPES`（`src/lib/constants.ts`）にまとめられており、**GA4 スコープは GSC の同意に同梱された単一同意**である。§9.1.1 の scope 縮小シナリオはこの構成を前提とする。

- `googleTokenService.ensureValidAccessToken` を利用する。
- 再認証が必要な場合は、§6.5 の**非永続状態として表示時に導出**し、既存の Google 設定画面へ誘導する。**`ga4_content_evaluations.status` には `needs_reauth` を保存しない**（永続化すると再連携後も解消せずデッドロックになる。§6.5）。
- 評価機能内で独自のトークン更新処理を作らない。

#### 9.1.1 連携ライフサイクル

**`needs_reauth` は永続状態ではない**（§6.5）。下表の「表示」列は表示時に導出する状態、「永続」列は `ga4_content_evaluations.status` と履歴に残る値を指す。

| イベント | 評価への影響 | 表示（非永続） | 永続・既存結果の扱い |
|---|---|---|---|
| リフレッシュトークン失効（`invalid_grant`、6 ヶ月未使用、ユーザー revoke 等。公式条件は §16「Google OAuth 2.0」） | 新規評価不可 | `needs_reauth`（「Google連携を確認してください」） | 既存の成功結果と履歴は保持。評価実行中に発生した場合は下記の永続ルールに従う |
| OAuth scope 縮小（`analytics.readonly` 不足） | 新規評価不可 | `needs_reauth`（`.agents/skills/google-integrations/SKILL.md` の実文は「**発火条件**: (a) refresh 失敗（期限切れ・取り消し）、(b) 必要スコープの不足。いずれも `ERROR_MESSAGES` 由来の文言とセットで返す」。同節のコード例は `needsReauth: true` を返す。実装 `ga4-status.ts:14,26` も `scopeMissing` → `needsReauth`） | 同上。不足 scope 名はサーバーログのみに出し、UI文言は既存 `ERROR_MESSAGES` に揃える。`import_failed` にすると主操作が「データを再取得」となり再連携導線が出ないため使わない |
| OAuth scope 縮小（`webmasters.readonly` のみ不足） | GSC データ取得に影響 | **MVP では検知しない**（下記） | — |
| Google アカウント削除・GrowMate ユーザー削除 | 新規評価不可 | — | 評価履歴は `ON DELETE CASCADE` でユーザーに追随。削除前の監査要件は別途 |
| 再連携成功 | 以降の取込・評価が可能 | 次の描画で `needs_reauth` が自動解消し、直前の永続状態を表示 | **欠損期間の自動埋め戻しは MVP 対象外**。再連携後は次回評価から新データを使用 |
| プロパティ/サイト URL 変更 | URL 突合失敗の可能性 | — | `insufficient_data` + 正規化失敗理由 |

**再認証事由で評価が中断したときの永続 status:** `needs_reauth` は永続5値（§6.5）に含まれないため、`finish_ga4_content_evaluation` は **`status='evaluation_failed'` + `error_code='needs_reauth'`** で確定する。表示は §6.5 の優先順位により `needs_reauth`（「Google連携を確認してください」）が被さる。`import_failed` は使わない（主操作が「データを再取得」になり再連携導線が出ないため）。受入条件は AC-05。

**GSC 側 scope 縮小を MVP の検知対象にしない理由（2026-08-14 実測）:** `ga4-status.ts:14,26` は `scopeMissing` を見るが、`gsc-status.ts:20` は `needsReauth: !hasValidToken` のみで scope を判定しない（`:29` で `scope` をそのまま返すだけ）。したがって `webmasters.readonly` だけが剥奪された状態は現状の実装では検知できない。§9.1 のとおり4スコープは `GOOGLE_SEARCH_CONSOLE_SCOPES` の**単一同意**にまとめられており、GA4 スコープを保ったまま GSC スコープだけが失われる状況は通常発生しない。この状態での GSC 取込の挙動は未確認である。`gsc-status.ts` への scope 判定追加は本 MVP の変更対象に含めず、§17 の別チケットとする。

### 9.2 GA4 API

- **Compatibility API による組み合わせ確認は、Q-A で取込追加が確定した場合に限り**、`ga4ImportService` の取得指標（`engagementRate` / `screenPageViews`）を変更する前に実施する。**評価実行経路では呼ばない。**公式定義（§16）のとおり Compatibility は「レポートリクエストに追加できるディメンション・指標」を列挙する API であり、レポートを発行しない評価経路（§9.2.1）には検証対象が存在しないためである。<br>この経路は現在未実装である（`ga4Service.ts` は `listProperties` / `listKeyEvents` / `runReport` の3メソッドのみ。`src/`・`app/` に `checkCompatibility` は0ヒット。§4.2.2 の実測）。新設は **Q-A 確定後の変更対象**とし、工数は §3.4 の取込拡張（12〜20h）に含める（§17）。
- 非互換の指標は、その指標だけを欠損扱いにするか、評価を `insufficient_data` にする。別指標を勝手に代替しない。
- API のレート制限、タイムアウト、権限エラー、プロパティ未設定をエラーコード化する。
- レポート取得の行数上限は公式に「If unspecified, 10,000 rows are returned. The API returns a maximum of 250,000 rows per request, no matter how many you ask for.」（確認日 2026-08-13、§16 参照）。`landingPage × date` で90日分を取ると既定の 10,000 行を超えうるため、取込は `limit` / `offset` のページングで全行を回収し、レスポンスの `rowCount` と実取得件数を突合して不一致を記録する（既存 `ga4ImportService.fetchReportWithPagination` の前提を明文化したもの）。
- 既存の評価結果を、今回の取得失敗で消去しない。

#### 9.2.1 GA4 クォータ（Standard Property, 2026-08-12 公式）

| クォータ | 上限 |
|---|---|
| Core Tokens Per Property Per Day | 200,000 |
| Core Tokens Per Property Per Hour | 40,000 |
| Core Tokens Per Project Per Property Per Hour | 14,000 |
| Core Concurrent Requests Per Property | 10 |

MVPでは**評価実行時に GA4 レポート API を呼ばない**。既存の取込済みデータのみを使用し、鮮度が閾値を超える場合は `insufficient_data` として扱う。再取得はユーザーが既存の取込導線から明示的に行う。したがって1評価あたりの GA4 API 呼び出しは **レポート 0 回・Compatibility 0 回**（合計0回）となる。Compatibility は評価実行経路ではなく、Q-A 確定後の取込指標変更時に実施する（§9.2）。

この方針により §5.1 の「評価前のデータ鮮度確認・再取込」は**鮮度の確認のみ**を指し、評価経路からの再取込は行わない。§10.4 の `import_failed` 時の主操作「データを再取得」も、評価経路ではなく既存の取込導線への誘導とする。大量評価時は `returnPropertyQuota: true` で消費をログ記録する。

### 9.3 GSC API

- ページ単位の `clicks`、`impressions`、`ctr`、`position` は GSC Search Analytics API から取り込んだ値を利用する。
- GSC 未連携、対象期間に行がない、URL 正規化で紐づかない場合を区別する。
- Search Analytics API は公式に「does not guarantee to return all data rows but rather top ones」（確認日 2026-08-13、§16 参照）と明記されている。評価対象記事の行が返らない場合を「データなし」と断定せず、上位行のみ返却された可能性として `data_quality_json` に記録する。§4.2.3 の「GSC を正本とする」はこの制約の上での正本という意味である。

#### 9.3.1 GSC クォータ・上限

| 項目 | 上限 |
|---|---|
| `rowLimit` | 1–25,000（デフォルト 1,000） |
| Per-site | 1,200 QPM |
| Per-user | 1,200 QPM |
| Per-project | 30,000,000 QPD / 40,000 QPM |

GrowMate は単一の GCP プロジェクトで全ユーザー分を呼び出すため、**per-project QPM が実効上限**になる。1ユーザーが複数サイトを持つ場合は per-user が先に効く。

1 ユーザー・1 評価バッチあたりの GSC 再取込は **`maxRows: 5000` 以下**（`gscEvaluationService` の既存値）を上限とする。

### 9.4 LLM

#### 9.4.1 再試行ポリシー

既存正本: `gscSuggestionJobService`（`suggestion_attempt_count >= 3` で terminal）。MVPは同期実行のみのため、間隔は固定2秒とし、`RETRY_DELAY_MINUTES` の15分は使わない。

| エラー種別 | 最大試行回数 | 再試行間隔 | 上限到達時 |
|---|---|---|---|
| 429 / 5xx / タイムアウト | **3 回**（初回含む） | **2 秒**固定（バックオフなし） | `evaluation_failed` |
| 構造化出力不正（Zod 検証失敗） | **3 回**（初回含む） | **2 秒**固定 | `evaluation_failed` |

試行回数は評価履歴に保存し、UI で「再試行中（n/3）」を区別できるようにする。

#### 9.4.2 ログ

- ログにはプロンプト本文、トークン、記事本文、認証情報を無制限に出力しない。

## 10. 画面仕様

### 10.1 画面責務

要件に画面配置の指定はないため、MVPでは新ルートを作らず既存画面を拡張する。

| 画面 | 責務 | MVPでの変更 |
|---|---|---|
| `/analytics` | コンテンツ一覧、カテゴリ/未評価フィルタ | GA4評価状態・点数・パターン・最終評価日時の列と未評価フィルタを追加 |
| `/gsc-dashboard?annotationId=...` | 1記事の詳細。既存は概要・検索クエリ分析・評価履歴の3タブ | 「コンテンツ評価」タブを追加。既存3タブの**内容と操作**・ルート・URL・既存導線は変更しない（`GscDashboardClient.tsx` の `TabsList` グリッド列数指定は4タブ化のため変更する） |
| `/ga4-dashboard` | サイト全体のGA4集計、ランキング、時系列 | 変更しない（§3.2 対象外） |

画面構成の見直し（記事詳細の新ルート化・移設・情報階層の再設計）は §3.2 のとおりMVP対象外とし、別チケットで扱う。

### 10.2 一覧画面 `/analytics`

- 既存のコンテンツ分析一覧（`AnalyticsTable.tsx`）に、GA4評価状態、評価点数、パターン、最終評価日時を追加する。
- `unassessed` / GA4未評価を**フィルタ**できるようにする（GSC未評価フィルタ `p_has_unstarted_gsc_evaluation` と同型）。
- 評価状態・評価点数・最終評価日時で**並び替え**できるようにする。クライアント文脈 §1.9.5 は「優先: ①未評価コンテンツの**ソート**」を第1優先と記録しており、フィルタでは代替しない。現状 `AnalyticsTable.tsx` のヘッダは非対話的な `<th>` で `onClick` も `aria-sort` もなく、行順は一覧RPCの `ORDER BY f.updated_at DESC NULLS LAST` 固定のため、**並び替え機構そのものを新規実装する**。一覧RPCに並び替えキーと昇降順のパラメータを追加し、ページングと整合させる。
- **並び替えは永続状態（一覧RPCが返す値）を基準とする。**表示時に被せる非永続状態（Kill Switch停止中、`needs_reauth`）は並び順に反映されない。一覧RPCは `ga4_content_evaluation_settings` を参照せず（§8.2）、`needs_reauth` は SQL 外で導出する（§6.5）ため、停止中・再連携待ちの記事は「表示は『停止中』／『Google連携を確認』だが、並び順は直前の永続状態（`evaluated` 等）に従う」ことになる。この挙動を仕様として固定し、並び替え UI は停止中も無効化しない（未評価コンテンツの発見は §2.3 の成功条件であり、評価停止中でも成立させる）。受入条件は AC-10 に明記する。
- **`fetchGa4Summaries` の打ち切りを検知したときの一覧表示:** `count:'exact'` の総件数と取得件数が一致しない場合、その集計値は部分取得である。**表示単位は「そのページの GA4 集計全体」とする。**理由は、`fetchGa4Summaries`（`analyticsContentService.ts:239,286-291`）が `.in('normalized_path', normalizedPaths)` で**そのページの全記事の日次行を1クエリで一括取得**しており、`count:'exact'` の差分は「打ち切りが起きた事実」しか示さないためである。**どの記事の行が欠けたかは、記事ごとの件数を持たない限り判別できない**（打ち切り位置以降の記事は0行で返り、「GA4データなし」と区別できない）。記事単位で部分取得を示す場合は、記事ごとに件数を取得するか `range` ページングで全行を回収して照合する必要があり、これは D4 の選択に依存する（§15.3）。<br>したがって一覧表示は「この一覧のGA4数値は一部が取得できていません」というページ単位の注記とし、数値を空欄にも0にもしない。評価実行時は §6.3.2 #5 のデータ品質として `data_quality_json` に伝播する。`data_quality_json` は評価履歴の列であり評価履歴のない記事には存在しないため、一覧側の表示は一覧RPC の応答とは独立にページ側で判定する。受入条件は AC-13（D4 確定後に対象化）。
- 一覧には診断・根拠・改善提案などの長文要約列を追加しない。既存テーブルの横幅とレイアウトを維持する。
- 記事詳細への遷移は既存の「詳細」ボタン（別タブで `/gsc-dashboard?annotationId=...` を開く）をそのまま使う。導線を変更しない。
- 文言は `.agents/skills/growmate-ui-ux/ui-text.md` に準拠する。

### 10.3 記事詳細の「コンテンツ評価」タブ

既存の記事詳細画面にタブを1つ追加する。既存タブの順序・内容・GSC固有の操作（`OverviewTab` の「最新化」、`SuggestionDataReadiness`、`EvaluationSettings` の評価周期・評価時刻設定と評価開始導線）は変更しない。

タブ内は上から次の順に表示する。

1. 評価状態と主操作（「評価を実行」または「再評価」）。GSC の「評価を開始」とは別の操作であることを文言で明示する。
2. 評価済みの場合のみ、評価点、診断の要約、評価対象期間、最終評価日時。未評価・評価不能時に点数を0として表示しない。
3. 「優先して改善すること」として、LLMが返した提案をタイトル・具体的な行動・優先度で表示する。
4. 「根拠となった指標」として、GA4・Google Search Console の指標を診断と隣接して表示する。日次推移は折りたたみ可能な詳細領域に置く。
5. 「データの品質」「データ取得日時」「評価対象期間」。プロンプトバージョンは「評価情報」の詳細欄で確認できるようにする。
6. このタブでの評価履歴。実行日時、状態、点数、パターン、対象期間、データ品質、診断、根拠、提案、失敗理由を表示する。既存「評価履歴」タブのGSC評価履歴とは統合せず、それぞれのタブに置く。

- ユーザー向けの表記は `.agents/skills/growmate-ui-ux/ui-text.md` の用語辞書に従う。
  - 引用（GA4 行の補足、verbatim）: 「フル表記は `Google Analytics 4`。初出はフル表記、以降 `GA4`（→「略語」）」。略語セクションの規定は「`GSC` のような略語は**その画面での初出でフル表記＋括弧書き**し、以降は略語を使う」で、例として `Google Search Console（以下、GSC）` が挙げられている。
  - 導出（本仕様での表記）: 上記2つを合わせ、画面初出は `Google Analytics 4（以下、GA4）`、以降は `GA4` とする。`Google Analytics 4（以下、GA4）` という文字列自体は辞書に記載がなく、略語ルールを適用した結果である。
  - 辞書にない「Google アナリティクス」は使わない。「Google Search Console」は辞書どおり。「再認証」はユーザー向けには使わず、「Google連携を確認」または「Googleを再連携」と表示する（辞書「再連携」行）。
- 同一画面に GSC 評価とコンテンツ評価の2種が並ぶ。
  - 引用（`ui-text.md`「評価」行の補足、verbatim）: 「Google Search Console 由来の評価。修飾を付けず「評価」と呼び、文脈は見出しで示す（`/gsc-dashboard` の「評価を開始」「評価基準日」に合わせる）。Google Ads 側の評価を UI に出す場合は両方に修飾を付けて揃える」。
  - 事実: 現行の辞書は **GSC × Google Ads の併存のみ**を規定しており、GA4 由来の評価は規定していない。既定は「修飾を付けず「評価」と呼び」であるため、既存側を「検索順位評価」へ改称する本仕様の方針は**現行の辞書のままでは根拠がない**。
  - 本仕様の方針: 併存時に両方へ修飾を付けるという辞書の趣旨を GA4 由来の評価へ広げ、既存側を「検索順位評価」、新規側を「コンテンツ評価」とする。あわせて `ui-text.md`「評価」行を「複数系統の評価を UI に出す場合は両方に修飾を付けて揃える」へ一般化する（§17 の変更対象）。既存タブ・ボタン文言の変更も対象範囲に含める。
- 評価実行中（`evaluating`）、データ不足、Google連携の再確認、評価失敗、Kill Switch停止中を区別して表示する。評価中に進捗率を推測表示しない。
- 「評価対象期間」と、グラフを確認する「表示期間」は別物として表示する。表示期間を変更しても保存済みの評価点・診断は変わらず、再評価時にだけ評価対象期間が更新される。
- 70点等の閾値はフィルタ・並び替え用途に限定し、提案内容を画面側で固定分岐しない（MustかはQ2）。
- 履歴詳細は画面内の展開領域または単一のダイアログで表示する。ダイアログ上に別のダイアログを重ねない。
- レスポンシブ・アクセシビリティは既存画面の作りに従う。状態は色だけで表現せず、ラベル・アイコン・文言を併用する。長い表は既存タブと同様に横スクロール可能にする。

### 10.4 状態別UIと操作

**この表は記事詳細の「コンテンツ評価」タブの状態表である。**一覧 `/analytics` には評価実行ボタンを置かないため（§8.2）、一覧では状態の表示のみを行い、`unassessed` は「未評価」と表示する（§6.5）。

| 内部状態 | ユーザー向け表示 | 主操作 | 既存の成功結果 | 操作制限 |
|---|---|---|---|---|
| `unassessed`（詳細＝履歴なし＋データ不足） | 未評価（データが不足） | 不足項目を確認 | なし | 「評価を実行」ボタンを表示しない |
| `eligible` | 評価可能 | 評価を実行 | なし | 実行中はボタンを無効化 |
| `evaluating` | 評価中です。完了まで最大3分かかる場合があります。 | なし。再読み込み可能 | ある場合は「前回の評価結果」として表示 | 評価を実行・再評価するボタンを無効化 |
| `evaluated` | 評価済み | 再評価 | 最新の成功結果 | なし |
| `insufficient_data` | データが不足しています | 不足項目を確認 | ある場合は保持して表示 | 点数・提案を新規表示しない |
| `import_failed` | データを取得できませんでした | データを再取得 | ある場合は保持して表示 | 評価開始を無効化 |
| `needs_reauth`（非永続・導出） | Google連携を確認してください | Googleを再連携 | ある場合は保持して表示 | 評価開始を無効化。**再連携が成功すれば次の描画で自動解消する**（DBに残らない） |
| `evaluation_failed` | 評価に失敗しました | 再評価 | 前回の成功結果を明示して表示 | 失敗理由をsanitized値で表示 |
| Kill Switch停止 | 評価機能は現在停止中です | なし | 既存結果は閲覧可能 | 評価・再評価を無効化 |

画面を離れて再訪した場合も、DBの状態を正本として同じ表示を出す。Kill Switch停止は永続化状態ではなく、評価APIと画面での表示制御に使う。

### 10.5 UI合意ゲート

クライアント文脈 §1.8 に従い、§10.2〜§10.4 をUIたたき台としてフェーズ1のUI実装前に合意する。MVPでは新ルートを作らず既存画面へタブを追加する方針に変わったため、2026-08-13 に合意した統合詳細画面のたたき台は**別チケットの前提として保留**し、MVPのタブ追加案で再合意する（D3）。

## 11. 非機能要件

`docs/templates/requirement-definition.md` §7 の分類に従い、同テンプレートの「検証方法」「状態・根拠」列を保持する。該当しない項目も理由を記載する。

| 分類 | 要件・目標値 | 検証方法 | 状態・根拠 |
|---|---|---|---|
| 性能・レイテンシ | 手動評価の実行経路は `maxDuration=180秒`。LLM 1回45秒・最大3回・間隔2秒（§8.1）。**一覧のページサイズは現状 `app/analytics/page.tsx:50` の `const perPage = 10;`（1ページ10件固定）であり、本仕様では変更しない。**`analyticsContentService.ts:14` の `MAX_PER_PAGE = 100` と一覧RPCの `GREATEST(1, LEAST(100, …))`（`20260809100000_...sql:36`）はサーバ側のクランプ上限であってページサイズではない | §13 APIテスト（LLMタイムアウト）、AC-00（既存ページングの挙動不変）、実データ検証 | 確定。ページサイズを10から変更すると §3.2・§3.4 フェーズ0完了条件・AC-00 の「既存レスポンス・ページングの挙動が変更されていない」に反する |
| 可用性・信頼性 | 外部 API または LLM の一時障害で、既存の正常結果が失われない。評価機能の停止が既存の一覧・GSC詳細・既存の取込経路（GSC は `gsc-evaluate` Cron、GA4 は `/api/ga4/sync` のユーザー起動）へ波及しない | AC-04、AC-06、§13 サービステスト | 確定。SLA 目標値は設定しない（MVPは手動実行のみで可用性が業務停止に直結しない）。取込経路の実態は §8.2 |
| セキュリティ・プライバシー | Google 認証情報・Service Role キー・個人情報を LLM 入力や通常ログへ出さない。所有者境界は §7.2 のアプリ層明示スコープと DB trigger。`error_message` は sanitized 値のみ。保持期間・削除条件は §7.6 | §13 サービステスト（ユーザーID分離・ログ秘匿）、DBテスト（ユーザー間の参照遮断） | 確定。§7.2 / §7.5 / §7.6 |
| 認証・認可 | 許可ロールは `admin` / `paid`（`ga4-permissions.ts:7`）。`/analytics` は `proxy.ts:10` の有料機能パス判定で保護される。**`/gsc-dashboard` は `proxy.ts` に保護されていないため、評価タブのデータ取得と Server Action / Route Handler の入口で `canAccessGa4` を必須検証し、許可されないロールにはタブを描画しない**（§3.3）。RLS は §7.5 のとおり Service Role 経路ではバイパスされるため多層防御として扱う | AC-12、§13 E2E（`trial` ロールで評価タブに到達できない）、DBテスト（RLS） | 確定。§3.3 に実測（2026-08-14）を記載 |
| 整合性・排他 | `start_ga4_content_evaluation` RPC の行ロックと `(user_id, content_annotation_id)` の一意制約により、同一ユーザー・同一記事の手動評価が同時に二重実行されない。`lease_expires_at` 15分TTLで固着を回復する | AC-07、§13 DBテスト（同時実行・stale回復） | 確定。§8.1 |
| データ量・打ち切り | `fetchGa4Summaries` の日次行取得について、打ち切りの検知方式と対象化の可否を **D4 で確定する**（§15.3）。検知を入れる場合は `count:'exact'` の総件数と取得件数を比較し、不一致を一覧表示と `data_quality_json` の部分取得フラグへ伝播する（§10.2）。評価入力は §6.3.2 の期間上限（最大90日）と記事単位の狙い撃ちにより最大90行/記事に有界化する。一覧RPCは1行返却のため PostgREST の1000行上限に該当しない | AC-13（D4 確定後に対象化）、§13 単体テスト | **想定行数**（`fetchGa4Summaries` は1ページ分の記事 × 選択期間の日数だけ `ga4_page_metrics_daily` の日次行を1クエリで取得する。1記事1日1行）。<br>・**現行のページサイズ10件**: **100日で 1,000行に到達する**（10記事 × 100日）。**一覧の表示期間には上限がない**（`app/analytics/page.tsx` の期間検証は書式のみ。§6.1-4）ため、**101日以上を指定すれば `db-max-rows = 1000` を超えうる**。なお §6.3.2 #2 の「最大90日」は**評価入力の上限であり一覧には適用されない**。<br>・**クランプ上限の100件までページサイズを広げた場合**: 100記事 × 10日 = 1,000行で到達、90日で 9,000行。<br>本仕様ではページサイズを変更しない（上記「性能・レイテンシ」行）が、**期間が長い場合は現行設定でも打ち切りが起こりうる**。実データの記事件数と `/analytics` の既定・最大期間は未確認であり、期間上限（D4 の (d)）を含む対処方式を D4 で決める。`docs/context/db-row-limits-and-data-truncation.md` は「`items.length >= limit` での検知は不可。必ず `count:'exact'` の総件数と比較する」と定める |
| 監査・ログ | 評価履歴に実行日時・状態・試行回数・エラーコード・プロンプトバージョン・入力データ識別情報を保存する（§7.3）。ログのマスキングは §9.4.2 | §13 サービステスト（履歴保存） | 確定。誰が実行したかの操作ログは別途持たない（MVPは owner-only で実行者＝所有者に限られるため） |
| 障害対応 | Kill Switch（§8.2）でDB設定変更のみ・デプロイなしに評価を停止できる。stale 実行は次回開始時に自動回復する | AC-06、AC-07（stale）、§13 DBテスト | 確定。RTO/RPO は設定しない（自動フェイルオーバー・多重化は行わず既存アプリの構成に従う） |
| バックアップ・復旧 | 評価履歴はロールバック時も削除しない（§14） | §13 DBテスト（ロールバック） | 確定。評価専用のバックアップ設計は持たない（Supabase 既存のバックアップ方針に従う） |
| 運用・監視 | 評価失敗率・stale 回復件数はDBから集計可能な形で履歴に残す | §7.3 の列定義、実データ検証 | 確定。専用の監視ダッシュボード・アラートはMVP対象外（定期Cronを持たないため常時監視の必要性が低い） |
| 拡張性・互換性 | 追加指標（Q-A）・定期Cron・共有閲覧は本書の構造を壊さず後から足せるよう、状態は §6.5 の永続/非永続の区分で分離し、履歴を正本とする | §13 単体テスト（状態遷移） | 確定。対応ブラウザ・端末は既存画面の前提に従う |
| アクセシビリティ | 一覧の並び替えは `aria-sort` を付与する。状態は色だけで表現せずラベル・文言を併用する。それ以外は既存画面の作りに従う | AC-09、AC-10、§13 一覧の並び替えテスト | 確定。記事詳細の情報階層・レスポンシブの新規要件定義は §3.2 で対象外 |
| コスト | LLM 呼び出しは1評価あたり最大3回。GA4 レポート API は評価実行時に呼ばない（§9.2.1） | Q8 回答後に測定方法を確定 | **未確定（Q8）**。1回あたりのコスト上限と月間想定件数はクライアント確認中。回答期限は D1 の見積合意と同時（§15.2） |

### AI 機能の観点

`docs/templates/requirement-definition.md` §7「AI機能の追加観点」に対応する。

| 観点 | 要件・目標値 | 検証方法 | 状態・根拠 |
|---|---|---|---|
| 出力品質・評価基準 | Zod でスキーマ検証。検証失敗は `evaluation_failed` とし、結果を公開状態にしない | AC-01、§13 単体テスト（LLM出力スキーマ検証） | 出力契約は Q1（プロンプト受領）まで暫定（§6.3.4） |
| 入力制御 | §6.3.2 の Context Assembly Contract。上限到達時は削減順序に従い、`data_quality_json` に partial を記録する | §13 フェーズ0単体テスト（評価Context組立） | 確定。最終上限は Q1 |
| 禁止事項・安全性 | プロンプト本文・記事全文・トークン・認証情報を通常ログへ出さない（§9.4.2）。アクセストークン・Service Role キーを LLM へ注入しない（§6.3.2 #6） | §13 フェーズ0単体テスト（ログ秘匿） | 確定 |
| 人間の確認・上書き | 評価結果はLLM生成であり、改善提案の実施判断は利用者が行う。自動的に記事を編集・公開しない（§3.2） | AC-02、E2E | 確定 |
| モデル・プロバイダ障害時 | 既存の成功結果を上書きしない（AC-04）。429/5xx/タイムアウトは3回まで再試行し、上限到達で `evaluation_failed`（§9.4.1） | AC-04、§13 APIテスト | 確定 |
| トークン・コスト上限 | `maxTokens` を明示的に渡す（§8.1）。本文系合計 80,000 文字を削減開始予算とする（§6.3.2 #1） | §13 フェーズ0単体テスト | **コスト上限は未確定（Q8）** |
| レイテンシ・タイムアウト | LLM 1回 45秒（`timeoutMs: 45000` を明示）・最大3回・実行経路 `maxDuration=180秒`（§8.1） | §13 APIテスト（LLMタイムアウト） | 確定 |
| 再現性 | プロンプトの `version` と本文 SHA-256 を評価履歴に保存する（§7.3） | §13 サービステスト | 確定 |

## 12. 受入条件（Gherkin）

### AC-00 フェーズ0のリファクタリングで既存挙動を維持する

```gherkin
Feature: GA4コンテンツ評価の実装基盤

  Scenario: リファクタリング着手前に現状の挙動を特性テストで固定する
    Given `analyticsContentService` のGA4集計値を検証するテストが存在しない
    When フェーズ0のリファクタリングに着手する前に特性テストを追加する
    Then 直帰率がセッション数による重み付き平均であることが固定される
    And CTRが impressions 0 件のとき null であることが固定される
    And is_sampled / is_partial が OR 集約されることが固定される
    And 日付逆転・URL0件・GA4プロパティ未設定時に空の集計を返すことが固定される

  Scenario: 事前リファクタリング後も既存の分析一覧が同じ結果を返す
    Given リファクタリング前の既存GA4/GSCデータと同じ入力がある
    When フェーズ0のリファクタリング後に /analytics 一覧を表示する
    Then 追加した特性テストが前後で同一結果を返す
    And ページング、既存フィルタ、GA4集計値、既存エラー表示の挙動が変わらない
    And 既存テスト、型チェック、Lint、ビルドが成功する
```

### AC-01 評価可能な記事を評価できる

```gherkin
Feature: GA4コンテンツ評価

  Scenario: GA4とGSCのデータが揃った記事を評価する
    Given 対象記事に評価対象期間のGA4とGSCデータがある
    And 評価用システムプロンプトが有効である
    When 記事の評価を実行する
    Then LLMへシステムプロンプトと構造化された記事・指標データが渡される
    And 出力スキーマに適合した評価点数、診断、根拠、改善提案が保存される
    And 評価状態が evaluated になる
```

### AC-02 固定ルールで提案を決めない

```gherkin
  Scenario: 指標の組み合わせが異なる記事を評価する
    Given 2つの記事が同じ評価点数帯でも異なる指標傾向を持つ
    When 2つの記事を評価する
    Then パターンと改善提案は入力記事とシステムプロンプトに基づいて生成される
    And score の閾値だけで同一提案に固定されない
```

### AC-03 データ不足を誤評価しない

```gherkin
  Scenario: 必須データが不足している記事を評価する
    Given 対象期間のGA4データまたはGSCデータが不足している
    When 記事の評価を実行する
    Then 欠損値を0として評価しない
    And 状態が insufficient_data になる
    And 不足している指標と期間が確認できる
```

### AC-04 取得失敗時に既存結果を保持する

```gherkin
  Scenario: 最新データの取得に失敗する
    Given 記事に正常な過去の評価結果がある
    When GA4、GSC、またはLLMの処理が失敗する
    Then 過去の正常な評価結果と履歴は変更されない
    And 最新実行は失敗状態とエラーコードを持つ
```

### AC-05 再認証を誘導する

```gherkin
  Scenario: Googleアクセストークンの再認証が必要である
    Given Google APIが再認証を要求する
    When 評価を実行する
    Then 表示上の評価状態が「Google連携を確認してください」になる
    And 永続状態は evaluation_failed、error_code は needs_reauth として履歴に記録される
    And ga4_content_evaluations.status に needs_reauth は保存されない
    And 既存のGoogle再連携導線が表示される

  Scenario: 再連携に成功すると表示が自動で戻る
    Given 直前の評価が error_code needs_reauth で失敗している
    And 利用者がGoogle連携をやり直して成功している
    When 「コンテンツ評価」タブを再表示する
    Then 「Google連携を確認してください」の表示は出ない
    And 評価を実行する操作が可能になる
```

### AC-06 Kill Switch で評価を停止できる

```gherkin
  Scenario: 評価機能が Kill Switch で停止されている
    Given `ga4_content_evaluation_settings.enabled` が false、行なし、またはDB読取失敗である
    When 記事の評価を実行しようとする
    Then 評価 API は実行されない
    And 記事詳細の「コンテンツ評価」タブに停止中の表示が出る
    And 評価実行ボタンは非活性である
    And /analytics 一覧の評価状態が停止中として表示される
```

### AC-07 同一記事の二重実行を防ぐ

```gherkin
  Scenario: 同一記事への同時評価要求
    Given 記事 A の評価が evaluating 状態である
    When 同じ記事 A に対して別の評価を開始しようとする
    Then 2 件目の評価は開始されない
    And 既存の `evaluating` 状態が保持される
```

`start_ga4_content_evaluation` RPC の `FOR UPDATE` と一意制約で防止する。

```gherkin
  Scenario: 異常終了した評価をTTL経過後に再実行する
    Given 記事 A の評価が `evaluating` 状態で、`lease_expires_at` が現在時刻より前である
    When 記事 A の評価を再実行する
    Then staleな実行は `evaluation_failed` と `evaluation_stale` として記録される
    And 新しい `evaluation_run_id` で評価が開始される
    And staleな実行が新しい評価結果を上書きできない
```

### AC-08 評価実行中状態を表示する

```gherkin
  Scenario: 評価実行中の記事を一覧で確認する
    Given 記事の評価が手動実行中である
    When /analytics 一覧を表示する
    Then 該当記事の評価状態が evaluating である
    And 評価完了まで evaluated 結果は上書き表示されない
```

### AC-09 状態別UIと既存結果保持

```gherkin
  Scenario: 評価失敗時に前回の成功結果を保持する
    Given 記事Aに最後の成功評価結果がある
    When 新しい評価が `evaluation_failed` になる
    Then 前回の成功評価結果は「前回の評価結果」として表示される
    And 今回の失敗理由と「再評価」操作が表示される
    And 前回の成功履歴は変更されない

  Scenario: 評価可能な記事を初めて開く
    Given 記事Aに必要なGA4/GSCデータが揃っている
    And 評価履歴が存在しない
    When 記事Aの「コンテンツ評価」タブを開く
    Then 「評価可能」と表示される
    And 点数や診断を表示しない
    And 「評価を実行」ボタンが表示される
    And 状態が色だけでなくラベル・文言でも判別できる

  Scenario: GSCの既存操作と混同しない
    Given 記事Aの記事詳細を開いている
    When 「コンテンツ評価」タブと既存タブを見比べる
    Then コンテンツ評価の「評価を実行」とGSCの「評価を開始」が別操作として文言で区別される
    And 既存3タブの内容と操作が変更されていない
```

### AC-10 未評価コンテンツを並び替え・絞り込みできる

クライアント文脈 §1.9.5 の第1優先要求（未評価コンテンツのソート）に対応する。

```gherkin
  Scenario: 未評価コンテンツだけを絞り込む
    Given 評価履歴のある記事とない記事が混在している
    When 未評価フィルタを適用する
    Then 評価履歴のない記事だけが表示される
    And 件数表示とページングが絞り込み後の結果と整合する

  Scenario: 評価状態・点数・最終評価日時で並び替える
    Given /analytics の一覧が表示されている
    When 評価状態、評価点数、または最終評価日時の見出しで並び替える
    Then その列の永続状態を基準に昇順・降順で並び替わる
    And 並び替えの状態が aria-sort で支援技術に伝わる
    And ページ送りしても並び替えが維持される

  Scenario: 表示上の状態が上書きされていても並び順は永続状態に従う
    Given Kill Switch が停止中である、または対象記事が再連携待ちである
    When 評価状態で並び替える
    Then 表示される状態は「停止中」または「Google連携を確認」になる
    And 並び順は上書き前の永続状態（評価済み・データ不足など）に従う
    And 並び替え操作は停止中でも無効化されない
```

### AC-11 追加指標を評価入力に含める（Q-A 確定後に対象化）

Q-A で `landingPage` 軸の `screenPageViews` / `engagementRate` が要件を満たすと確認できた場合にのみ受入対象とする。確定前は受入条件に含めない。

```gherkin
  Scenario: PVとエンゲージメント率を評価入力に含める
    Given GA4連携済みの記事Aに対象期間のデータがある
    And 追加指標の取込がMVP対象として確定している
    When 評価を実行する
    Then 評価入力に screenPageViews 由来のPVと engagementRate 由来のエンゲージメント率が含まれる
    And いずれかが未取得の期間は欠損として明示され、0として扱われない
```

### AC-12 許可されないロールが評価機能へ到達できない

`/gsc-dashboard` は `proxy.ts` の有料機能パス判定に含まれないため、タブ側で認可を担保する（§3.3）。

```gherkin
  Scenario: trial ロールで評価タブに到達しようとする
    Given ロールが trial のユーザーでログインしている
    When /gsc-dashboard?annotationId=... を開く
    Then 「コンテンツ評価」タブが描画されない
    And 評価の実行・再実行のServer Action / Route Handlerは認可エラーを返す
    And 評価結果・履歴のデータが応答に含まれない

  Scenario: paid ロールで評価タブを利用する
    Given ロールが paid のユーザーでログインしている
    When /gsc-dashboard?annotationId=... を開く
    Then 「コンテンツ評価」タブが表示される
```

### AC-13 データの打ち切りを検知して表示する（D4 確定後に対象化）

**D4（§15.3）の結論に依存する条件付き受入条件である。**現行のページサイズ10件では 100日までは `db-max-rows = 1000` に到達しないが、一覧の表示期間に上限がないため 101日以上で到達しうる（§11）。D4 が「現状維持（検知を入れない）」を選ぶ場合、本 AC は受入対象から外す。下表のとおり D4 の選択肢ごとに期待挙動が変わるため、**確定前は受入条件に含めない**。

| D4 の選択 | 打ち切りの発生 | AC-13 の扱い |
|---|---|---|
| (a) 現状維持（ページサイズ10・期間上限なし・検知なし） | 現行設定では発生しない見込み。ただし未確認（実データの記事件数） | 受入対象外。§11 に「発生しない前提」を根拠付きで残す |
| (b) 現状維持＋安全弁として検知のみ実装 | 発生し得る（ページサイズ拡張・期間拡大時） | 下記シナリオ1・2を受入対象とする |
| (c) `fetchGa4Summaries` を `range` ページングにして全行回収 | 発生しない（全行を回収する） | シナリオ1は再現不能。シナリオ3を受入対象とする |
| (d) 期間上限を設ける | 上限内では発生しない | シナリオ4を受入対象とする |

```gherkin
  Scenario: (b) GA4 日次行の取得が打ち切られる
    Given 対象ページの記事数と期間の組み合わせで、GA4 日次行が db-max-rows を超える
    When /analytics 一覧を表示する
    Then count:'exact' の総件数と取得件数の不一致が検知される
    And そのページのGA4集計全体が部分取得である旨が一覧に表示される
    And 不足分を0や空欄として表示しない

  Scenario: (b) 打ち切りが起きたデータで評価を実行する
    Given GA4 日次行の取得が部分取得である
    When 記事の評価を実行する
    Then data_quality_json に部分取得フラグが記録される
    And 評価入力にその旨が明示される

  Scenario: (c) range ページングで全行を回収する
    Given 対象ページの記事数と期間の組み合わせで、GA4 日次行が db-max-rows を超える
    When /analytics 一覧を表示する
    Then 全ての日次行が複数リクエストで回収される
    And count:'exact' の総件数と回収件数が一致する
    And 部分取得の注記は表示されない

  Scenario: (d) 期間上限を超える指定を受け取る
    Given 一覧の表示期間が定めた上限を超えている
    When /analytics 一覧を表示する
    Then 期間が上限まで丸められる、または上限超過が利用者に示される
    And GA4 集計は上限内の期間で取得される
```

記事単位で部分取得を示す要件は置かない（§10.2 のとおり、現在の一括取得では欠けた記事を判別できない）。記事単位の表示が必要になった場合は、D4 で (c) を選んだうえで記事ごとの件数照合を要件化する。

### AC と成功条件・要求出典の対応

`docs/templates/requirement-definition.md` §5「機能要件」の FR-ID 表と §6「シナリオ対応表」は導入していない（理由は §19 の残置記録）。代替として、各 AC が本書のどの成功条件・どの要求出典に対応するかを次に示す。

| AC | 対応する成功条件（§2.3 / §2.4） | 要求出典 |
|---|---|---|
| AC-00 | （成功条件の前提となる挙動維持） | §3.4 フェーズ0の完了条件（開発側の品質要件） |
| AC-01 | 記事ごとに評価状態・点数・パターン・根拠・改善提案を確認できる／KPI「評価結果の保存成功率」 | `client-vision-from-lark.md` §1.9.2 |
| AC-02 | 同じ固定パターンを機械的に返さない | §1.9.2 / §2.2 |
| AC-03 | GA4の数値欠損で誤評価しない／KPI「欠損値の誤評価」 | §2.3（開発側の品質要件） |
| AC-04 | GA4 APIの取得制約や再認証状態を評価失敗と混同せず表示・記録できる | §2.3 |
| AC-05 | 同上（再認証状態） | §2.3 / §9.1.1 |
| AC-06 | KPI「評価停止の即時性」 | 運用要件（§8.2） |
| AC-07 | KPI「二重実行」 | 運用要件（§8.1） |
| AC-08 | 記事ごとに評価状態を確認できる | §2.3 |
| AC-09 | 記事ごとに評価状態・点数・根拠・提案を確認できる | §1.9.2 / §2.3 |
| AC-10 | 未評価のコンテンツを一覧から発見できる | §1.9.5「優先: ①未評価コンテンツのソート」／§1.9.3 |
| AC-11 | （Q-A 確定後のみ）記事ごとの指標に基づく評価 | §1.9.2 のパターン条件（PV・エンゲージメント率） |
| AC-12 | 認可（成功条件ではなく非機能要件 §11「認証・認可」） | §3.3 / `ga4-permissions.ts` |
| AC-13（D4 確定後に対象化） | GA4の数値が欠損・不完全な場合に誤評価しない | §2.3 ／ `db-row-limits-and-data-truncation.md` |
| （AC なし） | 評価に使用した期間・データ取得日時・プロンプトバージョンを追跡できる | §7.3 の列定義と §13 サービステストで担保。UI からの追跡は §10.3-5 |

## 13. テスト計画

- フェーズ0特性テスト（**リファクタリング着手前に追加**）: `analyticsContentService` のGA4集計値（重み付き直帰率、impressions 0件時のCTR null、日次合算、is_sampled/is_partial の OR集約、`(user_id, property_id)` フィルタ）、早期returnの境界（日付逆転・日付未指定・有効URL 0件・GA4プロパティ未設定）、ページングと既存フィルタの組み合わせを固定する。既存テストはRPC引数検証3件のみでGA4集計値を検証していないため、これがないと責務分離の回帰を検知できない。
- フェーズ0回帰テスト: 上記の特性テストをリファクタリング前後で実行し、同一結果になることを確認する。`/analytics` の既存一覧、ページング、フィルタ、GA4集計値、GSC表示、既存エラー表示を比較する。
- フェーズ0単体テスト: 評価Context組立、欠損判定、状態遷移、エラーコード変換、構造化LLMアダプターのJSON抽出・再試行・ログ秘匿を検証する。DB fixtureは作成しない。
- 単体テスト: URL正規化、期間集計、欠損判定、状態遷移、LLM出力スキーマ検証。
- 欠損フォールバックの分離テスト: 対象期間に `sessions = 0` の記事について、**一覧の表示値では直帰率が `0` のまま**（既存挙動）、**評価入力では欠損**として Context に載ることを固定する（BR-02 / AC-03）。`fetchGa4Summaries` の集計ロジックを流用しても 0 フォールバックが評価入力へ混入しないことを検証する。
- サービステスト: GA4/GSCデータのユーザーID分離、プロンプトのsystem/user分離、履歴保存、失敗時の既存結果保持。
- APIテスト: GA4互換性エラー、GSC未連携、Google再認証（永続は `evaluation_failed` + `error_code='needs_reauth'`、表示は導出）、429/5xx、LLMタイムアウト。
- 認可テスト: `trial` 等の許可されないロールで、評価タブが描画されないこと、評価の Server Action / Route Handler が認可エラーを返すこと、評価データが応答に含まれないこと（AC-12）。`/gsc-dashboard` が `proxy.ts` で保護されていない前提での検証とする。
- 打ち切り検知テスト（**D4 で (b) または (c) を選んだ場合のみ**）: (b) では `fetchGa4Summaries` で `count:'exact'` の総件数と取得件数が不一致のとき、そのページのGA4集計全体を部分取得として一覧表示と `data_quality_json` に伝播すること、件数一致時に誤検知しないこと。(c) では全行が複数リクエストで回収され総件数と一致すること（AC-13）。
- DBテスト: RLS、インデックス、ユニーク制約、記事所有者trigger、`start_ga4_content_evaluation` / `finish_ga4_content_evaluation` RPCの同時実行、`evaluation_run_id` 条件付き更新、stale回復、履歴の成功/失敗/stale保存、Kill Switch設定のデフォルトfalse・権限、ロールバック、ユーザー間の参照遮断。評価テーブルのDB fixtureはフェーズ1で追加する。
- E2E: 未評価フィルタ、記事詳細の「コンテンツ評価」タブ表示、評価実行、評価中表示、評価結果と根拠表示、前回結果保持、データ不足・失敗・Google連携確認表示、Kill Switch停止表示、既存3タブが変わらないことの確認。
- 実データ検証: 少なくとも1ユーザーの実GA4/GSCデータを使い、画面値・保存値・API応答を突合する。モックの結果だけで完了判定しない。
- 一覧の並び替えテスト: 評価状態・点数・最終評価日時での昇順/降順、ページ送り時の維持、`aria-sort` の付与を検証する。あわせて、Kill Switch停止中・`needs_reauth` で表示状態が上書きされた行が、永続状態を基準に並ぶこと（表示値と並び順が一致しないこと）を固定する（AC-10）。
- GA4取込拡張テスト（Q-A 確定後のみ）: `engagementRate`・`screenPageViews` の Compatibility API 確認、`landingPage` 軸で取得した値と `pagePath` / `unifiedPagePathScreen` 軸のPVとの実データ突合、既存指標との期間集計整合、既存レコードNULLのままの期間の扱いを検証する。

## 14. リリース・ロールバック

### リリース順序

1. フェーズ0の特性テストを追加し、リファクタリング前の挙動を固定する。
2. フェーズ0のリファクタリングを適用する。利用者向け挙動を変えず、特性テストが前後で同一結果を返すことと、型チェック・Lint・ビルドが通ることを確認する。
3. §10.2〜§10.4 のUIたたき台を合意する（D3）。合意前にUI実装へ着手しない。
4. **事前確認:** `content_annotations.user_id` が UUID 文字列表現でない行が0件であることを確認する（判定 SQL: `SELECT count(*) FROM content_annotations WHERE user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`）。0件でなければ評価テーブルの適用を中止し、是正してから再開する（判断者: 開発チーム）。
5. フェーズ1のDB マイグレーションを適用する。Kill Switch設定行は `enabled=false` で作成する。
6. 生成型を更新する。未適用環境では pending 型を使用し、適用後に削除する。
7. 評価サービス・手動API・一覧の評価列と並び替え・記事詳細の「コンテンツ評価」タブをKill Switch無効状態でデプロイする。評価タブとその Server Action / Route Handler で `canAccessGa4` が検証されていること（AC-12）、既存3タブの内容と操作、既存導線が変わっていないことを確認する。
8. 許可された運用手順でステージングのDB設定を `enabled=true` に変更し、実データで評価結果とエラー状態を検証する。
9. 一般ユーザーへ段階展開する。

Q-A が「取込追加をMVPに含める」で確定した場合は、手順4の前に「GA4取込へ `engagementRate` / `screenPageViews` を追加する。Compatibility を確認し、`page_views` 列のリモート実在（Q-D）を確認したうえで `ga4_page_metrics_daily` のmigrationを適用し、§4.1.2 の後方互換方針に従って取込を有効化する」を挿入する。

### ロールバック

- `ga4_content_evaluation_settings.enabled=false` に変更して LLM 評価実行を次リクエストから停止する（§8.2）。DB設定の変更手段が利用できない場合は、評価APIを安全側で停止する。
- UI で問題が発生した場合は、「コンテンツ評価」タブの表示のみを取り下げる。既存3タブ・既存導線・URLを変更していないため、既存の記事詳細機能に影響しない。
- 既存の取込経路（GSC は `gsc-evaluate` Cron 経由、GA4 は `/api/ga4/sync` のユーザー起動。§8.2）は停止せず、評価処理だけを停止できる構成にする。**Q-A で取込追加が確定した場合に限り**、GA4取込へ追加した `engagementRate` / `screenPageViews` は、問題時に取得対象から外しても既存指標の取込が継続できるようにする。
- DB ロールバックが必要な場合は、評価専用テーブル・インデックス・ポリシー・`ga4_content_evaluation_settings` を対象に限定する。既存 GA4/GSC テーブルは削除しない。
- 評価履歴は削除せず、再デプロイ後の再評価に利用できるよう保持する（保持期間は §7.6）。
- **ロールバック判断者: 開発チーム。** Kill Switch の無効化はDB設定の変更手順を持つ運用担当が実施する。DB ロールバック（テーブル・ポリシー・RPC の削除）は開発チームの判断とし、実施前に §7.6 の保持方針に反しないことを確認する。

## 15. クライアント確認事項

### 15.1 確定事項（回答済み・実装契約に反映済み）

以下は回答を得たため、**本文が正本**である。再度の解釈変更を行わず、変更が必要な場合は §18 変更履歴に追記してから本文を直す。

| ID | 質問 | 回答 | 確定日 | 反映先 |
|---|---|---|---|---|
| Q5 | UIたたき台をフェーズ1のUI実装前、かつ `spec-to-pr` 前の必須ゲートとする方針でよいか | **合意（ゲート自体は有効）**。ただし2026-08-13に合意したたたき台は統合詳細画面（新ルート）を前提としており、MVPを既存画面へのタブ追加に絞ったため、たたき台の再合意が必要（D3） | 2026-08-13 | §10.5 UI合意ゲート |
| Q6 | GA4評価結果の共有ユーザー閲覧をMVPに含めるか | **MVP対象外。owner-onlyで実装し、共有閲覧はactorとownerを分けた別仕様・別migrationで設計する** | 2026-08-13 | §3.3 / §7.5 RLS |

### 15.2 未確定事項（クライアント確認中）

以下は **実装契約に確定値を書かない**。回答後に本書を更新し、`spec-to-pr` を再実行する。

**期限について:** 個別の期日はまだ設定されていない。全件の回答期限は「D1（見積合意）の提示時」に確定させる。それまでは無期限に開いた状態であることを明示し、未回答のまま `spec-to-pr` へ進まない（§17）。

| ID | 質問 | 背景 | ブロッカー | 回答者 | 期限 | 状態 |
|---|---|---|---|---|---|---|
| Q1 | §1.9.2 の評価パターン表を MVP 確定仕様としてよいか。それとも繁田さんプロンプト受領まで分岐名・条件を実装契約に入れないか。あわせて**分類数を確定したい**（`client-vision-from-lark.md` §1.9.2 の見出しは「3 分類」だが表は4行で、4行目に「全指標良好」がある。3行目の「3（発言上は「パターン C」）」という表記揺れも含む） | クライアント提示表 vs プロンプト待ち。`pattern` の列挙値と §7.3 の CHECK 制約が3値か4値かで変わる | **Yes**（プロンプト/パターン確定） | クライアント（繁田さん） | D1 提示時に確定 | 未回答 |
| Q2 | 「70点以下の一覧化」は Must の UI フィルタか、任意か | §1.9.2 vs §6.4 | UI 仕様確定 | クライアント | D1 提示時に確定 | 未回答 |
| Q3 | ROI は今回スコープか。費用・売上データの所在はどこか | §1.9.2 vs §3.2 Non-goal | 指標セット確定 | クライアント | D1 提示時に確定 | 未回答 |
| Q4 | 改善提案のメール配信を Non-goal にしてよいか（§1.9.4 との縮小合意） | メール連携言及 | スコープ確定 | クライアント | D1 提示時に確定 | 未回答 |
| Q7 | Q-A が「着地セッション基準でも要件を満たす」で確定した場合、`engagementRate`・PV（`screenPageViews`）の取込追加（12〜20h）をMVPに含めてよいか | パターン1はPV、2・3はPVとエンゲージメント率を条件に持つ。**Q-A に従属する質問であり、単独では回答できない** | 指標セット確定（Q-A 確定後） | クライアント | Q-A 回答後 | 未回答 |
| Q8 | 1回の評価あたりのコスト上限と、月あたりの想定評価件数 | 定期Cronは §3.2 でMVP対象外としたが、手動評価のコスト上限は必要 | コスト設計 | クライアント + 開発チーム | D1 の見積合意と同時 | 未回答 |
| Q-A | パターン1〜3の「PV」は**その記事自体のページビュー数**を指すか。それとも「その記事に着地したセッションが閲覧した全ページ数」でも要件を満たすか | 既存取込は `landingPage` 軸固定。両者の組み合わせ可否は公式に記載がなく、Compatibility API と実データでの実測が必要（§4.1.1 / §16「公式未確認」） | **Yes**（GA4取込軸・追加指標の可否・AC-11・Q7・12〜20h の工数） | クライアント（繁田さん） | D1 提示時に確定 | 未回答 |
| Q-B | `/analytics` の未評価コンテンツは、絞り込み（フィルタ）だけで足りるか。並び替え（評価状態・点数・最終評価日時）も必要か | §1.9.5 は「優先: ①未評価コンテンツの**ソート**」と記録。現状 `AnalyticsTable` に並び替え機構がない | UI 仕様確定（暫定で並び替えを実装対象とした） | クライアント | D3 の UI 再合意と同時 | 未回答 |
| Q-C | §1 承認欄の「クライアント合意済み（UI方針、2026-08-13）」は**新ルートの統合詳細画面**のたたき台に対する合意か。既存画面へタブを1枚追加する案は改めて合意が必要という理解でよいか | §10.5 / D3 と承認欄が矛盾していたため分離した | **Yes**（UI着手可否） | クライアント | D3 の UI 再合意と同時 | 未回答 |
| Q-D | 本番／ステージングの `ga4_page_metrics_daily` に **`page_views` 列は実在するか**。実在する場合の型・NULL可否・既存値 | 生成型 `src/types/database.types.ts:241` に non-nullable `number` として存在する一方、`supabase/migrations/` に定義が0件。生成型と migration は双方向にドリフトしており（§4.1.2 の反例）、生成型から実在を推論できない。**リモートDBの実スキーマ照会で確認する** | migration 安全性（Q-A 確定後に必要） | 開発チーム（DB管理者） | Q-A 回答後、migration 着手前 | 未回答 |

### 15.3 開発側で確定が必要な事項

クライアント確認ではなく、開発チーム内で決めて本文へ反映する。

| ID | 事項 | 背景 | ブロッカー | 担当 | 期限 | 状態 |
|---|---|---|---|---|---|---|
| D1 | MVP見積（フェーズ0 30〜45h + フェーズ1 113〜158h = 143〜203h）を着手前に合意する | §3.4 フェーズ1の内訳。GA4取込拡張12〜20hはQ-A回答待ちのため別枠。**提示時に §15.4 の「未評価ソートの分離先行リリース」判断と、§15.2 の全質問の回答期限を同時に論点化する** | 着手判断 | 開発チーム → クライアント | 未設定 | 未合意 |
| D3 | §10.2〜§10.4 の「既存画面へのタブ追加」案でUIたたき台を再合意する | 2026-08-13 に合意したたたき台は新ルートの統合詳細画面を前提としていた。MVPを絞った結果、前提が変わった | フェーズ1のUI実装 | 開発チーム → クライアント | 未設定 | 未合意 |
| D4 | `fetchGa4Summaries` の打ち切りへの対処方式を次から決める。**(a) 現状維持（検知を入れない）** / **(b) 現状維持＋安全弁として `count:'exact'` 検知のみ実装** / **(c) `range` ページングで全行回収** / **(d) 期間上限を設ける** | 現行のページサイズは10件固定（`app/analytics/page.tsx:50`）で、**100日までは `db-max-rows = 1000` に到達しない**（10記事 × 100日 = 1,000行）。ただし `app/analytics/page.tsx` の期間検証は書式のみで上限がないため（§6.1-4）、**101日以上の指定では到達しうる**。ページサイズを100（クランプ上限）へ広げると 10日で到達する。実データの記事件数と実際に使われる期間は未確認 | **対処方式の選択（(a)〜(d)）**と、それに応じた工数・**AC-13 の対象化**（AC-13 は本決定に従属する。逆方向の依存はない）。工数は (b) のみ 2〜4h を計上済みで、(c)(d) は D4 確定時に再見積もる（§3.4） | 開発チーム | フェーズ1のDB着手前 | 未確定 |

`/gsc-dashboard` からの移設・redirect（旧D2）は §3.2 でMVP対象外としたため、素の `/gsc-dashboard` のredirect先という論点はMVPでは発生しない。画面構成を見直す別チケットで扱う。

#### 制約条件

- 納期・予算・人員: 期日の指定はない。見積は D1 で合意する。実装は開発チームのみで、外部委託の予定はない。
- 法令・契約・審査: 本機能は外部審査（Meta App Review 等）の対象ではない。Google API は既存の読み取り専用スコープの範囲内で使う（§9.1）。
- 変更できない既存仕様: `/gsc-dashboard` の既存3タブの内容と操作・ルート・URL・既存導線（§10.1 / §17）、`ga4ImportService` の `landingPage` 軸（§4.2.1）、`proxy.ts` の既存パス設定（本仕様では変更しない。§3.3）。

#### 依存関係

| 依存対象 | 前提条件 | 完了確認 | 未完了時の影響 |
|---|---|---|---|
| 繁田さんのシステムプロンプト | 評価観点・出力JSON契約が確定していること | `prompt_templates` に登録され、§6.3.4 の出力契約が確定している | 出力スキーマ・CHECK制約・AC-01 が固定できず、フェーズ1の評価サービスに着手できない（§15.5 R-01） |
| Q-A の回答 | PVの定義が確定していること | §15.2 の Q-A が回答済みになる | 追加指標の取込・AC-11・12〜20hの工数が確定せず、着手すると全破棄のリスク |
| Q-D（リモートDBの実スキーマ照会） | `ga4_page_metrics_daily.page_views` の実在・型・NULL可否が判明していること | 照会結果を §4.1.2 に反映 | 追加指標の migration が安全に書けない（列衝突・NOT NULL 制約の食い違い） |
| D3（UIたたき台の再合意） | §10.2〜§10.4 の案に合意していること | §10.5 の合意ゲートを通過 | フェーズ1のUI実装に着手できない |
| D4（打ち切りへの対処方式） | (a)〜(d) のいずれかが選択されていること | §11 データ量行・§10.2・AC-13 の対象化に反映 | AC-13 を受入対象にできず、対処方式に応じた工数が確定しない（(b) は 2〜4h 計上済み、(c)(d) は未見積もり、(a) は 2〜4h を減じる） |
| フェーズ0の特性テスト | リファクタリング前の挙動が固定されていること | §3.4 フェーズ0の完了条件を満たす | フェーズ1で既存 `/analytics` の回帰を検知できない |

### 繁田さんへの確認事項（プロンプト関連）

1. システムプロンプトの最終版、入力 JSON の必須項目、出力 JSON のフィールド名・列挙値。
2. 評価点数の意味と算出方法。
3. 評価に必要な記事情報の範囲（タイトル、要約、導入文、本文、CTA 等）。
4. 評価期間の初期値と最低条件（例: 直近 30 日、データ蓄積 1 か月）。
5. CV の定義（対象イベント名、複数イベントの扱い、ユーザーごとの設定要否）。

### 15.4 トレードオフ判断

`docs/templates/requirement-definition.md` §10 に相当する。

| 判断 | 比較した案 | 採用理由 | 却下理由 | 影響 | 将来変更する条件 | 判断者 / 日 |
|---|---|---|---|---|---|---|
| GSC 評価テーブルを流用せず専用テーブルを新設（§5.2） | (a) `gsc_article_evaluations` を拡張 / (b) 専用テーブル新設 | GSC評価は順位変化の判定中心で、点数・診断・提案・履歴正本という構造が異なる | (a) は列の意味が混在し、どちらの評価か判別できない列群になる | migration・RLS・サービス層が増える | 両評価の出力契約が実質同一になった場合 | 開発チーム / 2026-08-12 |
| 記事詳細は新ルートを作らず既存画面へタブ追加（§10.1） | (a) `/analytics/[annotationId]` 新設+移設 / (b) 既存 `/gsc-dashboard` へタブ追加 | 要件に画面配置の指定がなく、成功条件 §2.3 は (b) で満たせる。(a) は +30〜50h | (a) は要件由来でない作業でMVPが遅れる | `/gsc-dashboard` という URL に GA4 由来の評価が乗る命名の齟齬が残る | 画面構成見直しの別チケットが起票され、UI合意が取れたとき | 開発チーム / 2026-08-13（**D3 で再合意が必要**） |
| フェーズ0（挙動不変リファクタ）を先に置く（§3.4） | (a) 先に責務分離 / (b) 既存を触らずフェーズ1で新設 | 評価固有ロジックの滲み出しを防ぎ、特性テストで回帰を検知できる | (b) は期間集計・URL正規化・欠損判定が二重化し値の食い違いが表面化する | 利用者に見えない作業へ 30〜45h を先払いする | 二重化のコストが分離のコストを下回ると判明したとき | 開発チーム / 2026-08-12 |
| 追加指標の取込を Q-A 回答まで確定しない（§4.1.1） | (a) MVP必須として確定 / (b) Q-A 回答待ち | `landingPage` 軸で取れる `screenPageViews` が記事単位PVと一致する保証がない。確定して実装後に覆ると取込軸からやり直しになる | (a) は12〜20h と AC を作り込んだ後に破棄するリスク | パターン1〜3の判定がQ-A回答まで設計できない | Q-A の回答、または Compatibility API での実測結果 | 開発チーム / 2026-08-14 |
| 評価タブの認可を `proxy.ts` ではなくタブ側で担保する（§3.3） | (a) `/gsc-dashboard` を `PAID_FEATURE_REQUIRED_PATHS` に追加 / (b) 評価タブのデータ取得・Server Action 入口で `canAccessGa4` を必須検証しタブを描画しない | (b) は本機能の追加分だけを保護でき、既存 `/gsc-dashboard` の到達可否を変えない。§10.1 / §17 の「既存導線を変更しない」制約と両立する | (a) は現在 `/gsc-dashboard` に到達できている `trial` 等のユーザーを既存機能ごと締め出す。要件に根拠がなく、本仕様の Non-goal（既存導線の変更）に反する | 評価タブの各入口に認可検証が必要になり、実装・テストが増える（AC-12） | `/gsc-dashboard` 全体を有料機能とする方針が別途決まったとき | 開発チーム / 2026-08-14 |
| 未評価ソートを分離して先行リリースしない（§3.4） | (a) フェーズ0 → フェーズ1 を一括でリリース / (b) 一覧の並び替え・未評価フィルタだけを先行リリース | クライアント第1優先（§1.9.5「①未評価コンテンツのソート」）は「評価が走っていない記事を見つけて評価する」ための手段である。評価機能が無い状態では全記事が未評価となり、先行リリースしても優先要求を満たさない。並び替えには評価テーブルとの JOIN（§5.1 一覧RPC）が必要で、フェーズ1のDB migrationを分割しても依存は消えない | (b) は DB migration と一覧RPC 再作成を2回に分けることになり、`get_filtered_content_annotations` の DROP/再作成を重複して行う | 第1優先要求の利用者価値がフェーズ1完了まで出ない。この点は D1 提示時に論点として提示する | クライアントが「評価機能より先に一覧の並び替えだけ欲しい」と明示した場合 | 開発チーム / 2026-08-14 |
| GSC 側の scope 縮小検知をMVP対象外とする（§9.1.1） | (a) `gsc-status.ts` に `webmasters.readonly` 欠落判定を追加 / (b) MVPでは検知対象外 | 4スコープは単一同意にまとめられており（§9.1）、GA4 スコープを保ったまま GSC スコープだけが失われる状況は通常発生しない。(a) は既存の GSC 連携ステータス表示の挙動を変える | (a) は本機能の要件に根拠がなく、既存画面の連携ステータス表示へ影響が及ぶ | `webmasters.readonly` のみ剥奪時に `needs_reauth` を出せない。発生時の GSC 取込の挙動は未確認 | GSC と GA4 の同意を分離した場合、または片方剥奪の事例が観測された場合 | 開発チーム / 2026-08-14 |
| 並び替えは永続状態を基準とし、表示上の上書きを反映しない（§10.2） | (a) 表示値（上書き後）で並べる / (b) 永続状態で並べる | 一覧RPCは `ga4_content_evaluation_settings` を参照せず（§8.2）、`needs_reauth` も SQL 外で導出する（§6.5）。(a) を実現するには全件をアプリ側で並べ直す必要があり、ページングと両立しない | (a) はページ内だけの並べ替えになり、ページ送りで並び順が壊れる | 停止中・再連携待ちの行で表示値と並び順が一致しない。AC-10 とテスト（§13）で挙動を固定する | 一覧RPCが Kill Switch と連携状態を参照する設計へ変えたとき | 開発チーム / 2026-08-14 |

### 15.5 リスク

| ID | リスク | 発生条件・影響 | 可能性 | 対策 | 担当 | 状態 |
|---|---|---|---|---|---|---|
| R-01 | プロンプト未受領のまま実装着手（Q1） | 出力JSON契約が毎PRで変わり、Zodスキーマ・CHECK制約・AC-01 が固定できない | 中 | §6.3.1 で実装ブロッカーと明記。プロンプト受領を着手条件とする | 開発チーム（受領は繁田さん） | 未解消（プロンプト待ち） |
| R-02 | Q-A が「記事単位PVが必要」で確定 | GA4取込軸の再設計が必要になり、パターン1〜3の判定方式ごと見直し | 中 | 取込追加をMVPから外し、Compatibility API と実データでの実測を先行させる（§4.1.1） | 開発チーム | 対応済み（MVPから隔離。Q-A 回答待ち） |
| R-03 | リリース直後に評価可能な記事がほぼ無い | 追加指標を入れた場合、取込開始日以前は欠損で `insufficient_data` になる | 高（取込追加時） | §4.1.2 の後方互換方針を Q-A 確定と同時に決める | 開発チーム | 未解消（Q-A 回答待ち） |
| R-04 | Service Role 経路で `.eq('user_id', …)` を省略 | 他ユーザーの評価履歴・診断本文が漏れる | 中 | §7.2 で一次防衛線を明記。§13 DBテストでユーザー間の参照遮断を検証 | 開発チーム | 対応方針決定済み（実装時に検証） |
| R-05 | GA4 の後追い確定（24〜48時間）を記事の変化と誤読 | 改善提案の効果測定を誤る | 中 | §4.2.4 で直近48時間を `data_quality_json` に記録 | 開発チーム | 対応方針決定済み |
| R-06 | MVP対象外を実装に混ぜ込む | 要件にない作業でリリースが遅れる | 中 | §3.2 に Non-goal と理由を明記。§17 に「別チケットへ送るもの」を列挙 | 開発チーム | 対応方針決定済み |
| R-07 | `/gsc-dashboard` が `proxy.ts` で保護されていないことを実装者が見落とす | 許可されないロールが評価タブと評価データに到達する | 中 | §3.3 に実測を明記し、§11「認証・認可」と AC-12 で担保 | 開発チーム | 対応方針決定済み（実装時に検証） |
| R-08 | `fetchGa4Summaries` の打ち切りに気づかず、欠けた集計で評価する | 記事の実績を過小評価した診断・提案が出る。現行のページサイズ10件では 100日までは `db-max-rows` に到達しないが、一覧の期間に上限がないため 101日以上の指定で到達しうる（§11） | 中（長期間を指定した場合）／低（100日以内の運用） | 想定行数と期間依存を §11 に明記。対処方式（(a)〜(d)）は D4 で確定し、選ばれた方式に応じて AC-13 を対象化する。期間上限（(d)）は本リスクの直接の対策である。ページサイズは変更しない（§11 性能行） | 開発チーム | 未解消（D4 未確定） |

## 16. 外部仕様の根拠

外部仕様は 2026-08-12 に Google 公式ドキュメントを確認した。以下、公式ページ本文の verbatim 引用と解釈を分離する。

### GA4 Data API — `engagementRate`

- URL: https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema
- 確認日: 2026-08-12
- 公式記載（引用）:

> The percentage of engaged sessions (Engaged sessions divided by Sessions). This metric is returned as a fraction; for example, 0.7239 means 72.39% of sessions were engaged sessions.

- 解釈: エンゲージメント率は GA4 指標として定義されている。MVP で使うかは Q-A（およびそれに従属する Q7）。使う場合は Compatibility API で `landingPage` との組み合わせを確認してから取込に追加する。

### GA4 Data API — `screenPageViews`

- URL: https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema
- 確認日: 2026-08-12
- 公式記載（引用）:

> The number of app screens or web pages your users viewed. Repeated views of a single page or screen are counted. (screen_view + page_view events).

- 解釈: PV 指標は GA4 で定義されている。既存取込には含まれない。MVP 対象とするかは Q-A（およびそれに従属する Q7）。

### GA4 Data API — `userEngagementDuration`

- URL: https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema
- 確認日: 2026-08-12
- 公式記載（引用）:

> The total amount of time (in seconds) your website or app was in the foreground of users' devices.

- 解釈: 滞在時間指標。既存 `ga4_page_metrics_daily.engagement_time_sec` に対応。

### GA4 Data API Compatibility

- URL: https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/checkCompatibility
- 確認日: 2026-08-12
- 公式記載（引用）:

> This compatibility method lists dimensions and metrics that can be added to a report request and maintain compatibility.

- 解釈: 指標追加前に互換性を検証する設計とする。

### GA4 Data API Quotas

- URL: https://developers.google.com/analytics/devguides/reporting/data/v1/quotas
- 確認日: 2026-08-12
- 公式記載（引用）:

> Core Tokens Per Property Per Day | 200,000
> Core Tokens Per Property Per Hour | 40,000
> Core Tokens Per Project Per Property Per Hour | 14,000
> Core Concurrent Requests Per Property | 10

- 再確認日: 2026-08-14（4行すべてを同 URL で確認）
- 解釈: §9.2.1 の上限値。Standard Property 前提。

### Search Console Search Analytics API — レスポンス行

- URL: https://developers.google.com/webmaster-tools/v1/searchanalytics/query
- 確認日: 2026-08-12
- 公式記載（引用）:

> `rows[].clicks` | Click count for the row.
> `rows[].impressions` | Impression count for the row.
> `rows[].ctr` | Click Through Rate (CTR) for the row. Values range from 0 to 1.0, inclusive.
> `rows[].position` | Average position in search results.

- 解釈: GSC 正本指標。`page` ディメンション指定でページ単位取得可能（同ページ Request body 定義参照）。

### Search Console — `rowLimit` / `dataState`

- URL: https://developers.google.com/webmaster-tools/v1/searchanalytics/query
- 確認日: 2026-08-12
- 公式記載（引用）:

> `rowLimit` | [Optional; Valid range is 1–25,000; Default is 1,000] The maximum number of rows to return.
> `dataState` | [Optional] If "all" (case-insensitive), data will include fresh data. If "final" (case-insensitive) or if this parameter is omitted, the returned data will include only finalized data. If "hourly_all" (case-insensitive), data will include hourly breakdown.

- 再確認日: 2026-08-14（`dataState` の3文目を追加取得し、引用を公式本文と同一にした）
- 解釈: §9.3.1 / §4.2.4 の根拠。`dataState` は3値であり、MVPは既定の `final` を使う（§4.2.4）。

### GA4 — `landingPage` ディメンションの定義

- URL: https://support.google.com/analytics/answer/9143382 （ページ名: "Analytics dimensions and metrics"）
- 確認日: 2026-08-14
- 公式記載（引用）:

> Landing page: "The page path associated with the first page view in a session."

- 解釈: `landingPage` はセッションの最初のページビューに紐づくページパスであり、スコープはセッションである。一方 `screenPageViews` はページ／画面の表示イベント数（上記 `screenPageViews` の節）であり、スコープが異なる。両者を組み合わせた値が記事単位PVと一致するかは**公式に記載がない**（下記「公式未確認」）。断定せず Q-A へ隔離する（§4.1.1）。

### Google OAuth 2.0 — リフレッシュトークンの失効条件

- URL: https://developers.google.com/identity/protocols/oauth2
- 確認日: 2026-08-14
- 公式記載（引用）:

> The user has revoked your app's access
> The refresh token has not been used for six months
> The user changed passwords and the refresh token contains Gmail scopes
> The user account has exceeded a maximum number of granted (live) refresh tokens

- 解釈: §9.1.1 の「6 ヶ月未使用」の出典。本アプリの scope 構成（§9.1 の4スコープ）に Gmail は含まれないため、「パスワード変更＋Gmail scope」の条件は該当しない。

### GA4 Data API — レポート行数上限

- URL: https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport
- 確認日: 2026-08-13
- 公式記載（引用）:

> `limit`: "The number of rows to return. If unspecified, 10,000 rows are returned. The API returns a maximum of 250,000 rows per request, no matter how many you ask for."

- 解釈: §9.2 のページング要件の根拠。

### GA4 — データ処理遅延

- URL: https://support.google.com/analytics/answer/11198161
- 確認日: 2026-08-13
- 公式記載（引用）:

> "Data processing can take 24-48 hours. During that time, data in your reports may change."

> Standard intraday: "2-6 hours"

> Daily: "12 hours"

- 再確認日: 2026-08-14（データ鮮度の2行を追加取得）
- 解釈: §4.2.4 の根拠。直近48時間の値は後から変動しうる。本アプリの対象は Standard プロパティであり、その反映間隔は intraday 2〜6時間 / daily 12時間である。

### Search Console — 全行返却の非保証と `dataState` の値

- URL: https://developers.google.com/webmaster-tools/v1/searchanalytics/query
- 確認日: 2026-08-13
- 公式記載（引用）:

> `startRow`: "Zero-based index of the first row in the response. Must be a non-negative number. If `startRow` exceeds the number of results for the query, the response will be a successful response with zero rows."

> "The API is bounded by internal limitations of Search Console and does not guarantee to return all data rows but rather top ones."

- 再確認日: 2026-08-14（`startRow` の後段を追加取得）
- 解釈: §9.3 の根拠。`dataState` の3値の引用は「Search Console — `rowLimit` / `dataState`」節に置き、同節で `hourly_all` を含む公式本文全文に揃えた。本書 §4.2.4 の2値記載はこれに合わせて訂正済み。

### Search Console — クォータ

- URL: https://developers.google.com/webmaster-tools/limits
- 確認日: 2026-08-13
- 公式記載（引用）:

Search Analytics の QPS quota として、公式は次の区分と値を示す（区分名は公式表記、値は verbatim）。

> Per-site quota（calls querying the same site）: "1,200 QPM"

> Per-user quota（calls made by the same user）: "1,200 QPM"

> Per-project quota（calls made using the same Developer Console key）: "30,000,000 QPD" / "40,000 QPM"

- 再確認日: 2026-08-14（3区分の値と区分の説明を再取得。値はいずれも公式と一致）
- 解釈: §9.3.1 の根拠。単一 GCP プロジェクトで全ユーザー分を呼ぶため per-project QPM が実効上限。1ユーザーが複数サイトを持つ場合は per-user が先に効く。

### 公式未確認（アプリ定義とする）

| 項目 | 理由 |
|---|---|
| `landingPage` × 検索指標の非互換 | 公式 API スキーマ本文に明示記述なし（2026-08-13 再確認）。既存 `ga4ImportService` のコード内コメントを正とする（コメントであり公式正本ではない点に注意） |
| `landingPage` × `screenPageViews` / `engagementRate` の可否 | **公式に可・不可のいずれの明示記述も見つかっていない。** Compatibility API と実データでの実測が必要（Q-A） |
| GA4 公式レポート（"Landing page" / "Pages and screens"）の構成 | どのレポートがどのディメンション・指標を組むかを記載した公式ページを特定できていない。`https://support.google.com/analytics/answer/9143382` は "Analytics dimensions and metrics"（指標リファレンス）であり、レポート構成の記載も `unifiedPagePathScreen` の記載も**存在しない**ことを 2026-08-14 に実測した。本書は「公式レポートで組み合わされていない」という間接証拠を根拠に使わない |
| `engagementRate` / `screenPageViews` / `userEngagementDuration` の API スキーマ本文 | 引用元 `.../data/v1/api-schema` の Metrics セクションが取得時に truncate され、本文へ到達できていない（2026-08-13・2026-08-14 の2回）。上記各節の引用は 2026-08-12 時点の取得内容であり、再取得による verbatim 再確認ができていない |

## 17. 変更影響とドキュメント

- フェーズ0の変更対象候補: `src/server/services/analyticsContentService.ts` の内部分離、新規の評価Context・状態・エラー型、新規の構造化LLMアダプター、単体/回帰テスト。`contentAnnotationSummaryService.ts` と `llmService.ts` は既存挙動不変のため変更しない。
- フェーズ1の変更対象候補: `src/server/services/`、`src/server/actions/` または Route Handler、`src/types/`、`supabase/migrations/`（評価テーブル・settings・trigger・開始/完了RPC）、`src/components/AnalyticsTable.tsx`（評価状態列・未評価フィルタ・**並び替え機構の新規実装**）、`app/gsc-dashboard/`（「コンテンツ評価」タブ追加。`GscDashboardClient.tsx` の `TabsList` グリッド列数と既存タブ文言の修飾）、`app/gsc-dashboard/page.tsx` と `src/server/actions/gscDashboard.actions.ts`（評価タブのデータ取得・Server Action 入口での `canAccessGa4` 検証と、許可されないロールへのタブ非描画。§3.3 / AC-12。既存3タブの取得処理と表示は変更しない）、`get_filtered_content_annotations` の再作成（未評価フィルタ・並び替えパラメータ・評価テーブルJOIN・返却フィールド追加）、`.agents/skills/growmate-ui-ux/ui-text.md`（「評価」行の修飾ルール更新）。
- Q-A 確定後に追加される変更対象: `src/server/services/ga4ImportService.ts`（`engagementRate` / `screenPageViews` 取得追加）、`src/server/services/ga4Service.ts`（`checkCompatibility` 経路の新設。現在3メソッドのみで未実装。取得指標を変更する前の互換性確認に使う。§4.2.2 / §9.2）、`ga4_page_metrics_daily` の追加指標 migration、§4.1.2 の後方互換対応。いずれも取込拡張（12〜20h）に含む。
- 変更しないもの: `app/gsc-dashboard/` の既存3タブ・ルート・URL・既存導線、`src/components/GlobalToastBridge.tsx`、`src/server/actions/gscDashboard.actions.ts` と `gscNotification.actions.ts` の `revalidatePath`、`app/ga4-dashboard/` の画面構成・集計ロジック（§3.2 対象外）。
- 別チケットへ送るもの: 記事詳細の新ルート化（`/analytics/[annotationId]`）と移設、旧URL redirect、戻り先クエリ引き継ぎ、情報階層の再設計、レスポンシブ・アクセシビリティの新規要件、定期Cron・非同期ジョブ、共有ユーザー閲覧、GSC `dataState` の明示指定と記録、インポート直後の自動評価、`src/server/lib/gsc-status.ts` への `webmasters.readonly` 欠落判定の追加（§9.1.1 / §15.4）。
- 既知の別課題: `app/ga4-dashboard/components/RankingTab.tsx` の `/analytics?annotationId=...` は `/analytics` 側が `annotationId` を読まないため現状無効。`app/ga4-dashboard/page.tsx` の `annotationId` / `path` searchParams 型も未使用。MVPの対象外だが、画面構成を見直すチケットで扱う。
- `README.md`: Kill SwitchのDB設定変更手順、手動評価経路、設定変更時の安全側挙動、GA4取込に追加した指標を追記する。READMEの更新要否・対象セクションは実装時の `readme_sync` で最終確認する。
- 実装前に本書をレビューし、§15.2 の未確定事項（Q1〜Q4・Q7・Q8・Q-A〜Q-D）と §15.3 の開発側確定事項（D1 見積合意、D3 UIたたき台の再合意、D4 期間上限・ページング方式）を確定したうえで、テーブル項目・API契約・画面文言を固定する。**未回答のまま `spec-to-pr` を実行しない。****Q-A が未回答の間は追加指標の取込とAC-11を実装対象にしない。**

## 18. 変更履歴

| 日付 | 内容 | 状態 |
|---|---|---|
| 2026-08-12 | 会議内容、既存実装、Google公式仕様をもとに初版作成 | ドラフト |
| 2026-08-12 | spec-review audit 指摘（SPEC-AUTHZ-001 〜 SPEC-CLIENT-001）を反映 | ドラフト・レビュー待ち |
| 2026-08-12 | spec-review audit 第2回（SPEC-OPS-002 〜 SPEC-AC-001）を反映 | ドラフト・レビュー待ち |
| 2026-08-12 | 事前リファクタリング（フェーズ0）と手動MVP・Cron・追加指標の段階実装、概算工数を追加 | ドラフト・レビュー待ち |
| 2026-08-12 | サブエージェントレビュー指摘（挙動不変範囲、評価固着、UIゲート、Kill Switch、手動時間予算、状態定義、フェーズ3契約）を反映 | ドラフト・レビュー待ち |
| 2026-08-12 | `/analytics`一覧・`/analytics/[annotationId]`統合詳細・`/ga4-dashboard`集計の3層構成、GSC詳細移設、旧URL redirect、戻りクエリ復元を追加 | ドラフト・レビュー待ち |
| 2026-08-13 | `/analytics/[annotationId]` の評価結果中心UI、状態別操作、レスポンシブ/a11y、履歴統合表示、原子評価RPC、履歴正本・owner-only DB設計を反映 | UI方針・owner-only MVP合意済み、プロンプト契約レビュー待ち |
| 2026-08-13 | レビュー指摘を反映。§6.3.1 のプロンプトバージョン追跡を既存 `prompt_versions` 参照へ修正、AC-09の掲載順を是正、§8.2 の停止文言を §10.4 に統一 | ドラフト・レビュー待ち |
| 2026-08-13 | §7/§10 の確定を受けてフェーズ1を106〜146h・1aを+30〜50hへ改訂。§15 を確定事項/未確定事項/開発側確定事項に分離 | 差し替え済み |
| 2026-08-13 | フェーズ0の完了条件に着手前の特性テスト（重み付き直帰率・impressions 0件時のCTR null・OR集約・早期return境界・ページング/フィルタ）を追加。影響範囲が `analyticsContentService` と `/analytics` 一覧に閉じることを明記 | ドラフト・レビュー待ち |
| 2026-08-14 | spec-review audit（🔴10 / 🟡20 / 🟢6）を反映。PV・エンゲージメント率の取込追加をQ-A回答待ちへ差し戻し、`needs_reauth` の永続化を撤回、所有者境界をアプリ層明示スコープへ訂正、1000行上限の論点を `fetchGa4Summaries` へ付け替え、一覧の並び替えを対象化、§11をテンプレート表形式へ、§15.4 トレードオフ・§15.5 リスクを新設。MVPは 140〜197h | 確認質問（Q-A〜Q-D）回答待ち |
| 2026-08-13 | MVP以外を仕様から除外。フェーズ1a（記事詳細の新ルート化・移設）とフェーズ2（定期Cron）を対象外にし、記事詳細は既存画面への「コンテンツ評価」タブ追加へ変更。旧フェーズ3（`engagementRate`/`screenPageViews` 取込）はパターン1〜3の条件に必要なためMVPへ繰り上げ。MVPは 148〜211h | 見積合意（D1）とUIたたき台再合意（D3）待ち |
| 2026-08-14 | spec-review audit 第2回（🔴4 / 🟡15 / 🟢7 + 継続7）を反映。`needs_reauth` の非永続化を §9.1 / §9.1.1 / AC-05 へ波及、`/gsc-dashboard` が `proxy.ts` で保護されていない実測を §3.3 に反映して AC-12 を新設、追加指標のMVP残置記述（§5.1 / §14）を Q-A 従属へ訂正、§16 の未確認引用ブロックを削除して「公式未確認」へ移動、GA4取込 Cron 不在を §8.2 / §11 / §14 に反映、§11 に「認証・認可」行と検証方法列を追加、打ち切り検知を工数・AC-13・D4 として要件化、§7.6 データ保持・§15.3 制約条件/依存関係表を新設。MVPは 143〜203h（打ち切り検知 2〜4h・認可ガード 1〜2h を追加） | 確認質問（Q-A〜Q-D・Q1〜Q4・Q7・Q8）回答待ち |
| 2026-08-14 | spec-review audit 第3回（🟡4 / 🟢3）を反映。一覧のページサイズが10件固定である実測に基づき §11 性能行・想定行数・§6.1-4 を訂正、Compatibility API が未実装である実測を §4.2.2 / §9.2 / §17 に反映、打ち切りの表示単位をページ単位に改め AC-13 を D4 従属の条件付き AC 化（D4 の循環参照も解消）、§2.7「業務ルール」（BR-01〜06）を新設。§16 の引用ラベル・GSC クォータ引用を公式表記へ | 確認質問（Q-A〜Q-D・Q1〜Q4・Q7・Q8）と D1 / D3 / D4 の確定待ち |
| 2026-08-14 | spec-review audit 第4回（🟡2 / 🟢2）を反映。Compatibility 経路を MVP 無条件から **Q-A 条件付き**へ限定し（評価経路はレポート0回のため検証対象が存在しない）工数を取込拡張12〜20hへ帰属、BR-02 の例外を実測（0 フォールバックは `fetchGa4Summaries` の集計処理内）に合わせて訂正し評価入力での無効化を §5.1 / §5.4 / §6.3.2 / §13 へ波及、打ち切りの想定行数を「10件/ページでも101日以上で到達しうる」へ訂正、D4 の (c)(d) が未見積もりである旨を明記 | 確認質問（Q-A〜Q-D・Q1〜Q4・Q7・Q8）と D1 / D3 / D4 の確定待ち |

## 19. レビュー記録

| finding_id | 対応 | 備考 |
|---|---|---|
| SPEC-AUTHZ-001 | 修正 | §3.3 認可表を追加 |
| SPEC-RLS-001 | 修正 | §7.2 uuid FK、§7.5 owner-only RLS、共有閲覧は別仕様へ分離 |
| SPEC-REUSE-001 | 修正 | §5.1 再利用必須リスト、§6.1 RPC/正規化 |
| SPEC-DATA-001 | 修正 | §4.2 データ契約（landingPage、死列、GSC 正本） |
| SPEC-LLM-001 | 修正 | §6.3.2 Context Assembly Contract 表。プロンプト依存項目はブロッカー明記 |
| SPEC-LLM-002 | 修正 | 既存 `prompt_versions` を参照し、hashは評価履歴側に保存。`prompt_templates`/`prompt_versions` への列追加はしない（§6.3.1 / §7.3） |
| SPEC-OPS-001 | 修正 | §8.1 手動評価の実行設計、§8.2 DB Kill Switch、§14。Cron/claim はMVP対象外へ |
| SPEC-EXT-001 | 修正 | §9 OAuth scope、§9.2.1/§9.3.1 クォータ |
| SPEC-EXT-002 | 修正 | §16 verbatim 引用に置換 |
| SPEC-EXT-003 | 修正 | §9.1.1 連携ライフサイクル |
| SPEC-SCOPE-001 | 修正 | §3.2/§17 で `ga4-dashboard` Non-goal 明示 |
| SPEC-CLIENT-001 | 修正 | §15.2 の未確定Qに隔離し本文で断定しない。回答済みのQ5/Q6は §15.1 へ分離 |
| SPEC-OPS-002 | 修正 | §8.2 未設定/false→停止、明示 `true` のみ許可 |
| SPEC-XREF-001 | 修正 | §4.1 CV 参照を §15 繁田確認 #5 に修正 |
| SPEC-LLM-003 | 修正 | §9.4.1 再試行回数 3・間隔固定 |
| SPEC-TMPL-001 | 修正 | §2.4 KPI 表、§2.5 関係者、§2.6 As-Is/To-Be |
| SPEC-AC-001 | 修正 | §12 AC-06〜08 追加 |
| SPEC-UI-001 | 差し替え | 3層構成・移設・旧URL互換は SPEC-SCOPE-002 でMVP対象外へ。MVPは §10.1 の画面責務表（一覧＋既存記事詳細へのタブ追加）を正とする |
| SPEC-PROMPT-001 | 修正 | §6.3.1 が実在する `prompt_versions` を「将来必要になれば」と記述し §7.3 と矛盾していた。既存テーブル参照に統一（§6.3.1 / §7.3） |
| SPEC-AC-002 | 修正 | AC-09 が AC-11 の後に置かれていた掲載順を是正（§12） |
| SPEC-UITEXT-001 | 修正 | §8.2 の停止文言「GA4コンテンツ評価は…」を §10.4 の「評価機能は現在停止中です」に統一し、§10.4 を正本と明記 |
| SPEC-EST-001 | 修正 | §3.4 をMVP（フェーズ0+1 = 148〜211h）に再構成し、フェーズ1の内訳表を追加。合意はD1 |
| SPEC-SCOPE-002 | 修正 | 要件（`docs/context/client-vision-from-lark.md` §1.9.2/§1.9.3）に画面配置の指定がないため、記事詳細の新ルート化・移設と定期CronをMVP対象外にした（§3.2）。記事詳細は既存画面への「コンテンツ評価」タブ追加（§10.3） |
| SPEC-TEST-001 | 修正 | フェーズ0完了条件が「GA4集計値の挙動不変」を要求する一方、それを検証するテストが0件（既存はRPC引数検証3件のみ）で検証不能だった。着手前の特性テストを完了条件・§5.4・§13・§14・AC-00 に追加 |
| SPEC-SCOPE-003 | 修正 | パターン1はPV、パターン2・3はPVとエンゲージメント率を条件に使うため、`screenPageViews`/`engagementRate` の取込追加を任意扱いからMVP必須へ変更（§3.1 / §4.1 / AC-10） |
| SPEC-XREF-002 | 修正 | 回答済みQ5/Q6が「未確定事項・実装契約に確定値を書かない」表に混在。§15.1/§15.2/§15.3 に分離 |

### 2026-08-14 audit 第1回（対応37行）

前ラン audit レポートは冒頭サマリーで「🔴10 / 🟡20 / 🟢6」（計36）と記載する一方、判定欄では「`new` が 38 件」としており、レポート自身の内訳が一致していない。したがってここでは内訳を再掲せず、**本節の実表行数（37行）を正**とする。

| finding_id | 対応 | 備考 |
|---|---|---|
| ARCH-NEW-spec-L167 | 修正 | `landingPage` × `screenPageViews` の意味論を §4.1.1 に明記し、MVP必須化を撤回して Q-A へ隔離 |
| ARCH-NEW-spec-L845 | 修正 | §3.1 / §4.1 / §3.4 / AC を Q-A 待ちへ統一。旧AC-10 は AC-11（条件付き）へ移動。**§5.1 と §14 は未反映だったため 2026-08-14 第2回で再修正（`ARCH-NEW-spec-L241`）** |
| ARCH-NEW-spec-L378 | 修正 | §7.2 に防衛線の責任分担表を追加。§7.5 冒頭に「実行経路ではRLSがバイパスされる」を明記 |
| ARCH-NEW-spec-L595 | 修正 | §6.1-4 / §11 の打ち切り論点を `fetchGa4Summaries` へ付け替え。`count:'exact'` 検知を要件化 |
| ARCH-NEW-spec-L10 | 修正 | §1 承認欄を分離し「未承認。owner-only のみ合意済み、UI方針は再合意待ち」へ |
| ARCH-NEW-spec-L194 | 修正 | §4.2.4 を公式引用（24-48時間）に差し替え、§16 に引用を追加、公式未確認表から削除 |
| ARCH-NEW-spec-L472 | 修正 | §9.1.1 の scope 不足を `needs_reauth` へ訂正 |
| ARCH-NEW-spec-L578 | 修正 | §6.5 に永続/非永続の区分表と表示優先順位を追加。`needs_reauth` の永続化を撤回。**§9.1 / §9.1.1 / AC-05 は未反映だったため 2026-08-14 第2回で再修正（`ARCH-NEW-spec-L539` / `L771`）** |
| ARCH-NEW-spec-L543 | 修正 | §10.2 に並び替えを追加し AC-10 を新設。§3.4 に 4〜6h を計上 |
| ARCH-NEW-spec-L775 | 修正 | §4.1.2 に後方互換の未決事項表を新設。Q-D を §15.2 へ |
| ARCH-NEW-spec-L561 / L554 | 修正 | §10.3 の表記を `ui-text.md` 準拠へ。両方の評価に修飾を付ける方針を採用し §17 に辞書更新を追加。**引用文が辞書の実文と異なっていたため 2026-08-14 第2回で verbatim へ差し替え（`ARCH-NEW-spec-L646` / `L645`）** |
| ARCH-NEW-spec-L195 | 修正 | `dataState` は MVP 対象外として §4.2.4 に明記し §17 の別チケットへ |
| ARCH-NEW-spec-L389 | 修正 | §7.3 に hash 対象（`prompt_versions.content` 原文）と `prompt_captured_at` を定義。`updated_at` 不在を反映 |
| ARCH-NEW-spec-L434 | 修正 | §8.1 に `timeoutMs: 45000` と `maxTokens` の明示上書きを追加 |
| ARCH-NEW-spec-L322 | 修正 | §6.3.4 に ```json フェンス要件を追加 |
| ARCH-NEW-spec-L347 | 修正 | §5.1 に一覧RPCの追加パラメータ・JOIN・返却フィールドを列挙。§6.5 で `eligible` は詳細のみ導出と確定 |
| ARCH-NEW-spec-L444 | 修正 | §8.2 に表示の合成規則を追加（一覧RPCは settings を参照しない） |
| ARCH-NEW-spec-L318 | 修正 | LLM出力側を `llm_data_quality` へ改名し、`data_quality_json` との関係を §7.3 に明記 |
| ARCH-NEW-spec-L504 | 修正 | §9.3.1 に per-user / per-project を追加し §16 に引用を記録 |
| ARCH-NEW-spec-L493 | 修正 | §9.2.1 を「評価実行時にレポートAPIを呼ばない」で統一 |
| ARCH-NEW-spec-L479 | 修正 | §9.2 に行数上限の引用とページング要件を追加 |
| ARCH-NEW-spec-L497 | 修正 | §9.3 に全行返却非保証の引用と `data_quality_json` 記録を追加 |
| ARCH-NEW-spec-L873 | 修正 | §16 の checkCompatibility 引用を公式本文の verbatim へ差し替え |
| ARCH-NEW-spec-L378b | 修正 | §14 手順4 に判定SQL付きの事前確認を挿入 |
| ARCH-NEW-spec-L588 | 修正 | §11 をテンプレート §7 の表形式へ置換し、対象外項目に理由を記載。**「認証・認可」分類と「検証方法」「状態・根拠」列が欠落していたため 2026-08-14 第2回で補完（`ARCH-NEW-spec-L677`）** |
| ARCH-NEW-spec-L110 | 修正 | §3.3 に削除の認可行を追加 |
| ARCH-NEW-spec-L790 | 修正 | §15.4 トレードオフ判断・§15.5 リスクを新設。§1 にメタデータ4行を追加 |
| ARCH-NEW-spec-L83 | 修正 | §3.4 にフェーズ0の代替案比較表を追加 |
| ARCH-NEW-spec-L167b | 修正 | §4.1.2 に `page_views` 列のドリフト論点を追加し Q-D へ |
| ARCH-NEW-spec-L98 | 修正 | §3.2 に自動評価 Non-goal の出典（§1.9.5）を明記 |
| ARCH-NEW-spec-L535 | 修正 | §10.1 / §17 を「内容と操作を変更しない（グリッド定義は変更する）」へ |
| ARCH-NEW-spec-L608 | 修正 | 特性テストの固定対象に直帰率0フォールバックと `ctr` 再計算を追加 |
| ARCH-NEW-spec-L908 | 修正 | `dataState` の列挙に `hourly_all` を追加 |
| ARCH-NEW-spec-L456 | 修正 | §9.1 のスコープ表に4スコープと単一同意である旨を反映 |
| ARCH-NEW-spec-L947 | 修正 | §19 の集計を実表に合わせて訂正。**訂正後の「計62件」も実表と一致していなかったため 2026-08-14 第2回で再訂正（`ARCH-NEW-spec-L1240`）** |
| ARCH-NEW-spec-L283 | 修正 | §6.3.2 #1 に既存定数のセマンティクス差（拒否閾値 vs 削減予算）を注記 |
| ARCH-NEW-spec-L242（テンプレ FR-ID表・シナリオ対応表） | 残置 | FR-ID 体系の導入はプロンプト契約（Q1）確定後に一括で行う方が手戻りが少ないため、確定まで残置する。**当初の残置理由（「§12 の AC が §2.3 と §1.9.2/§1.9.3 の要求に1対1で対応する」）は成立していなかったため、2026-08-14 第2回で §12 末尾に AC ↔ 成功条件・要求出典の対応表を追加し、§2.3 に未評価コンテンツの発見を成功条件として追加した（`ARCH-PERSIST-spec-L242`）。**`ARCH-NEW-spec-L790` はこの行に併記されていたが、同 ID は上表で「修正」済みのため併記を解消した |

### 2026-08-14 audit 第2回（new 24件 / persists 7件）

| finding_id | 対応 | 備考 |
|---|---|---|
| ARCH-NEW-spec-L539 | 修正 | §9.1 の「`needs_reauth` として保存し」を、§6.5 の非永続状態として表示時に導出する記述へ置換。§9.1.1 の列を「表示（非永続）／永続・既存結果の扱い」に分離 |
| ARCH-NEW-spec-L112 | 修正 | §3.3 に `proxy.ts:10`・`app/gsc-dashboard/page.tsx`・`gscDashboard.actions.ts` の実測を明記。評価タブ側で `canAccessGa4` を検証する方針を §15.4 の判断として記録し、AC-12・§11「認証・認可」・§13 認可テスト・§17 変更対象を追加 |
| ARCH-NEW-spec-L1077 | 修正 | 引用元 URL に存在しないレポート構成の引用2ブロックを §16 から削除。`landingPage` の定義引用を公式実文（"first page view"）へ差し替え、レポート構成は「公式未確認」表へ移動。§4.1.1 の断定を削り、Q-A の根拠を「公式未記載であること自体」に置換 |
| ARCH-NEW-spec-L241 | 修正 | §5.1 の「MVPで取得を追加する」を Q-A 回答後の対象化へ、§14 ロールバックの該当文を条件節付きへ変更 |
| ARCH-NEW-spec-L771 | 修正 | §9.1.1 に「永続は `evaluation_failed` + `error_code='needs_reauth'`」を定義。AC-05 を表示・永続・再連携後の自動解消の3観点へ分割 |
| ARCH-NEW-spec-L941 | 修正 | Q7 を Q-A 従属の質問へ書き換え。§16 の `engagementRate` / `screenPageViews` 節の参照先を Q-A へ更新 |
| ARCH-NEW-spec-L677 | 修正 | §11 に「認証・認可」行を追加し、テンプレートの「検証方法」「状態・根拠」列を復活。AI観点表は `requirement-definition.md:147-154` の6項目を網羅したうえで、入力制御・再現性を加えた8行とした |
| ARCH-NEW-spec-L627 | 修正 | §10.2 に「並び替えは永続状態を基準とし、表示上の上書きは反映しない」を明記。AC-10 にシナリオを追加し、§13・§15.4 に反映 |
| ARCH-NEW-spec-L682 | 修正 | §3.4 に打ち切り検知（2〜4h）を計上、§10.2 に一覧側の挙動、§12 に AC-13、§11 に想定行数（100記事×10日で1,000行到達）と D4 を追加 |
| ARCH-NEW-spec-L304 | 修正 | §6.2 にクライアント提示表が4行（4分類目「全指標良好」）である実測を記載し、Q1 に分類数と表記揺れの確認を含めた |
| ARCH-NEW-spec-L1240 | 修正 | 第1回の見出しから内訳（前ランレポート自身が不整合）を外し実表行数へ。`L790` の二重記載を解消。集計を下記「残置（理由付き）」で行数ベースに訂正 |
| ARCH-NEW-spec-L522 | 修正 | §8.2 に取込経路の実測表（GA4 取込 Cron は不在、`/api/ga4/sync` のユーザー起動）を追加。§11 可用性行・§14 ロールバックも同様に訂正 |
| ARCH-NEW-spec-L547 | 修正 | §9.1.1 に `gsc-status.ts:20` の実測と、GSC scope 縮小をMVP検知対象外とする理由を記載。§15.4 に判断、§17 に別チケットとして記録 |
| ARCH-NEW-spec-L646 | 修正 | §10.3 で `ui-text.md`「評価」行の実文を verbatim 引用し、GA4 由来の評価が辞書未規定であることと本仕様の方針（辞書の一般化）を分けて記載 |
| ARCH-NEW-spec-L971 | 修正 | §15.4 に「未評価ソートの分離先行リリース」判断を追加（採用: 一括リリース）。D1 の背景に提示時の論点化を明記 |
| ARCH-NEW-spec-L657 | 修正 | §6.5 に一覧／詳細での `unassessed` の意味の違いを表で定義。§10.4 の該当行を「未評価（データが不足）／不足項目を確認／評価を実行ボタンを表示しない」へ修正し、表が詳細画面用であることを明記 |
| ARCH-NEW-spec-L931 | 修正（一部未確定） | §7.6 データ保持・削除、§15.3 制約条件・依存関係表、§15.2 の回答者・期限・状態列、§15.5 の ID・担当・状態列、§14 ロールバック判断者を追加。**個別の回答期限日は未設定であり、D1 提示時に確定する旨を明記した（未確定であることを可視化した状態で残置）** |
| ARCH-NEW-spec-L206 | 修正 | §4.1.2 に生成型ドリフトの反例（`prompt_versions.change_summary`）を追記し、Q-D をリモート実スキーマ照会に限定 |
| ARCH-NEW-spec-L645 | 修正 | §10.3 の GA4 表記を、辞書の実文引用と略語ルール適用による導出に分離 |
| ARCH-NEW-spec-L1039 | 修正 | §16 GA4 クォータに Per Project Per Property Per Hour / Concurrent Requests の2行を追記（2026-08-14 再取得） |
| ARCH-NEW-spec-L1101 | 修正 | §16 GA4 データ処理遅延に Standard intraday / daily の引用を追加し、解釈欄から分離 |
| ARCH-NEW-spec-L1064 | 修正 | §16 に `dataState` の3値を含む完全な引用と `startRow` の後段を追記 |
| ARCH-NEW-spec-L546 | 修正 | §16 に「Google OAuth 2.0 — リフレッシュトークンの失効条件」節を新設（6ヶ月未使用ほか） |
| ARCH-NEW-spec-L479b | 修正 | §7.2 / §7.5 に「MVP では DELETE 経路を提供しない。ポリシーは将来の多層防御」を明記 |
| ARCH-PERSIST-spec-L845 | 修正 | new `ARCH-NEW-spec-L241` と同一。第1回の記録に未反映箇所を追記済み |
| ARCH-PERSIST-spec-L578 | 修正 | new `ARCH-NEW-spec-L539` / `L771` と同一。第1回の記録に未反映箇所を追記済み |
| ARCH-PERSIST-spec-L588 | 修正 | new `ARCH-NEW-spec-L677` と同一 |
| ARCH-PERSIST-spec-L561 | 修正 | new `ARCH-NEW-spec-L646` / `L645` と同一 |
| ARCH-PERSIST-spec-L947 | 修正 | new `ARCH-NEW-spec-L1240` と同一 |
| ARCH-PERSIST-spec-L242 | 修正 | §12 末尾に AC ↔ 成功条件・要求出典の対応表を追加し、§2.3 に「未評価のコンテンツを一覧から発見できる」を追加。FR-ID 体系自体の導入は Q1 確定後として残置（上表の残置行を参照） |
| ARCH-PERSIST-spec-L908 | 修正 | new `ARCH-NEW-spec-L1064` と同一 |

### 2026-08-14 audit 第3回（new 3件 / persists 1件 / 🟢 3件）

| finding_id | 対応 | 備考 |
|---|---|---|
| ARCH-NEW-spec-L741 | 修正 | §11 性能行の「ページング100件/ページを維持する」を実測（`app/analytics/page.tsx:50` の `const perPage = 10;`）に基づき「10件固定・本仕様では変更しない」へ訂正。`MAX_PER_PAGE = 100` と RPC の `LEAST(100, …)` はクランプ上限であってページサイズではない旨を明記。§11 想定行数を「現行10件: 10記事×90日=900行で未到達／100件へ拡張時: 10日で1,000行到達・90日で9,000行」の2段に分割し、§6.1-4 にも同事実を追記 |
| ARCH-NEW-spec-L236 | 修正 | §4.2.2 の「Compatibility API による事前確認を根拠とする」を削除。`ga4Service.ts` の公開メソッドが `listProperties`(:38)／`listKeyEvents`(:82)／`runReport`(:114) の3本のみで `src/`・`app/` に `checkCompatibility` が0ヒットである実測（2026-08-14）を記載し、根拠を `ga4ImportService.ts:257-259` のコードコメントのみに限定。Compatibility 確認は §9.2 で新規実装する旨と §17 の変更対象を明記 |
| ARCH-NEW-spec-L983 | 修正 | (a) §10.2 の一覧表示単位を「そのページの GA4 集計全体」へ変更。`fetchGa4Summaries` が `.in('normalized_path', …)` の一括取得であり `count:'exact'` の差分では欠けた記事を判別できない実測根拠を併記し、記事単位の表示要件を撤回。(b) AC-13 を「D4 確定後に対象化する条件付き AC」とし、D4 の選択肢 (a)〜(d) ごとに期待挙動を書き分け。D4 のブロッカー欄から AC-13 への循環参照を外し「D4 → AC-13」の一方向に修正。§3.4 内訳・§13・§15.3 依存関係表・R-08 も同方針へ更新 |
| ARCH-PERSIST-spec-L931 | 修正 | §2.7「業務ルール」を新設（BR-01〜BR-06）。terminal 履歴の不変性／欠損値を0にしない／失敗で既存結果を上書きしない／同時評価1件／Kill Switch 停止時は評価APIを実行しない／`.eq('user_id', …)` 省略禁止に ID を与え、例外・本文の定義箇所・対応する AC / テストを対応付けた。いずれも本文既出の不変条件であり新しい意思決定を含まない |
| （🟢）ARCH-NEW-spec-L1284 | 修正 | §16 GA4 データ処理遅延の引用ラベルを公式表記に合わせ `Standard daily` → `Daily` へ訂正（2026-08-14 再確認） |
| （🟢）ARCH-NEW-spec-L1435 | 修正 | §19 第2回表の備考「テンプレート §7 の8項目へ揃えた」の誤記を「`requirement-definition.md:147-154` の6項目を網羅したうえで入力制御・再現性を加えた8行」へ訂正 |
| （🟢）ARCH-NEW-spec-L1308 | 修正 | §16 GSC クォータ引用を1行への再構成から、公式の3区分（Per-site / Per-user / Per-project）ごとの引用へ分割。区分の説明も公式表記で併記し、2026-08-14 に値の一致を再確認 |

### 2026-08-14 audit 第4回（new 2件 / persists 0件 / 🟢 2件）

| finding_id | 対応 | 備考 |
|---|---|---|
| ARCH-NEW-spec-L621 | 修正 | Compatibility 経路を **Q-A 条件付きへ限定**した。§9.2 を「Q-A で取込追加が確定した場合に限り、取得指標を変更する前に実施。評価実行経路では呼ばない」へ、§9.2.1 の呼び出し回数を「レポート 0 回・Compatibility 0 回」へ訂正。§17 の無条件側から外して「Q-A 確定後に追加される変更対象」へ移し、§3.4 の取込拡張（12〜20h）に含む旨を明記。§4.2.2 の時制も同方針へ揃えた。**採用理由**: §16 の公式引用が「レポートリクエストに追加できるディメンション・指標を列挙する」API と定義しており、レポートを発行しない評価経路（§9.2.1）には検証対象が存在しないため。MVP 無条件で残す案は、この目的不在を解消できないため却下した |
| ARCH-NEW-spec-L91 | 修正 | BR-02 の例外欄を「一覧の表示値としては 0 フォールバックを維持し、**評価入力へ流用する際は適用せず `sessions = 0` の直帰率を欠損として渡す**」へ改めた。実測（`analyticsContentService.ts:344-345` の `agg.bounceRateSessions > 0 ? … : 0`）に基づき、0 フォールバックが表示層ではなく `fetchGa4Summaries` の集計処理そのものにあることを明記。§5.1 の流用方針に「流用するのは日次合算・加重平均・OR集約であり 0 フォールバックは評価入力に適用しない」を追加、§5.4 フェーズ0「評価入力」境界の方針・完了条件に分岐の設置を追加、§6.3.2 #2 にも注記、§13 に「`sessions = 0` の直帰率が評価入力で欠損になる」テストを新設（AC-03 / BR-02 に紐付け） |
| （🟢）ARCH-NEW-spec-L761 | 修正 | 「10記事 × 90日 = 900行で到達しない」の 90日が §6.3.2 #2 の**評価入力の上限**であり一覧に適用されない点を訂正。§11・§6.1-4・AC-13・R-08 を「現行10件では 100日で 1,000行に到達。一覧の期間に上限がないため 101日以上で到達しうる」へ書き換え、D4 の (d)（期間上限）の検討材料として明示。R-08 の可能性も期間依存の表現へ改めた |
| （🟢）ARCH-NEW-spec-L162 | 修正 | §3.4 の「打ち切り検知 2〜4h」を「D4 の (b) を選んだ場合の見積」と明示し、(c) `range` ページング・(d) 期間上限は未見積もり（D4 確定時に再見積もり）と記載。D4 のブロッカー欄と §15.3 依存関係表の「実装有無」を「対処方式の選択（(a)〜(d)）」へ改めた |

### 公式ドキュメント照合

- **実施**（確認日: 2026-08-12 初回、2026-08-13 追加、2026-08-14 audit で9本、第2回改訂で5本、第3回改訂で1本を WebFetch により再取得）。§16 に URL・確認日・verbatim 引用を記録している。
- 第2回改訂で再取得し公式本文との一致を確認したもの: `support.google.com/analytics/answer/9143382`（`landingPage` 定義。ページ名は "Analytics dimensions and metrics"）、GA4 Quotas 4行、GA4 Data freshness（24-48時間・Standard intraday 2-6 hours・Daily 12 hours）、GSC `dataState`（3値）・`startRow`・全行返却非保証、Google OAuth 2.0 のリフレッシュトークン失効条件。
- 第3回改訂で再取得したもの: GSC `webmaster-tools/limits` の Search Analytics クォータ3区分（Per-site / Per-user / Per-project）。値は公式と一致し、引用を区分ごとに分割した。あわせて GA4 Data freshness のラベルを公式表記 `Daily` へ訂正した。
- **不一致を検出し削除したもの**: 「Landing page レポート／Pages and screens レポートの構成」引用2ブロック。引用元 URL に当該記述も `unifiedPagePathScreen` も存在しないことを 2026-08-14 に実測したため §16 から削除し、「公式未確認」表へ移した。
- **公式未確認（§16 表参照）**: `landingPage` × 検索指標の非互換、`landingPage` × `screenPageViews` / `engagementRate` の可否、GA4 公式レポートの構成、`.../data/v1/api-schema` の Metrics セクション（ページが truncate され再取得できず、`engagementRate` / `screenPageViews` / `userEngagementDuration` の引用は 2026-08-12 取得時のまま）。

### 残置（理由付き）

§19 の記録は **計105行**（第1表 26行・第1回 audit 対応表 37行・第2回 audit 対応表 31行・第3回 audit 対応表 7行・第4回 audit 対応表 4行）。`finding_id` は行単位で一意に管理し、同一 ID を複数行に併記しない。

残置は次の2件。それ以外はすべて修正、または §15.2 の確認質問・§15.3 の開発側確定事項へ隔離した。**第3回 audit（new 3・persists 1・🟢 3）および第4回 audit（new 2・🟢 2）はいずれも修正済みで、残置に追加はない。**

| 残置項目 | finding_id | 理由 |
|---|---|---|
| テンプレート §5 の FR-ID 表と §6 のシナリオ対応表を導入しない | `ARCH-NEW-spec-L242` / `ARCH-PERSIST-spec-L242` | FR-ID 体系はプロンプト契約（Q1）確定後に一括導入する方が手戻りが少ない。代替として §12 末尾に AC ↔ 成功条件・要求出典の対応表を置き、追跡可能性を確保した |
| §15.2 の各質問に具体的な回答期限日を入れない | `ARCH-NEW-spec-L931` | 期限日は開発チーム単独では決められず、D1（見積合意）の提示時にクライアントと同時に確定する。無期限に開いたままにしないため、「D1 提示時に確定」という期限の決め方自体を表に明記し、§17 で未回答のまま `spec-to-pr` へ進まないことを条件化した |
