-- Add GSC evaluation-not-started filtering to the analytics content RPC.
-- A content annotation is considered started when a row exists in
-- gsc_article_evaluations, regardless of its status.

-- The filter checks evaluation existence by annotation, so the composite
-- (user_id, content_annotation_id) constraint cannot be used efficiently.
CREATE INDEX IF NOT EXISTS idx_gsc_article_evaluations_content_annotation
  ON public.gsc_article_evaluations(content_annotation_id);

-- CREATE OR REPLACE does not replace a function when the parameter list changes.
DROP FUNCTION IF EXISTS public.get_filtered_content_annotations(
  uuid,
  integer,
  integer,
  text[],
  boolean,
  boolean
);

CREATE OR REPLACE FUNCTION public.get_filtered_content_annotations(
  p_user_id uuid,
  p_page integer,
  p_per_page integer,
  p_selected_category_names text[] DEFAULT '{}'::text[],
  p_include_uncategorized boolean DEFAULT false,
  p_has_unread_suggestion boolean DEFAULT false,
  p_has_unstarted_gsc_evaluation boolean DEFAULT false
)
RETURNS TABLE(items jsonb, total_count bigint)
LANGUAGE sql
STABLE
AS $$
  WITH normalized AS (
    SELECT
      GREATEST(1, COALESCE(p_page, 1)) AS page,
      GREATEST(1, LEAST(100, COALESCE(p_per_page, 100))) AS per_page,
      COALESCE(
        (
          SELECT ARRAY_AGG(trimmed_name)
          FROM (
            SELECT DISTINCT trim(name) AS trimmed_name
            FROM unnest(COALESCE(p_selected_category_names, '{}'::text[])) AS name
            WHERE trim(name) <> ''
          ) normalized_names
        ),
        '{}'::text[]
      ) AS selected_names,
      COALESCE(p_include_uncategorized, false) AS include_uncategorized,
      COALESCE(p_has_unread_suggestion, false) AS has_unread_suggestion,
      COALESCE(p_has_unstarted_gsc_evaluation, false) AS has_unstarted_gsc_evaluation
  ),
  filtered AS (
    SELECT ca.*
    FROM public.content_annotations ca
    CROSS JOIN normalized n
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        ARRAY_AGG(trim(category_name)) FILTER (WHERE trim(category_name) <> ''),
        '{}'::text[]
      ) AS normalized_wp_category_names
      FROM unnest(COALESCE(ca.wp_category_names, '{}'::text[])) AS category_name
    ) norm
    -- The remote schema does not contain the legacy owner/staff helper.
    -- Analytics access is self-owned in the current model.
    WHERE ca.user_id = p_user_id::text
      AND (
        (COALESCE(array_length(n.selected_names, 1), 0) = 0 AND n.include_uncategorized = false)
        OR (
          COALESCE(array_length(n.selected_names, 1), 0) > 0
          AND norm.normalized_wp_category_names && n.selected_names
        )
        OR (
          n.include_uncategorized = true
          AND COALESCE(array_length(norm.normalized_wp_category_names, 1), 0) = 0
        )
      )
      AND (
        NOT n.has_unread_suggestion
        OR EXISTS (
          SELECT 1
          FROM public.gsc_article_evaluation_history h
          WHERE h.content_annotation_id = ca.id
            AND h.user_id = p_user_id
            AND h.is_read = false
            AND h.outcome_type <> 'error'
            AND h.outcome IS NOT NULL
            AND h.outcome <> 'improved'
        )
      )
      AND (
        NOT n.has_unstarted_gsc_evaluation
        OR NOT EXISTS (
          SELECT 1
          FROM public.gsc_article_evaluations e
          WHERE e.content_annotation_id = ca.id
        )
      )
  ),
  ordered AS (
    SELECT
      f.*,
      ROW_NUMBER() OVER (ORDER BY f.updated_at DESC NULLS LAST) AS rn
    FROM filtered f
  ),
  paged AS (
    SELECT
      to_jsonb(o.*) AS annotation,
      o.rn
    FROM ordered o
    CROSS JOIN normalized n
    WHERE o.rn > (n.page - 1) * n.per_page
      AND o.rn <= n.page * n.per_page
  )
  SELECT
    COALESCE(
      (SELECT jsonb_agg(p.annotation ORDER BY p.rn) FROM paged p),
      '[]'::jsonb
    ) AS items,
    COALESCE((SELECT COUNT(*) FROM filtered), 0)::bigint AS total_count;
$$;

-- Keep the analytics category choices consistent with the self-owned access
-- model. The previous definition depended on the missing legacy helper.
CREATE OR REPLACE FUNCTION public.get_available_category_names(p_user_id uuid)
RETURNS TABLE(name text)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT normalized.name
  FROM (
    SELECT trim(unnest(wp_category_names)::text) AS name
    FROM public.content_annotations
    WHERE user_id = p_user_id::text
      AND wp_category_names IS NOT NULL
      AND array_length(wp_category_names, 1) > 0
  ) AS normalized
  WHERE normalized.name <> ''
  ORDER BY normalized.name;
$$;

-- The content_annotation_id index above provides the lookup index for the
-- NOT EXISTS clause. The user_id condition is intentionally omitted because
-- evaluation rows are owned by the annotation owner while analytics content
-- can be viewed by shared users.

-- This RPC is called through SupabaseService with the Service Role client only.
REVOKE EXECUTE ON FUNCTION public.get_filtered_content_annotations(
  uuid, integer, integer, text[], boolean, boolean, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_filtered_content_annotations(
  uuid, integer, integer, text[], boolean, boolean, boolean
) TO service_role;

-- Rollback:
-- DROP FUNCTION IF EXISTS public.get_filtered_content_annotations(
--   uuid, integer, integer, text[], boolean, boolean, boolean
-- );
-- Re-apply the six-parameter definition from
-- 20260419000000_add_unread_suggestion_filter.sql.
