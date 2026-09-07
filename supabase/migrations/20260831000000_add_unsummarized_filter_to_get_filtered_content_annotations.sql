-- 一覧 RPC に「未要約」フィルタ（AI 要約一括実行）を追加する。
--
-- 未要約 = AI要約対象8項目（main_kw, kw, needs, persona, goal, prep, opening_proposal,
-- basic_structure）がすべて未設定（NULL または trim 後空文字）かつ WordPress 連携済み
-- （wp_post_id が正の数、または canonical_url が trim 後非空）。
-- 定義は docs/plans/content-annotation-bulk-ai-summary-spec.md BR-02 が正本。
-- impressions は AI 要約の書き込み対象外（saveSummary が更新しない）ため判定に含めない。
--
-- 引数リストが変わるため create or replace では置き換わらない。8引数版を drop してから作り直す
-- （20260809100000_add_gsc_unstarted_evaluation_filter.sql と同じ理由）。
-- drop で権限も消えるため、末尾の revoke / grant を必ず再実行する。これを落とすと
-- service_role から一覧 RPC を実行できず /analytics の一覧が全滅する。
drop function if exists public.get_filtered_content_annotations(uuid, integer, integer, text[], boolean, boolean);
drop function if exists public.get_filtered_content_annotations(uuid, integer, integer, text[], boolean, boolean, boolean);
drop function if exists public.get_filtered_content_annotations(uuid, integer, integer, text[], boolean, boolean, boolean, boolean);
drop function if exists public.get_filtered_content_annotations(uuid, integer, integer, text[], boolean, boolean, boolean, boolean, boolean);

create or replace function public.get_filtered_content_annotations(
  p_user_id uuid,
  p_page integer,
  p_per_page integer,
  p_selected_category_names text[] default '{}'::text[],
  p_include_uncategorized boolean default false,
  p_has_unread_suggestion boolean default false,
  p_has_unstarted_gsc_evaluation boolean default false,
  p_has_unstarted_ga4_evaluation boolean default false,
  p_has_unsummarized boolean default false
)
returns table(items jsonb, total_count bigint)
language sql stable
as $$
  with normalized as (
    select
      greatest(1, coalesce(p_page, 1)) as page,
      greatest(1, least(100, coalesce(p_per_page, 100))) as per_page,
      coalesce((select array_agg(trimmed_name) from (
        select distinct trim(name) as trimmed_name
        from unnest(coalesce(p_selected_category_names, '{}'::text[])) as name
        where trim(name) <> ''
      ) names), '{}'::text[]) as selected_names,
      coalesce(p_include_uncategorized, false) as include_uncategorized,
      coalesce(p_has_unread_suggestion, false) as has_unread_suggestion,
      coalesce(p_has_unstarted_gsc_evaluation, false) as has_unstarted_gsc_evaluation,
      coalesce(p_has_unstarted_ga4_evaluation, false) as has_unstarted_ga4_evaluation,
      coalesce(p_has_unsummarized, false) as has_unsummarized,
      -- btrim で落とす空白文字の集合（上の未要約述語のコメントを参照）
      ' ' || chr(9) || chr(10) || chr(13) || chr(12) || chr(11) || chr(160) || chr(12288) as blank
  ), filtered as (
    select ca.*
    from public.content_annotations ca
    cross join normalized n
    cross join lateral (
      select coalesce(array_agg(trim(category_name)) filter (where trim(category_name) <> ''), '{}'::text[]) as names
      from unnest(coalesce(ca.wp_category_names, '{}'::text[])) as category_name
    ) categories
    where ca.user_id = p_user_id::text
      and (
        (coalesce(array_length(n.selected_names, 1), 0) = 0 and not n.include_uncategorized)
        or (coalesce(array_length(n.selected_names, 1), 0) > 0 and categories.names && n.selected_names)
        or (n.include_uncategorized and coalesce(array_length(categories.names, 1), 0) = 0)
      )
      and (
        not n.has_unread_suggestion
        or exists (
          select 1 from public.gsc_article_evaluation_history h
          where h.content_annotation_id = ca.id and h.user_id = p_user_id
            and h.is_read = false and h.outcome_type <> 'error'
            and h.outcome is not null and h.outcome <> 'improved'
        )
      )
      and (
        not n.has_unstarted_gsc_evaluation
        or not exists (
          select 1 from public.gsc_article_evaluations e
          where e.content_annotation_id = ca.id
        )
      )
      and (
        not n.has_unstarted_ga4_evaluation
        or not exists (
          select 1 from public.ga4_content_evaluations e
          where e.content_annotation_id = ca.id and e.user_id = p_user_id
        )
      )
      -- 未要約（BR-02）: 8項目すべてが空 かつ WordPress 連携済み。
      -- NULL と空文字を同一視して判定する（NULL のみの判定にすると、空文字で保存された行が
      -- 「要約済み」に見えて一括の対象から外れる）。
      --
      -- 既定の btrim は半角スペースしか落とさないため、除去する文字を明示する。
      -- アプリ側の判定は TypeScript の String.prototype.trim（Unicode 空白すべてを除去。
      -- src/server/lib/content-annotation-bulk-summary.ts の readField）なので、揃えないと
      -- 「全角スペースだけの main_kw」が SQL では要約済み・アプリでは未要約となり、
      -- フィルタに出ない記事が全選択経由で上書きされる。
      -- 落とす文字: 半角スペース / タブ / LF / CR / FF / VT / NBSP(U+00A0) / 全角スペース(U+3000)。
      -- JS の trim はさらに U+2000〜U+200A 等も落とすが、日本語コンテンツで現実に混入するのは
      -- ここに挙げた範囲なので完全一致までは求めない（差が問題になったら本行に足す）。
      and (
        not n.has_unsummarized
        or (
          coalesce(btrim(ca.main_kw, n.blank), '') = ''
          and coalesce(btrim(ca.kw, n.blank), '') = ''
          and coalesce(btrim(ca.needs, n.blank), '') = ''
          and coalesce(btrim(ca.persona, n.blank), '') = ''
          and coalesce(btrim(ca.goal, n.blank), '') = ''
          and coalesce(btrim(ca.prep, n.blank), '') = ''
          and coalesce(btrim(ca.opening_proposal, n.blank), '') = ''
          and coalesce(btrim(ca.basic_structure, n.blank), '') = ''
          and (
            coalesce(ca.wp_post_id, 0) > 0
            or coalesce(btrim(ca.canonical_url, n.blank), '') <> ''
          )
        )
      )
  ), ordered as (
    select
      f.*,
      row_number() over (order by f.updated_at desc nulls last) as rn,
      latest.status as ga4_evaluation_status,
      latest.content_score as ga4_content_score,
      latest.diagnosis_code as ga4_diagnosis_code,
      latest.evaluated_at as ga4_last_evaluated_at
    from filtered f
    left join lateral (
      select ev.status, h.content_score, h.diagnosis_code, h.completed_at as evaluated_at
      from public.ga4_content_evaluations ev
      left join public.ga4_content_evaluation_history h on h.id = ev.last_success_history_id
      where ev.user_id = p_user_id and ev.content_annotation_id = f.id
    ) latest on true
  ), paged as (
    select to_jsonb(o.*) as annotation, o.rn
    from ordered o cross join normalized n
    where o.rn > (n.page - 1) * n.per_page and o.rn <= n.page * n.per_page
  )
  select coalesce((select jsonb_agg(p.annotation order by p.rn) from paged p), '[]'::jsonb),
         coalesce((select count(*) from filtered), 0)::bigint;
$$;

revoke execute on function public.get_filtered_content_annotations(uuid, integer, integer, text[], boolean, boolean, boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.get_filtered_content_annotations(uuid, integer, integer, text[], boolean, boolean, boolean, boolean, boolean) to service_role;

-- Rollback: 9引数版を drop し、20260818000300_update_get_filtered_content_annotations_for_ga4.sql を
-- ファイル全体で再適用する（同ファイルは末尾に8引数版の revoke / grant を持つため権限も戻る）。
--   drop function if exists public.get_filtered_content_annotations(uuid, integer, integer, text[], boolean, boolean, boolean, boolean, boolean);
-- 20260809100000（7引数版）へ戻してはならない。p_has_unstarted_ga4_evaluation と GA4 射影フィールドが
-- 失われ /analytics の GA4 表示が壊れる。
