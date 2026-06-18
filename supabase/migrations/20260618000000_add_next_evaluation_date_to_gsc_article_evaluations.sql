-- gsc_article_evaluations に next_evaluation_date 計算済み列を追加
-- COALESCE(last_evaluated_on, base_evaluation_date) + cycle_days で次回評価日を DB 側で算出し、
-- cron バッチが全件 SELECT → メモリフィルタではなく、due なレコードのみ取得できるようにする。

ALTER TABLE gsc_article_evaluations
ADD COLUMN next_evaluation_date date GENERATED ALWAYS AS (
  COALESCE(last_evaluated_on, base_evaluation_date)::date + COALESCE(cycle_days, 30)
) STORED;

CREATE INDEX idx_gsc_article_evaluations_due
  ON gsc_article_evaluations (status, next_evaluation_date)
  WHERE status = 'active';

-- claim_gsc_suggestion_jobs の p_limit 上限を 2 → 10 に引き上げ
-- JOBS_PER_INVOCATION=5 への変更に合わせて制約を緩和する

CREATE OR REPLACE FUNCTION public.claim_gsc_suggestion_jobs(p_limit integer default 2)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  content_annotation_id uuid,
  outcome text,
  current_position numeric,
  previous_position numeric,
  suggestion_stage smallint,
  suggestion_attempt_count integer,
  suggestion_job_token uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_limit < 1 OR p_limit > 10 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 10';
  END IF;

  UPDATE public.gsc_article_evaluation_history AS history
  SET
    suggestion_status = 'failed',
    suggestion_error = COALESCE(history.suggestion_error, 'GSC改善提案の生成がタイムアウトしました'),
    suggestion_next_retry_at = NULL
  WHERE history.suggestion_status = 'processing'
    AND history.suggestion_attempt_count >= 3
    AND history.suggestion_started_at <= TIMEZONE('utc', NOW()) - INTERVAL '15 minutes';

  RETURN QUERY
  WITH candidate AS (
    SELECT history.id
    FROM public.gsc_article_evaluation_history AS history
    WHERE (
      history.suggestion_status = 'pending'
      OR (
        history.suggestion_status = 'failed'
        AND history.suggestion_attempt_count < 3
        AND COALESCE(history.suggestion_next_retry_at, TIMEZONE('utc', NOW()))
          <= TIMEZONE('utc', NOW())
      )
      OR (
        history.suggestion_status = 'processing'
        AND history.suggestion_attempt_count < 3
        AND history.suggestion_started_at
          <= TIMEZONE('utc', NOW()) - INTERVAL '15 minutes'
      )
    )
    AND history.suggestion_stage IS NOT NULL
    ORDER BY history.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.gsc_article_evaluation_history AS history
  SET
    suggestion_status = 'processing',
    suggestion_attempt_count = history.suggestion_attempt_count + 1,
    suggestion_started_at = TIMEZONE('utc', NOW()),
    suggestion_error = NULL,
    suggestion_job_token = gen_random_uuid()
  FROM candidate
  WHERE history.id = candidate.id
  RETURNING
    history.id,
    history.user_id,
    history.content_annotation_id,
    history.outcome,
    history.current_position,
    history.previous_position,
    history.suggestion_stage,
    history.suggestion_attempt_count,
    history.suggestion_job_token;
END;
$$;

-- Rollback:
-- ALTER TABLE gsc_article_evaluations DROP COLUMN IF EXISTS next_evaluation_date;
-- DROP INDEX IF EXISTS idx_gsc_article_evaluations_due;
-- 元の claim_gsc_suggestion_jobs (上限 2) に戻す場合は 20260611000000_add_gsc_suggestion_jobs.sql の関数定義を再適用
