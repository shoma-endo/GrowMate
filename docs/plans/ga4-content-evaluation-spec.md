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
| 評価停止の即時性 | 未計測 | Kill Switch 変更後、次リクエストから評価 API が停止 | AC-06 + 手動検証 | リリース前 |
| 二重実行 | 未計測 | 同一 `(user_id, content_annotation_id)` の同時評価 0 件 | AC-07 + DB 制約テスト | CI |

### 2.5 利用者・関係者

| 区分 | 対象 | 期待すること・責任 |
|---|---|---|
| 利用者 | GrowMate `paid` / `admin` ユーザー | `/analytics` で評価実行・結果確認・再実行 |
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
  -> 未評価フィルタ / 手動評価実行
  -> GA4/GSC 指標 + 記事情報を LLM へ構造化投入
  -> 点数・診断・提案を DB 保存（最新 + 履歴）
  -> 一覧・ドロワーで結果確認 -> 改善アクション
```

定期一括評価（Cron）は Q8 確定まで As-Is 相当の手動運用を維持する。

## 3. 対象範囲

### 3.1 MVPで対象とするもの

- GA4日次ページ指標の評価用取得。
- GSCページ指標の評価用取得・GA4との組み合わせ。
- 記事単位の評価実行、結果保存、履歴保存。
- 評価状態（未評価、評価可能、評価済み、データ不足、取得失敗、再認証必要）の表示。
- 評価点数・評価パターン・診断・根拠・改善提案の表示。
- 繁田さんのシステムプロンプトをDBのプロンプトテンプレートから読み込み、`system`ロールでLLMへ渡す処理。
- 評価結果の再実行。

### 3.2 MVPで対象外とするもの

- GA4取込時に全記事を自動評価する処理。
- LLMによる記事本文の自動編集・公開。
- 改善提案の自動メール送信（クライアント文脈 §1.9.4 との整合は Q4 で確認。確定までは Non-goal）。
- ヒートマップの導入・独自イベント設計。データが既存の入力に含まれる場合だけ、将来拡張できる入力項目として扱う。
- 固定ルールによる評価点数・パターン・提案文の算出。
- `app/ga4-dashboard/` の改修（GA4ダッシュボードは取込済み指標の可視化専用。GA4コンテンツ評価の一覧・実行・結果表示は `/analytics` に集約する）。
- `ga4ImportService` への `engagementRate` / `screenPageViews` 追加取得（MVP必須かは Q7 で確定。確定までは取込パイプライン改修対象外）。

### 3.3 認可とアクセス制御

既存実装 `canAccessGa4`（`src/server/lib/ga4-permissions.ts`）を正とする。許可ロールは `admin` と `paid` のみ。`/analytics` は `proxy.ts` の有料機能パスに含まれる。

| 操作 | admin | paid | その他（trial 等） | 実装根拠 |
|---|---|---|---|---|
| 評価一覧・結果の閲覧 | 可 | 可 | 不可 | `canAccessGa4` + `/analytics` ガード |
| 評価の手動実行 | 可 | 可 | 不可 | 同上 |
| 評価の再実行 | 可 | 可 | 不可 | 同上 |
| Cron による一括評価 | 可（対象ユーザー） | 可（対象ユーザー） | 不可 | Service Role 経由。アプリ層で `user_id` を検証 |

共有ユーザー（スタッフ等）がオーナーの評価結果を閲覧できるかは Q6 で確定する。確定までは、新規テーブルの RLS は owner-only とし、共有閲覧が必要な場合は `get_filtered_content_annotations` 等の RPC 経由に限定する（§7.4）。

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
| コンテンツ一覧 RPC | `get_filtered_content_annotations` | 未評価フィルタ追加: `p_has_unstarted_ga4_evaluation`（命名は実装時調整）。**DROP FUNCTION → 再作成 → REVOKE/GRANT** の手順を踏む |
| 未評価フィルタ UI | `AnalyticsTable.tsx` / `CategoryFilter.tsx` | 既存 GSC 未評価フィルタ（`p_has_unstarted_gsc_evaluation`）と同パターンで GA4 版を追加 |
| URL 正規化（GA4） | `normalizeToPath`（`src/lib/ga4-utils.ts`） | `ga4_page_metrics_daily.normalized_path` との突合 |
| URL 正規化（GSC） | `normalizeUrl`（`src/lib/normalize-url.ts`） | `gsc_page_metrics` との突合 |
| Google トークン | `googleTokenService.ensureValidAccessToken` | 再認証検知 |
| プロンプト管理 | `PromptService` + `prompt_templates` | GA4 評価用テンプレートを追加 |
| LLM 呼び出し | `llmChat`（`src/server/services/llmService.ts`） | 構造化出力の JSON 抽出・Zod 検証は `contentAnnotationSummaryService` パターンを踏襲 |
| GSC 評価ジョブ | `gscEvaluationService` + `CRON_DEFINITIONS.gscEvaluate` | 時間予算（`BATCH_TIME_LIMIT_MS`）、並列数、Cron `maxDuration: 300` の設計を GA4 評価 Cron に流用 |
| GSC 提案ジョブ claim | `claim_gsc_suggestion_jobs` RPC + `gscSuggestionJobService` | GA4 評価の非同期ジョブが必要な場合、**claim パターン**（`FOR UPDATE SKIP LOCKED`）を流用。新規 RPC 名は `claim_ga4_content_evaluation_jobs` 等 |
| 権限チェック | `canAccessGa4` | Server Action / Route Handler の入口で検証 |

### 5.2 再利用しないもの

GSCの`gsc_article_evaluations`と`gsc_article_evaluation_history`は掲載順位の改善判定を中心とした設計であり、GA4評価の点数・診断・提案を保存する用途には流用しない。GA4評価専用テーブルを追加する。

### 5.3 共通点と差分

共通点は、外部データを取込し、記事単位に評価を実行し、結果と履歴を保存する流れである。

差分は、GSC評価が順位変化の機械的な結果判定に近いのに対し、GA4評価はGA4・GSC・記事情報をLLMが総合解釈し、記事ごとに改善提案を生成する点である。GA4評価では、評価点数やパターンを固定条件分岐で決めない。

## 6. 機能仕様

### 6.1 評価対象の決定

1. ユーザーに紐づくコンテンツ一覧から評価対象記事を取得する。入口は `get_filtered_content_annotations` RPC（`analyticsContentService.getPage`）。
2. 記事 URL を正規化し、GA4 ページデータと GSC ページデータを同一記事へ紐づける。
   - GA4 突合: `normalizeToPath(canonical_url)` ↔ `ga4_page_metrics_daily.normalized_path`
   - GSC 突合: `normalizeUrl(canonical_url)` ↔ GSC ページ指標
3. GA4 または GSC のデータがない場合は、欠損理由を保持する。GA4 の `search_clicks` / `impressions` / `ctr` 列は欠損ではなく **使用禁止（死データ）** として扱う。
4. 評価対象の全件取得と、LLM へ送る記事情報の取得を分離する。PostgREST の最大返却行数（1000 行）によって、評価対象を暗黙に切り捨てない。一覧は RPC ページング（最大 100 件/ページ）、指標は `fetchGa4Summaries` 相当の **IN 句による狙い撃ち取得** または DB 側集約を使う。
5. データ期間、最終取込日時、最小データ条件を確認し、評価可能な記事だけを LLM 評価へ進める。

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
| `unassessed` | 評価履歴がない |
| `eligible` | 必要データが揃い評価可能 |
| `evaluated` | 最新評価が利用可能 |
| `insufficient_data` | データ期間・件数・指標が不足 |
| `import_failed` | 外部API取込に失敗 |
| `needs_reauth` | Google再認証が必要 |
| `evaluation_failed` | LLMまたは出力検証に失敗 |
| `evaluating` | 評価実行中（非同期ジョブ claim 済み） |

欠損値を`0`に変換して評価を続行しない。新しい評価に失敗した場合、既存の正常な評価結果と履歴を上書きしない。

## 7. データ設計（案）

### 7.1 新規テーブル

テーブル名は実装時に命名規則を確認するが、案は以下とする。

- `ga4_content_evaluations`: 記事ごとの最新評価。
- `ga4_content_evaluation_history`: 評価実行ごとのスナップショット。

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
- `last_error_code`, `last_error_message`
- `created_at`, `updated_at`

`content_annotations.user_id` は `text` 型だが、新規テーブルの `user_id` は **`uuid` FK** とする。評価作成時は `content_annotation_id` から注釈を取得し、`content_annotations.user_id::uuid` と操作主体の `user_id` の一致をアプリケーション層で検証する。

### 7.3 制約・インデックス

- `user_id`を必須とし、すべてのサービス層クエリで対象ユーザーを明示する。
- `(user_id, content_annotation_id)`に一意制約を設ける。
- `(user_id, status, score)`、`(user_id, updated_at)`を検索用途に検討する。
- 履歴には評価時点の出力と入力データの識別情報を保存し、後から同じ評価結果を追跡できるようにする。
- JSONは表示用に保存し、検索・並び替えに使う値は通常列として保持する。

### 7.4 RLS・アクセス制御

- 新規テーブルは **`user_id = (SELECT auth.uid())` の owner-only RLS** とする。`.agents/skills/supabase/rls.md` に従い、新規 RLS/RPC で **`get_accessible_user_ids` を参照しない**。
- 共有ユーザーがオーナーの評価結果を閲覧する必要がある場合（Q6）、直接 SELECT ではなく **`get_filtered_content_annotations` 等の Service Role RPC** で評価状態・点数を JOIN して返す。RPC 内の共有判定は既存 RPC の `get_accessible_user_ids` 利用に限定する。
- `auth.uid()` は `(SELECT auth.uid())` でラップする。
- バッチ・Cron・Google 取込はサーバー側の `SupabaseService` 経由で実行し、Service Role 利用時もアプリケーション層でユーザー ID と対象記事を検証する。
- RPC を追加する場合は、用途に応じて `PUBLIC`、`anon`、`authenticated` の実行権限を明示的に取り消し、許可対象だけに grant する。claim 系 RPC は `service_role` のみ（`claim_gsc_suggestion_jobs` と同型）。
- マイグレーションにはロールバック用の `DROP POLICY`、テーブル・インデックス削除手順をコメントで残す。

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

| 項目 | 方針 | 既存正本 |
|---|---|---|
| Cron 定義 | `CRON_CONFIGS` に `ga4ContentEvaluate` を追加 | `src/server/lib/cron-definitions.ts` |
| Route | `/api/cron/ga4-content-evaluate` | `gsc-evaluate` と同型 |
| `maxDuration` | **300 秒**（GSC 評価と同値） | `CRON_CONFIGS.gscEvaluate.maxDuration` |
| 時間予算 | **280 秒**でバッチ中断 | `GscEvaluationService.BATCH_TIME_LIMIT_MS` |
| 二重実行防止 | (1) `(user_id, content_annotation_id)` ユニーク制約 (2) claim RPC の `FOR UPDATE SKIP LOCKED` (3) `evaluating` 状態 | `claim_gsc_suggestion_jobs` |
| 手動実行 | Server Action から単記事評価。Cron とは別経路 | GSC 手動評価と同型 |

定期評価を MVP に含めるかは **Q8** で確定。確定までは **手動実行のみ** を実装対象とする。

### 8.2 Kill Switch（外部依存停止）

既存の feature flag 基盤は存在しない（`src/lib/constants.ts` の「Feature Flags」は AI モデル設定用）。MVP では **環境変数** で停止する。

| 設定値 | 意味 | 停止時 UI |
|---|---|---|
| 未設定 | **停止**（安全側。未設定 = 未有効化） | `/analytics` に「GA4コンテンツ評価は現在停止中です」を表示。評価実行ボタン非活性 |
| `false` | **停止** | 同上 |
| `true`（明示のみ） | 評価実行を許可（ロール `admin`/`paid` は別途必須） | 通常表示 |

**判定ロジック:** `process.env.GA4_CONTENT_EVALUATION_ENABLED === 'true'` のときのみ許可。未設定・空文字・`false` その他はすべて停止。

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

対象画面: **`/analytics`**（`app/analytics/`）。`app/ga4-dashboard/` は §3.2 Non-goal。

- 既存のコンテンツ分析・評価一覧（`AnalyticsTable.tsx`）に、GA4 評価状態、評価点数、パターン、最終評価日時を追加する。
- `unassessed` / GA4 未評価をフィルタできるようにする（GSC 未評価フィルタ `p_has_unstarted_gsc_evaluation` と同型）。
- 評価済み記事では、診断、根拠、改善提案、対象期間、データ品質を表示する。詳細 UI は **`/analytics` 内ドロワー** を第一案とする（GSC の `EvaluationHistoryTab` パターンを参考。最終配置は Q5 の UI たたき台合意後）。
- 評価実行中（`evaluating`）、データ不足、再認証必要、評価失敗、Kill Switch 停止中を区別して表示する。
- 70点等の閾値はフィルタ・並び替え用途に限定し、提案内容を画面側で固定分岐しない（Must かは Q2）。
- 文言は `.agents/skills/growmate-ui-ux/ui-text.md` に準拠する。

**リリース前ゲート:** クライアント文脈 §1.8 に従い、**UI たたき台の事前合意**を `spec-to-pr` 前の必須条件とする（Q5）。合意前はワイヤーフレームレベルの配置・文言を本書で固定しない。

## 11. 非機能要件

- 同一ユーザー・同一記事の評価が同時に二重実行されない（§8.1: ユニーク制約 + claim RPC + `evaluating`）。
- 外部 API または LLM の一時障害で、既存の正常結果が失われない。
- 評価結果に対象期間、データ取得日時、プロンプトバージョンを表示または追跡できる。
- LLM 入力は §6.3.2 の上限を持ち、上限到達時に `data_quality=partial` または `evaluation_failed` で検知できる。
- Google 認証情報・Service Role キー・個人情報を LLM 入力や通常ログへ出さない。
- DB 取得は PostgREST の 1000 行上限を前提に、狙い撃ち、ページング、DB 側集約のいずれかを使用する。
- Cron `maxDuration` 300 秒・バッチ時間予算 280 秒を超える評価は中断し、残件は次回 Cron へ委譲する。
- Kill Switch（§8.2）によりデプロイなしで LLM 評価を停止できる。

## 12. 受入条件（Gherkin）

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
    Given 環境変数 GA4_CONTENT_EVALUATION_ENABLED が未設定または false である
    When 記事の評価を実行しようとする
    Then 評価 API は実行されない
    And /analytics に停止中の表示が出る
    And 評価実行ボタンは非活性である
```

### AC-07 同一記事の二重実行を防ぐ

```gherkin
  Scenario: 同一記事への同時評価要求
    Given 記事 A の評価が evaluating 状態である
    When 同じ記事 A に対して別の評価を開始しようとする
    Then 2 件目の評価は開始されない
    And 既存の evaluating 状態または claim が保持される
```

### AC-08 評価実行中状態を表示する

```gherkin
  Scenario: 評価実行中の記事を一覧で確認する
    Given 記事の評価が非同期ジョブで実行中である
    When /analytics 一覧を表示する
    Then 該当記事の評価状態が evaluating である
    And 評価完了まで evaluated 結果は上書き表示されない
```

## 13. テスト計画

- 単体テスト: URL正規化、期間集計、欠損判定、状態遷移、LLM出力スキーマ検証。
- サービステスト: GA4/GSCデータのユーザーID分離、プロンプトのsystem/user分離、履歴保存、失敗時の既存結果保持。
- APIテスト: GA4互換性エラー、GSC未連携、Google再認証、429/5xx、LLMタイムアウト。
- DBテスト: RLS、インデックス、ユニーク制約、ロールバック、ユーザー間の参照遮断。
- E2E: 未評価フィルタ、評価実行、評価結果表示、データ不足・失敗・再認証表示。
- 実データ検証: 少なくとも1ユーザーの実GA4/GSCデータを使い、画面値・保存値・API応答を突合する。モックの結果だけで完了判定しない。

## 14. リリース・ロールバック

### リリース順序

1. DB マイグレーションを適用する。
2. 生成型を更新する。未適用環境では pending 型を使用し、適用後に削除する。
3. 評価サービス・API・ジョブをデプロイする（`GA4_CONTENT_EVALUATION_ENABLED=false` でデプロイ）。
4. 環境変数 `GA4_CONTENT_EVALUATION_ENABLED=true` をステージングで有効化し、実データで評価結果とエラー状態を検証する。
5. UI たたき台合意（Q5）後、本番 UI を確定デプロイする。
6. 一般ユーザーへ段階展開する。

### ロールバック

- `GA4_CONTENT_EVALUATION_ENABLED=false` で LLM 評価実行を即時停止する（§8.2）。
- 既存の GA4/GSC 取込 Cron は停止せず、評価処理だけを停止できる構成にする。
- DB ロールバックが必要な場合は、評価専用テーブル・インデックス・ポリシーを対象に限定する。既存 GA4/GSC テーブルは削除しない。
- 評価履歴は削除せず、再デプロイ後の再評価に利用できるよう保持する。

## 15. 未確定事項（クライアント確認中）

以下は **実装契約に確定値を書かない**。回答後に本書を更新し、`spec-to-pr` を再実行する。

| ID | 質問 | 背景 | ブロッカー |
|---|---|---|---|
| Q1 | §1.9.2 のパターン1〜3表を MVP 確定仕様としてよいか。それとも繁田さんプロンプト受領まで分岐名・条件を実装契約に入れないか | クライアント提示表 vs プロンプト待ち | **Yes**（プロンプト/パターン確定） |
| Q2 | 「70点以下の一覧化」は Must の UI フィルタか、任意か | §1.9.2 vs §6.4 | UI 仕様確定 |
| Q3 | ROI は今回スコープか。費用・売上データの所在はどこか | §1.9.2 vs §3.2 Non-goal | 指標セット確定 |
| Q4 | 改善提案のメール配信を Non-goal にしてよいか（§1.9.4 との縮小合意） | メール連携言及 | スコープ確定 |
| Q5 | UI たたき台合意を `spec-to-pr` 前の必須ゲートにするか。別作業で先行共有するか | §1.8 開発前 UI 合意 | **Yes**（画面配置・文言） |
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

- 変更対象候補: `src/server/services/`、`src/server/actions/` または Route Handler、`src/types/`、`supabase/migrations/`、`app/analytics/`（`AnalyticsTable.tsx` 等）。
- 変更対象外: `app/ga4-dashboard/`（§3.2 Non-goal）、`ga4ImportService`（Q7 確定まで追加指標改修なし）。
- 新規環境変数: `GA4_CONTENT_EVALUATION_ENABLED`（boolean, デフォルト false）。secret 管理・再起動条件を README に追記する。
- `README.md`: 上記 env 追加時に更新する。
- 実装前に本書をレビューし、§15 の未確定事項を確定したうえで、テーブル項目・API 契約・画面文言を固定する。

## 18. 変更履歴

| 日付 | 内容 | 状態 |
|---|---|---|
| 2026-08-12 | 会議内容、既存実装、Google公式仕様をもとに初版作成 | ドラフト |
| 2026-08-12 | spec-review audit 指摘（SPEC-AUTHZ-001 〜 SPEC-CLIENT-001）を反映 | ドラフト・レビュー待ち |
| 2026-08-12 | spec-review audit 第2回（SPEC-OPS-002 〜 SPEC-AC-001）を反映 | ドラフト・レビュー待ち |

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

### 公式ドキュメント照合

- **実施**（確認日: 2026-08-12）。§16 に verbatim 引用を記録。
- **公式未確認**: `landingPage`×検索指標非互換、GA4 データ確定遅延（§16 表参照）。

### 残置（理由付き）

該当なし。audit 第1回 12 件・第2回 5 件はすべて修正または §15 ブロッカー隔離で対応済み。
