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

-- Rollback: DROP TABLE public.instagram_blog_draft_jobs;
--           DROP TABLE public.instagram_blog_draft_batches;
--           DELETE FROM public.prompt_templates WHERE name = 'instagram_blog_keyword_generation';
