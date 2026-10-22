-- 本番は既に NULL 可だが、リポの migration だけで作った DB では NOT NULL のままなので、URL だけの記事を作れるよう外す
alter table public.content_annotations
  alter column wp_post_id drop not null;

alter table public.content_annotations
  drop constraint if exists content_annotations_key_presence_chk;

alter table public.content_annotations
  add constraint content_annotations_key_presence_chk
  check (wp_post_id is not null or session_id is not null or canonical_url is not null);

create index if not exists idx_content_annotations_user_normalized_url
  on public.content_annotations(user_id, normalized_url)
  where normalized_url is not null;

create or replace function public.import_content_annotations_csv(p_user_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_match_count integer;
  v_annotation_id uuid;
  v_updated integer := 0;
  v_created integer := 0;
  v_unchanged integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_has_values boolean;
  v_url text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required';
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be a JSON array';
  end if;

  for v_row in
    select
      item.ordinality::integer as row_index,
      item.value ->> 'url' as url,
      item.value ->> 'main_kw' as main_kw,
      item.value ->> 'kw' as kw,
      item.value ->> 'impressions' as impressions,
      item.value ->> 'needs' as needs,
      item.value ->> 'persona' as persona,
      item.value ->> 'goal' as goal,
      item.value ->> 'prep' as prep,
      item.value ->> 'basic_structure' as basic_structure,
      item.value ->> 'opening_proposal' as opening_proposal
    from jsonb_array_elements(p_rows) with ordinality as item(value, ordinality)
  loop
    v_url := nullif(btrim(v_row.url), '');
    if v_url is null then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'row_index', v_row.row_index, 'url', '', 'reason', 'invalid_url'
      ));
      continue;
    end if;

    v_has_values := nullif(btrim(v_row.main_kw), '') is not null
      or nullif(btrim(v_row.kw), '') is not null
      or nullif(btrim(v_row.impressions), '') is not null
      or nullif(btrim(v_row.needs), '') is not null
      or nullif(btrim(v_row.persona), '') is not null
      or nullif(btrim(v_row.goal), '') is not null
      or nullif(btrim(v_row.prep), '') is not null
      or nullif(btrim(v_row.basic_structure), '') is not null
      or nullif(btrim(v_row.opening_proposal), '') is not null;

    select count(*), (array_agg(annotation.id))[1]
      into v_match_count, v_annotation_id
      from public.content_annotations as annotation
      where annotation.user_id = p_user_id::text
        and annotation.normalized_url = public.normalize_url(v_url);

    if v_match_count > 1 then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'row_index', v_row.row_index, 'url', v_url, 'reason', 'multiple_matches'
      ));
    elsif v_match_count = 1 and v_has_values then
      update public.content_annotations as annotation
      set
        main_kw = coalesce(nullif(btrim(v_row.main_kw), ''), annotation.main_kw),
        kw = coalesce(nullif(btrim(v_row.kw), ''), annotation.kw),
        impressions = coalesce(nullif(btrim(v_row.impressions), ''), annotation.impressions),
        needs = coalesce(nullif(btrim(v_row.needs), ''), annotation.needs),
        persona = coalesce(nullif(btrim(v_row.persona), ''), annotation.persona),
        goal = coalesce(nullif(btrim(v_row.goal), ''), annotation.goal),
        prep = coalesce(nullif(btrim(v_row.prep), ''), annotation.prep),
        basic_structure = coalesce(nullif(btrim(v_row.basic_structure), ''), annotation.basic_structure),
        opening_proposal = coalesce(nullif(btrim(v_row.opening_proposal), ''), annotation.opening_proposal),
        updated_at = now()
      where annotation.id = v_annotation_id
        and annotation.user_id = p_user_id::text;
      v_updated := v_updated + 1;
    elsif v_match_count = 1 then
      v_unchanged := v_unchanged + 1;
    elsif v_has_values then
      insert into public.content_annotations (
        user_id, canonical_url, main_kw, kw, impressions, needs, persona, goal, prep,
        basic_structure, opening_proposal
      ) values (
        p_user_id::text, v_url,
        nullif(btrim(v_row.main_kw), ''), nullif(btrim(v_row.kw), ''),
        nullif(btrim(v_row.impressions), ''), nullif(btrim(v_row.needs), ''),
        nullif(btrim(v_row.persona), ''), nullif(btrim(v_row.goal), ''),
        nullif(btrim(v_row.prep), ''), nullif(btrim(v_row.basic_structure), ''),
        nullif(btrim(v_row.opening_proposal), '')
      );
      v_created := v_created + 1;
    else
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'row_index', v_row.row_index, 'url', v_url, 'reason', 'no_values'
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'updated', v_updated,
    'created', v_created,
    'unchanged', v_unchanged,
    'skipped', v_skipped
  );
end;
$$;

revoke execute on function public.import_content_annotations_csv(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.import_content_annotations_csv(uuid, jsonb) to service_role;

-- 想定どおりの権限と search_path になったかを確かめる（想定外なら適用を失敗させる）
do $$
declare
  fn_oid oid := 'public.import_content_annotations_csv(uuid,jsonb)'::regprocedure;
begin
  if not has_function_privilege('service_role', fn_oid, 'execute') then
    raise exception 'service_role が import_content_annotations_csv を実行できない';
  end if;
  if has_function_privilege('anon', fn_oid, 'execute') then
    raise exception 'anon が import_content_annotations_csv を実行できてしまう（revoke 漏れ）';
  end if;
  if has_function_privilege('authenticated', fn_oid, 'execute') then
    raise exception 'authenticated が import_content_annotations_csv を実行できてしまう（revoke 漏れ）';
  end if;
  if not exists (
    select 1 from pg_proc p, unnest(p.proconfig) as cfg
    where p.oid = fn_oid and cfg = 'search_path=public'
  ) then
    raise exception 'import_content_annotations_csv の search_path が public になっていない';
  end if;
end $$;

-- Rollback:
--   drop function public.import_content_annotations_csv(uuid, jsonb);
--   drop index public.idx_content_annotations_user_normalized_url;
--   CHECK 制約を元の式（wp_post_id または session_id）に戻すのは、URL だけの記事が無いときだけ（あれば先に消すか、戻さない）
