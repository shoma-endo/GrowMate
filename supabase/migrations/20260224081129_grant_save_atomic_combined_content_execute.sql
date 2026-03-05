-- Rollback:
-- REVOKE EXECUTE ON FUNCTION public.save_atomic_combined_content(text, text, text) FROM service_role;

-- Keep this migration as a single statement for CLI compatibility.
DO $grant_save_atomic_combined_content$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.save_atomic_combined_content(text, text, text) FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON FUNCTION public.save_atomic_combined_content(text, text, text) FROM authenticated';
  EXECUTE 'REVOKE ALL ON FUNCTION public.save_atomic_combined_content(text, text, text) FROM anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.save_atomic_combined_content(text, text, text) TO service_role';
END
$grant_save_atomic_combined_content$;
