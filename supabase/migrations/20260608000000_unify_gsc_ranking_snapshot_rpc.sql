-- §17.4: GSC順位スナップショットRPCを統合する。
-- これまで集約本体が同一の2関数を分けていた:
--   - get_gsc_ranking_snapshot      … プロンプト用（上位 p_limit 件）
--   - get_gsc_ranking_for_queries   … メール突合用（提案KW狙い撃ち・上限なし）※本マイグレーション前は未適用
-- 約70行の集約ロジックが重複しドリフトの温床だったため、省略可能パラメータで1関数に統合する。
--
--   - p_queries 非NULL … query_normalized = ANY(p_queries) で狙い撃ち（結果はKW数に有界）
--   - p_limit  非NULL … ORDER 後に LIMIT。NULL は「無制限」（Postgres の LIMIT NULL）。
--   呼び出し分岐は引数のみ:
--     プロンプト用 → p_limit=500（p_queries 省略）
--     突合用       → p_queries=[...]（p_limit 省略=無制限・p_queries で有界）
--
-- query_normalized はインポート時に TS の normalizeQuery（NFKC + lowercase + 空白圧縮・冪等）で
-- 生成されるため、呼び出し側が normalizeQuery(KW) を渡せば直接突合できる。
--
-- 集約仕様（インプレッション加重平均position・合計指標・代表ページ解決）は従来と不変。
-- Rollback: DROP FUNCTION IF EXISTS public.get_gsc_ranking_snapshot(UUID, TEXT, DATE, DATE, INT, TEXT[]);

-- 旧署名（5引数）を明示DROPして署名重複（PostgREST のオーバーロード曖昧）を避ける。
DROP FUNCTION IF EXISTS public.get_gsc_ranking_snapshot(UUID, TEXT, DATE, DATE, INT);
-- 別関数として先行適用されていた場合に備え冪等にDROP（通常は未適用）。
DROP FUNCTION IF EXISTS public.get_gsc_ranking_for_queries(UUID, TEXT, DATE, DATE, TEXT[]);

CREATE OR REPLACE FUNCTION public.get_gsc_ranking_snapshot(
  p_user_id UUID,
  p_property_uri TEXT,
  p_start_date DATE,
  p_end_date DATE,
  p_limit INT DEFAULT NULL,
  p_queries TEXT[] DEFAULT NULL
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
      -- p_queries 指定時のみ狙い撃ち。未指定（NULL）は全クエリ対象（プロンプト用）。
      AND (p_queries IS NULL OR query_normalized = ANY(p_queries))
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
  -- p_limit NULL = 無制限（狙い撃ち時は p_queries で結果が有界）。
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.get_gsc_ranking_snapshot IS
  'GSC自社順位スナップショット（統合）: 期間集約（加重平均position・合計指標）＋代表ページ解決をDB側で実行。p_queries で狙い撃ち（上限なし）、p_limit で上位N件（プロンプト用）。';
