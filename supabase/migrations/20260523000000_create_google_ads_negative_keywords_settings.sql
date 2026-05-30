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
（各行: 検索語句 | キャンペーン名 | 広告グループ名 | IMP | Click | Cost(円) | CV | CV値(円)）
{{searchTermData}}

### 比較対象期間の検索クエリ実績（前々日・前日比メモ用）
{{previousSearchTermData}}

### 前日比サマリー（自動集計済み）
{{dayOverDayComparison}}

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

以下の構成・見出し・絵文字をそのまま使い、Markdown のレポートとして出力してください。
**表（`| ... |` 形式）は一切使わず、見出しと箇条書き・番号付きリストのみで記述すること。**

# Google Ads 検索クエリ分析レポート

対象日: {{dateRange}}（前日分）
アカウント: {{customerName}}

戦略シート読込: ペルソナ情報が取得できている場合はそのまま分析に使用し「✅ 反映済み」と記載する。取得できていない（「（ペルソナ未設定）」等）場合は「⚠️ 取得失敗 → 一般的な前提で分析」と明記する。

## ■ サマリー

- 分析クエリ数（ユニーク）: （件数）
- 前日広告費（合計）: ¥（金額）
- クリック数（合計）: （数）
- コンバージョン数: （数）
- コンバージョン値: ¥（金額）
- 🚨 除外候補（クリック発生済み）: （件数）
- ⚠️ 予防的除外候補: （件数）
- 🤔 要検討: （件数）

CV 状況や前日比から気づいた点を 1〜2 行でコメントする。

## 🚨 除外候補（クリック発生済み）

クリック・課金が発生しているため優先的に除外を推奨する。1 件ずつ次の形式で番号付きで記載する。

1. （検索クエリ） ／ （カテゴリ）
   クリック （数）・費用 ¥（金額）・CV （数） → （除外理由）

## ⚠️ 予防的除外候補（クリック未発生）

表示はされているが明確に商品と無関係・他ブランド・他地域のクエリ。次の 3 カテゴリに分け、箇条書きで列挙する。

### (A) 企業系：競合・他社・他ブランドの指名検索（company）
- （検索クエリ）（表示 （回数）） — （除外理由）

### (B) ノウハウ系：情報収集・「〇〇とは」「方法」など（knowhow）
- （検索クエリ）（表示 （回数）） — （除外理由）

### (C) 一般フレーズ：他地域・カテゴリ違い・その他無関係（general_phrase）
- （検索クエリ）（表示 （回数）） — （除外理由）

## 🤔 要検討キーワード

意図不明・判断保留のクエリ。箇条書きで列挙する。

- （検索クエリ） — （判断保留の理由）

## ✅ 主要クエリ TOP5（参考・残留推奨）

クリック数・費用の上位クエリを最大 5 件、除外せず残す推奨として番号付きで記載する。

1. （検索クエリ） — 表示 （数）・クリック （数）・費用 ¥（金額） → （判定）

## 🛠 広告グループ別 適用用除外リスト

Google Ads にそのまま登録できるよう、**広告グループごと**に除外キーワードを箇条書きで列挙する。広告グループ名が特定できないものはキャンペーン共通として「（キャンペーン共通）」にまとめる。マッチタイプは BROAD / PHRASE / EXACT の推奨値を必ず明記する。既存除外キーワードと完全一致する語句は含めない。

### 広告グループ: （広告グループ名）
- （検索クエリ） ／ （マッチタイプ）
- …

（除外候補のある広告グループの数だけ繰り返す）

## 📈 前日比メモ

インプットの「前日比サマリー（自動集計済み）」の数値を基に、広告費・クリック・CV の増減を箇条書きで 1 行ずつコメントし、主要クエリや指名検索のインプレッション・クリックの傾向にも触れる。

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
    "conversions": 0,
    "conversionValue": 0
  }
]
```
$prompt$,
  '[
    {"name": "persona", "description": "ターゲットペルソナ"},
    {"name": "customerName", "description": "Google Ads アカウント名"},
    {"name": "dateRange", "description": "集計期間（前日 1 日）"},
    {"name": "searchTermData", "description": "前日の検索クエリ実績"},
    {"name": "existingNegativeKeywords", "description": "既存除外キーワード"},
    {"name": "previousSearchTermData", "description": "前々日（比較対象期間）の検索クエリ実績"},
    {"name": "dayOverDayComparison", "description": "前日比サマリー（広告費・クリック・CV・CV値）"}
  ]'::jsonb
)
on conflict (name) do update
set
  display_name = excluded.display_name,
  content = excluded.content,
  variables = excluded.variables,
  updated_at = timezone('utc', now());
