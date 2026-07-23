-- pending backoff 更新を原子的にする（SELECT→UPDATE の TOCTOU を排除）。
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.schedule_pending_auth_user_deletion_retry(uuid);

CREATE OR REPLACE FUNCTION public.schedule_pending_auth_user_deletion_retry(
  p_supabase_auth_id uuid
)
RETURNS TABLE (
  success boolean,
  error text,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := timezone('utc', now());
  v_updated public.pending_auth_user_deletions%rowtype;
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
  RETURNING p.* INTO v_updated;

  IF FOUND THEN
    RETURN QUERY SELECT true, null::text, v_updated.attempt_count;
    RETURN;
  END IF;

  RETURN QUERY SELECT false, 'pending_not_found'::text, null::integer;
END;
$$;

REVOKE ALL ON FUNCTION public.schedule_pending_auth_user_deletion_retry(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.schedule_pending_auth_user_deletion_retry(uuid) TO service_role;
