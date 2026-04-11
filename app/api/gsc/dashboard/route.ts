import { NextRequest, NextResponse } from 'next/server';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { nextJson409IfEmailLinkConflict } from '@/server/middleware/authMiddlewareGuards';
import { SupabaseService } from '@/server/services/supabaseService';
import { getLiffTokensFromRequest } from '@/server/lib/auth-helpers';

const supabaseService = new SupabaseService();

export async function GET(request: NextRequest) {
  try {
    const { accessToken: liffAccessToken, refreshToken } = getLiffTokensFromRequest(request);

    // liffAccessToken がない場合も authMiddleware が Supabase Email セッションで解決する
    const authResult = await authMiddleware(liffAccessToken, refreshToken, { allowEmailFallback: true });
    const conflict409 = nextJson409IfEmailLinkConflict(authResult);
    if (conflict409) return conflict409;
    if (authResult.error || !authResult.userId) {
      return NextResponse.json(
        { success: false, error: authResult.error || 'ユーザー認証に失敗しました' },
        { status: 401 }
      );
    }

    const userId = authResult.userId;
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const perPage = Math.min(50, Math.max(1, parseInt(searchParams.get('perPage') ?? '20', 10)));
    const search = (searchParams.get('q') ?? '').trim();
    const stage = searchParams.get('stage') ?? null;
    const annotationId = searchParams.get('annotationId') ?? null;

    const from = (page - 1) * perPage;
    const to = from + perPage - 1;

    let query = supabaseService
      .getClient()
      .from('content_annotations')
      .select('id, wp_post_title, canonical_url, updated_at, session_id', { count: 'exact' })
      .eq('user_id', userId)
      .order('updated_at', { ascending: false, nullsFirst: false });

    if (annotationId) {
      query = query.eq('id', annotationId);
    }

    if (search) {
      const like = `%${search}%`;
      query = query.or(`wp_post_title.ilike.${like},canonical_url.ilike.${like}`);
    }

    const { data: annotations, error: annotationsError, count } = await query.range(from, to);

    if (annotationsError) {
      throw new Error(annotationsError.message);
    }

    const annotationIds = (annotations ?? []).map(a => a.id);

    const { data: evals, error: evalError } = await supabaseService
      .getClient()
      .from('gsc_article_evaluations')
      .select('*')
      .eq('user_id', userId)
      .in('content_annotation_id', annotationIds.length ? annotationIds : ['00000000-0000-0000-0000-000000000000']);

    if (evalError) {
      throw new Error(evalError.message);
    }

    const { data: metrics, error: metricError } = await supabaseService
      .getClient()
      .from('gsc_page_metrics')
      .select('content_annotation_id, position, ctr, clicks, impressions, date')
      .eq('user_id', userId)
      .in('content_annotation_id', annotationIds.length ? annotationIds : ['00000000-0000-0000-0000-000000000000'])
      .order('date', { ascending: false });

    if (metricError) {
      throw new Error(metricError.message);
    }

    // pick latest metric per annotation
    const latestMetricMap = new Map<string, (typeof metrics)[number]>();
    (metrics ?? []).forEach(m => {
      if (!latestMetricMap.has(m.content_annotation_id as string)) {
        latestMetricMap.set(m.content_annotation_id as string, m);
      }
    });

    // optional stage filter applied after join
    const stageFiltered = (annotations ?? []).filter(a => {
      if (!stage) return true;
      const evalRow = (evals ?? []).find(e => e.content_annotation_id === a.id);
      if (!evalRow) return false;
      return String(evalRow.current_suggestion_stage) === stage;
    });

    const items = stageFiltered.map(a => {
      const evaluation = (evals ?? []).find(e => e.content_annotation_id === a.id) || null;
      const metric = latestMetricMap.get(a.id) ?? null;
      return {
        annotationId: a.id,
        title: a.wp_post_title ?? '',
        url: a.canonical_url ?? '',
        updatedAt: a.updated_at ?? null,
        sessionId: a.session_id ?? null,
        evaluation,
        latestMetric: metric,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        items,
        total: count ?? items.length,
        page,
        perPage,
      },
    });
  } catch (error) {
    console.error('[gsc/dashboard] error', error);
    const message = error instanceof Error ? error.message : 'ダッシュボードデータ取得に失敗しました';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
