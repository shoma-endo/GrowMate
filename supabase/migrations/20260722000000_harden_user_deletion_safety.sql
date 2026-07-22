-- Stage3: ユーザー削除の安全性硬化を1本にまとめる。
-- - 旧スタッフ削除 RPC（delete_employee_and_restore_owner）DROP
-- - delete_user_fully: FOR UPDATE + 削除保護 + pending 先行（初期 lease 30s）
-- - admin_action_logs.target_supabase_auth_id
-- - pending_auth_user_deletions + claim_pending_auth_user_deletion（原子的 claim）
--
-- Rollback（注意）:
--   1) 切替中は管理画面のユーザー削除 Action を停止する。
--   2) pending に未削除 Auth が残る状態でテーブルを DROP しない（再作成防止が解除される）。
--   3) 現行（pending 依存）アプリを残したままテーブルを DROP しない
--      （メール認証解決が DB エラーになる）。先に旧アプリへ戻す。
--   手順:
--     (1) 削除 Action 停止
--     (2) Auth Admin で残存ユーザーを手動削除し pending が空であることを確認
--     (3) 旧アプリ配備へ戻す
--     (4) delete_user_fully / delete_employee_and_restore_owner を
--         20251230140000 / 20260108000000 の定義へ復元
--     (5) pending_auth_user_deletions DROP、必要なら target_supabase_auth_id 列削除

DROP FUNCTION IF EXISTS public.delete_employee_and_restore_owner(uuid, uuid);

ALTER TABLE public.admin_action_logs
  ADD COLUMN IF NOT EXISTS target_supabase_auth_id uuid;

COMMENT ON COLUMN public.admin_action_logs.target_supabase_auth_id IS
  '削除対象の Supabase Auth ID（Auth削除失敗時の追跡・再試行用。メール等のPIIは保存しない）';

CREATE TABLE IF NOT EXISTS public.pending_auth_user_deletions (
  supabase_auth_id uuid PRIMARY KEY,
  target_user_id uuid NOT NULL,
  admin_action_log_id uuid,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  last_attempt_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0),
  next_attempt_at timestamptz
);

ALTER TABLE public.pending_auth_user_deletions
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;

COMMENT ON TABLE public.pending_auth_user_deletions IS
  'users 削除と同一TXで作成する Auth 削除待ち。同一 auth id での public.users 再作成を防ぐ';

COMMENT ON COLUMN public.pending_auth_user_deletions.next_attempt_at IS
  '次回 Auth 削除試行可能時刻。作成直後は初期 lease。未到達のログイン解決では Auth Admin API を呼ばない';

ALTER TABLE public.pending_auth_user_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pending_auth_user_deletions FROM anon, authenticated;

DROP FUNCTION IF EXISTS public.delete_user_fully(uuid);
DROP FUNCTION IF EXISTS public.delete_user_fully(uuid, boolean);
DROP FUNCTION IF EXISTS public.delete_user_fully(uuid, uuid);
DROP FUNCTION IF EXISTS public.claim_pending_auth_user_deletion(uuid);

CREATE OR REPLACE FUNCTION public.delete_user_fully(
  p_user_id uuid,
  p_admin_action_log_id uuid DEFAULT NULL
)
RETURNS TABLE (
  success boolean,
  error text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target public.users%rowtype;
  v_lease_until timestamptz := timezone('utc', now()) + interval '30 seconds';
BEGIN
  BEGIN
    SELECT *
      INTO v_target
      FROM public.users
     WHERE id = p_user_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RETURN QUERY SELECT false, 'User not found';
      RETURN;
    END IF;

    -- 削除保護（検証と DELETE を同一トランザクション＋行ロック内で実施）
    IF v_target.role = 'admin' THEN
      RETURN QUERY SELECT false, 'blocked_admin';
      RETURN;
    END IF;

    IF v_target.stripe_subscription_id IS NOT NULL THEN
      RETURN QUERY SELECT false, 'blocked_active_subscription';
      RETURN;
    END IF;

    IF v_target.owner_user_id IS NOT NULL THEN
      RETURN QUERY SELECT false, 'blocked_organization';
      RETURN;
    END IF;

    IF EXISTS (
      SELECT 1
        FROM public.users
       WHERE owner_user_id = p_user_id
    ) THEN
      RETURN QUERY SELECT false, 'blocked_organization';
      RETURN;
    END IF;

    -- Auth がある場合は users 削除前に pending を同一TXで作成（クラッシュ窓・並行再作成を閉じる）
    -- next_attempt_at は初期 lease。管理画面の直後 Auth リトライ中はログイン claim させない。
    IF v_target.supabase_auth_id IS NOT NULL THEN
      INSERT INTO public.pending_auth_user_deletions (
        supabase_auth_id,
        target_user_id,
        admin_action_log_id,
        created_at,
        last_attempt_at,
        attempt_count,
        next_attempt_at
      ) VALUES (
        v_target.supabase_auth_id,
        p_user_id,
        p_admin_action_log_id,
        timezone('utc', now()),
        NULL,
        0,
        v_lease_until
      )
      ON CONFLICT (supabase_auth_id) DO UPDATE SET
        target_user_id = EXCLUDED.target_user_id,
        admin_action_log_id = COALESCE(
          EXCLUDED.admin_action_log_id,
          public.pending_auth_user_deletions.admin_action_log_id
        ),
        next_attempt_at = v_lease_until;
    END IF;

    DELETE FROM public.chat_messages WHERE user_id = p_user_id::text;
    DELETE FROM public.chat_sessions WHERE user_id = p_user_id::text;
    DELETE FROM public.content_annotations WHERE user_id = p_user_id::text;
    DELETE FROM public.briefs WHERE user_id = p_user_id::text;

    DELETE FROM public.users WHERE id = p_user_id;

    RETURN QUERY SELECT true, null::text;
  EXCEPTION
    WHEN foreign_key_violation THEN
      RETURN QUERY SELECT false, 'Cannot delete user: foreign key constraint';
    WHEN OTHERS THEN
      RETURN QUERY SELECT false, 'Failed to delete user: ' || SQLERRM;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_user_fully(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_user_fully(uuid, uuid) TO service_role;

-- 原子的 claim: 期限到来行のみ attempt を進め RETURNING。並列ログインで二重 claim しない。
CREATE OR REPLACE FUNCTION public.claim_pending_auth_user_deletion(
  p_supabase_auth_id uuid
)
RETURNS TABLE (
  outcome text,
  target_user_id uuid,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := timezone('utc', now());
  v_claimed public.pending_auth_user_deletions%rowtype;
BEGIN
  UPDATE public.pending_auth_user_deletions AS p
     SET last_attempt_at = v_now,
         attempt_count = p.attempt_count + 1,
         next_attempt_at = v_now + make_interval(
           secs => least(
             3600,
             (30 * power(2, least(p.attempt_count + 1, 7)))::integer
           )
         )
   WHERE p.supabase_auth_id = p_supabase_auth_id
     AND (p.next_attempt_at IS NULL OR p.next_attempt_at <= v_now)
  RETURNING p.* INTO v_claimed;

  IF FOUND THEN
    RETURN QUERY SELECT 'claimed'::text, v_claimed.target_user_id, v_claimed.attempt_count;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.pending_auth_user_deletions
     WHERE supabase_auth_id = p_supabase_auth_id
  ) THEN
    RETURN QUERY SELECT 'not_due'::text, null::uuid, null::integer;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'absent'::text, null::uuid, null::integer;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_pending_auth_user_deletion(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_pending_auth_user_deletion(uuid) TO service_role;
