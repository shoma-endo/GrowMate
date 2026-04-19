-- Add p_has_unread_suggestion filter to get_filtered_content_annotations RPC
-- When true, returns only annotations that have at least one unread improvement suggestion

-- Drop old 5-parameter signature before creating new 6-parameter version.
-- CREATE OR REPLACE only replaces a function when the full signature matches;
-- adding a parameter would create a second overload and cause PostgREST
-- ambiguous-function errors at runtime.
DROP FUNCTION IF EXISTS public.get_filtered_content_annotations(uuid, integer, integer, text[], boolean);

CREATE OR REPLACE FUNCTION public.get_filtered_content_annotations(
  p_user_id uuid,
  p_page integer,
  p_per_page integer,
  p_selected_category_names text[] DEFAULT '{}'::text[],
  p_include_uncategorized boolean DEFAULT false,
  p_has_unread_suggestion boolean DEFAULT false
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
      COALESCE(p_has_unread_suggestion, false) AS has_unread_suggestion
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
    WHERE ca.user_id = ANY(public.get_accessible_user_ids(p_user_id)::text[])
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

-- Performance index for the EXISTS subquery on gsc_article_evaluation_history
CREATE INDEX IF NOT EXISTS idx_gsc_eval_history_annotation_unread
  ON public.gsc_article_evaluation_history (content_annotation_id)
  WHERE is_read = false AND outcome_type <> 'error' AND outcome IS NOT NULL AND outcome <> 'improved';

-- Rollback:
-- DROP INDEX IF EXISTS idx_gsc_eval_history_annotation_unread;
-- DROP FUNCTION IF EXISTS public.get_filtered_content_annotations(uuid, integer, integer, text[], boolean, boolean);
-- Then restore the previous 5-parameter version of get_filtered_content_annotations.
