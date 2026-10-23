ALTER TABLE public.content_annotations
  ADD COLUMN wp_post_status text,
  ADD COLUMN wp_publish_claimed_at timestamptz,
  ADD CONSTRAINT content_annotations_wp_post_status_check
    CHECK (wp_post_status IS NULL OR wp_post_status IN ('draft', 'future', 'publish'));

-- Rollback: ALTER TABLE public.content_annotations DROP COLUMN wp_publish_claimed_at, DROP COLUMN wp_post_status;
