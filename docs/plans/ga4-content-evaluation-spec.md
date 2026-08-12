# GA4コンテンツ評価機能 仕様書（ドラフト）

## 1. 文書情報

| 項目 | 内容 |
|---|---|
| ステータス | ドラフト・レビュー待ち |
| 作成日 | 2026-08-12 |
| 対象 | GA4評価機能の初期実装 |
| 承認者 | 未承認 |
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
| 開発・運用 | GrowMate 開発チーム | 実装、Kill Switch 運用、Cron 監視 |
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
  -> /analytics/[annotationId] の記事詳細へ遷移
  -> GA4/GSC 指標・検索クエリ・記事情報を LLM へ構造化投入
  -> 点数・診断・提案を DB 保存（最新 + 履歴）
  -> 記事詳細で結果確認・再実行 -> 改善アクション
```

定期一括評価（Cron）は Q8 確定まで As-Is 相当の手動運用を維持する。

## 3. 対象範囲

### 3.1 MVPで対象とするもの

- フェーズ0（事前リファクタリング）完了後の手動評価MVP。フェーズ0は利用者向け挙動を変更しない。
- GA4日次ページ指標の評価用取得。
- GSCページ指標の評価用取得・GA4との組み合わせ。
- 記事単位の評価実行、結果保存、履歴保存。
- 評価状態（未評価、評価可能、評価済み、データ不足、取得失敗、再認証必要）の表示。
- 評価点数・評価パターン・診断・根拠・改善提案の表示。
- `/analytics` の一覧と `/analytics/[annotationId]` の記事詳細を分離し、GA4/GSC統合評価は記事詳細で表示する。
- 繁田さんのシステムプロンプトをDBのプロンプトテンプレートから読み込み、`system`ロールでLLMへ渡す処理。
- 評価結果の再実行。

### 3.2 MVPで対象外とするもの

- GA4取込時に全記事を自動評価する処理。
- LLMによる記事本文の自動編集・公開。
- 改善提案の自動メール送信（クライアント文脈 §1.9.4 との整合は Q4 で確認。確定までは Non-goal）。
- ヒートマップの導入・独自イベント設計。データが既存の入力に含まれる場合だけ、将来拡張できる入力項目として扱う。
- 固定ルールによる評価点数・パターン・提案文の算出。
- `app/ga4-dashboard/` の改修。`/ga4-dashboard` はサイト全体のGA4可視化画面（集計・ランキング・時系列）であり、記事単位のGA4/GSC統合評価・履歴・改善提案を持たせる画面ではないため、評価機能の対象外とする。
- `ga4ImportService` への `engagementRate` / `screenPageViews` 追加取得（MVP必須かは Q7 で確定。確定までは取込パイプライン改修対象外）。
- フェーズ2（定期Cron・非同期ジョブ）とフェーズ3（追加GA4指標）は、Q8/Q7の回答確定までMVPの受入条件に含めない。

### 3.3 認可とアクセス制御

既存実装 `canAccessGa4`（`src/server/lib/ga4-permissions.ts`）を正とする。許可ロールは `admin` と `paid` のみ。`/analytics` と `/analytics/[annotationId]` は `proxy.ts` の有料機能パスに含める。

| 操作 | admin | paid | その他（trial 等） | 実装根拠 |
|---|---|---|---|---|
| 評価一覧・結果の閲覧 | 可 | 可 | 不可 | `canAccessGa4` + 一覧/詳細ルートのガード |
| 評価の手動実行 | 可 | 可 | 不可 | 詳細ルート/API入口で同上 |
| 評価の再実行 | 可 | 可 | 不可 | 詳細ルート/API入口で同上 |
| Cron による一括評価（フェーズ2、Q8確定後） | 可（対象ユーザー） | 可（対象ユーザー） | 不可 | Service Role 経由。アプリ層で `user_id` を検証 |

共有ユーザー（スタッフ等）がオーナーの評価結果を閲覧できるかは Q6 で確定する。確定までは、新規テーブルの RLS は owner-only とし、共有閲覧が必要な場合は `get_filtered_content_annotations` 等の RPC 経由に限定する（§7.4）。

### 3.4 実装フェーズと概算工数

実装は、利用者向け機能を追加する前に、評価機能に必要な境界だけを整理する。概算は8時間を1人日とした開発工数であり、仕様確定・レビュー待ち時間は別途である。

| フェーズ | 目的 | 主な成果物 | 工数 | MVPとの関係 |
|---|---|---|---:|---|
| 0. 事前リファクタリング | 既存挙動を維持したまま、評価実装の境界を整理する | データ集約境界、LLM構造化出力アダプター、状態/エラー型、回帰テスト | 30〜45h | 必須前提 |
| 1. 手動評価MVP | 1記事単位の評価・保存・表示を提供する | DB/RLS、評価サービス、手動API、DB Kill Switch、stale回復、一覧/記事詳細UI、実データ検証 | 90〜120h | MVP対象 |
| 1a. 既存GSC詳細画面の移設 | 記事詳細の責務を統合し、既存URLと導線を維持する | `/gsc-dashboard` → `/analytics/[annotationId]` 移設、旧URL redirect、戻りクエリ引き継ぎ、既存GSC詳細の回帰確認 | +8〜16h | フェーズ1の追加作業 |
| 2. 定期評価 | Cron・非同期ジョブで一括評価する | claim RPC、ジョブ処理、時間予算、再試行、監視 | +25〜35h | Q8確定後 |
| 3. 追加GA4指標 | PV・エンゲージメント率等を評価入力へ追加する | GA4取込拡張、`ga4_page_metrics_daily` migration、Compatibility確認、評価入力契約・プロンプト再確認、既存データ検証 | +12〜20h | Q7確定後 |

フェーズ0〜1の合計は **120〜165時間（15〜21人日）**、既存GSC詳細画面の移設まで含むMVPは **128〜181時間（16〜23人日）**、フェーズ2まで含める場合は **153〜216時間（19〜27人日）**を目安とする。フェーズ0では、GSC・GA4の全体的な共通化、無関係な既存サービスの再設計、画面仕様の変更を行わない。1aはフェーズ0の挙動不変工数に含めない。

#### フェーズ0の完了条件

- `/analytics` の既存レスポンス、ページング、GA4集計値、既存フィルタの挙動が変更されていない。
- データ取得・期間集計・評価入力組立の責務が分離され、フェーズ1から評価専用の入力境界を利用できる。
- LLM呼び出し、JSON抽出、Zod検証、再試行、機密情報のログ出力制御を共通アダプターとして利用できる。
- 評価状態・エラーコードの型と状態遷移テストが追加されている。
- 既存テスト、型チェック、Lint、ビルドが通る。

## 4. 指標とデータソース

### 4.1 評価候補指標

| 指標 | 正本データソース | 既存取込の実態 | MVP方針 |
|---|---|---|---|
| 滞在時間 | GA4 `userEngagementDuration` → `ga4_page_metrics_daily.engagement_time_sec` | `landingPage` 軸で日次取得済み | 利用する |
| エンゲージメント率 | GA4 `engagementRate` | **未取得**（DB列なし） | **未確定（Q7）**。必須なら §3.2 Non-goal から外し取込改修を対象化 |
| オーガニック検索 ROI | 費用・売上データ | 未連携 | **未確定（Q3）**。確定までは評価入力に含めない |
| 表示回数 | GSC `impressions` → `gsc_page_metrics` | GSC Search Analytics API から取得済み | 利用する |
| CTR | GSC `ctr` → `gsc_page_metrics` | 同上 | 利用する |
| PV数 | GA4 `screenPageViews` | **未取得**（`page_views` 型定義のみ、migration 0件） | **未確定（Q7）**。必須なら §3.2 Non-goal から外し取込改修を対象化 |
| 直帰率 | GA4 `bounceRate` → `ga4_page_metrics_daily.bounce_rate` | `landingPage` 軸で日次取得済み | 利用する |
| CV数 | GA4 `eventCount` → `ga4_page_metrics_daily.cv_event_count` | CV イベント名はユーザー設定依存 | 利用する（イベント定義は §15 繁田確認 #5） |
| ヒートマップ情報 | 外部サービス | なし | MVP対象外 |

### 4.2 GA4/GSC データ契約（既存実装に固定）

#### 4.2.1 GA4 取込軸

既存 `ga4ImportService` は **`landingPage` ディメンション**（セッションスコープ）で日次指標を保存する。`pagePath` ではない。

- 保存先: `ga4_page_metrics_daily`（キー: `user_id`, `property_id`, `date`, `normalized_path`）
- 取得指標: `sessions`, `userEngagementDuration`, `bounceRate`, CV/scroll イベントの `eventCount`
- CVR 分母: `totalUsers` は `landingPage` と非互換のため **`sessions` を充てる**（既存実装コメント通り）

#### 4.2.2 使用しない列（死データ）

`ga4_page_metrics_daily` の `search_clicks`, `impressions`, `ctr` は、GA4 API 制約により **`landingPage` 軸では取得不可**のため取込時に **0 または NULL で保存**される。評価入力では **これらの GA4 列を使わない**。検索表示回数・CTR・クリック数の正本は GSC のみとする。

`landingPage` × 検索指標の非互換について、Google 公式 API スキーマ本文に明示的な記述は 2026-08-12 時点で未確認。既存コードコメント（`ga4ImportService.ts`）と Compatibility API による事前確認を根拠とする。

#### 4.2.3 GSC 正本

検索表示回数・クリック数・CTR・掲載順位は `gscImportService` → `gsc_page_metrics` の値を正本とする。URL 突合キーは `normalizeUrl`（GSC 側）と `normalizeToPath`（GA4 側）の **2 系統**であり、評価サービスは両方を明示的に使い分ける（§5.1）。

#### 4.2.4 データ鮮度

- GA4: 公式ドキュメントに「データ確定遅延」の定義は 2026-08-12 時点で未確認。アプリ定義として `ga4_page_metrics_daily.imported_at` と評価結果の `source_data_fetched_at` を鮮度指標とする。
- GSC: Search Analytics API の `dataState`（`final` / `all`）を取込時に記録し、部分確定データを `data_quality_json` に反映する。

## 5. 現行実装との関係

### 5.1 既存の再利用（必須）

以下は新規実装せず、既存経路を拡張して再利用する。

| コンポーネント | パス | GA4評価での使い方 |
|---|---|---|
| GA4 日次取込 | `src/server/services/ga4ImportService.ts` | 評価前のデータ鮮度確認・再取込。軸は `landingPage` 固定 |
| GA4 一覧集計 | `src/server/services/analyticsContentService.ts` → `fetchGa4Summaries` | 記事 URL と `ga4_page_metrics_daily` の突合。評価入力の GA4 部分はこの集計ロジックを流用 |
| GSC 取込 | `src/server/services/gscImportService.ts` | 評価期間の GSC 指標取得 |
| 既存GSC記事詳細 | `app/gsc-dashboard/` + `gscDashboard.actions.ts` | 概要・検索クエリ・評価履歴のUI/取得ロジックを記事詳細へ移設。旧 `/gsc-dashboard?annotationId=...` はredirect専用の互換入口として残し、旧画面UIは残さない |
| コンテンツ一覧 RPC | `get_filtered_content_annotations` | 未評価フィルタ追加: `p_has_unstarted_ga4_evaluation`（命名は実装時調整）。**DROP FUNCTION → 再作成 → REVOKE/GRANT** の手順を踏む |
| 未評価フィルタ UI | `AnalyticsTable.tsx` / `CategoryFilter.tsx` | 既存 GSC 未評価フィルタ（`p_has_unstarted_gsc_evaluation`）と同パターンで GA4 版を追加 |
| URL 正規化（GA4） | `normalizeToPath`（`src/lib/ga4-utils.ts`） | `ga4_page_metrics_daily.normalized_path` との突合 |
| URL 正規化（GSC） | `normalizeUrl`（`src/lib/normalize-url.ts`） | `gsc_page_metrics` との突合 |
| Google トークン | `googleTokenService.ensureValidAccessToken` | 再認証検知 |
| プロンプト管理 | `PromptService` + `prompt_templates` | GA4 評価用テンプレートを追加 |
| LLM 呼び出し | `llmChat`（`src/server/services/llmService.ts`） | 構造化出力の JSON 抽出・Zod 検証は `contentAnnotationSummaryService` パターンを踏襲 |
| GSC 評価ジョブ（フェーズ2、Q8確定後） | `gscEvaluationService` + `CRON_DEFINITIONS.gscEvaluate` | 時間予算（`BATCH_TIME_LIMIT_MS`）、並列数、Cron `maxDuration: 300` の設計を GA4 評価 Cron に流用 |
| GSC 提案ジョブ claim（フェーズ2、Q8確定後） | `claim_gsc_suggestion_jobs` RPC + `gscSuggestionJobService` | GA4 評価の非同期ジョブが必要な場合、**claim パターン**（`FOR UPDATE SKIP LOCKED`）を流用。新規 RPC 名は `claim_ga4_content_evaluation_jobs` 等 |
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
| 評価入力 | GA4/GSC/記事情報を評価用Contextへ組み立てる境界を新設する。GA4は`normalizeToPath`、GSCは`normalizeUrl`を引き続き使い分ける | 欠損、期間、鮮度、データ品質がContextに明示される |
| LLM呼び出し | `contentAnnotationSummaryService`等の実装を参考に、**既存サービスを変更せず**、GA4評価用の構造化LLMアダプターを新設する。JSON抽出、Zod検証、タイムアウト、再試行、ログ秘匿を呼出し境界に集約する | ドメイン固有の出力スキーマと評価結果保存は共通化せず、新規アダプターをフェーズ1から利用できる |
| 評価状態・エラー | `unassessed`等の状態、外部API/LLMエラーコード、既存結果保持の状態遷移を共通型・純関数として整理する | 状態遷移と異常系の単体テストがある |
| テスト基盤 | GA4/GSC入力、欠損値、ユーザー分離、LLM不正出力、既存結果保持のfixtureを追加する | フェーズ1で同じfixtureを再利用できる |

フェーズ0では、GSC評価テーブルの流用、GSC評価ロジックの全面共通化、既存APIの変更、既存LLMサービスの変更、データベーススキーマ変更、UI変更を行わない。フェーズ0のfixtureは型・純関数レベルに限定し、評価テーブルを使うDB fixtureはフェーズ1で追加する。

## 6. 機能仕様

### 6.1 評価対象の決定

1. ユーザーに紐づくコンテンツ一覧から評価対象記事を取得する。入口は `get_filtered_content_annotations` RPC（`analyticsContentService.getPage`）。
2. 記事 URL を正規化し、GA4 ページデータと GSC ページデータを同一記事へ紐づける。
   - GA4 突合: `normalizeToPath(canonical_url)` ↔ `ga4_page_metrics_daily.normalized_path`
   - GSC 突合: `normalizeUrl(canonical_url)` ↔ GSC ページ指標
3. GA4 または GSC のデータがない場合は、欠損理由を保持する。GA4 の `search_clicks` / `impressions` / `ctr` 列は欠損ではなく **使用禁止（死データ）** として扱う。
4. 評価対象の全件取得と、LLM へ送る記事情報の取得を分離する。PostgREST の最大返却行数（1000 行）によって、評価対象を暗黙に切り捨てない。一覧は RPC ページング（最大 100 件/ページ）、指標は `fetchGa4Summaries` 相当の **IN 句による狙い撃ち取得** または DB 側集約を使う。
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

### 6.3 LLM入力契約

#### 6.3.1 システムプロンプト

- 保存先: `prompt_templates` の GA4 評価用テンプレート。
- LLM へのロール: `system`。
- バージョン追跡: `prompt_template_id` + `prompt_templates.version` + `prompt_templates.updated_at` を評価結果に保存する。`prompt_templates` にハッシュ列は存在しないため、**新規ハッシュ列の追加は行わない**（`prompt_versions` テーブルが将来必要になれば別 migration）。
- 内容: 繁田さんが定義する評価目的、評価観点、点数・パターン・提案の出力ルール。**プロンプト未受領は実装ブロッカー**。

#### 6.3.2 Context Assembly Contract

| # | 入力要素 | 取得経路 | 上限（MVP 固定値） | 超過時の削減順序 | 注入条件 | ログ/禁止 |
|---|---|---|---|---|---|---|
| 1 | 記事メタ（ID, URL, タイトル, 要約） | `content_annotations` | 本文系合計 **80,000 文字**（`CONTENT_ANNOTATION_SUMMARY_MAX_CONTENT_CHARS` と同上限を暫定採用） | (a) `wp_content_text` 省略 → (b) `wp_excerpt` のみ → (c) タイトル+URL のみ | 常時 | プロンプト全文・記事全文を通常ログに出さない |
| 2 | GA4 期間集計 | `fetchGa4Summaries` 相当 | 期間 **最大 90 日**、日次推移 **最大 90 行/記事** | (a) 日次推移省略 → (b) 期間集計のみ | GA4 連携済み | `search_clicks`/`impressions`/`ctr` 死列は注入しない |
| 3 | GSC 期間集計 | `gsc_page_metrics` | 同上 | 同上 | GSC 連携済み | — |
| 4 | CV イベント定義 | ユーザー設定 + GA4 イベント名 | イベント名 **最大 10 件** | 件数超過は `data_quality=partial` | CV 評価に使う場合 | — |
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
  "data_quality": "sufficient"
}
```

上記のフィールド名、列挙値、点数の意味、提案数はドラフトであり、繁田さんのプロンプト受領後に確定する。実装では確定した契約をZod等で検証し、検証失敗時は結果を公開状態にしない。

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
| `needs_reauth` | Google再認証が必要 |
| `evaluation_failed` | LLMまたは出力検証に失敗 |
| `evaluating` | 評価処理中（フェーズ1の手動実行中、またはフェーズ2の非同期ジョブ claim 済み） |

欠損値を`0`に変換して評価を続行しない。新しい評価に失敗した場合、既存の正常な評価結果と履歴を上書きしない。

`unassessed` / `eligible` は一覧表示時に評価履歴の有無とデータ品質から導出する。`evaluated`、`insufficient_data`、`import_failed`、`needs_reauth`、`evaluation_failed`、`evaluating` は `ga4_content_evaluations.status` に永続化する。手動評価の開始・完了・失敗更新は同じ `evaluation_run_id` を条件に行い、TTL回復後に古い実行が新しい評価を上書きできないようにする。

## 7. データ設計（案）

### 7.1 新規テーブル

テーブル名は実装時に命名規則を確認するが、案は以下とする。

- `ga4_content_evaluations`: 記事ごとの最新評価。
- `ga4_content_evaluation_history`: 評価実行ごとのスナップショット。
- `ga4_content_evaluation_settings`: Kill Switchを管理する単一行設定。`id`（固定値1）、`enabled`（boolean、デフォルトfalse）、`updated_at`、`updated_by`を持つ。MVPでは設定画面を追加せず、許可された運用手順から更新する。

### 7.2 最新評価テーブルの主な項目

- `id` (`uuid`, PK)
- `user_id` (`uuid`, NOT NULL, FK → `public.users(id)` ON DELETE CASCADE)
- `content_annotation_id` (`uuid`, NOT NULL, FK → `public.content_annotations(id)` ON DELETE CASCADE)
- `canonical_url`
- `status`
- `score`
- `pattern`
- `diagnosis`
- `evidence_json`
- `recommendations_json`
- `data_quality_json`
- `period_start`, `period_end`
- `prompt_template_id` (`uuid`, FK → `prompt_templates(id)`), `prompt_version` (`integer`), `prompt_updated_at` (`timestamptz`)
- `source_data_fetched_at`
- `evaluated_at`
- `evaluation_run_id` (`uuid`, 評価開始ごとの実行識別子。古い実行結果による上書きを防ぐ)
- `last_error_code`, `last_error_message`
- `created_at`, `updated_at`

`content_annotations.user_id` は `text` 型だが、新規テーブルの `user_id` は **`uuid` FK** とする。評価作成時は `content_annotation_id` から注釈を取得し、`content_annotations.user_id::uuid` と操作主体の `user_id` の一致をアプリケーション層で検証する。

### 7.3 制約・インデックス

- `user_id`を必須とし、すべてのサービス層クエリで対象ユーザーを明示する。
- `(user_id, content_annotation_id)`に一意制約を設ける。
- `(user_id, status, score)`、`(user_id, updated_at)`を検索用途に検討する。
- `ga4_content_evaluation_settings` は `id=1` の単一行制約を持ち、migration適用時に `enabled=false` の行を作成する。
- 履歴には評価時点の出力、`evaluation_run_id`、入力データの識別情報を保存し、後から同じ評価結果を追跡できるようにする。
- JSONは表示用に保存し、検索・並び替えに使う値は通常列として保持する。

### 7.4 RLS・アクセス制御

- 評価結果・履歴テーブルは **`user_id = (SELECT auth.uid())` の owner-only RLS** とする。`.agents/skills/supabase/rls.md` に従い、新規 RLS/RPC で **`get_accessible_user_ids` を参照しない**。
- `ga4_content_evaluation_settings` は `anon`、`authenticated`、`PUBLIC` の直接更新・参照を許可せず、Service Role経由のサーバー処理と許可された運用手順だけが読み書きできる。設定が存在しない、またはDB読取に失敗した場合は安全側で停止する。
- 共有ユーザーがオーナーの評価結果を閲覧する必要がある場合（Q6）、直接 SELECT ではなく **`get_filtered_content_annotations` 等の Service Role RPC** で評価状態・点数を JOIN して返す。RPC 内の共有判定は既存 RPC の `get_accessible_user_ids` 利用に限定する。
- `auth.uid()` は `(SELECT auth.uid())` でラップする。
- バッチ・Cron・Google 取込はサーバー側の `SupabaseService` 経由で実行し、Service Role 利用時もアプリケーション層でユーザー ID と対象記事を検証する。
- RPC を追加する場合は、用途に応じて `PUBLIC`、`anon`、`authenticated` の実行権限を明示的に取り消し、許可対象だけに grant する。claim 系 RPC は `service_role` のみ（`claim_gsc_suggestion_jobs` と同型）。
- マイグレーションにはロールバック用の `DROP POLICY`、テーブル・インデックス削除手順をコメントで残す。
- `ga4_content_evaluation_settings` のmigrationには、単一行作成、Service Role以外の権限取り消し、`DROP TABLE` を含むロールバック手順を残す。

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

### 8.1 ジョブ・Cron 設計

#### フェーズ1：手動評価

フェーズ1では、Server ActionまたはRoute Handlerから単記事評価を実行する。評価対象の決定、データ品質確認、LLM呼び出し、最新評価・履歴保存を1記事単位で行う。実行開始時は、`(user_id, content_annotation_id)` を条件に `status='evaluating'` へ原子的に更新し、更新行数で開始可否を判定する。評価行がない場合は、`INSERT ... ON CONFLICT DO NOTHING` と条件付き更新を同一DBトランザクション内で行い、一意制約競合時も開始できるのは1実行だけにする。

`evaluating` の `updated_at` が **15分**を超えて更新されていれば stale とみなし、`evaluation_failed`・`last_error_code='evaluation_stale'` に更新してから新しい `evaluation_run_id` で再実行できる。実行完了・失敗の保存は開始時の `evaluation_run_id` が一致する場合だけ許可する。これにより、プロセス異常終了後の固着と、古い実行による結果上書きを防ぐ。

手動評価の実行経路は `maxDuration=180秒`、LLM 1回あたりのタイムアウトは45秒、試行回数は初回を含めて最大3回、試行間隔は2秒とする。定期Cron、claim RPC、ジョブキューはフェーズ1の実装対象に含めない。

#### フェーズ2：定期評価・非同期ジョブ（Q8確定後）

| 項目 | 方針 | 既存正本 |
|---|---|---|
| Cron 定義 | `CRON_CONFIGS` に `ga4ContentEvaluate` を追加 | `src/server/lib/cron-definitions.ts` |
| Route | `/api/cron/ga4-content-evaluate` | `gsc-evaluate` と同型 |
| `maxDuration` | **300 秒**（GSC 評価と同値） | `CRON_CONFIGS.gscEvaluate.maxDuration` |
| 時間予算 | **280 秒**でバッチ中断 | `GscEvaluationService.BATCH_TIME_LIMIT_MS` |
| 二重実行防止 | (1) `(user_id, content_annotation_id)` ユニーク制約 (2) claim RPC の `FOR UPDATE SKIP LOCKED` (3) `evaluating` 状態 | `claim_gsc_suggestion_jobs` |
| 手動実行 | Server Action から単記事評価。Cron とは別経路 | GSC 手動評価と同型 |

Q8で定期評価をMVPに含めると確定した場合のみ、フェーズ2をフェーズ1に続けて実装する。Q8未確定の間は、フェーズ1の手動評価を受入対象とし、claim処理（claim RPC・ジョブキュー）を先行実装しない。

### 8.2 Kill Switch（外部依存停止）

既存の feature flag 基盤は存在しない（`src/lib/constants.ts` の「Feature Flags」は AI モデル設定用）。MVPでは専用の `ga4_content_evaluation_settings` テーブルを使用し、DBの`enabled`をKill Switchとする。環境変数は使わない。

| DB設定 | 意味 | 停止時 UI |
|---|---|---|
| 行なし / DB読取失敗 | **停止**（安全側。未設定 = 未有効化） | `/analytics/[annotationId]` に「GA4コンテンツ評価は現在停止中です」を表示し、評価実行ボタンを非活性にする。`/analytics` 一覧は評価状態を停止中として表示する（一覧に評価実行ボタンは置かない） |
| `enabled=false` | **停止** | 同上 |
| `enabled=true` | 評価実行を許可（ロール `admin`/`paid` は別途必須） | 通常表示 |

**判定ロジック:** 各評価リクエストで `ga4_content_evaluation_settings.enabled IS TRUE` を確認した場合のみ許可する。設定変更は次のリクエストから反映し、アプリの再デプロイを必要としない。DB読取失敗時も評価APIは実行しない。

GA4/GSC **取込 Cron は停止しない**。評価処理だけを切り離す（§14 ロールバックと整合）。

## 9. 外部API・エラー仕様

### 9.1 Google認証・OAuth スコープ

必要スコープ（既存正本: `src/lib/constants.ts`）:

| 用途 | スコープ |
|---|---|
| GA4 Data API | `https://www.googleapis.com/auth/analytics.readonly` |
| GSC Search Analytics API | `https://www.googleapis.com/auth/webmasters.readonly` |

- `googleTokenService.ensureValidAccessToken` を利用する。
- 再認証が必要な場合は `needs_reauth` として保存し、既存の Google 設定画面へ誘導する。
- 評価機能内で独自のトークン更新処理を作らない。

#### 9.1.1 連携ライフサイクル

| イベント | 評価への影響 | 保存・UI |
|---|---|---|
| リフレッシュトークン失効（`invalid_grant`、6 ヶ月未使用、ユーザー revoke 等） | 新規評価不可 | `needs_reauth`。既存評価結果は保持 |
| OAuth scope 縮小（`analytics.readonly` / `webmasters.readonly` 不足） | 不足 API のみ `import_failed` | 不足 scope をエラーメッセージに明示 |
| Google アカウント削除・GrowMate ユーザー削除 | 新規評価不可 | 評価履歴は `ON DELETE CASCADE` でユーザーに追随。削除前の監査要件は別途 |
| 再連携成功 | 以降の取込・評価が可能 | **欠損期間の自動埋め戻しは MVP 対象外**。再連携後は次回評価から新データを使用 |
| プロパティ/サイト URL 変更 | URL 突合失敗の可能性 | `insufficient_data` + 正規化失敗理由 |

### 9.2 GA4 API

- GA4 Data API のレポートリクエスト前に、必要に応じて Compatibility API でディメンション・指標の組み合わせを確認する。
- 非互換の指標は、その指標だけを欠損扱いにするか、評価を `insufficient_data` にする。別指標を勝手に代替しない。
- API のレート制限、タイムアウト、権限エラー、プロパティ未設定をエラーコード化する。
- 既存の評価結果を、今回の取得失敗で消去しない。

#### 9.2.1 GA4 クォータ（Standard Property, 2026-08-12 公式）

| クォータ | 上限 |
|---|---|
| Core Tokens Per Property Per Day | 200,000 |
| Core Tokens Per Property Per Hour | 40,000 |
| Core Tokens Per Project Per Property Per Hour | 14,000 |
| Core Concurrent Requests Per Property | 10 |

1 評価あたりの GA4 API 呼び出しは **Compatibility 確認 0〜1 回 + レポート 0 回**（DB キャッシュ利用）を原則とし、キャッシュ miss 時のみ API を叩く。大量評価時は `returnPropertyQuota: true` で消費をログ記録する。

### 9.3 GSC API

- ページ単位の `clicks`、`impressions`、`ctr`、`position` は GSC Search Analytics API から取り込んだ値を利用する。
- GSC 未連携、対象期間に行がない、URL 正規化で紐づかない場合を区別する。

#### 9.3.1 GSC クォータ・上限

| 項目 | 上限 |
|---|---|
| `rowLimit` | 1–25,000（デフォルト 1,000） |
| QPM | 1,200 queries/minute/site（公式 limits） |

1 ユーザー・1 評価バッチあたりの GSC 再取込は **`maxRows: 5000` 以下**（`gscEvaluationService` の既存値）を上限とする。

### 9.4 LLM

#### 9.4.1 再試行ポリシー

既存正本: `gscSuggestionJobService`（`suggestion_attempt_count >= 3` で terminal、`RETRY_DELAY_MINUTES = 15`）。

| エラー種別 | 最大試行回数 | 再試行間隔 | 上限到達時 |
|---|---|---|---|
| 429 / 5xx / タイムアウト（手動・同期評価） | **3 回**（初回含む） | **2 秒**固定（バックオフなし） | `evaluation_failed` |
| 構造化出力不正（Zod 検証失敗） | **3 回**（初回含む） | **2 秒**固定 | `evaluation_failed` |
| 429 / 5xx / タイムアウト（非同期ジョブ） | **3 回**（`evaluation_attempt_count` 等で履歴に記録） | **15 分**（`RETRY_DELAY_MINUTES` と同値） | `evaluation_failed`（terminal） |

試行回数は評価履歴に保存し、UI で「再試行中（n/3）」を区別できるようにする。

#### 9.4.2 ログ

- ログにはプロンプト本文、トークン、記事本文、認証情報を無制限に出力しない。

## 10. 画面仕様

### 10.1 画面責務

| 画面 | 責務 | 対象 |
|---|---|---|
| `/analytics` | コンテンツ一覧、カテゴリ/未評価フィルタ、評価状態・点数・パターン・最終評価日時の表示。記事詳細への導線 | `app/analytics/`、`AnalyticsTable.tsx` |
| `/analytics/[annotationId]` | 1記事の統合詳細。GA4指標、GSC指標、検索クエリ、GA4/GSC統合評価、評価履歴、手動評価・再実行 | 既存 `app/gsc-dashboard/` の記事詳細機能を移設・再構成 |
| `/ga4-dashboard` | サイト全体のGA4集計、ランキング、時系列の可視化 | 既存画面を維持。GA4コンテンツ評価は追加しない |
| `/gsc-dashboard?annotationId=...` | 既存ブックマーク・開きっぱなしの別タブ向けredirect専用の互換入口。`/analytics/[annotationId]`へredirect | 旧画面UI・新規機能は追加しない |

### 10.2 一覧画面 `/analytics`

- 既存のコンテンツ分析一覧（`AnalyticsTable.tsx`）に、GA4評価状態、評価点数、パターン、最終評価日時を追加する。
- `unassessed` / GA4未評価をフィルタできるようにする（GSC未評価フィルタ `p_has_unstarted_gsc_evaluation` と同型）。
- 一覧には診断・根拠・改善提案などの長文要約列を追加しない。既存テーブルの横幅とレイアウトを維持する。
- 各記事から `/analytics/[annotationId]` へ遷移する。遷移元の一覧URL（`page`、`category`、`uncategorized`、`start`、`end`、`unread_suggestion`、`gsc_evaluation`）を`returnTo`として引き継ぐ。
- 文言は `.agents/skills/growmate-ui-ux/ui-text.md` に準拠する。

### 10.3 記事詳細画面 `/analytics/[annotationId]`

- 既存 `/gsc-dashboard?annotationId=...` の概要、検索クエリ分析、評価履歴を移設する。
- GA4指標とGSC指標を同じ記事単位で表示し、GA4/GSC統合評価の診断、根拠、改善提案、対象期間、データ品質、プロンプトバージョンを確認できるようにする。
- タブ構成は「概要（GA4/GSC統合）」「検索クエリ」「評価履歴」を基本とし、UIたたき台合意（Q5）で最終確定する。
- 評価実行中（`evaluating`）、データ不足、再認証必要、評価失敗、Kill Switch停止中を区別して表示する。
- `returnTo`が検証済みの同一サイト内パスであれば「コンテンツ一覧に戻る」に使用し、未指定・不正値の場合は`/analytics`へ戻す。外部URLへ遷移させない。
- 旧URL `/gsc-dashboard?annotationId=...` は、記事IDを維持して本画面へredirectする。旧URLの利用者がいる前提でredirectは削除しないが、旧画面UIは残さない。
- 70点等の閾値はフィルタ・並び替え用途に限定し、提案内容を画面側で固定分岐しない（MustかはQ2）。

### 10.4 UI合意ゲート

クライアント文脈 §1.8 に従い、UIたたき台の事前合意をフェーズ1のUI実装前、かつ `spec-to-pr` 前の必須条件とする（Q5）。合意前はタブ配置・詳細文言を固定しない。

## 11. 非機能要件

- フェーズ1では状態と `(user_id, content_annotation_id)` の一意制約により、同一ユーザー・同一記事の手動評価が同時に二重実行されない。フェーズ2ではこれにclaim RPCを加える。
- 外部 API または LLM の一時障害で、既存の正常結果が失われない。
- 評価結果に対象期間、データ取得日時、プロンプトバージョンを表示または追跡できる。
- LLM 入力は §6.3.2 の上限を持ち、上限到達時に `data_quality=partial` または `evaluation_failed` で検知できる。
- Google 認証情報・Service Role キー・個人情報を LLM 入力や通常ログへ出さない。
- DB 取得は PostgREST の 1000 行上限を前提に、狙い撃ち、ページング、DB 側集約のいずれかを使用する。
- フェーズ2でCronを対象化する場合、`maxDuration` 300 秒・バッチ時間予算 280 秒を超える評価は中断し、残件は次回 Cron へ委譲する。
- Kill Switch（§8.2）により、DB設定変更だけでデプロイなしに LLM 評価を停止できる。

## 12. 受入条件（Gherkin）

### AC-00 フェーズ0のリファクタリングで既存挙動を維持する

```gherkin
Feature: GA4コンテンツ評価の実装基盤

  Scenario: 事前リファクタリング後も既存の分析一覧が同じ結果を返す
    Given リファクタリング前の既存GA4/GSCデータと同じ入力がある
    When フェーズ0のリファクタリング後に /analytics 一覧を表示する
    Then ページング、既存フィルタ、GA4集計値、既存エラー表示の挙動が変わらない
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
    Then 評価状態が needs_reauth になる
    And 既存のGoogle再認証導線が表示される
```

### AC-06 Kill Switch で評価を停止できる

```gherkin
  Scenario: 評価機能が Kill Switch で停止されている
    Given `ga4_content_evaluation_settings.enabled` が false、行なし、またはDB読取失敗である
    When 記事の評価を実行しようとする
    Then 評価 API は実行されない
    And /analytics/[annotationId] に停止中の表示が出る
    And 記事詳細の評価実行ボタンは非活性である
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

フェーズ1は評価状態と一意制約で防止し、フェーズ2はこれにclaim RPCの`FOR UPDATE SKIP LOCKED`を加える。

```gherkin
  Scenario: 異常終了した評価をTTL経過後に再実行する
    Given 記事 A の評価が `evaluating` 状態で、`updated_at` が15分より古い
    When 記事 A の評価を再実行する
    Then staleな実行は `evaluation_failed` と `evaluation_stale` として記録される
    And 新しい `evaluation_run_id` で評価が開始される
    And staleな実行が新しい評価結果を上書きできない
```

### AC-08 評価実行中状態を表示する（フェーズ2）

```gherkin
  Scenario: 評価実行中の記事を一覧で確認する
    Given 記事の評価が非同期ジョブで実行中である
    When /analytics 一覧を表示する
    Then 該当記事の評価状態が evaluating である
    And 評価完了まで evaluated 結果は上書き表示されない
```

### AC-09 記事詳細画面へ移設し、旧URLを維持する

```gherkin
  Scenario: 一覧からGA4/GSC統合記事詳細へ遷移する
    Given `/analytics` の一覧に記事 A が表示されている
    And 一覧URLにページ、カテゴリ、期間などのフィルタが指定されている
    When 記事 A の詳細を開く
    Then `/analytics/[annotationId]` でGA4指標、GSC指標、検索クエリ、統合評価履歴を確認できる
    And 「コンテンツ一覧に戻る」で元の一覧フィルタが復元される

  Scenario: 旧GSC詳細URLを開く
    Given `/gsc-dashboard?annotationId=記事A` を開く
    When redirect が実行される
    Then `/analytics/記事A` に遷移する
    And 記事Aの既存GSC詳細情報と評価履歴を確認できる
```

## 13. テスト計画

- フェーズ0回帰テスト: `/analytics` の既存一覧、ページング、フィルタ、GA4集計値、GSC表示、既存エラー表示をリファクタリング前後で比較する。
- フェーズ0単体テスト: 評価Context組立、欠損判定、状態遷移、エラーコード変換、構造化LLMアダプターのJSON抽出・再試行・ログ秘匿を検証する。DB fixtureは作成しない。
- 単体テスト: URL正規化、期間集計、欠損判定、状態遷移、LLM出力スキーマ検証。
- サービステスト: GA4/GSCデータのユーザーID分離、プロンプトのsystem/user分離、履歴保存、失敗時の既存結果保持。
- APIテスト: GA4互換性エラー、GSC未連携、Google再認証、429/5xx、LLMタイムアウト。
- DBテスト: RLS、インデックス、ユニーク制約、`evaluation_run_id` 条件付き更新、stale回復、Kill Switch設定のデフォルトfalse・権限、ロールバック、ユーザー間の参照遮断。評価テーブルのDB fixtureはフェーズ1で追加する。
- E2E: 未評価フィルタ、一覧から記事詳細への遷移、GA4/GSC統合評価表示、評価実行、評価結果表示、データ不足・失敗・再認証表示、旧GSC詳細URL redirect、戻りクエリ復元。
- 実データ検証: 少なくとも1ユーザーの実GA4/GSCデータを使い、画面値・保存値・API応答を突合する。モックの結果だけで完了判定しない。
- フェーズ2テスト（実施時のみ）: claim RPCの同時実行、Cron時間予算超過、残ジョブの次回委譲、非同期再試行、重複評価防止を検証する。
- フェーズ3テスト（実施時のみ）: Compatibility API確認、追加指標の取込値、既存指標との期間集計整合を実データで検証する。

## 14. リリース・ロールバック

### リリース順序

1. フェーズ0のリファクタリングを適用する。利用者向け挙動を変えず、回帰テスト・型チェック・Lint・ビルドを通す。
2. Q5のUIたたき台合意を完了し、`spec-to-pr` とフェーズ1のUI実装着手条件を満たす。
3. フェーズ1のDB マイグレーションを適用する。Kill Switch設定行は `enabled=false` で作成する。
4. 生成型を更新する。未適用環境では pending 型を使用し、適用後に削除する。
5. フェーズ1の評価サービス・手動API・UIをKill Switch無効状態でデプロイする。
6. `/gsc-dashboard?annotationId=...` の互換redirectと、一覧・GA4ランキングから記事詳細への導線をデプロイする。旧URL、別タブ、ブックマーク、一覧フィルタ付きの戻り遷移を検証する。
7. 許可された運用手順でステージングのDB設定を `enabled=true` に変更し、実データで評価結果とエラー状態を検証する。
8. Q8で定期評価を含めると確定した場合のみ、フェーズ2のCron・非同期ジョブを追加する。
9. 一般ユーザーへ段階展開する。

### ロールバック

- `ga4_content_evaluation_settings.enabled=false` に変更して LLM 評価実行を次リクエストから停止する（§8.2）。DB設定の変更手段が利用できない場合は、評価APIを安全側で停止する。
- 画面移設で問題が発生した場合は、旧 `/gsc-dashboard?annotationId=...` redirectと旧導線を一時的に維持し、評価データ・履歴を削除せずに新詳細画面への導線だけを戻せるようにする。
- 既存の GA4/GSC 取込 Cron は停止せず、評価処理だけを停止できる構成にする。
- DB ロールバックが必要な場合は、評価専用テーブル・インデックス・ポリシー・`ga4_content_evaluation_settings` を対象に限定する。既存 GA4/GSC テーブルは削除しない。
- 評価履歴は削除せず、再デプロイ後の再評価に利用できるよう保持する。

## 15. 未確定事項（クライアント確認中）

以下は **実装契約に確定値を書かない**。回答後に本書を更新し、`spec-to-pr` を再実行する。

| ID | 質問 | 背景 | ブロッカー |
|---|---|---|---|
| Q1 | §1.9.2 のパターン1〜3表を MVP 確定仕様としてよいか。それとも繁田さんプロンプト受領まで分岐名・条件を実装契約に入れないか | クライアント提示表 vs プロンプト待ち | **Yes**（プロンプト/パターン確定） |
| Q2 | 「70点以下の一覧化」は Must の UI フィルタか、任意か | §1.9.2 vs §6.4 | UI 仕様確定 |
| Q3 | ROI は今回スコープか。費用・売上データの所在はどこか | §1.9.2 vs §3.2 Non-goal | 指標セット確定 |
| Q4 | 改善提案のメール配信を Non-goal にしてよいか（§1.9.4 との縮小合意） | メール連携言及 | スコープ確定 |
| Q5 | UI たたき台合意をフェーズ1のUI実装前、かつ `spec-to-pr` 前の必須ゲートとする方針でよいか | §1.8 開発前 UI 合意。現行仮置きは「必須」 | **Yes**（画面配置・文言） |
| Q6 | GA4 評価結果を共有ユーザー（スタッフ等）が閲覧できるべきか | 既存 RPC の共有モデル vs 新規 RLS owner-only | RLS/RPC 設計 |
| Q7 | `engagementRate`・PV（`screenPageViews`）の GA4 API 追加取得は MVP 必須か | 既存取込に未取得 | 取込パイプライン範囲 |
| Q8 | 評価実行は手動のみか、定期 Cron も含むか。1 回あたり記事数・コスト上限は | §8.1 暫定は手動のみ | Cron/コスト設計 |

### 繁田さんへの確認事項（プロンプト関連）

1. システムプロンプトの最終版、入力 JSON の必須項目、出力 JSON のフィールド名・列挙値。
2. 評価点数の意味と算出方法。
3. 評価に必要な記事情報の範囲（タイトル、要約、導入文、本文、CTA 等）。
4. 評価期間の初期値と最低条件（例: 直近 30 日、データ蓄積 1 か月）。
5. CV の定義（対象イベント名、複数イベントの扱い、ユーザーごとの設定要否）。

## 16. 外部仕様の根拠

外部仕様は 2026-08-12 に Google 公式ドキュメントを確認した。以下、公式ページ本文の verbatim 引用と解釈を分離する。

### GA4 Data API — `engagementRate`

- URL: https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema
- 確認日: 2026-08-12
- 公式記載（引用）:

> The percentage of engaged sessions (Engaged sessions divided by Sessions). This metric is returned as a fraction; for example, 0.7239 means 72.39% of sessions were engaged sessions.

- 解釈: エンゲージメント率は GA4 指標として定義されている。MVP で使うかは Q7。使う場合は Compatibility API で `landingPage` との組み合わせを確認してから取込に追加する。

### GA4 Data API — `screenPageViews`

- URL: https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema
- 確認日: 2026-08-12
- 公式記載（引用）:

> The number of app screens or web pages your users viewed. Repeated views of a single page or screen are counted. (screen_view + page_view events).

- 解釈: PV 指標は GA4 で定義されている。既存取込には含まれない。MVP 必須かは Q7。

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

> This method checks the compatibility of dimensions and metrics that can be added to a Google Analytics Core report request.

- 解釈: 指標追加前に互換性を検証する設計とする。

### GA4 Data API Quotas

- URL: https://developers.google.com/analytics/devguides/reporting/data/v1/quotas
- 確認日: 2026-08-12
- 公式記載（引用）:

> Core Tokens Per Property Per Day | 200,000
> Core Tokens Per Property Per Hour | 40,000

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
> `dataState` | [Optional] If "all" (case-insensitive), data will include fresh data. If "final" (case-insensitive) or if this parameter is omitted, the returned data will include only finalized data.

- 解釈: §9.3.1 / §4.2.4 の根拠。

### 公式未確認（アプリ定義とする）

| 項目 | 理由 |
|---|---|
| `landingPage` × 検索指標の非互換 | 公式 API スキーマ本文に明示記述なし（2026-08-12）。既存 `ga4ImportService` コメントを正とする |
| GA4 データ確定遅延 | GA4 Data API basics に遅延定義なし（2026-08-12）。`imported_at` をアプリ定義とする |

## 17. 変更影響とドキュメント

- フェーズ0の変更対象候補: `src/server/services/analyticsContentService.ts` の内部分離、新規の評価Context・状態・エラー型、新規の構造化LLMアダプター、単体/回帰テスト。`contentAnnotationSummaryService.ts` と `llmService.ts` は既存挙動不変のため変更しない。
- フェーズ1の変更対象候補: `src/server/services/`、`src/server/actions/` または Route Handler、`src/types/`、`supabase/migrations/`、`app/analytics/`（`AnalyticsTable.tsx` 等）、`app/analytics/[annotationId]/`、`ga4_content_evaluation_settings` の参照処理。
- 既存GSC詳細画面の移設対象: `app/gsc-dashboard/` のページ/コンポーネント、`src/server/actions/gscDashboard.actions.ts` の `revalidatePath('/gsc-dashboard')`、`src/server/actions/gscNotification.actions.ts` の同パス、`src/components/GlobalToastBridge.tsx` の `/gsc-dashboard` 判定、`src/components/AnalyticsTable.tsx` の別タブ導線。
- 移設時の導線修正対象: `app/ga4-dashboard/components/RankingTab.tsx` の `/analytics?annotationId=...` 死リンクを `/analytics/[annotationId]` と`returnTo`付き導線へ修正する。`app/ga4-dashboard/page.tsx` の未使用 `annotationId` / `path` searchParams 型も、移設方針に合わせて削除または実装確認する。
- フェーズ2の変更対象候補: `src/server/lib/cron-definitions.ts`、`app/api/cron/`、claim RPC、非同期ジョブサービス、監視定義。
- フェーズ3の変更対象候補: `ga4ImportService`、`ga4_page_metrics_daily` の追加指標migration、Compatibility確認、Context Assembly Contract、プロンプト入力契約、実データ検証。
- 変更対象外: `app/ga4-dashboard/` の画面構成・集計ロジック（§3.2 Non-goal）。ただし、記事詳細へのリンク修正は移設互換対応としてフェーズ1で行う。`ga4ImportService` はフェーズ3を対象化するまで改修しない。
- `README.md`: Kill SwitchのDB設定変更手順、フェーズ1の手動評価経路、設定変更時の安全側挙動を追記する。READMEの更新要否・対象セクションは実装時の `readme_sync` で最終確認する。
- 実装前に本書をレビューし、§15 の未確定事項を確定したうえで、フェーズ1のテーブル項目・API契約・画面文言を固定する。フェーズ2/3は対象化した時点で追加レビューする。

## 18. 変更履歴

| 日付 | 内容 | 状態 |
|---|---|---|
| 2026-08-12 | 会議内容、既存実装、Google公式仕様をもとに初版作成 | ドラフト |
| 2026-08-12 | spec-review audit 指摘（SPEC-AUTHZ-001 〜 SPEC-CLIENT-001）を反映 | ドラフト・レビュー待ち |
| 2026-08-12 | spec-review audit 第2回（SPEC-OPS-002 〜 SPEC-AC-001）を反映 | ドラフト・レビュー待ち |
| 2026-08-12 | 事前リファクタリング（フェーズ0）と手動MVP・Cron・追加指標の段階実装、概算工数を追加 | ドラフト・レビュー待ち |
| 2026-08-12 | サブエージェントレビュー指摘（挙動不変範囲、評価固着、UIゲート、Kill Switch、手動時間予算、状態定義、フェーズ3契約）を反映 | ドラフト・レビュー待ち |
| 2026-08-12 | `/analytics`一覧・`/analytics/[annotationId]`統合詳細・`/ga4-dashboard`集計の3層構成、GSC詳細移設、旧URL redirect、戻りクエリ復元を追加 | ドラフト・レビュー待ち |

## 19. レビュー記録

| finding_id | 対応 | 備考 |
|---|---|---|
| SPEC-AUTHZ-001 | 修正 | §3.3 認可表を追加 |
| SPEC-RLS-001 | 修正 | §7.2 uuid FK、§7.4 owner-only RLS + RPC 共有方針 |
| SPEC-REUSE-001 | 修正 | §5.1 再利用必須リスト、§6.1 RPC/正規化 |
| SPEC-DATA-001 | 修正 | §4.2 データ契約（landingPage、死列、GSC 正本） |
| SPEC-LLM-001 | 修正 | §6.3.2 Context Assembly Contract 表。プロンプト依存項目はブロッカー明記 |
| SPEC-LLM-002 | 修正 | ハッシュ列追加せず `version`+`updated_at` で追跡（§6.3.1） |
| SPEC-OPS-001 | 修正 | §8.1 Cron/claim、§8.2 env Kill Switch、§14 |
| SPEC-EXT-001 | 修正 | §9 OAuth scope、§9.2.1/§9.3.1 クォータ |
| SPEC-EXT-002 | 修正 | §16 verbatim 引用に置換 |
| SPEC-EXT-003 | 修正 | §9.1.1 連携ライフサイクル |
| SPEC-SCOPE-001 | 修正 | §3.2/§17 で `ga4-dashboard` Non-goal 明示 |
| SPEC-CLIENT-001 | 修正 | §15 Q1–Q8 に隔離。本文で断定しない |
| SPEC-OPS-002 | 修正 | §8.2 未設定/false→停止、明示 `true` のみ許可 |
| SPEC-XREF-001 | 修正 | §4.1 CV 参照を §15 繁田確認 #5 に修正 |
| SPEC-LLM-003 | 修正 | §9.4.1 再試行回数 3・間隔固定 |
| SPEC-TMPL-001 | 修正 | §2.4 KPI 表、§2.5 関係者、§2.6 As-Is/To-Be |
| SPEC-AC-001 | 修正 | §12 AC-06〜08 追加 |
| SPEC-UI-001 | 修正 | `/analytics`一覧・`/analytics/[annotationId]`統合詳細・`/ga4-dashboard`集計の責務分離、GSC詳細移設と旧URL互換を追加 |

### 公式ドキュメント照合

- **実施**（確認日: 2026-08-12）。§16 に verbatim 引用を記録。
- **公式未確認**: `landingPage`×検索指標非互換、GA4 データ確定遅延（§16 表参照）。

### 残置（理由付き）

該当なし。audit 第1回 12 件・第2回 5 件はすべて修正または §15 ブロッカー隔離で対応済み。
