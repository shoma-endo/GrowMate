# GA4 Data API 日次キャッシュ機能 設計書（MVP・記事ページ別PDCA）

**作成日**: 2026-01-24  
**ステータス**: MVP確定（実装進行可）

---

## 概要

GA4 Data API を用いて、ユーザーのサイトの **記事ページ別** 指標を日次で取得・キャッシュし、Analytics 画面で「ページ評価 → 改善提案 → PDCA」に利用する。

GA4 Data API の制約（`eventName` ディメンション追加でベース指標の意味が変わり得る等）を回避するため、**2レポート分離（ベース/イベント）**で取得・統合する。

---

## 要件サマリ（MVP確定）

| 項目 | 仕様 |
|---|---|
| 表示対象 | 記事ページ別（pagePath を normalized_path に正規化してJOIN） |
| 取得期間 | 直近30日（デフォルト） |
| 指標 | 滞在時間（平均）/ 読了率 / 直帰率 / CV数 / CVR |
| 直帰率 | GA4 定義（bounceRate）を使用 |
| 読了率 | scroll 90% 到達（`scroll_90`、時間条件なし） |
| CV定義 | 記事ページ上の前段CVイベント（複数選択可） |
| CV数 | 選択イベントの `eventCount` 合算（回数ベース） |
| CVR | `cv_event_count / users`（分母は users=totalUsers） |
| CV未設定時 | `cv_event_count=0` で保存 + UIバナーで設定を促す |
| Phase 1 での scroll_90 | 取得・保存する（UIは非表示） |
| URL正規化 | クエリ全削除 + フラグメント全削除 + 小文字化 |

> 注記（仕様固定）: CV は eventCount（回数）ベースのため、同一ユーザーの複数回行動は加算される（= 回数ベースCVR）。

---

## 全体アーキテクチャ

### 初回セットアップ（GSC設定画面に統合）

1. オーナーが「GA4 連携」ボタンをクリック
2. Google OAuth（`analytics.readonly` スコープ追加）へリダイレクト
3. 認可後、`ga4Service.listProperties` でプロパティ一覧取得
4. オーナーがプロパティを選択
5. CVイベント（前段CV）を選択（複数可）
6. 基準値（滞在時間・読了率の閾値）を設定
7. `gsc_credentials` に保存

### 日次バッチ（Cron）

> **注意**: MVPでは未実装。手動同期（`/api/ga4/sync`）のみ対応。本番投入後に実装予定。

1. `/api/cron/ga4-sync` が毎日 AM 6:00 JST に実行（将来実装）
2. `ga4_property_id` が設定済みのユーザーを取得（最大10件、`ga4_last_synced_at` が古い順）
3. 各ユーザーに対して:
   - `gscService.refreshAccessToken` でトークン更新
   - 取得期間を計算（`startDate = ga4_last_synced_at(JST日付) + 1日`, `endDate = yesterdayJst`）
   - GA4 Data API を 2レポート取得（ベース/イベント）
   - `ga4_page_metrics_daily` に upsert（Service Role）
   - `gsc_credentials.ga4_last_synced_at` を「取り込み済み最終日（endDate）」基準で更新
4. 280秒経過でバッチ終了（残りは次回実行）

### Analytics 画面表示

1. `content_annotations` と `ga4_page_metrics_daily` を JOIN
2. `normalized_path` でマッチング
3. 期間フィルタで `date` 範囲を絞り込み
4. 基準値と比較してハイライト表示
5. `is_sampled` / `is_partial` バッジ表示

---

## GA4分析専用画面（MVP追記）

### 目的

- `Analytics` 一覧を「記事の優先順位付け（トリアージ）」に集中させる
- GA4の時系列・分布・比較分析は専用画面で行う
- GSCダッシュボードと同様に `recharts` を利用し、UI/実装パターンを統一する

### 画面URL（案）

- `GET /ga4-dashboard`
- クエリパラメータ（初期案）:
- `start`: `YYYY-MM-DD`（省略時は直近30日）
- `end`: `YYYY-MM-DD`（省略時は yesterday JST）
- `annotationId`: 選択記事ID（任意）
- `path`: `normalized_path`（任意、`annotationId` 未指定時の直接選択）

### アクセス制御

- `/analytics` と同様、認証済みユーザーのみ
- スタッフはオーナー権限範囲のデータを参照可能（既存の `get_accessible_user_ids` に準拠）
- `ga4_property_id` 未設定時は設定導線を表示し、`/setup/ga4` へ誘導

### 情報設計（MVP）

優先実装順:
- 1) サマリーカード → 2) 記事別ランキングテーブル → 3) 時系列グラフ
- MVPは縦積みレイアウトを採用し、将来のタブ切替/左右分割は Phase 2 で検討する

1. サマリーカード（期間集計）
- 表示: `sessions`, `users`, `平均滞在時間`, `読了率`, `直帰率`, `CV数`, `CVR`
- 既存仕様の計算式を使用（本書「指標計算式」）

2. 記事別ランキングテーブル
- 行: `normalized_path`（必要に応じてタイトルJOIN）
- 列: 上記主要指標 + `is_sampled` / `is_partial` フラグ
- ソート: `sessions`, `CVR`, `読了率`, `平均滞在時間`（初期は `sessions DESC`）
- クリックで下段の時系列グラフ対象を切替

3. 時系列グラフ（選択記事）
- グラフライブラリ: `recharts`
- 折れ線: `sessions`, `users`
- 追加線（切替式）: `読了率`, `直帰率`, `CVR`
- 補助表示: `is_sampled` / `is_partial` 日をバッジまたは点スタイルで識別

4. 品質フラグ表示
- 期間内に `is_sampled=true` または `is_partial=true` が存在する場合、画面上部に注意バナーを表示
- 判定粒度は「期間内に1日でも該当があれば表示」とする
- 時系列グラフでは日次点ごとに `is_sampled` / `is_partial` を識別できる表示を行う

### データ取得（MVP）

- 取得元は `ga4_page_metrics_daily` のみ（MVPでは追加外部API呼び出しなし）
- 集計単位:
- 画面全体サマリー: 期間合算
- 記事別ランキング: `normalized_path` ごとに期間合算
- 時系列: 選択記事の `date` 単位

### API / Server Action（初期案）

- `fetchGa4DashboardSummary(start, end)`
- `fetchGa4DashboardRanking(start, end, limit, sort)`
- `fetchGa4DashboardTimeseries(start, end, normalizedPath)`

未指定時のデフォルト挙動:
- `start` / `end` 省略時は Server Action 側で直近30日を適用する
- `normalizedPath` 未指定時は、同期間の `sessions` 上位1記事を自動選択して時系列を表示する
- 上位記事が取得できない場合は空グラフ（プレースホルダ）を表示する

> 実装方式は既存方針に従い、App Router + Server Actions を優先する。

### `Analytics` 画面との役割分担

- `Analytics`: 記事一覧 + 注釈編集 + 軽量指標確認（運用導線）
- `GA4 Dashboard`: 指標分析・比較・傾向把握（分析導線）
- 相互導線:
- `Analytics` から「GA4分析を見る」リンク
- `GA4 Dashboard` から対象記事の `Analytics` 行へ戻る導線

### MVP範囲外（Phase 2）

- セグメント比較（デバイス/流入チャネル/新規既存）
- 指標しきい値の高度アラート
- 複数記事同時比較グラフ
- CSVダウンロード

---

## OAuth 設計

### スコープ

| API | スコープ |
|---|---|
| GSC（既存） | `https://www.googleapis.com/auth/webmasters.readonly` |
| GA4 Data API（追加） | `https://www.googleapis.com/auth/analytics.readonly` |
| GA4 Admin API（追加） | `https://www.googleapis.com/auth/analytics.readonly` |

### 再認可導線（確定）

- **GSC 設定画面に「GA4スコープ追加/再連携」ボタンを配置**
- 403（insufficient permissions）等を検知した場合、UI で再認可を促す

---

## データ取得設計（GA4 Data API）

### 方針（2レポート分離）

- **(A) ベース指標レポート**: `pagePath` × `date` でセッション/ユーザー/滞在/直帰を取得
- **(B) イベント指標レポート**: `pagePath` × `date` × `eventName` で `eventCount` を取得（CVイベント + `scroll_90`）

取得後、`date + normalized_path` で統合し、日次行として保存する。

### (A) ベース指標レポート（runReport）

```ts
interface GA4BaseReportRequest {
  dateRanges: [{ startDate: string; endDate: string }];
  dimensions: [{ name: 'pagePath' }, { name: 'date' }];
  metrics: [
    { name: 'sessions' },
    { name: 'totalUsers' },
    { name: 'userEngagementDuration' },
    { name: 'bounceRate' }
  ];
  limit: 10000;
  offset?: number;
}
```

### (B) イベント指標レポート（runReport）

```ts
interface GA4EventReportRequest {
  dateRanges: [{ startDate: string; endDate: string }];
  dimensions: [{ name: 'pagePath' }, { name: 'date' }, { name: 'eventName' }];
  metrics: [{ name: 'eventCount' }];
  // eventName IN (...) のフィルタを適用する想定
  limit: 10000;
  offset?: number;
}
```

#### イベントフィルタ方式（確定）

- `eventNames = unique([...ga4_conversion_events, 'scroll_90'])`
- **CVイベントが未設定（空配列）でも `scroll_90` は必ず取得する**

擬似コード:

```ts
const eventNames = Array.from(
  new Set([...(ga4ConversionEvents ?? []), GA4_CONFIG.READ_EVENT_NAME])
).filter(Boolean);

// eventNames は最低でも ['scroll_90'] になる
```

### ページング・上限

- 1リクエスト最大: 10,000行
- 最大取得行数: 50,000行（ベース/イベントそれぞれ）
- 上限到達時: `is_partial = true` を設定し、警告ログ出力。UI にバッジ表示。

### サンプリング検知

レスポンス `metadata.samplingMetadatas` が存在する場合、`is_sampled = true` を設定し UI にバッジ表示。

---

## 2レポート統合（不整合対策・確定）

### 不整合の前提

ベースレポートに存在するがイベントレポートに存在しない（`date, normalized_path`）組み合わせは通常発生する。

### 統合ルール（NULL禁止）

統合時に `cv_event_count` と `scroll_90_event_count` は **必ず 0 を入れる**（NULL禁止）。

擬似コード:

```ts
const merged = baseRows.map((base) => {
  const key = `${base.date}:${base.normalized_path}`;
  const eventData = eventMap.get(key) ?? {
    cv_event_count: 0,
    scroll_90_event_count: 0,
  };
  return { ...base, ...eventData };
});
```

---

## DB 設計

### `gsc_credentials` 拡張

| カラム | 型 | 説明 |
|---|---|---|
| ga4_property_id | text | GA4プロパティID（例: `properties/123456789`） |
| ga4_property_name | text | プロパティ表示名 |
| ga4_conversion_events | text[] | CVイベント名（前段CV、複数可） |
| ga4_threshold_engagement_sec | int | 滞在時間の閾値（秒） |
| ga4_threshold_read_rate | numeric(3,2) | 読了率の閾値（0〜1） |
| ga4_last_synced_at | timestamptz | 取り込み済み最終日（endDate）を表す同期カーソル |

### `ga4_page_metrics_daily`

| カラム | 型 | 説明 |
|---|---|---|
| id | uuid | 主キー |
| user_id | uuid | ユーザーID（オーナーIDに正規化） |
| property_id | text | GA4プロパティID |
| date | date | 日付 |
| page_path | text | GA4 `pagePath` |
| normalized_path | text (GENERATED) | `normalize_to_path(page_path)` |
| sessions | int | `sessions` |
| users | int | `totalUsers` |
| engagement_time_sec | int | `userEngagementDuration`（秒・合計） |
| bounce_rate | numeric(5,4) | `bounceRate`（0〜1） |
| cv_event_count | int | CVイベントの eventCount 合算（**NOT NULL DEFAULT 0**） |
| scroll_90_event_count | int | `scroll_90` の eventCount（**NOT NULL DEFAULT 0**） |
| is_sampled | boolean | サンプリング有無 |
| is_partial | boolean | 部分取得フラグ |
| imported_at | timestamptz | インポート日時 |
| created_at | timestamptz | 作成日時 |
| updated_at | timestamptz | 更新日時 |

### 一意制約・インデックス

- UNIQUE: `(user_id, property_id, date, page_path)`
- Index:
  - `(user_id, date DESC)`
  - `(user_id, property_id)`
  - `GIN (normalized_path gin_trgm_ops)`

### RLS

- SELECT: `user_id = ANY(get_accessible_user_ids(auth.uid()))`
- INSERT/UPDATE/DELETE: Service Role のみ（ポリシー未定義 = RLS により拒否）

### user_id の正規化

スタッフが実行した場合も、保存先はオーナーIDに正規化する。

```ts
async function resolveOwnerUserId(userId: string): Promise<string> {
  const user = await getUser(userId);
  return user.ownerUserId ?? userId;
}
```

---

## URL 正規化（JOINキー）

### 正規化ルール（確定）

- `https?://` を除去
- ドメインが付いていたらパス部分のみ抽出
- **フラグメント（`#`以降）全削除**
- **クエリ（`?`以降）全削除**
- 末尾 `/` を除去（`/` は維持）
- 空/NULL/ドメインのみ/`?`だけ/`#`だけは `/`
- 小文字化（大小文字を区別しない）

---

## 指標計算式（ページ×日）

| 指標 | 計算式 | 備考 |
|---|---|---|
| 滞在時間（平均） | `engagement_time_sec / sessions` | sessions=0 の場合 0 |
| 直帰率 | `bounce_rate * 100` | 表示は% |
| CV数 | `cv_event_count` | eventCount合算 |
| CVR | `cv_event_count / users * 100` | users=0 の場合 0 |
| 読了率 | `scroll_90_event_count / users` | users=0 の場合 0 |

---

## UI 仕様（MVP）

### GA4 設定（/app/gsc-dashboard に統合）

- 接続状態
- プロパティ選択
- CVイベント選択（複数）
- 閾値設定（滞在時間/読了率）
- 手動同期ボタン
- 再認可導線（GA4スコープ追加/再連携）

### Analytics 画面

- 期間フィルタ: 7 / 14 / 30（デフォルト）/ 90 日
- `is_sampled` / `is_partial` バッジ表示
- CVイベント未設定時:
  - **バナーで「CVイベントを設定してください」表示**
  - CV/CVR 列は `-`（または 0。UI側で統一）

---

## バッチ制御（MVP）

> **注意**: MVPでは未実装。本番投入後のCron実装時に使用予定。

```ts
const MAX_USERS_PER_BATCH = 10;
const TIMEOUT_BUFFER_MS = 20_000;
const MAX_DURATION_MS = 300_000 - TIMEOUT_BUFFER_MS;
```

- 対象ユーザーは `ga4_last_synced_at ASC NULLS FIRST`（古い順）で選定
- 同期カーソル運用: `startDate > endDate` の場合でも `ga4_last_synced_at` は `endDate` 基準に更新し、次回実行で再計算する
- MAX_DURATION_MS を超えたら中断し、次回に持ち越す

---

## API エンドポイント（MVP）

| 種別 | パス | メソッド | 認証 |
|---|---|---:|---|
| 手動同期 | `/api/ga4/sync` | POST | オーナーのみ |
| プロパティ一覧 | `/api/ga4/properties` | GET | オーナーのみ |
| キーイベント一覧 | `/api/ga4/key-events` | GET | オーナーのみ（`propertyId`） |
| 設定保存 | `/api/ga4/settings` | PUT | オーナーのみ |

> **注意**: Cron エンドポイント（`/api/cron/ga4-sync`）は MVP では未実装。本番投入後に実装予定。

---

## 付録A: DDL（フラグメント除去・列確定版）

> **拡張機能**: `idx_ga4_page_metrics_path_trgm`（GIN + `gin_trgm_ops`）を使用するため、`pg_trgm` 拡張が必要です。未導入の場合は先頭の `CREATE EXTENSION` で有効化してください。

```sql
-- 必要な拡張機能を有効化
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION public.normalize_to_path(input_url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  val text;
  slash_pos int;
BEGIN
  IF input_url IS NULL OR input_url = '' THEN
    RETURN '/';
  END IF;

  val := lower(input_url);
  val := regexp_replace(val, '^https?://', '');

  IF val = '' THEN
    RETURN '/';
  END IF;

  IF left(val, 1) = '?' OR left(val, 1) = '#' THEN
    RETURN '/';
  END IF;

  IF left(val, 1) != '/' THEN
    slash_pos := position('/' in val);
    IF slash_pos > 0 THEN
      val := substring(val from slash_pos);
    ELSE
      RETURN '/';
    END IF;
  END IF;

  val := regexp_replace(val, '#.*$', '');
  val := regexp_replace(val, '\?.*$', '');

  IF val != '/' THEN
    val := regexp_replace(val, '/+$', '');
  END IF;

  IF val = '' THEN
    RETURN '/';
  END IF;

  RETURN val;
END;
$$;

COMMENT ON FUNCTION public.normalize_to_path(text)
IS 'URL またはパスを正規化してパス部分のみを返す。クエリ・フラグメントを除去。GA4/GSC の JOIN 用。';

ALTER TABLE gsc_credentials ADD COLUMN IF NOT EXISTS ga4_property_id text;
ALTER TABLE gsc_credentials ADD COLUMN IF NOT EXISTS ga4_property_name text;
ALTER TABLE gsc_credentials ADD COLUMN IF NOT EXISTS ga4_conversion_events text[];
ALTER TABLE gsc_credentials ADD COLUMN IF NOT EXISTS ga4_threshold_engagement_sec int DEFAULT 60;
ALTER TABLE gsc_credentials ADD COLUMN IF NOT EXISTS ga4_threshold_read_rate numeric(3,2) DEFAULT 0.50;
ALTER TABLE gsc_credentials ADD COLUMN IF NOT EXISTS ga4_last_synced_at timestamptz;

CREATE TABLE ga4_page_metrics_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id text NOT NULL,
  date date NOT NULL,
  page_path text NOT NULL,
  normalized_path text GENERATED ALWAYS AS (public.normalize_to_path(page_path)) STORED,
  sessions int NOT NULL DEFAULT 0,
  users int NOT NULL DEFAULT 0,
  engagement_time_sec int NOT NULL DEFAULT 0,
  bounce_rate numeric(5,4),
  cv_event_count int NOT NULL DEFAULT 0,
  scroll_90_event_count int NOT NULL DEFAULT 0,
  is_sampled boolean NOT NULL DEFAULT false,
  is_partial boolean NOT NULL DEFAULT false,
  imported_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ga4_page_metrics_daily
  ADD CONSTRAINT ga4_page_metrics_daily_unique
  UNIQUE (user_id, property_id, date, page_path);

CREATE INDEX idx_ga4_page_metrics_user_date ON ga4_page_metrics_daily (user_id, date DESC);
CREATE INDEX idx_ga4_page_metrics_user_property ON ga4_page_metrics_daily (user_id, property_id);
CREATE INDEX idx_ga4_page_metrics_path_trgm ON ga4_page_metrics_daily USING gin (normalized_path gin_trgm_ops);

ALTER TABLE ga4_page_metrics_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY ga4_page_metrics_daily_select_policy
  ON ga4_page_metrics_daily
  FOR SELECT
  USING (user_id = ANY(get_accessible_user_ids(auth.uid())));
```

---

## 付録B: ロールバックSQL

```sql
DROP POLICY IF EXISTS ga4_page_metrics_daily_select_policy ON ga4_page_metrics_daily;
DROP TABLE IF EXISTS ga4_page_metrics_daily;
DROP FUNCTION IF EXISTS public.normalize_to_path(text);
ALTER TABLE gsc_credentials DROP COLUMN IF EXISTS ga4_property_id;
ALTER TABLE gsc_credentials DROP COLUMN IF EXISTS ga4_property_name;
ALTER TABLE gsc_credentials DROP COLUMN IF EXISTS ga4_conversion_events;
ALTER TABLE gsc_credentials DROP COLUMN IF EXISTS ga4_threshold_engagement_sec;
ALTER TABLE gsc_credentials DROP COLUMN IF EXISTS ga4_threshold_read_rate;
ALTER TABLE gsc_credentials DROP COLUMN IF EXISTS ga4_last_synced_at;
```

---

## 付録C: TypeScript 正規化関数（フラグメント除去対応）

```ts
export function normalizeToPath(inputUrl: string | null | undefined): string {
  if (inputUrl === null || inputUrl === undefined || inputUrl === '') {
    return '/';
  }
  let val = inputUrl.toLowerCase();
  val = val.replace(/^https?:\/\//, '');
  if (val === '') {
    return '/';
  }
  if (val.startsWith('?') || val.startsWith('#')) {
    return '/';
  }
  if (!val.startsWith('/')) {
    const slashPos = val.indexOf('/');
    if (slashPos > 0) {
      val = val.substring(slashPos);
    } else {
      return '/';
    }
  }
  val = val.replace(/#.*$/, '');
  val = val.replace(/\?.*$/, '');
  if (val !== '/') {
    val = val.replace(/\/+$/, '');
  }
  if (val === '') {
    return '/';
  }
  return val;
}
```

---

## 付録D: SQL テスト（フラグメント対応）

```sql
SELECT
  input,
  public.normalize_to_path(input) AS result,
  expected,
  CASE WHEN public.normalize_to_path(input) = expected THEN 'OK' ELSE 'NG' END AS status
FROM (
  VALUES
    ('https://example.com/blog/post?utm=1', '/blog/post'),
    ('http://example.com/blog/post/', '/blog/post'),
    ('example.com/blog/post', '/blog/post'),
    ('/blog/post?x=1', '/blog/post'),
    ('/blog/post/', '/blog/post'),
    ('/', '/'),
    ('', '/'),
    (NULL, '/'),
    ('example.com', '/'),
    ('?utm=1', '/'),
    ('#section', '/'),
    ('https://example.com', '/'),
    ('https://example.com/', '/'),
    ('/blog/post#section', '/blog/post'),
    ('https://example.com/blog/post#section?query=1', '/blog/post'),
    ('/blog/post?query=1#section', '/blog/post')
) AS t(input, expected);
```
