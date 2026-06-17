# チャットトークン使用量 仕様書（方針1: 新規テーブル）

## 目的
AIチャット利用のトークン使用量を「1リクエスト単位」で永続化し、月次集計・ユーザー別・モデル別の可視化と、将来の課金/上限設計に耐えうる基盤を提供する。

## スコープ
- 対象: `/app/chat` のAIチャット（Anthropic/OpenAI）。
- 保存粒度: 1リクエスト = 1レコード。
- 集計単位: 月次（UTCで集計、表示はUIでタイムゾーン変換）。

## 期待するユースケース
- ユーザー別の「当月トークン使用量」表示
- 管理画面での使用量ランキング
- モデル/プロバイダ/機能別（serviceId）での使用量分析
- 将来の従量課金・上限アラート

## データモデル
新規テーブル `chat_token_usages` を作成する。

### カラム定義（案）
| カラム名 | 型 | Null | 説明 |
| --- | --- | --- | --- |
| id | uuid | NO | PK |
| user_id | text | NO | オーナー基準のユーザーID（スタッフは ownerUserId を使用） |
| session_id | text | YES | chat_sessions.id |
| message_id | text | YES | chat_messages.id（該当があれば） |
| service_id | text | YES | chat_sessions.service_id と同義 |
| provider | text | NO | `openai` / `anthropic` |
| model | text | NO | 実モデル名 |
| input_tokens | integer | NO | 入力トークン数 |
| output_tokens | integer | NO | 出力トークン数 |
| total_tokens | integer | NO | input + output（DBで整合性保証） |
| web_search_requests | integer | NO | Anthropic web_search ツール呼び出し回数（DEFAULT 0、OpenAI は常に 0） |
| request_id | text | YES | 生成リクエストの識別子（追跡用） |
| created_at | timestamptz | NO | 生成日時（UTC） |

### インデックス（案）
- `(user_id, created_at)` 月次集計用
- `(session_id, created_at)` セッション集計用
- `(provider, model, created_at)` モデル別集計用

## 保存タイミング
以下のタイミングで usage を記録する。

1. `app/api/chat/anthropic/stream/route.ts`
   - `message_delta` の `chunk.usage` 取得時点で記録
2. `src/server/services/llmService.ts`
   - OpenAI/Anthropic の非ストリーミング呼び出し完了時点で記録

## 権限・RLS方針
- 既存の `get_accessible_user_ids` を利用し、スタッフはオーナーのデータに集約。
- RLS:
  - select: `user_id = any (get_accessible_user_ids(auth.uid()))`
  - insert: サービスロールのみ許可（サーバー側で一元記録）

## 集計クエリ（例）
**月次トークン合計（ユーザー別）**
```sql
select
  date_trunc('month', created_at) as month,
  user_id,
  sum(total_tokens) as total_tokens
from chat_token_usages
where user_id = :user_id
  and created_at >= date_trunc('month', now())
group by 1, 2;
```

**モデル別使用量**
```sql
select
  provider,
  model,
  sum(total_tokens) as total_tokens
from chat_token_usages
where user_id = :user_id
  and created_at >= date_trunc('month', now())
group by 1, 2
order by total_tokens desc;
```

## マイグレーション方針
- `supabase/migrations/` に新規SQLを追加。
- Rollback案をSQLコメントで記載する（既存方針に準拠）。

## データ整合性（total_tokens）
`total_tokens` は手動計算による不整合を避けるため、以下のいずれかを採用する（推奨: GENERATED）。

1. **GENERATED カラム（推奨）**
   ```sql
   total_tokens integer GENERATED ALWAYS AS (input_tokens + output_tokens) STORED
   ```

2. **CHECK 制約**
   ```sql
   CONSTRAINT chk_total_tokens CHECK (total_tokens = input_tokens + output_tokens)
   ```

## アプリケーションコード要件（GENERATED 採用時）
GENERATED カラムを採用する場合、アプリケーション側は以下を厳守する。

- **INSERT で `total_tokens` を指定しない**（指定すると PostgreSQL がエラー）
- **UPDATE で `total_tokens` を変更しない**（同上）
- 影響範囲の実装（`app/api/chat/anthropic/stream/route.ts` / `src/server/services/llmService.ts` など）では、挿入・更新の payload から `total_tokens` を除外する
- **`web_search_requests` は Anthropic の場合のみ `TokenUsageTotals.webSearchRequests` の値を設定する。OpenAI など非対応プロバイダは省略可（`DEFAULT 0` が適用される）。**
  - 取得元: `app/api/chat/anthropic/stream/route.ts` でストリーミング完了後に保持している `TokenUsageTotals.webSearchRequests`
  - `mergeTokenUsage` / `addTokenUsageTotals`（`anthropic-token-usage.ts`）で累積された値をそのまま使用する

例: INSERT（`total_tokens` を含めない）
```sql
INSERT INTO chat_token_usages (
  id, user_id, session_id, message_id, service_id,
  provider, model, input_tokens, output_tokens,
  web_search_requests,  -- Anthropic の場合のみ設定。OpenAI は省略（DEFAULT 0）
  request_id, created_at
) VALUES (...);
```

## 既存データの扱い
- 過去分は計測不可のため、仕様開始日以降のみ集計。

## 監査・ログ
- `request_id` でエラー/再生成の追跡を可能にする。
- 異常値（total_tokens < 0 など）は記録拒否。

## 影響範囲
- API: `app/api/chat/anthropic/stream/route.ts`
- サービス: `src/server/services/llmService.ts`
- DB: Supabase migration（新規テーブル）
- UI: 既存 `app/analytics` での表示拡張（別途タスク）

---

## 管理画面 トークン消費UI 仕様（追記）

### 概要
管理者が `/admin/users` 画面から、各ユーザーのトークン消費状況を時系列グラフで確認できる機能を追加する。

---

### 画面構成

#### 1. ユーザー一覧画面（既存）への変更
- **対象ファイル**: `app/admin/users/UsersClient.tsx`
- アクションカラムに「トークン」ボタンを追加。
- 遷移先: `/admin/users/{userId}/token-usage`

```
| フルネーム | LINE表示名 | メール / 認証 | 最終ログイン | 登録日 | 権限 | アクション        |
|------------|-----------|--------------|------------|------|-----|-----------------|
| 田中 一郎   | ...       | ...          | ...        | ...  | ... | 編集 ｜ トークン  |
```

#### 2. トークン消費詳細画面（新規）
- **Route**: `/admin/users/[userId]/token-usage`
- **ファイル構成**:
  ```
  app/admin/users/
  └─ [userId]/
     └─ token-usage/
        ├─ page.tsx                 # Server Component（ユーザー情報・初期データ取得）
        └─ TokenUsageClient.tsx     # Client Component（recharts グラフ）
  ```

---

### UIレイアウト（詳細ページ）

```
← ユーザー一覧に戻る

# 田中 一郎 のトークン消費量

[サマリーカード群]
  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
  │ 当月合計         │ │ 前月比           │ │ Webサーチ回数    │
  │ 1,234,567 tokens │ │ ▲ +12.3%        │ │ 42 回           │
  └─────────────────┘ └─────────────────┘ └─────────────────┘

[粒度セレクタ] ── [ 日次 | 週次 | 月次 ]

[時系列バーチャート]
  - X軸: 日付ラベル（日次: 過去30日、週次: 過去12週、月次: 過去12ヶ月）
  - Y軸: トークン数
  - 積み上げ棒グラフ: input_tokens（青）/ output_tokens（橙）
  - ホバー: ツールチップで各値・合計を表示

[モデル別内訳テーブル]
  | モデル            | Input Tokens | Output Tokens | 合計        |
  |------------------|-------------|--------------|------------|
  | claude-sonnet-4-6 | 800,000     | 400,000      | 1,200,000  |
  | ...              | ...         | ...          | ...        |
```

---

### データ取得仕様

#### Server Action（新規）
```typescript
// src/server/actions/admin.actions.ts に追加（または adminTokenUsage.actions.ts を新規作成）

export type TokenUsageGranularity = 'daily' | 'weekly' | 'monthly';

export type TokenUsageDataPoint = {
  period: string;        // '2026-05-01' / '2026-W18' / '2026-05'
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type TokenUsageByModel = {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type TokenUsageSummary = {
  currentMonthTotal: number;
  previousMonthTotal: number;
  webSearchRequests: number;  // chat_token_usages.web_search_requests の SUM
  series: TokenUsageDataPoint[];
  byModel: TokenUsageByModel[];
};

// webSearchRequests 算出ロジック:
//   SELECT SUM(web_search_requests) FROM chat_token_usages
//   WHERE user_id = :user_id AND created_at >= :start AND created_at < :end
// 保存元: Anthropic ストリーミングレスポンスの server_tool_use.web_search_requests
//         （TokenUsageTotals.webSearchRequests として anthropic-token-usage.ts が保持）
// service_id 絞り込み: なし（全サービスを合算して表示。絞り込みが必要な場合は別途 API パラメータを追加）

export const getTokenUsageByUser = async (
  userId: string,
  granularity: TokenUsageGranularity
): Promise<{ success: true; data: TokenUsageSummary } | { success: false; error: string }>;
```

#### SQLクエリ（日次集計例）

> **タイムゾーン方針**: DB は常に UTC 基準で集計し、`period` は UTC 日付文字列として返す。
> UI（`TokenUsageClient.tsx`）側でユーザーのタイムゾーンに変換して表示する。

```sql
-- 日次（過去30日）— UTC 基準
SELECT
  date_trunc('day', created_at)::date::text AS period,
  SUM(input_tokens)  AS input_tokens,
  SUM(output_tokens) AS output_tokens,
  SUM(total_tokens)  AS total_tokens
FROM chat_token_usages
WHERE user_id = :user_id
  AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY 1
ORDER BY 1;
```

> 週次・月次も同様に `date_trunc('week' / 'month', created_at)` で集計（`AT TIME ZONE` は使用しない）。

#### UI 側タイムゾーン変換（TokenUsageClient.tsx）

```ts
// period は 'YYYY-MM-DD'（UTC）で届く
// ユーザーのタイムゾーンに合わせてラベルを整形する
const formatPeriodLabel = (period: string, userTimezone: string) =>
  new Date(period).toLocaleDateString('ja-JP', { timeZone: userTimezone });
```

- `userTimezone` は `Intl.DateTimeFormat().resolvedOptions().timeZone` で取得（ブラウザのロケール）。
- 将来の国際展開時はユーザープロフィールの `timezone` フィールドを参照する想定。

---

### recharts コンポーネント設計

```tsx
// TokenUsageClient.tsx（概略）
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

// 粒度選択タブ: 'daily' | 'weekly' | 'monthly'
// データ切り替えは Server Action 再呼び出し（useTransition）
```

- **ライブラリ**: 既存 `recharts`（package.json 済み）
- **グラフ種別**: `BarChart`（積み上げ棒グラフ）
- **色定義**: input=`#3B82F6`（青）/ output=`#F97316`（橙）

---

### ルーティング・権限

- 既存 `/admin` レイアウトのミドルウェア（admin権限必須）がそのまま適用される。
- `page.tsx` で `getAllUsers` と同様の `resolveAdminUser()` チェックを実施。
- 対象ユーザーが存在しない場合は404リダイレクト。

---

### 前提条件
以下が先行タスクとして完了している必要がある。
1. **DB マイグレーション**: `chat_token_usages` テーブル作成（本仕様書「データモデル」参照）。
2. **保存処理実装**: `app/api/chat/anthropic/stream/route.ts` での usage 永続化。

---

### 開発工数見積もり

| タスク | 工数 | 備考 |
|--------|------|------|
| **前提①** DBマイグレーション（`chat_token_usages` テーブル） | 0.5d | 先行タスク。未完の場合 |
| **前提②** API保存処理（stream/route.ts → chat_token_usages INSERT） | 1.0d | 先行タスク。未完の場合 |
| Server Action 追加（`getTokenUsageByUser`・集計クエリ） | 1.0d | 日次/週次/月次の3クエリ＋型定義＋データなし期間の補完 |
| `UsersClient.tsx` 変更（「トークン」ボタン追加） | 0.5h | 軽微 |
| `app/admin/users/[userId]/token-usage/` 新規ページ | 1.5d | page.tsx + TokenUsageClient.tsx + 404リダイレクト・ローディング・エラーハンドリング |
| recharts グラフ実装（積み上げ棒・ツールチップ・粒度切替） | 1.0d | useTransition・ツールチップカスタマイズ・レスポンシブ対応 |
| サマリーカード・モデル別テーブル実装 | 0.5d | |
| lint / build / 動作確認 | 0.5d | |
| **合計（UI部分のみ）** | **4.0d** | DB・API完了済みを前提（バッファ含む） |
| **合計（全工程）** | **6.5d** | 前提タスク未完の場合（バッファ含む） |
