CREATE TABLE public.instagram_blog_draft_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  chain_count integer NOT NULL DEFAULT 0 CHECK (chain_count BETWEEN 0 AND 30),
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX instagram_blog_draft_batches_user_id_idx
  ON public.instagram_blog_draft_batches(user_id);

ALTER TABLE public.instagram_blog_draft_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own Instagram blog draft batches"
  ON public.instagram_blog_draft_batches
  FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

CREATE TABLE public.instagram_blog_draft_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  instagram_media_id uuid NOT NULL UNIQUE REFERENCES public.instagram_media(id) ON DELETE CASCADE,
  session_id text REFERENCES public.chat_sessions(id) ON DELETE SET NULL,
  batch_id uuid NOT NULL REFERENCES public.instagram_blog_draft_batches(id),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'failed', 'completed')),
  stage text NOT NULL CHECK (stage IN ('keywords', 'step1', 'step2', 'step3', 'step4', 'step5', 'step6', 'headings', 'heading', 'combine', 'done')),
  heading_index integer NOT NULL DEFAULT 0,
  heading_total integer,
  error_code text CHECK (error_code IN ('KEYWORD_PARSE_FAILED', 'AI_FAILED', 'AI_RATE_LIMITED', 'MAX_TOKENS', 'NO_HEADINGS', 'SAVE_FAILED', 'LEAD_PARSE_FAILED', 'CHAIN_LIMIT', 'ROLE_REVOKED')),
  continuation_count integer CHECK (continuation_count BETWEEN 0 AND 2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX instagram_blog_draft_jobs_user_id_idx
  ON public.instagram_blog_draft_jobs(user_id);

ALTER TABLE public.instagram_blog_draft_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own Instagram blog draft jobs"
  ON public.instagram_blog_draft_jobs
  FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

CREATE TRIGGER set_updated_at_instagram_blog_draft_jobs
  BEFORE UPDATE ON public.instagram_blog_draft_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 開始の判定（作成中のまとまりの有無）と、まとまり・行の作成・再開の付け替えを1トランザクションで行う。
-- ユーザーごとのロックで、同じユーザーの開始要求が同時に届いても両方が判定を通らないようにする。
-- 作成中のまとまりがあれば0行を返す
CREATE FUNCTION public.start_instagram_blog_draft_batch(
  p_user_id uuid,
  p_new_media_ids uuid[],
  p_resume_job_ids uuid[],
  p_stale_before timestamptz
)
RETURNS TABLE (batch_id uuid, started integer, resumed integer, original_batch_ids uuid[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_id uuid;
  v_started integer;
  v_resumed integer;
  v_original_batch_ids uuid[];
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('instagram_blog_draft_start'), hashtext(p_user_id::text));

  IF EXISTS (
    SELECT 1 FROM public.instagram_blog_draft_jobs j
    WHERE j.user_id = p_user_id
      AND j.status IN ('queued', 'running')
      AND j.updated_at >= p_stale_before
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.instagram_blog_draft_batches (user_id) VALUES (p_user_id) RETURNING id INTO v_batch_id;

  WITH moved AS (
    UPDATE public.instagram_blog_draft_jobs j
    SET batch_id = v_batch_id,
        status = 'queued',
        error_code = NULL,
        completed_at = NULL,
        continuation_count = CASE WHEN j.continuation_count IS NULL THEN NULL ELSE 0 END
    FROM (
      SELECT o.id, o.batch_id FROM public.instagram_blog_draft_jobs o WHERE o.id = ANY(p_resume_job_ids)
    ) original
    WHERE j.id = original.id
      AND j.user_id = p_user_id
      AND (j.status = 'failed' OR (j.status IN ('queued', 'running') AND j.updated_at < p_stale_before))
    RETURNING original.batch_id AS original_batch_id
  )
  SELECT count(*)::integer, coalesce(array_agg(DISTINCT moved.original_batch_id), '{}')
  INTO v_resumed, v_original_batch_ids
  FROM moved;

  INSERT INTO public.instagram_blog_draft_jobs (user_id, instagram_media_id, batch_id, status, stage)
  SELECT p_user_id, m.id, v_batch_id, 'queued', 'keywords'
  FROM public.instagram_media m
  WHERE m.id = ANY(p_new_media_ids) AND m.user_id = p_user_id
  ON CONFLICT (instagram_media_id) DO NOTHING;
  GET DIAGNOSTICS v_started = ROW_COUNT;

  IF v_started + v_resumed = 0 THEN
    DELETE FROM public.instagram_blog_draft_batches b WHERE b.id = v_batch_id;
  END IF;

  RETURN QUERY SELECT v_batch_id, v_started, v_resumed, v_original_batch_ids;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.start_instagram_blog_draft_batch(uuid, uuid[], uuid[], timestamptz) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_instagram_blog_draft_batch(uuid, uuid[], uuid[], timestamptz) TO service_role;

INSERT INTO public.prompt_templates (name, display_name, content, variables, version)
VALUES (
  'instagram_blog_keyword_generation',
  'Instagram 投稿のキーワード案',
  'あなたは、Instagram 投稿をブログ記事にするためのキーワードを提案する編集者です。

## 元の Instagram 投稿
{{instagramCaption}}

## 事業者情報
会社名: {{company}}
サービス名: {{serviceName}}
強み: {{strength}}
ターゲット: {{persona}}

投稿の内容と事業者情報を参考に、ブログ記事に適した主キーワードを1件と関連キーワードを複数提案してください。キャプションに書かれていない事実（価格、保証内容、数値、実績など）を作らないでください。事業者情報に無い事実も作らないでください。

JSON のみを出力してください。形式: {"main_kw":"主キーワード","kw":["関連キーワード1","関連キーワード2"]}',
  '[{"name":"instagramCaption","description":"元のInstagram投稿のキャプション"},{"name":"company","description":"会社名"},{"name":"serviceName","description":"サービス名"},{"name":"strength","description":"事業の強み"},{"name":"persona","description":"事業者情報のターゲット"}]'::jsonb,
  1
)
ON CONFLICT (name) DO NOTHING;

-- Rollback: DROP FUNCTION public.start_instagram_blog_draft_batch(uuid, uuid[], uuid[], timestamptz);
--           DROP TABLE public.instagram_blog_draft_jobs;
--           DROP TABLE public.instagram_blog_draft_batches;
--           DELETE FROM public.prompt_templates WHERE name = 'instagram_blog_keyword_generation';
