-- Create Google Ads AI evaluation settings for the MVP manual execution flow.
--
-- Rollback:
--   drop policy if exists "google_ads_eval_settings_select" on public.google_ads_evaluation_settings;
--   drop table if exists public.google_ads_evaluation_settings cascade;
--   delete from public.prompt_templates where name = 'google_ads_ai_evaluation';

create table if not exists public.google_ads_evaluation_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  date_range_days integer not null default 30,
  last_evaluated_on date,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique(user_id)
);

alter table public.google_ads_evaluation_settings enable row level security;

drop policy if exists "google_ads_eval_settings_select" on public.google_ads_evaluation_settings;
create policy "google_ads_eval_settings_select"
  on public.google_ads_evaluation_settings for select
  using (user_id::text = any(get_accessible_user_ids((select auth.uid()))));

insert into public.prompt_templates (name, display_name, content, variables)
values (
  'google_ads_ai_evaluation',
  'Google Ads AI分析',
  $prompt$
あなたはSEOコンテンツ戦略の専門家です。
以下の【インプット情報】を元に、Google検索広告の実績からコンテンツ案を一括で出力してください。

---

## 【インプット情報】

### 1. Google Ads アカウント情報
- アカウント名: {{customerName}}
- 分析期間: {{dateRange}}

### 2. Google検索広告のキーワード指標データ
以下は Google Ads API から取得したキーワード指標です。
検索意図の推定、優先順位付け、コンテンツテーマ作成に使用してください。

{{keywordData}}

### 3. 除外キーワード一覧
以下は現在設定されている除外キーワードです。
カニバリチェック、除外すべき検索意図、記事化すべきでないテーマの判断材料として使用してください。

{{negativeKeywords}}

### 4. 事業・商品の強み
以下は登録済みの事業者情報から抽出したサービスごとの強みです。
各コンテンツテーマと事業の強みが一致しているかを必ず評価してください。

{{strengths}}

### 5. メインペルソナ
以下は登録済みのメインペルソナ情報です。
各コンテンツテーマの検索意図に応じて、サブペルソナとして調整してください。

{{persona}}

---

## 【出力要件】

以下のルールを必ず守ってください。

### ルール1: カニバリチェック
- キーワードを「検索意図」でグルーピングする
- 同じ検索意図のキーワードは1つのコンテンツにまとめる（別記事にしない）
- 意図の分類基準は「情報収集」「比較検討」「購買直前」「教育的」「懐疑的」の5軸で判断する

### ルール2: CV距離での優先順位付け
- 「購買直前」→「比較検討」→「情報収集→購買」→「教育→購買」の順に優先順位をつける
- 同じ距離の場合は、広告インプレッション数（検索需要の高さ）を優先する
- クリック数、コンバージョン数、費用、CPA、CVR も加味し、事業成果に近いテーマを優先する

### ルール3: 各コンテンツの出力フォーマット
以下の項目を各コンテンツごとに必ず出力すること。

---

### 出力フォーマット（各コンテンツごとに繰り返す）

**【優先順位 #X】コンテンツテーマ名**

| 項目 | 内容 |
|------|------|
| メインKW（H1用） | |
| 月間検索Vol推定 | |
| サブKW 1〜3 | |
| ロングテールKW（本文内で拾う） | |
| 広告での表示回数合計 | |
| クリック数合計 | |
| コンバージョン数合計 | |
| 検索意図 | |
| 事業の強み一致度 | ◎ / ○ / △ + 理由 |
| 競合難易度 | 高 / 中 / 低 |
| CV距離 | 非常に近い / 近い / 中間 / 遠い→教育→購買 |

**▼ペルソナ情報**

| 項目 | 内容 |
|------|------|
| ペルソナ名（仮） | |
| 年齢層 | |
| 性別比率 | |
| 家族構成 | |
| 職業・年収帯 | |
| 居住エリア | |
| 検索シーン（いつ・なぜ） | |
| 心理状態・悩み | |
| 求めている情報 | |
| 記事で提供すべき価値 | |
| CTAの方向性 | |

---

## 【補足ルール】

- メインKWは「検索需要が大きく、検索意図が明確なKW」を採用する
- 検索需要が最大でも、検索意図が広すぎて上位表示が難しい場合は、意図を絞ったKWを優先し、その理由を記載する
- ペルソナはメインペルソナをベースに、各記事の検索意図に応じてサブペルソナとして調整する（名前は仮名でOK）
- CTAは以下の方針で設定する
  - 「購買直前」「比較検討」コンテンツ: 強めのCTA（問い合わせ、無料相談、商品・サービスページへの直接誘導）
  - 「教育的」「情報収集」コンテンツ: 柔らかいCTA（関連ページ、事例、SNS、資料、ナレッジコンテンツへの誘導）
- 出力は優先順位の高い順に並べ、最後に「推奨着手順序（TOP5）」を要約で出力すること

---

## 【最終サマリー出力】

全コンテンツの出力後、以下を出力してください。

### ▼推奨着手順序（TOP5）
コンテンツ名、優先理由、期待効果を一言でまとめてください。

### ▼カニバリチェック済みグルーピング一覧
まとめたキーワードのグループと、採用したメインKWの一覧を出力してください。

### ▼注意フラグ
競合難易度が高い、検索意図が曖昧、CV距離が遠すぎて優先度を下げるべきコンテンツがあれば指摘してください。
$prompt$,
  '[
    {"name": "persona", "description": "ターゲットペルソナ情報"},
    {"name": "strengths", "description": "全サービスの強み（改行区切り）"},
    {"name": "keywordData", "description": "全キーワード指標（構造化テキスト）"},
    {"name": "negativeKeywords", "description": "除外キーワード一覧"},
    {"name": "dateRange", "description": "分析期間"},
    {"name": "customerName", "description": "Google Adsアカウント名"}
  ]'::jsonb
)
on conflict (name) do update
set
  display_name = excluded.display_name,
  content = excluded.content,
  variables = excluded.variables,
  updated_at = timezone('utc', now());
