# Google Ads 除外キーワード提案バッチ ジョブキュー化 基本設計

作成日: 2026-08-04
ステータス: 設計レビュー待ち（実装未着手）
関連仕様書: [`docs/specs/google-ads-negative-keywords-suggestion-design.md`](../specs/google-ads-negative-keywords-suggestion-design.md)
参考実装: GSC 提案ジョブ（[`src/server/services/gscSuggestionJobService.ts`](../../src/server/services/gscSuggestionJobService.ts) / [`supabase/migrations/20260611000000_add_gsc_suggestion_jobs.sql`](../../supabase/migrations/20260611000000_add_gsc_suggestion_jobs.sql)）

## 1. 背景

2026-08-01 の本番実行で `Vercel Runtime Timeout Error: Task timed out after 300 seconds` が発生した。1 ユーザーあたり LLM 呼び出しに約 120〜150 秒かかるため、3 並列 × 2 チャンクで `maxDuration=300` を使い切っていた。

暫定対応（2026-08-03、別 PR）で以下を実施済み。

| 対応 | 内容 |
|---|---|
| `maxDuration` 800 秒化 | Fluid Compute 有効を Dashboard で確認済み |
| 時間予算 480 秒での安全停止 | `BATCH_TIME_LIMIT_MS = 800 − USER_TIME_LIMIT_MS(300) − 余白(20)` |
| 1 ユーザー上限 300 秒 | `Promise.race` で強制打ち切り |
| `send_hour_jst <= 現在時刻` での同日回収 | 取りこぼしを次の毎時 cron が拾う |
| `last_attempted_on` カラム | 成否問わず試行時に立て、同日リトライを 1 回に制限 |
| curl リトライ無効化 | 504 によるバッチ二重起動を防止 |

これにより「1 回で 12 ユーザー、あふれた分は次の毎時 cron が回収」という状態になった。

## 2. 目的（暫定対応で残った課題）

| # | 課題 | 現状の実装 | 影響 |
|---|---|---|---|
| A | **クレーム（ロック）が無い** | 対象ユーザーを `SELECT` するだけ。処理権の排他はしていない | 2 本の実行が重なると同じユーザーを両方が処理し、**メールが重複する**。現在は「GH Actions の `concurrency`」「curl リトライ無効」「`last_attempted_on`」の 3 層で "重ならないこと" に依存している |
| B | **個別リトライが無い** | 成否によらず当日 1 回で打ち切り | Anthropic 529 やネットワーク瞬断のような**一過性の失敗でも当日は再送されない** |
| C | **恒久失敗と一過性失敗を区別しない** | どちらも `last_send_error` に記録して当日終了 | Google Ads 未接続のユーザーが毎日 LLM を 1 回消費する。区別があれば LLM 呼び出し前に打ち切れる |
| D | **進捗が観測できない** | 「`last_attempted_on` が NULL」が唯一の手掛かり | 誰が未処理かを SQL で正確に追えない。滞留の検知は `skippedDueToLimit` の WARN のみ |
| E | **水平スケールできない** | 1 起動＝ 1 関数で全ユーザーを処理 | クレームが無いため起動を並列化できず、スループットは `maxDuration` に縛られる |

本設計はこの 5 点を、既に本番稼働している GSC 提案ジョブと同じ方式で解消する。

## 3. キュー化が必要になる規模

現行方式の限界は「1 時間あたり 12 ユーザー」（480 秒 ÷ 150 秒 = 4 チャンク × 3 並列）。回収を含めた 1 日の処理可能量は送信時刻の分散に依存する。

| 送信時刻 | 同時刻の上限 | 回収窓 | 実質上限 |
|---|---|---|---|
| 7 時 | 12 人 | 16 回（8〜23 時） | 分散すれば数十人でも可 |
| 22 時 | 12 人 | 1 回 | 24 人 |
| 23 時 | 12 人 | **0 回** | **12 人** |

実運用では「7 時」に集中する想定のため、**同一時刻に 12 人を超えた時点**が移行の目安。現在は `skippedDueToLimit` の WARN で検知できる。

## 4. 設計方針

### 4.1 採用案: 専用ジョブテーブル + クレーム RPC

GSC 提案は「1 記事評価 = 1 ジョブ」が既存テーブルの行と 1:1 だったため、`gsc_article_evaluation_history` にカラムを追加する形を採った。本機能は「1 ユーザー × 1 日 = 1 ジョブ」で、設定テーブル（`google_ads_negative_keywords_settings`、user_id ユニーク）とは粒度が異なるため、**専用テーブルを新設**する。

```
毎時 cron
 ├ (1) enqueue: 送信時刻に達した有効ユーザーの当日ジョブを insert（on conflict do nothing）
 └ (2) claim  : claim_google_ads_negative_keywords_jobs(p_limit) で N 件を processing に更新して取得
     └ 各ジョブを処理 → completed / failed(next_retry_at 設定) / terminal_failed
```

`enqueue` と `claim` を分けることで、「対象の確定」と「処理権の取得」が別トランザクションになり、失敗時の再試行が単純になる。

### 4.2 検討した代替案（不採用）

| 案 | 不採用理由 |
|---|---|
| `google_ads_negative_keywords_settings` にジョブ用カラムを追加（GSC と同型） | user_id ユニークのため 1 ユーザー 1 行しか持てず、日付ごとの履歴・再実行が表現できない。設定と実行状態が同居して RLS も複雑化する |
| 外部キュー（Upstash QStash / Vercel Queues 等） | 新規サービス導入・課金・シークレット管理が増える。同等の要件を Postgres の `FOR UPDATE SKIP LOCKED` で満たせており、GSC 提案で本番実績もある |
| ユーザー単位のファンアウト（cron が対象を列挙し 1 ユーザー 1 関数を HTTP で起動） | クレームが無いままだと重複起動に弱い。キュー化すればファンアウトは後から安全に足せる（5.5 参照） |

## 5. 詳細設計

### 5.1 マイグレーション（新規テーブル + クレーム RPC）

`supabase/migrations/<YYYYMMDDHHMMSS>_create_google_ads_negative_keywords_jobs.sql`

```sql
create table if not exists public.google_ads_negative_keywords_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  target_date date not null,                    -- 配信対象日（JST）
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed', 'skipped')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_retry_at timestamptz,
  last_error text,                               -- ERROR_MESSAGES の定義済み文言のみ
  error_kind text check (error_kind in ('transient', 'permanent')),
  started_at timestamptz,
  completed_at timestamptz,
  job_token uuid,                                -- 実行権の識別子（stale な結果の書き戻しを弾く）
  email_sent_at timestamptz,                     -- Resend 送信成功時刻（stale reclaim 後の二重送信防止）
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique(user_id, target_date)                   -- 1 ユーザー 1 日 1 ジョブ（enqueue の冪等性）
);

create index if not exists idx_google_ads_negative_keywords_jobs_claim
  on public.google_ads_negative_keywords_jobs (status, next_retry_at, created_at)
  where status in ('pending', 'failed', 'processing');

create index if not exists idx_google_ads_negative_keywords_jobs_user_id
  on public.google_ads_negative_keywords_jobs (user_id);

alter table public.google_ads_negative_keywords_jobs enable row level security;

-- 参照は本人と管理者のみ（既存 settings テーブルと同じ get_accessible_user_ids を使う）
create policy "google_ads_negative_keywords_jobs_select"
  on public.google_ads_negative_keywords_jobs for select
  using (user_id::text = any(public.get_accessible_user_ids((select auth.uid()))));
```

クレーム RPC は GSC 版（`claim_gsc_suggestion_jobs`）をほぼそのまま踏襲する。

```sql
create or replace function public.claim_google_ads_negative_keywords_jobs(p_limit integer default 3)
returns table (
  id uuid,
  user_id uuid,
  target_date date,
  attempt_count integer,
  job_token uuid,
  email_sent_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_limit < 1 or p_limit > 10 then
    raise exception 'p_limit must be between 1 and 10';
  end if;

  -- ハードキル等で processing のまま残ったジョブを回収（stale 判定は 20 分）
  update public.google_ads_negative_keywords_jobs
  set status = 'failed',
      last_error = coalesce(last_error, 'Google Ads 除外キーワード提案の実行がタイムアウトしました'),
      next_retry_at = null
  where status = 'processing'
    and attempt_count >= 3
    and started_at <= timezone('utc', now()) - interval '20 minutes';

  return query
  with candidate as (
    select j.id
    from public.google_ads_negative_keywords_jobs as j
    where (
      j.status = 'pending'
      or (j.status = 'failed'
          and j.attempt_count < 3
          and coalesce(j.error_kind, 'transient') = 'transient'
          and coalesce(j.next_retry_at, timezone('utc', now())) <= timezone('utc', now()))
      or (j.status = 'processing'
          and j.attempt_count < 3
          and j.started_at <= timezone('utc', now()) - interval '20 minutes')
    )
    order by j.created_at
    for update skip locked          -- ★ ここが排他の実体
    limit p_limit
  )
  update public.google_ads_negative_keywords_jobs as j
  set status = 'processing',
      attempt_count = j.attempt_count + 1,
      started_at = timezone('utc', now()),
      last_error = null,
      job_token = gen_random_uuid()
  from candidate
  where j.id = candidate.id
  returning j.id, j.user_id, j.target_date, j.attempt_count, j.job_token, j.email_sent_at;
end;
$$;

revoke all on function public.claim_google_ads_negative_keywords_jobs(integer) from public;
grant execute on function public.claim_google_ads_negative_keywords_jobs(integer) to service_role;

-- Rollback:
-- revoke all on function public.claim_google_ads_negative_keywords_jobs(integer) from service_role;
-- drop function if exists public.claim_google_ads_negative_keywords_jobs(integer);
-- drop policy if exists "google_ads_negative_keywords_jobs_select" on public.google_ads_negative_keywords_jobs;
-- drop index if exists idx_google_ads_negative_keywords_jobs_user_id;
-- drop index if exists idx_google_ads_negative_keywords_jobs_claim;
-- drop table if exists public.google_ads_negative_keywords_jobs;
```

`for update skip locked` により、複数の関数実行が同時に claim しても**同じジョブが二重に払い出されない**。課題 A の解決点はここ。

stale 判定を GSC の 15 分ではなく **20 分**にするのは、本機能の 1 ユーザー上限が 300 秒（GSC は 240 秒）で、関数の `maxDuration` も 800 秒と長いため。

### 5.2 enqueue

`GoogleAdsNegativeKeywordsSuggestionService.enqueueDueJobs()`

```
1. now = JST 現在時刻、todayJst = 当日
2. settings から enabled = true かつ send_hour_jst <= now.hour を取得
3. upsert into google_ads_negative_keywords_jobs (user_id, target_date=todayJst)
   on conflict (user_id, target_date) do nothing
```

`unique(user_id, target_date)` により、毎時実行しても**同じ日のジョブ行は 1 つしか作られない**（enqueue の冪等性）。

**注意（`last_attempted_on` との差）**: この unique 制約は「当日ジョブ行の重複 insert」を防ぐだけで、**処理中の再試行やメール送信の冪等性は引き継がない**。Phase 3 で cron 経路から `markAttempt` / `markSuccess` / `markFailure` を削除すると、ジョブ再 claim や LLM 成功後のメール再送で二重配信しうる。メール冪等は 5.2.1 を必須とする。

#### 5.2.1 メール送信冪等（Resend Idempotency-Key）

**参照**: [Resend — Idempotency Keys](https://resend.com/docs/dashboard/emails/idempotency-keys)（確認日: 2026-08-04）

**公式本文（verbatim）**:

> When you send an email with an idempotency key, Resend checks whether an email with the same idempotency key has already been sent in the last 24 hours.
> …
> Send the key in the `Idempotency-Key` HTTP header in your API requests. Our SDKs also provide a convenient way to set this header.

**解釈（本設計）**: Resend は**同一 idempotency key** のみ 24 時間再送を抑止する。claim の `attempt_count` 増加（stale reclaim 含む）ごとにキーを変えると、メール送信成功後にジョブ完了更新が失敗したケースで**別キーとなり二重送信しうる**。キーは **`user_id` × `target_date`（= 当日 1 通）で固定**する。

**参照（409）**: 同上 Idempotency Keys ページ「Possible responses」（確認日: 2026-08-04）

**公式本文（verbatim）**:

> `409`: `invalid_idempotent_request` - this idempotency key has already been used on a request that had a different payload. Retrying this request is useless without changing the idempotency key or payload.

**解釈（本設計）**: stale reclaim 後に LLM を再実行すると HTML 本文が変わり、**同一固定キー**で Resend すると 409 になりうる。409 は「当該キーで既に 1 通送信済み」とみなし、**メール送信失敗（transient terminal）にしない**（§5.3.5）。

| 項目 | 内容 |
|---|---|
| キー形式（cron） | `google-ads-negative-kw/{user_id}/{target_date}`（256 文字以内、`attempt_count` を含めない） |
| キー形式（手動） | `google-ads-negative-kw/manual/{user_id}/{todayJst}`（同日の手動再送は別運用。必要なら末尾に UUID） |
| 送信済みマーカー | ジョブ行 `email_sent_at`。Resend **2xx 成功直後**に `processJob` が `job_token` 条件付きで UPDATE（§5.3.5）。`sendNegativeKeywordsSuggestionForUser` 単体では更新しない |
| 付与箇所 | cron: `GoogleAdsNegativeKeywordsJobService` → `EmailService.sendGoogleAdsNegativeKeywords(..., { idempotencyKey })`。手動: suggestion service から同 EmailService |

**禁止**: `.../{job_id}/{attempt_count}` のように試行ごとにキーを変える設計（監査で二重送信再発と判定）。

### 5.3 サービス層

`src/server/services/googleAdsNegativeKeywordsJobService.ts`（新規、`gscSuggestionJobService.ts` と同構造）

```
runNextJobs():
  1. rpc('claim_google_ads_negative_keywords_jobs', { p_limit: JOBS_PER_INVOCATION })
  2. 0 件なら即 return
  3. Promise.all(jobs.map(processJob))
  4. { total, completed, failed, terminalFailed, skipped } を返す

processJob(job):  // job は claim RPC 戻り値（email_sent_at 含む）。必要なら process 開始時に id+user_id で再 SELECT して最新 email_sent_at を確認可
  1. job.email_sent_at が非 NULL → finalizeCompletedFromPriorSend(job):
       LLM も Resend も sendNegativeKeywordsSuggestionForUser を呼ばない。
       status=completed / completed_at / settings sync（§5.3.2）のみ。return completed
  2. 上記以外 → runCronPipeline(job):
       a. sendNegativeKeywordsSuggestionForUser(..., { cronJob: { jobId, jobToken, targetDate },
            idempotencyKey, persistAttemptMarkers: false }) で LLM〜メールまで実行
          （cron では markAttempt / markSuccess を使わない。§5.3.4）
       b. Resend 2xx 成功直後、processJob が jobs.email_sent_at=now() を
          `.eq('id', job.id).eq('user_id', job.user_id).eq('status','processing').eq('job_token', job.job_token)` で UPDATE
       c. Resend 409 invalid_idempotent_request → (b) と同様に email_sent_at を立て、送信済み成功として (d) へ（§5.2.1）
       d. result を §5.3.1 で写像し status=completed 等を更新 + settings sync
  3. unexpected 例外（ジョブ UPDATE 失敗等）のみ catch → transient 失敗更新
```

**配線上の注意**: step 1 は「Resend だけスkip」ではなく **パイプライン全体をスキップ**する。step 2 は `email_sent_at` 更新責務を **JobService（processJob）** に置き、SuggestionService の黒箱内に隠さない。

#### 5.3.5 cron パイプラインと `email_sent_at`（必須）

| タイミング | 主体 | 処理 |
|---|---|---|
| claim 直後 | RPC | `email_sent_at` を RETURNING に含め processJob へ渡す |
| process 開始 | `GoogleAdsNegativeKeywordsJobService` | `email_sent_at` 済みなら LLM/Resend なしで completed 確定 |
| Resend 2xx | `GoogleAdsNegativeKeywordsJobService` | 完了 status 更新**より前**に `email_sent_at` を書く（完了更新失敗でも再 claim 時 step 1 に入れる） |
| Resend 409 `invalid_idempotent_request` | 同上 | 送信済み成功。`email_sent_at` を設定し completed（メール送信失敗扱い禁止） |
| NO_DATA（skipped） | SuggestionService → JobService | メール未送信のため `email_sent_at` は NULL のまま completed |

実装方針（いずれか、spec-to-pr で選択可）:

1. **推奨**: SuggestionService に `runNegativeKeywordsSuggestionForCronJob(job, hooks)` を追加し、メール送信直前/直後の hook で JobService が `email_sent_at` を更新する。
2. **代替**: SuggestionService が `{ phase: 'content' | 'email', html?, subject? }` を分離し、JobService が Resend と `email_sent_at` を担当する。

いずれも **cron 経路の Resend 呼び出し結果（2xx / 409）は JobService が解釈**する。

`error_kind` の分類が課題 C の解決点。恒久エラーは claim 条件 `error_kind = 'transient'` により**当日再 claim されない**ため、LLM を消費しない。

#### 5.3.1 `result.error` → `error_kind` / ジョブ status（完全一致）

判定は `result.error` が `ERROR_MESSAGES` の**文字列値と完全一致**することのみを根拠とする（略称・部分一致禁止）。`src/domain/errors/error-messages.ts` の現行文言に合わせる。

| `result.error`（完全一致） | `error_kind` | ジョブ `status` / 備考 |
|---|---|---|
| （`success: true`, `skipped: true`, `message` = `NEGATIVE_KEYWORDS_SUGGESTION_NO_DATA`） | — | `completed`（メール未送信だが当日処理完了。`last_error=null`） |
| （`success: true`, メール送信済み） | — | `completed`, `completed_at` 設定 |
| `Google Adsが未接続です` | `permanent` | `failed`, `next_retry_at=null` |
| `アカウントが選択されていません。設定画面からアカウントを選択してください` | `permanent` | 同上 |
| `Google Adsの認証が期限切れまたは取り消されています。設定画面からGoogle Adsを再連携してください。` | `permanent` | 同上（§5.3.3 の恒久 refresh 失敗のみ。この文言に載せる） |
| `メールアドレス未登録のため、Google Ads 除外キーワード提案を送信できません` | `permanent` | 同上 |
| `Google Ads 除外キーワード提案プロンプトが見つかりません。管理画面でテンプレートを確認してください` | `permanent` | 同上 |
| `Google Ads 除外キーワード提案設定が見つかりません` | `permanent` | 同上 |
| `ユーザー情報が見つかりません`（`ERROR_MESSAGES.USER.USER_INFO_NOT_FOUND`） | `permanent` | 同上 |
| `Google Ads 除外キーワード提案の自動配信がOFFです` | `permanent` | cron では enqueue 済みのため通常到達しない。到達時は `failed` permanent |
| `キーワード指標の取得に失敗しました` | `transient` | `failed`, `next_retry_at=now+15分`, `attempt_count>=3` で terminal |
| `除外キーワードの取得に失敗しました` | `transient` | 同上 |
| `Google Ads 除外キーワード提案のメール送信に失敗しました` | `transient` | Resend **409 `invalid_idempotent_request` 以外**の失敗（409 は §5.3.5 で送信済み success） |
| `Google Ads 除外キーワード提案設定の更新に失敗しました` | `transient` | 同上 |
| `アクセストークンの更新に失敗しました。再認証してください。` | `transient` | §5.3.3 の一時的 refresh 失敗 |
| `Google Ads 除外キーワード提案の実行に失敗しました` | `transient` | LLM タイムアウト・未分類例外の正規化先。**529 等も現状ここに集約される**（再試行対象）。将来 529 専用文言を `error-messages.ts` に追加した場合は本表に行を追加し、`RUN_FAILED` と分離する |

ジョブ更新時、`error_kind='permanent'` の行は claim RPC が当日再取得しないよう必ず `error_kind` 列に書き込む。

ジョブ `last_error` には上表の定義済み文言（または NO_DATA 時は null）のみ保存する。Google Ads / Anthropic / Resend の生メッセージは `console.error` のみ（既存 `sendNegativeKeywordsSuggestionForUser` と同じ）。

#### 5.3.2 設定テーブル同期（UI 表示）

| 列 | cron / ジョブ経路 | 手動送信（`force: true`） |
|---|---|---|
| `last_attempted_on` | ジョブ `processing` 開始時（claim 時）または初回 process 開始時に `target_date` を設定 | 従来どおり送信試行開始時に更新（`markAttempt` 相当を force 用に残す） |
| `last_sent_on` | ジョブ `completed` かつメール送信成功時 | **メール送信成功時に必ず更新**（下記 §5.3.4） |
| `last_send_error` | ジョブ terminal / permanent 失敗時に `last_error` を写す。成功時 null | 失敗時に `result.error` を写す。**手動成功時も null に戻す** |

`NegativeKeywordsSuggestionSettings.tsx` は **`lastSentOn` / `lastSendError` の表示を維持**する。`last_attempted_on` 列は **Phase 4**（§7）で drop するまで settings とジョブを同期し、表示が空にならないようにする。

#### 5.3.3 Google Ads トークン refresh と `AUTH_EXPIRED_OR_REVOKED`

現行 `ensureAccessToken` は refresh 失敗をすべて `null` → `AUTH_EXPIRED_OR_REVOKED` にしている。本設計では次を分離する。

| refresh 結果 | `sendNegativeKeywordsSuggestionForUser` の返却 | `error_kind` |
|---|---|---|
| OAuth `invalid_grant` / 取り消し済み refresh token | `AUTH_EXPIRED_OR_REVOKED` | `permanent` |
| ネットワーク瞬断・Google 5xx・保存失敗（一時） | `アクセストークンの更新に失敗しました。再認証してください。`（`ERROR_MESSAGES.GOOGLE_ADS.TOKEN_REFRESH_FAILED`） | `transient` |

恒久と判定した場合、§5.3.2 に従い `last_send_error` を更新し、設定画面の「最終エラー」に再連携案内が出る（`/setup/google-ads` 導線は既存 UI のまま）。

#### 5.3.4 `force` 引数（cron と手動送信）

| 経路 | `force` | 備考 |
|---|---|---|
| cron → `processJob` | **使用しない**（常に `enabled` チェック有効） | ジョブキューが排他・再試行を担う |
| `runNegativeKeywordsSuggestionNow` | **`force: true` を維持** | 自動配信 OFF でも手動送信可。`markAttempt` 系は手動専用ロジックとして残す（Phase 3 で cron 側だけ削除） |

**現行コードとの差分（必須改修）**: 現行 `sendNegativeKeywordsSuggestionForUser` は `force: true` 時に `markSuccess` / `markFailure` をスキップする（L344-354, L165-168, L362-368）。本設計では **手動送信でも** メール送信成功時に `last_sent_on` を更新し、失敗時に `last_send_error` を更新するよう `force` 分岐を改修する（cron 経路の `markAttempt` 削除とは独立）。UI の「最終送信日」が手動送信後も更新されない regression を防ぐ。

`sendNegativeKeywordsSuggestionForUser` のシグネチャは維持し、オプションに `idempotencyKey?: string` と cron 用 `cronJob` / `persistAttemptMarkers: false` を追加する（§5.3.5）。**cron の `email_sent_at` 更新は JobService の責務**であり、本関数内では行わない。

### 5.4 cron route

`app/api/cron/google-ads-negative-keywords-suggestion/route.ts` を以下に変更する。

```ts
const enqueued = await googleAdsNegativeKeywordsSuggestionService.enqueueDueJobs();
const result = await googleAdsNegativeKeywordsJobService.runNextJobs();
return NextResponse.json({ success: true, data: { ...result, enqueued } });
```

- `maxDuration` は 800 のまま。`JOBS_PER_INVOCATION` を 3、`JOB_TIMEOUT_MS` を 300 秒とすると 1 起動の上限は約 300 秒 + enqueue で、余裕を持って収まる
- 時間予算（`BATCH_TIME_LIMIT_MS`）による打ち切りロジックは**不要になる**（1 起動あたりの処理件数が固定されるため）。`stoppedReason` / `skippedDueToLimit` も廃止
- `invoke-cron.sh` の `--max-time` は 820 → 310 に戻せる。`--max-retries` は 1 のまま（リトライは キュー側の責務）

### 5.5 将来の水平スケール（本設計では実装しない）

claim が排他になるため、以下が**後から安全に足せる**ようになる。

- `hourly-cron.yml` の matrix に同じエンドポイントを複数並べて N 並列起動する
- 15 分間隔の cron にして 1 時間あたりの処理量を 4 倍にする

いずれもジョブが重複払い出しされないことが前提条件であり、それを満たすのが本設計。

## 6. 監視

| 観点 | 方法 |
|---|---|
| 滞留（再試行待ち） | `select count(*) from google_ads_negative_keywords_jobs where target_date = current_date and (status = 'pending' or (status = 'failed' and coalesce(error_kind, 'transient') = 'transient' and attempt_count < 3))` |
| 恒久失敗ユーザー | `where error_kind = 'permanent' and target_date = current_date` |
| CI 判定 | `invoke-cron.sh` の `count-batch` profile を拡張し、`terminalFailed > 0` を FAIL、`pending` 残件を WARN。GSC 提案の `gsc-suggestions` profile（一時失敗は WARN、最終失敗は FAIL）と同じ考え方 |

現状は「恒久失敗ユーザーが 1 人いると毎日ジョブが赤くなる」ため、`error_kind='permanent'` は WARN に留め、`transient` の 3 回失敗（`terminalFailed`）のみ FAIL とする。

## 7. 移行手順

| Phase | 内容 | 備考 |
|---|---|---|
| 1 | マイグレーション適用（テーブル + RPC） | 管理者が実施。既存挙動に影響なし |
| 2 | `npm run supabase:types` で型再生成 | 未適用の間は `database.types.pending.ts` に暫定型を置く（README:176 の規約） |
| 3 | サービス・route・EmailService の切り替え | 旧 batch ロジック（時間予算・`runAllDueSuggestions`・cron 経路の `markAttempt`）を削除。**手動送信の `force` + settings 更新は残す**（5.3.4）。settings とジョブの二重管理は cron 経路に限定しない |
| 4 | 1 週間の観測後、`last_attempted_on` カラムを drop | 切り戻し余地を残すため即時削除はしない |

**settings 列の役割（Phase 3 完了時点）**

| 列 | 維持 | 更新元 |
|---|---|---|
| `enabled`, `send_hour_jst` | ○ | ユーザー設定（変更なし） |
| `last_sent_on`, `last_send_error` | ○ | ジョブ完了時 sync + 手動送信（5.3.2） |
| `last_attempted_on` | Phase 4 まで ○ | ジョブ開始 sync。Phase 4 で drop |

切り戻しは Phase 3 のリバートで可能（テーブルが残っていても旧ロジックは参照しない）。

## 8. 影響ファイル

| ファイル | 変更 |
|---|---|
| `supabase/migrations/<new>.sql` | 新規（テーブル + index + RLS + claim RPC + Rollback コメント） |
| `src/server/services/googleAdsNegativeKeywordsJobService.ts` | 新規。`processJob` orchestration（§5.3.5）、`email_sent_at` 更新、Resend 409 処理 |
| `src/server/services/googleAdsNegativeKeywordsSuggestionService.ts` | `enqueueDueJobs()`、cron 用パイプライン（§5.3.5 推奨 API）、手動 `force` 時 settings 更新、`ensureAccessToken` 分類 |
| `src/server/services/emailService.ts` | `sendGoogleAdsNegativeKeywords` に `idempotencyKey` と Resend 409 エラー種別の返却（JobService が解釈） |
| `src/server/services/supabaseService.ts` | ジョブテーブル CRUD、enqueue 用 listing、settings sync ヘルパ |
| `src/types/google-ads-negative-keywords-suggestion.ts` | ジョブ行（claim 戻り値に `email_sent_at` 含む）・バッチ結果の型 |
| `app/api/cron/google-ads-negative-keywords-suggestion/route.ts` | enqueue → runNextJobs の 2 段構成に |
| `app/google-ads-dashboard/_components/NegativeKeywordsSuggestionSettings.tsx` | 表示維持。ジョブ sync 後も `lastSentOn` / `lastSendError` が更新されることの E2E 確認 |
| `src/server/actions/googleAdsNegativeKeywordsSuggestion.actions.ts` | 手動送信 `force: true` 維持。成功時 `revalidatePath` 維持 |
| `scripts/invoke-cron.sh` | `count-batch` profile の判定を `terminalFailed` ベースに |
| `.github/workflows/hourly-cron.yml` | `maxTime` を 310 に戻す |
| `docs/specs/google-ads-negative-keywords-suggestion-design.md` | §8.3 / §10.1 を書き換え |

**テスト（最低限）**

| ファイル | 内容 |
|---|---|
| `tests/unit/server/services/googleAdsNegativeKeywordsJobService.test.ts` | 新規。claim 0 件・terminal・job_token discard・**email_sent_at 済みで LLM 未呼び出し**・Resend 409 → completed |
| `tests/unit/server/services/googleAdsNegativeKeywordsSuggestionService.test.ts` | batch 削除に伴う enqueue / 旧 batch テストの差し替え |
| `tests/unit/server/services/googleAdsNegativeKeywordsSuggestionService.sendForUser.test.ts` | `error_kind` 写像の根拠となる `result.error` 文言・NO_DATA skipped・refresh 分類 |
| `tests/unit/server/services/supabaseService.negativeKeywordsDue.test.ts` | enqueue 条件（`send_hour_jst`）の維持 |

## 9. 受け入れ条件（Acceptance Criteria）

- [ ] 同一 `user_id` × `target_date` で 2 本の cron が同時に claim しても、メールが 1 通のみ（ジョブ排他 + 固定 idempotency key）
- [ ] **メール送信成功後**にジョブ `completed` 更新が失敗し、stale reclaim で再 process されても、`email_sent_at` により **LLM/Resend を呼ばず** completed 確定し、二重送信しない
- [ ] 固定 idempotency key で LLM 再実行により HTML が変わり Resend が **409 `invalid_idempotent_request`** を返しても、ジョブは **completed**（`terminalFailed` / メール送信失敗扱いにしない）
- [ ] Anthropic / Google Ads API の一過性失敗後、15 分以内の再 claim で再試行され、3 回目で terminal（`terminalFailed` カウント）
- [ ] `NOT_CONNECTED` 等の恒久失敗ジョブは当日再 claim されず、LLM が呼ばれない
- [ ] Google Ads 設定画面で「最終送信日」「最終エラー」が cron 完了後も更新される
- [ ] 手動送信（自動配信 OFF）成功後、設定画面の「最終送信日」が更新される（`force: true` でも `last_sent_on` 更新）
- [ ] `npm run verify` が通る

## 10. Non-goals（本設計のスコープ外）

- 外部キュー（QStash 等）の導入
- `hourly-cron.yml` の matrix 並列化（5.5 は将来）
- `last_attempted_on` 列の即時 drop（Phase 4 まで温存）
- GSC 提案ジョブサービスとの共通化リファクタ
- 529 専用 ERROR_MESSAGES の追加（推奨は §5.3.1 に記載。未実装でも AC は `RUN_FAILED` transient で満たす）

## 11. 検証手順

| 種別 | 手順 |
|---|---|
| 自動 | `npm run verify`（quality-gate 正本） |
| 単体 | 上記 §8 の 4 テストファイル |
| 手動 | staging で cron 1 回実行 → `google_ads_negative_keywords_jobs` の status 遷移、settings の last_* 更新、設定画面表示 |
| 手動 | 意図的に Google Ads 未接続ユーザーで enqueue → permanent で LLM 未呼び出しをログ確認 |
| CI | `invoke-cron.sh` の `count-batch` で `terminalFailed > 0` が FAIL になること |

README 更新: 本番 cron の `maxTime` 変更のみ該当しうる（🏗️ または運用節）。実装時 `readme_sync` で最終判断。

## 12. 確認質問・未決定事項

### 確認質問（実装前に判断が必要）

1. **恒久エラーの当日再試行**（Q-001）: ユーザーが Google Ads を接続し直した場合、当日中に再送するか翌日まで待つか。当日再送するなら「設定変更時にジョブを `pending` に戻す」処理が要る。回答者: PO

### 未決定事項（今は決めない）

1. **`JOBS_PER_INVOCATION`**（OPEN-001）: 3（現行の並列度）か、`maxDuration` 800 秒を活かして 6 以上にするか。今決めない理由: LLM のレート制限とメール送信の制約は実行しないと測れない。決めるタイミング: 初回の負荷実測後。決める人: 実装担当

## 13. 確認質問（クライアント確認中）

1. **`send_hour_jst = 23` の扱い**: キュー化すると翌 0 時以降もジョブが残るため、日付を跨いで前日分レポートを送るか、当日中で破棄（`status='skipped'`）するか。
   - 技術側の推奨: 破棄（「前日データのレポート」という意味が壊れるため）
   - **クライアント確認**: 23 時配信ユーザーが存在する場合、日跨ぎ送信を許容するか、23 時選択を UI で禁止するか

## 14. 見送る場合の判断材料

同一時刻のユーザーが 12 人を超えず、`skippedDueToLimit` の WARN も出ていないなら、暫定対応のままで機能的な不足はない。キュー化の主な価値は「重複配信の構造的な防止」と「水平スケールの余地」であり、**現時点では保険**。実装規模はマイグレーション 1 本 + サービス 1 本 + 既存 3 ファイルの改修で、テスト込みで 1〜2 日を見込む。
