-- §17: GSC 自社順位スナップショットの期間集約をDB側で実行するRPC。
-- 旧実装は「最新日のみ・コード側で上位N件キャップ後集約」だったため、
--   (1) 集約前の行キャップで低インプレッションの上位順位クエリが欠落し合計/加重平均が歪む
--   (2) 代表URL/FKを単一行のインプレッション最大で選んでしまう
-- という問題があった。本RPCで窓内全行をDB側集約し、上記を解消する。
--
-- 仕様:
--   - 対象: user_id + property_uri + search_type='web' + [p_start_date, p_end_date]
--   - query_normalized 単位に集約: position=インプレッション加重平均、impressions/clicks=合計
--   - 代表ページ: (query, url)単位の合計インプレッション最大のページ（単一行maxではない）
--   - content_annotations を JOIN し canonical_url / wp_post_title を解決
--   - ORDER BY position ASC, impressions DESC LIMIT p_limit
--
-- Rollback: DROP FUNCTION IF EXISTS public.get_gsc_ranking_snapshot;

CREATE OR REPLACE FUNCTION public.get_gsc_ranking_snapshot(
  p_user_id UUID,
  p_property_uri TEXT,
  p_start_date DATE,
  p_end_date DATE,
  p_limit INT
)
RETURNS TABLE (
  query_normalized TEXT,
  -- "position" は SQL 標準関数 POSITION() の予約語のため、列名としては引用符で囲む必要がある。
  -- PostgREST が返す JSON キーは "position" のままなので呼び出し側（TS）の変更は不要。
  "position" NUMERIC,
  impressions BIGINT,
  clicks BIGINT,
  url TEXT,
  title TEXT,
  content_annotation_id UUID
)
LANGUAGE sql
STABLE
AS $$
  WITH win AS (
    SELECT
      query_normalized AS qn,
      position AS pos,
      impressions AS imp,
      clicks AS clk,
      normalized_url AS nurl,
      content_annotation_id AS caid
    FROM gsc_query_metrics
    WHERE user_id = p_user_id
      AND property_uri = p_property_uri
      AND search_type = 'web'
      AND date >= p_start_date
      AND date <= p_end_date
  ),
  query_agg AS (
    SELECT
      qn,
      SUM(imp)::BIGINT AS impressions,
      SUM(clk)::BIGINT AS clicks,
      -- 総インプレッション0なら加重平均が定義できないため単純平均にフォールバック
      CASE
        WHEN SUM(imp) > 0 THEN ROUND(SUM(pos * imp) / SUM(imp), 1)
        ELSE ROUND(AVG(pos), 1)
      END AS position
    FROM win
    GROUP BY qn
  ),
  url_agg AS (
    -- (query, url) 単位の合計インプレッションで代表ページを決定する（単一行maxではない）。
    -- content_annotation_id は同一URL内で最大インプレッション行の非NULL値を採用する。
    SELECT
      qn,
      nurl,
      SUM(imp) AS url_imp,
      (ARRAY_AGG(caid ORDER BY imp DESC NULLS LAST) FILTER (WHERE caid IS NOT NULL))[1] AS caid
    FROM win
    GROUP BY qn, nurl
  ),
  representative AS (
    SELECT qn, nurl, caid
    FROM (
      SELECT
        qn,
        nurl,
        caid,
        ROW_NUMBER() OVER (PARTITION BY qn ORDER BY url_imp DESC, nurl ASC) AS rn
      FROM url_agg
    ) ranked
    WHERE rn = 1
  )
  SELECT
    q.qn AS query_normalized,
    q.position,
    q.impressions,
    q.clicks,
    COALESCE(ca.canonical_url, ca.normalized_url, r.nurl) AS url,
    COALESCE(ca.wp_post_title, '') AS title,
    r.caid AS content_annotation_id
  FROM query_agg q
  LEFT JOIN representative r ON q.qn = r.qn
  -- Service Role 実行で RLS がバイパスされるため、別ユーザーのコンテンツ流出を防ぐべく
  -- content_annotations 側も user_id で明示照合する（user_id は text 型のためキャスト）。
  LEFT JOIN content_annotations ca ON ca.id = r.caid AND ca.user_id = p_user_id::text
  ORDER BY q.position ASC, q.impressions DESC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.get_gsc_ranking_snapshot IS
  'GSC自社順位スナップショット: 期間集約（インプレッション加重平均position・合計指標）＋代表ページ解決をDB側で実行。';
