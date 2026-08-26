-- GSC検索順位評価サイクルとGA4コンテンツ評価サイクルを1本へ統合する（2026-08-26 要件変更）。
--
-- 変更前: GA4は専用の ga4_content_evaluation_cycles を持ち、基準日・サイクル日数・評価実行時間を
-- GSCとは別に保持していた（利用者は同じ性質の設定を2回入力していた）。
-- 変更後: スケジュールの正は gsc_article_evaluations の1行だけ。GA4コンテンツ評価は同じ
-- base_evaluation_date / cycle_days / evaluation_hour を読む。
--
-- 実行の進捗マークだけを系統別に持つ理由（重要。共用すると壊れる）:
-- gsc-evaluate と ga4-content-evaluate は .github/workflows/hourly-cron.yml の matrix で
-- fail-fast: false・concurrency group がジョブ別のため、互いをブロックせず起動順は非決定的である。
-- 両者が last_evaluated_on を共用すると、先に走った方がそれを today に更新して生成列
-- next_evaluation_date が +cycle_days 跳ぶため、負けた方はそのサイクルを丸ごと飛ばす。
-- GitHub Actions のランナー割当順は毎時ほぼ同じ傾向になるので、実運用では片方が恒久的に負ける。
-- したがって「設定は共有・進捗は別」とし、GA4用のクールダウン列を独立して持つ。
--
-- ga4_content_evaluations（記事ごとのGA4評価状態）へ列を足さない理由:
-- 同テーブルの status は CHECK 制約で6値（evaluated / narrative_failed / insufficient_data /
-- import_failed / evaluation_failed / evaluating）しか許さず、「予定はあるがまだ一度も評価していない」
-- 行を表現できない。さらに行の作成主体は start_ga4_content_evaluation RPC に限られ、ベースライン算出
-- （computeBaselineScore）はこのRPCを呼ばないため、初回サイクル時点で行が存在しない。

alter table public.gsc_article_evaluations
  -- GA4コンテンツ評価バッチのクールダウン。GSCの last_evaluated_on とは独立に進む
  add column if not exists ga4_last_evaluated_on date,
  -- ベースライン（初回計測）のコンテンツ力スコア。GSCの last_seen_position と同じ役割で、
  -- null = 未計測（次のdueで軽量パスへ分岐する）
  add column if not exists ga4_last_seen_content_score integer
    check (ga4_last_seen_content_score is null
           or (ga4_last_seen_content_score >= 0 and ga4_last_seen_content_score <= 100)),
  -- 通知メールの冪等キー（BR-12）。送信済みの評価履歴ID。
  -- ga4_content_evaluation_history への外部キーは張らない: GSC側テーブルからGA4側テーブルへの
  -- クロスドメイン参照を作らないため。履歴が消えても値が残るだけで、二重送信は起きない
  -- （同じ履歴IDが再び生成されることはなく、Resendへ渡す idempotencyKey が二段目の防御になる）
  add column if not exists ga4_last_notified_history_id uuid;

comment on column public.gsc_article_evaluations.ga4_last_evaluated_on is
  'GA4コンテンツ評価バッチのクールダウン。スケジュール設定（base_evaluation_date / cycle_days / evaluation_hour）はGSCと共有するが、実行済みマークは系統別に持つ（2ジョブが並列に走るため）';
comment on column public.gsc_article_evaluations.ga4_last_seen_content_score is
  'GA4コンテンツ評価のベースライン。null なら次のdueで軽量パス（スコア算出のみ・LLMなし・履歴行なし・通知なし）へ分岐する';
comment on column public.gsc_article_evaluations.ga4_last_notified_history_id is
  'GA4コンテンツ評価の通知メールを送信済みの ga4_content_evaluation_history.id（BR-12の冪等キー）。FKは張らない';

-- 既存行の移行: GA4の進捗をGSCの進捗に合わせる。
-- これを行わないと ga4_last_evaluated_on が null のまま
-- 「base_evaluation_date + cycle_days」が過去日になり、統合直後の毎時実行で
-- 稼働中の全記事に対してGA4ベースラインパスが一斉に走る。
update public.gsc_article_evaluations
  set ga4_last_evaluated_on = last_evaluated_on
  where last_evaluated_on is not null
    and ga4_last_evaluated_on is null;

-- GA4のdue抽出用。GSC用の idx_gsc_article_evaluations_due（生成列 next_evaluation_date を使う）とは
-- 式が違うため別に持つ
create index if not exists idx_gsc_article_evaluations_ga4_due
  on public.gsc_article_evaluations (status, ga4_last_evaluated_on, base_evaluation_date)
  where status = 'active';

-- 定期評価バッチのdue抽出RPC（§8.3 処理順序1）。
--
-- ロール絞り込みをSQL側で行う理由（§8.3）: アプリ側フィルタだけだと trial/unavailable へ降格した
-- ユーザーの行が毎時due抽出され続け、ga4_last_evaluated_on が進まないため due 日が過去のまま
-- 昇順の先頭に居座り、1,000行枠（db-max-rows）を恒久占有する（R-17）。
-- なおGSC側のdue抽出（gscEvaluationService）はロールを見ていないが、GSCはLLMを呼ばないため
-- 実害が小さい。GA4はLLMを呼ぶので、この絞り込みを落としてはいけない。
--
-- due 日が p_today_jst と等しい行は evaluation_hour の判定をアプリ側で行う（§6.6.2）ため、
-- ここでは日付のみで絞り込む。
--
-- p_limit/p_offset をSQL関数内部で適用しない理由: 関数内部でLIMIT/OFFSETを適用すると、PostgRESTの
-- count:'exact' が返す件数が「この呼び出し自体が返した行数」になり全体の候補件数を反映しない。
-- その結果 SupabaseService.fetchAllPaged の打ち切り判定（total !== null && all.length < total）が
-- 常に成立せず、1,000行上限の取りこぼし検知（truncatedCandidates）が機能しなくなる。
-- ページングはPostgREST側の .range() に委ね、この関数はページングしないSETOFを返す。
create or replace function public.list_due_ga4_content_evaluations(
  p_today_jst date
)
returns table(
  id uuid,
  user_id uuid,
  content_annotation_id uuid,
  base_evaluation_date date,
  cycle_days integer,
  evaluation_hour smallint,
  ga4_last_evaluated_on date,
  ga4_last_seen_content_score integer,
  ga4_next_evaluation_date date
)
language sql stable
as $$
  select
    e.id, e.user_id, e.content_annotation_id, e.base_evaluation_date,
    e.cycle_days, e.evaluation_hour, e.ga4_last_evaluated_on, e.ga4_last_seen_content_score,
    (coalesce(e.ga4_last_evaluated_on, e.base_evaluation_date)::date
      + coalesce(e.cycle_days, 30))::date as ga4_next_evaluation_date
  from public.gsc_article_evaluations e
  join public.users u on u.id = e.user_id
  where e.status = 'active'
    and (coalesce(e.ga4_last_evaluated_on, e.base_evaluation_date)::date
          + coalesce(e.cycle_days, 30)) <= p_today_jst
    and u.role in ('admin', 'paid')
  order by ga4_next_evaluation_date asc, e.id asc;
$$;

revoke execute on function public.list_due_ga4_content_evaluations(date) from public, anon, authenticated;
grant execute on function public.list_due_ga4_content_evaluations(date) to service_role;

-- Rollback:
-- drop function if exists public.list_due_ga4_content_evaluations(date);
-- drop index if exists public.idx_gsc_article_evaluations_ga4_due;
-- alter table public.gsc_article_evaluations
--   drop column if exists ga4_last_notified_history_id,
--   drop column if exists ga4_last_seen_content_score,
--   drop column if exists ga4_last_evaluated_on;
