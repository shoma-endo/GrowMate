-- ロールバック手順 (Rollback):
-- DROP FUNCTION IF EXISTS public.save_atomic_combined_content(text, text, text);
-- DROP TRIGGER IF EXISTS set_updated_at_session_combined_contents ON public.session_combined_contents;
-- DROP TRIGGER IF EXISTS set_updated_at_session_heading_sections ON public.session_heading_sections;
-- DROP TABLE IF EXISTS public.session_combined_contents;
-- DROP TABLE IF EXISTS public.session_heading_sections;

-- Create session_heading_sections table
CREATE TABLE IF NOT EXISTS public.session_heading_sections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id text NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
    heading_key text NOT NULL,
    heading_level smallint NOT NULL CHECK (heading_level BETWEEN 1 AND 6),
    heading_text text NOT NULL,
    order_index integer NOT NULL CHECK (order_index >= 0),
    content text NOT NULL DEFAULT '',
    is_confirmed boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (session_id, heading_key)
);

-- Index for session_heading_sections
CREATE INDEX IF NOT EXISTS idx_heading_sections_session_order ON public.session_heading_sections (session_id, order_index);

-- Create session_combined_contents table
CREATE TABLE IF NOT EXISTS public.session_combined_contents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id text NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
    version_no integer NOT NULL CHECK (version_no >= 1),
    content text NOT NULL,
    is_latest boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (session_id, version_no)
);

-- Unique constraint for is_latest per session
CREATE UNIQUE INDEX IF NOT EXISTS idx_combined_contents_latest ON public.session_combined_contents (session_id) WHERE is_latest = true;

-- Index for session_combined_contents
CREATE INDEX IF NOT EXISTS idx_combined_contents_session_version ON public.session_combined_contents (session_id, version_no DESC);

-- updated_at 自動更新トリガー（update_updated_at_column は既存マイグレーションで定義済み）
CREATE TRIGGER set_updated_at_session_heading_sections
    BEFORE UPDATE ON public.session_heading_sections
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at_session_combined_contents
    BEFORE UPDATE ON public.session_combined_contents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE public.session_heading_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_combined_contents ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DO $$
BEGIN
    -- session_heading_sections policies
    DROP POLICY IF EXISTS "Users can access their own session headings" ON public.session_heading_sections;
    
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'session_heading_sections' AND policyname = 'Users can view their own session headings') THEN
        CREATE POLICY "Users can view their own session headings" ON public.session_heading_sections
            FOR SELECT
            TO authenticated
            USING (
                session_id IN (
                    SELECT id FROM public.chat_sessions 
                    WHERE user_id = ANY(public.get_accessible_user_ids(auth.uid()))
                )
            );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'session_heading_sections' AND policyname = 'Users can modify their own session headings') THEN
        CREATE POLICY "Users can modify their own session headings" ON public.session_heading_sections
            FOR ALL
            TO authenticated
            USING (
                session_id IN (
                    SELECT id FROM public.chat_sessions 
                    WHERE user_id = ANY(public.get_accessible_user_ids(auth.uid()))
                )
                AND (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role != 'owner'))
            )
            WITH CHECK (
                session_id IN (
                    SELECT id FROM public.chat_sessions 
                    WHERE user_id = ANY(public.get_accessible_user_ids(auth.uid()))
                )
                AND (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role != 'owner'))
            );
    END IF;

    -- session_combined_contents policies
    DROP POLICY IF EXISTS "Users can access their own combined contents" ON public.session_combined_contents;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'session_combined_contents' AND policyname = 'Users can view their own combined contents') THEN
        CREATE POLICY "Users can view their own combined contents" ON public.session_combined_contents
            FOR SELECT
            TO authenticated
            USING (
                session_id IN (
                    SELECT id FROM public.chat_sessions 
                    WHERE user_id = ANY(public.get_accessible_user_ids(auth.uid()))
                )
            );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'session_combined_contents' AND policyname = 'Users can modify their own combined contents') THEN
        CREATE POLICY "Users can modify their own combined contents" ON public.session_combined_contents
            FOR ALL
            TO authenticated
            USING (
                session_id IN (
                    SELECT id FROM public.chat_sessions 
                    WHERE user_id = ANY(public.get_accessible_user_ids(auth.uid()))
                )
                AND (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role != 'owner'))
            )
            WITH CHECK (
                session_id IN (
                    SELECT id FROM public.chat_sessions 
                    WHERE user_id = ANY(public.get_accessible_user_ids(auth.uid()))
                )
                AND (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role != 'owner'))
            );
    END IF;
END $$;

-- Create a function to atomically update combined content
CREATE OR REPLACE FUNCTION public.save_atomic_combined_content(
    p_session_id text,
    p_content text,
    p_authenticated_user_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_max_version integer;
    v_user_id text;
    v_effective_user_id text;
BEGIN
    -- 1. Determine effective user ID and Validate Context
    -- SECURITY DEFINER runs as owner, so we check the calling role via auth.role()
    -- If called by service_role, trust the passed p_authenticated_user_id
    IF auth.role() = 'service_role' THEN
        v_effective_user_id := p_authenticated_user_id;
    -- 将来の拡張用：authenticated に EXECUTE を付与して直接呼び出す場合の対応。
    -- 現状は service_role のみが呼び出し可能なため、このブランチは到達不能。
    ELSIF auth.role() = 'authenticated' THEN
        v_effective_user_id := auth.uid()::text;
    ELSE
        RAISE EXCEPTION 'Execution denied: invalid authentication context';
    END IF;

    IF v_effective_user_id IS NULL THEN
        RAISE EXCEPTION 'User context is missing';
    END IF;

    -- 2. Security check and Concurrency Control (Row Locking)
    -- chat_sessions の該当行を FOR UPDATE でロックし、同一セッションでの同時保存をシリアライズ化する
    SELECT user_id INTO v_user_id 
    FROM public.chat_sessions 
    WHERE id = p_session_id
    FOR UPDATE;

    IF v_user_id IS NULL OR NOT (v_user_id = ANY(public.get_accessible_user_ids(v_effective_user_id::uuid))) THEN
        RAISE EXCEPTION 'Unauthorized session access';
    END IF;

    -- 3. Get current max version
    SELECT COALESCE(MAX(version_no), 0) INTO v_max_version
    FROM public.session_combined_contents
    WHERE session_id = p_session_id;

    -- 4. Unset existing latest
    UPDATE public.session_combined_contents
    SET is_latest = false, updated_at = now()
    WHERE session_id = p_session_id AND is_latest = true;

    -- 5. Insert new latest version
    INSERT INTO public.session_combined_contents (
        session_id,
        version_no,
        content,
        is_latest
    ) VALUES (
        p_session_id,
        v_max_version + 1,
        p_content,
        true
    );
END;
$$;

-- Revoke all privileges and grant only to service_role for maximum security
REVOKE ALL ON FUNCTION public.save_atomic_combined_content(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_atomic_combined_content(text, text, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.save_atomic_combined_content(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_atomic_combined_content(text, text, text) TO service_role;
