-- Create Google Ads negative keywords suggestion settings and prompt template.
--
-- Rollback:
--   drop policy if exists "google_ads_negative_keywords_settings_select" on public.google_ads_negative_keywords_settings;
--   drop table if exists public.google_ads_negative_keywords_settings cascade;
--   delete from public.prompt_templates where name = 'google_ads_negative_keywords_suggestion';

create table if not exists public.google_ads_negative_keywords_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  enabled boolean not null default false,
  send_hour_jst smallint not null default 7
    check (send_hour_jst between 0 and 23),
  last_sent_on date,
  last_send_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique(user_id)
);

alter table public.google_ads_negative_keywords_settings enable row level security;

drop policy if exists "google_ads_negative_keywords_settings_select" on public.google_ads_negative_keywords_settings;
create policy "google_ads_negative_keywords_settings_select"
  on public.google_ads_negative_keywords_settings for select
  using (user_id::text = any(public.get_accessible_user_ids((select auth.uid()))));

insert into public.prompt_templates (name, display_name, content, variables)
values (
  'google_ads_negative_keywords_suggestion',
  'Google Ads 除外キーワード提案',
  $prompt$
あなたはリスティング広告（Google Ads）の運用最適化の専門コンサルタントです。
以下のインプットを元に「除外キーワード提案レポート」を Markdown 形式で作成してください。

## インプット

### アカウント
- アカウント名: {{customerName}}
- 集計期間: {{dateRange}}（前日 1 日）
- 分析範囲: 連携済み Google Ads アカウント全体

### ターゲットペルソナ
{{persona}}

### 既存除外キーワード（重複登録を避けるための文脈）
{{existingNegativeKeywords}}

### 期間内の検索クエリ実績
（各行: 検索語句 | キャンペーン名 | 広告グループ名 | IMP | Click | Cost(円) | CV）
{{searchTermData}}

## 分析と分類ルール

1. 提案レベル
   - **campaign**: キャンペーン共通で除外すべき検索語句
   - **ad_group**: 特定広告グループの意図と合わない検索語句
2. カテゴリ
   - **company**: 競合企業・他ブランドの指名検索
   - **knowhow**: 「〇〇とは」「方法」「自分で」「DIY」など情報収集意図
   - **general_phrase**: 上記いずれにも当てはまらないその他不要語
3. 緊急度
   - **click_occurred**: クリック発生済み
   - **preventive**: インプレッションのみ
   - **review_needed**: 意図不明・要確認
4. 既存除外と完全一致する語句は提案に含めない。
5. 広告グループ単位の除外候補は、広告グループ名を必ず明記する。

## 出力形式

### 1. レポートサマリー
- 分析クエリ数（ユニーク）
- 前日広告費・クリック数・コンバージョン数の合計
- 除外候補（クリック発生済み）件数、予防的除外件数、要検討件数

### 2. キャンペーン共通の除外候補
表形式: No. / 検索クエリ / カテゴリ / 提案マッチタイプ / 除外理由 / クリック / 費用 / CV

### 3. 広告グループ単位の除外候補
表形式: No. / 検索クエリ / キャンペーン / 広告グループ / カテゴリ / 提案マッチタイプ / 除外理由 / クリック / 費用 / CV

### 4. 要検討
表形式（理由を明記）

### 5. 主要クエリ TOP5（参考・残留推奨）
表形式

### 6. 運用メモ
- ペルソナと検索クエリの整合
- 商品ページ訴求の改善ヒント
- 季節・トレンド要素のコメント

## 構造化データ出力（最後に必ず出力）

```json
[
  {
    "searchTerm": "検索語句",
    "level": "campaign または ad_group",
    "category": "company または knowhow または general_phrase",
    "urgency": "click_occurred または preventive または review_needed",
    "campaignName": "キャンペーン名",
    "adGroupName": "広告グループ名（level=ad_group の場合は必須）",
    "matchType": "BROAD / PHRASE / EXACT",
    "reason": "除外理由",
    "impressions": 0,
    "clicks": 0,
    "cost": 0,
    "conversions": 0
  }
]
```
$prompt$,
  '[
    {"name": "persona", "description": "ターゲットペルソナ"},
    {"name": "customerName", "description": "Google Ads アカウント名"},
    {"name": "dateRange", "description": "集計期間（前日 1 日）"},
    {"name": "searchTermData", "description": "前日の検索クエリ実績"},
    {"name": "existingNegativeKeywords", "description": "既存除外キーワード"}
  ]'::jsonb
)
on conflict (name) do update
set
  display_name = excluded.display_name,
  content = excluded.content,
  variables = excluded.variables,
  updated_at = timezone('utc', now());
