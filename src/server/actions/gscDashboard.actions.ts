'use server';

import { revalidatePath } from 'next/cache';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { SupabaseService } from '@/server/services/supabaseService';
import { gscImportService } from '@/server/services/gscImportService';
import { normalizeUrl } from '@/lib/normalize-url';
import { buildGscDateRange } from '@/lib/date-utils';
import type { GscEvaluationOutcome } from '@/types/gsc';
import type { UserRole } from '@/types/user';
import {
  isViewModeEnabled,
  resolveViewModeRole,
  VIEW_MODE_ERROR_MESSAGE,
} from '@/server/lib/view-mode';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { getLiffTokensFromCookies } from '@/server/lib/auth-helpers';
import { emailLinkConflictErrorPayload } from '@/server/middleware/authMiddlewareGuards';

const supabaseService = new SupabaseService();

export type GscDetailResponse = {
  success: boolean;
  data?: {
    annotation: {
      id: string;
      wp_post_id: number | null;
      wp_post_title: string | null;
      canonical_url: string | null;
      opening_proposal: string | null;
      wp_content_text: string | null;
      wp_excerpt?: string | null;
      persona: string | null;
      needs: string | null;
    };
    metrics: Array<{
      date: string;
      position: number | null;
      ctr: number | null;
      clicks: number | null;
      impressions: number | null;
    }>;
    history: Array<{
      id: string;
      evaluation_date: string;
      previous_position: number | null;
      current_position: number | null; // nullable for errors
      outcome: GscEvaluationOutcome | null; // nullable for errors
      outcomeType: 'success' | 'error';
      errorCode?: 'import_failed' | 'no_metrics' | null;
      errorMessage?: string | null;
      suggestion_summary: string | null;
      is_read: boolean;
      created_at: string;
    }>;
    evaluation: {
      id: string;
      user_id: string;
      content_annotation_id: string;
      property_uri: string;
      last_evaluated_on: string | null;
      base_evaluation_date: string;
      cycle_days: number;
      evaluation_hour: number;
      last_seen_position: number | null;
      status: string;
      created_at: string;
      updated_at: string;
    } | null;
    next_evaluation_run_utc?: string | null;
    credential: {
      propertyUri: string | null;
    } | null;
  };
  error?: string;
  /** メール紐付け競合（クライアントがログイン回復へ誘導） */
  emailLinkConflict?: true;
};

type GscDashboardAuthIdResult =
  | { error: string; emailLinkConflict?: true }
  | { userId: string; role: UserRole | null };

function gscAuthErrorPayload(authId: Extract<GscDashboardAuthIdResult, { error: string }>): {
  success: false;
  error: string;
  emailLinkConflict?: true;
} {
  return {
    success: false,
    error: authId.error,
    ...(authId.emailLinkConflict ? { emailLinkConflict: true as const } : {}),
  };
}

const getAuthUserId = async (): Promise<GscDashboardAuthIdResult> => {
  const { accessToken, refreshToken } = await getLiffTokensFromCookies();

  const authResult = await authMiddleware(accessToken, refreshToken);
  const linkConflict = emailLinkConflictErrorPayload(authResult);
  if (linkConflict) return { error: linkConflict.error, emailLinkConflict: true };
  if (authResult.error || !authResult.userId) {
      return { error: authResult.error || ERROR_MESSAGES.AUTH.USER_AUTH_FAILED };
  }
  return { userId: authResult.userId, role: resolveViewModeRole(authResult) };
};

interface AccessibleUserIdsResult {
  accessibleIds: string[] | null;
  error: string | null;
}

const getAccessibleUserIds = async (userId: string): Promise<AccessibleUserIdsResult> => {
  const { data: accessibleIds, error: accessError } = await supabaseService
    .getClient()
    .rpc('get_accessible_user_ids', { p_user_id: userId });

  if (accessError || !accessibleIds) {
    return {
      accessibleIds: null,
      error: ERROR_MESSAGES.AUTH.ACCESS_CHECK_FAILED,
    };
  }

  return { accessibleIds, error: null };
};

export async function fetchGscDetail(
  annotationId: string,
  options?: { days?: number }
): Promise<GscDetailResponse> {
  try {
  const authId = await getAuthUserId();
  if ('error' in authId) {
    return gscAuthErrorPayload(authId);
  }
  const { userId } = authId;

  const { accessibleIds, error: accessCheckError } = await getAccessibleUserIds(userId);
  if (accessCheckError || !accessibleIds) {
    return { success: false, error: accessCheckError || ERROR_MESSAGES.AUTH.ACCESS_CHECK_FAILED };
  }

  const days = Math.min(180, Math.max(7, options?.days ?? 90));
  const startDate = new Date();
  startDate.setUTCDate(startDate.getUTCDate() - days);
  const startIso = startDate.toISOString().slice(0, 10);

  const { data: annotation, error: annotationError } = await supabaseService
    .getClient()
    .from('content_annotations')
    .select(
      'id, user_id, wp_post_id, wp_post_title, canonical_url, opening_proposal, wp_content_text, wp_excerpt, persona, needs'
    )
    .in('user_id', accessibleIds)
    .eq('id', annotationId)
    .maybeSingle();

    if (annotationError) {
      throw new Error(annotationError.message);
    }
    if (!annotation) {
      return { success: false, error: ERROR_MESSAGES.GSC.TARGET_NOT_FOUND };
    }

  const ownerUserId = annotation.user_id;
  const credential = await supabaseService.getGscCredentialByUserId(ownerUserId);

  let metricsQuery = supabaseService
    .getClient()
    .from('gsc_page_metrics')
    .select('date, position, ctr, clicks, impressions')
    .eq('user_id', ownerUserId)
    .eq('content_annotation_id', annotationId)
    .gte('date', startIso)
    .order('date', { ascending: true });

    if (credential?.propertyUri) {
      metricsQuery = metricsQuery.eq('property_uri', credential.propertyUri);
    }

    const { data: metrics, error: metricError } = await metricsQuery;

    if (metricError) {
      throw new Error(metricError.message);
    }

    const { data: history, error: historyError } = await supabaseService
    .getClient()
    .from('gsc_article_evaluation_history')
    .select('*')
    .eq('user_id', ownerUserId)
    .eq('content_annotation_id', annotationId)
    .order('created_at', { ascending: false })
    .limit(100);

    if (historyError) {
      throw new Error(historyError.message);
    }

    const { data: evaluation, error: evaluationError } = await supabaseService
    .getClient()
    .from('gsc_article_evaluations')
    .select('*')
    .eq('user_id', ownerUserId)
    .eq('content_annotation_id', annotationId)
    .maybeSingle();

    if (evaluationError) {
      throw new Error(evaluationError.message);
    }

    return {
      success: true,
      data: {
        annotation,
        metrics: metrics ?? [],
        history:
          history?.map(item => ({
            ...item,
            outcome:
              item.outcome === 'improved' ||
              item.outcome === 'no_change' ||
              item.outcome === 'worse'
                ? (item.outcome as GscEvaluationOutcome)
                : null,
            outcomeType:
              item.outcome_type === 'success' || item.outcome_type === 'error'
                ? item.outcome_type
                : 'error',
            errorCode:
              item.error_code === 'import_failed' || item.error_code === 'no_metrics'
                ? item.error_code
                : null,
            errorMessage: item.error_message,
          })) ?? [],
        evaluation: evaluation ?? null,
        next_evaluation_run_utc: evaluation ? computeNextRunAtJst(evaluation) : null,
        credential: credential ? { propertyUri: credential.propertyUri ?? null } : null,
      },
    };
  } catch (error) {
    console.error('[gsc-dashboard] fetch detail failed', error);
    const message = error instanceof Error ? error.message : ERROR_MESSAGES.GSC.DETAIL_FETCH_FAILED;
    return { success: false, error: message };
  }
}

function computeNextRunAtJst(evaluation: {
  last_evaluated_on: string | null;
  base_evaluation_date: string;
  cycle_days: number;
  evaluation_hour?: number;
}): string {
  const cycle = evaluation.cycle_days || 30;
  const hour = evaluation.evaluation_hour ?? 12;
  const last = evaluation.last_evaluated_on;
  const baseDate = last ?? evaluation.base_evaluation_date;
  const base = new Date(`${baseDate}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + cycle);
  // JST時間をUTCに変換（JST = UTC + 9）
  const utcHour = (hour - 9 + 24) % 24;
  base.setUTCHours(utcHour, 0, 0, 0);
  return base.toISOString();
}

function extractHostName(rawUrl: string): string | null {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return host.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function doesPropertyCoverUrl(propertyUri: string, canonicalUrl: string): boolean {
  const targetNormalized = normalizeUrl(canonicalUrl);
  if (!targetNormalized) {
    return false;
  }

  if (propertyUri.startsWith('sc-domain:')) {
    const targetHost = extractHostName(canonicalUrl);
    const domain = propertyUri.slice('sc-domain:'.length).toLowerCase().replace(/^www\./, '');
    if (!targetHost || !domain) {
      return false;
    }
    return targetHost === domain || targetHost.endsWith(`.${domain}`);
  }

  const propertyNormalized = normalizeUrl(propertyUri);
  if (!propertyNormalized) {
    return false;
  }

  return (
    targetNormalized === propertyNormalized || targetNormalized.startsWith(`${propertyNormalized}/`)
  );
}

async function resolveBestQueryPropertyUri(params: {
  userId: string;
  normalizedUrl: string;
  startIso: string;
  endIso: string;
  preferredPropertyUri?: string | null;
}): Promise<{
  resolvedPropertyUri: string | null;
  bestPropertyUri: string | null;
  preferredInMetrics: boolean;
}> {
  const { userId, normalizedUrl, startIso, endIso, preferredPropertyUri } = params;

  interface GscPropertyCandidateRow {
    property_uri: string | null;
    row_count: number;
    total_impressions: number;
    total_clicks: number;
  }

  interface RpcErrorLike {
    message?: string;
  }

  interface GscPropertyCandidatesRpcClient {
    rpc: (
      fn: string,
      args: Record<string, string>
    ) => Promise<{ data: unknown; error: RpcErrorLike | null }>;
  }

  const rpcClient = supabaseService.getClient() as unknown as GscPropertyCandidatesRpcClient;
  const rpcResult = await rpcClient.rpc('get_gsc_property_candidates', {
    p_user_id: userId,
    p_normalized_url: normalizedUrl,
    p_start_date: startIso,
    p_end_date: endIso,
  });
  const data = Array.isArray(rpcResult?.data) ? (rpcResult.data as GscPropertyCandidateRow[]) : null;
  const error = rpcResult?.error ?? null;

  if (error) {
    throw new Error(error.message || 'クエリ指標のプロパティ探索に失敗しました');
  }

  if (!data || data.length === 0) {
    return {
      resolvedPropertyUri: preferredPropertyUri ?? null,
      bestPropertyUri: null,
      preferredInMetrics: false,
    };
  }

  const propertyUris = new Set<string>(data.map(row => row.property_uri).filter(Boolean) as string[]);
  const preferredInMetrics = Boolean(preferredPropertyUri && propertyUris.has(preferredPropertyUri));
  const bestPropertyUri = data.find(row => typeof row.property_uri === 'string')?.property_uri ?? null;

  return {
    resolvedPropertyUri: preferredInMetrics
      ? (preferredPropertyUri ?? null)
      : (bestPropertyUri ?? preferredPropertyUri ?? null),
    bestPropertyUri,
    preferredInMetrics,
  };
}

async function fetchQueryAnalysisRows(params: {
  userId: string;
  propertyUri: string;
  normalizedUrl: string;
  startIso: string;
  endIso: string;
  compStartIso: string;
  compEndIso: string;
}) {
  const { userId, propertyUri, normalizedUrl, startIso, endIso, compStartIso, compEndIso } = params;

  const { data, error } = await supabaseService.getClient().rpc('get_gsc_query_analysis', {
    p_user_id: userId,
    p_property_uri: propertyUri,
    p_normalized_url: normalizedUrl,
    p_start_date: startIso,
    p_end_date: endIso,
    p_comp_start_date: compStartIso,
    p_comp_end_date: compEndIso,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function registerEvaluation(params: {
  contentAnnotationId: string;
  propertyUri: string;
  baseEvaluationDate: string;
  cycleDays?: number;
  evaluationHour?: number;
}) {
  try {
    const authId = await getAuthUserId();
    if ('error' in authId) {
      return gscAuthErrorPayload(authId);
    }
    const { userId, role } = authId;
    if (await isViewModeEnabled(role ?? null)) {
      return { success: false, error: VIEW_MODE_ERROR_MESSAGE };
    }

    const { accessibleIds, error: accessCheckError } = await getAccessibleUserIds(userId);
    if (accessCheckError || !accessibleIds) {
      return { success: false, error: accessCheckError || ERROR_MESSAGES.AUTH.ACCESS_CHECK_FAILED };
    }

    const { contentAnnotationId, propertyUri, baseEvaluationDate, cycleDays, evaluationHour } =
      params;
    if (!contentAnnotationId || !propertyUri || !baseEvaluationDate) {
      return {
        success: false,
        error: ERROR_MESSAGES.GSC.REQUIRED_PARAMS_MISSING,
      };
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(baseEvaluationDate)) {
      return { success: false, error: ERROR_MESSAGES.GSC.INVALID_DATE_FORMAT_YYYYMMDD };
    }
    const evaluationDate = new Date(`${baseEvaluationDate}T00:00:00.000Z`);
    if (Number.isNaN(evaluationDate.getTime())) {
      return { success: false, error: ERROR_MESSAGES.GSC.INVALID_DATE };
    }

    const validatedCycleDays = cycleDays ?? 30;
    if (validatedCycleDays < 1 || validatedCycleDays > 365) {
      return { success: false, error: ERROR_MESSAGES.GSC.CYCLE_DAYS_INVALID };
    }

    const validatedEvaluationHour = evaluationHour ?? 12;
    if (validatedEvaluationHour < 0 || validatedEvaluationHour > 23) {
      return { success: false, error: ERROR_MESSAGES.GSC.EVALUATION_HOUR_INVALID };
    }

    const { data: annotation, error: annotationError } = await supabaseService
      .getClient()
      .from('content_annotations')
      .select('id, user_id')
      .eq('id', contentAnnotationId)
      .in('user_id', accessibleIds)
      .maybeSingle();

    if (annotationError) {
      throw new Error(annotationError.message || 'アノテーションの確認に失敗しました');
    }
    if (!annotation) {
      return { success: false, error: ERROR_MESSAGES.GSC.ARTICLE_NOT_FOUND };
    }

    const ownerUserId = annotation.user_id;

    const { data: existing, error: duplicateError } = await supabaseService
      .getClient()
      .from('gsc_article_evaluations')
      .select('id')
      .eq('user_id', ownerUserId)
      .eq('content_annotation_id', contentAnnotationId)
      .maybeSingle();

    if (duplicateError) {
      throw new Error(duplicateError.message || '重複チェックに失敗しました');
    }
    if (existing) {
      return { success: false, error: ERROR_MESSAGES.GSC.ARTICLE_ALREADY_REGISTERED };
    }

    const { error: insertError } = await supabaseService
      .getClient()
      .from('gsc_article_evaluations')
      .insert({
        user_id: ownerUserId,
        content_annotation_id: contentAnnotationId,
        property_uri: propertyUri,
        base_evaluation_date: baseEvaluationDate,
        cycle_days: validatedCycleDays,
        evaluation_hour: validatedEvaluationHour,
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

    if (insertError) {
      throw new Error(insertError.message || '評価対象の登録に失敗しました');
    }

    revalidatePath('/gsc-dashboard');
    return { success: true, data: { contentAnnotationId, baseEvaluationDate } };
  } catch (error) {
    console.error('[gsc-dashboard] register evaluation failed', error);
    const message = error instanceof Error ? error.message : ERROR_MESSAGES.GSC.EVALUATION_REGISTER_FAILED;
    return { success: false, error: message };
  }
}

export async function updateEvaluation(params: {
  contentAnnotationId: string;
  baseEvaluationDate: string;
  cycleDays?: number;
  evaluationHour?: number;
}) {
  try {
    const authId = await getAuthUserId();
    if ('error' in authId) {
      return gscAuthErrorPayload(authId);
    }
    const { userId, role } = authId;
    if (await isViewModeEnabled(role ?? null)) {
      return { success: false, error: VIEW_MODE_ERROR_MESSAGE };
    }

    const { accessibleIds, error: accessCheckError } = await getAccessibleUserIds(userId);
    if (accessCheckError || !accessibleIds) {
      return { success: false, error: accessCheckError || ERROR_MESSAGES.AUTH.ACCESS_CHECK_FAILED };
    }

    const { contentAnnotationId, baseEvaluationDate, cycleDays, evaluationHour } = params;
    if (!contentAnnotationId || !baseEvaluationDate) {
      return { success: false, error: ERROR_MESSAGES.GSC.REQUIRED_PARAMS_MISSING };
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(baseEvaluationDate)) {
      return { success: false, error: ERROR_MESSAGES.GSC.INVALID_DATE_FORMAT_YYYYMMDD };
    }
    const evaluationDate = new Date(`${baseEvaluationDate}T00:00:00.000Z`);
    if (Number.isNaN(evaluationDate.getTime())) {
      return { success: false, error: ERROR_MESSAGES.GSC.INVALID_DATE };
    }

    if (cycleDays !== undefined && (cycleDays < 1 || cycleDays > 365)) {
      return { success: false, error: ERROR_MESSAGES.GSC.CYCLE_DAYS_INVALID };
    }

    if (evaluationHour !== undefined && (evaluationHour < 0 || evaluationHour > 23)) {
      return { success: false, error: ERROR_MESSAGES.GSC.EVALUATION_HOUR_INVALID };
    }

    const { data: annotation, error: annotationError } = await supabaseService
      .getClient()
      .from('content_annotations')
      .select('user_id')
      .eq('id', contentAnnotationId)
      .in('user_id', accessibleIds)
      .maybeSingle();

    if (annotationError) {
      throw new Error(annotationError.message || '記事情報の取得に失敗しました');
    }
    if (!annotation) {
      return { success: false, error: ERROR_MESSAGES.GSC.ARTICLE_NOT_FOUND };
    }

    const ownerUserId = annotation.user_id;

    const { data: evaluation, error: evaluationError } = await supabaseService
      .getClient()
      .from('gsc_article_evaluations')
      .select('id')
      .eq('user_id', ownerUserId)
      .eq('content_annotation_id', contentAnnotationId)
      .maybeSingle();

    if (evaluationError) {
      throw new Error(evaluationError.message || '評価対象の確認に失敗しました');
    }

    if (!evaluation) {
      return { success: false, error: ERROR_MESSAGES.GSC.EVALUATION_NOT_FOUND };
    }

    const updateData: {
      base_evaluation_date: string;
      cycle_days?: number;
      evaluation_hour?: number;
      updated_at: string;
    } = {
      base_evaluation_date: baseEvaluationDate,
      updated_at: new Date().toISOString(),
    };
    if (cycleDays !== undefined) {
      updateData.cycle_days = cycleDays;
    }
    if (evaluationHour !== undefined) {
      updateData.evaluation_hour = evaluationHour;
    }

    const { error: updateError } = await supabaseService
      .getClient()
      .from('gsc_article_evaluations')
      .update(updateData)
      .eq('id', evaluation.id)
      .eq('user_id', ownerUserId);

    if (updateError) {
      throw new Error(updateError.message || '評価基準日の更新に失敗しました');
    }

    revalidatePath('/gsc-dashboard');
    return { success: true, data: { contentAnnotationId, baseEvaluationDate } };
  } catch (error) {
    console.error('[gsc-dashboard] update evaluation failed', error);
    const message = error instanceof Error ? error.message : ERROR_MESSAGES.GSC.EVALUATION_DATE_UPDATE_FAILED;
    return { success: false, error: message };
  }
}

// ============================================
// Query Analysis 用の型定義と関数
// ============================================

export interface QueryAggregation {
  query: string;
  queryNormalized: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  positionChange: number | null;
  clicksChange: number | null;
  wordCount: number;
}

export interface QueryAnalysisResponse {
  success: boolean;
  data?: {
    queries: QueryAggregation[];
    summary: {
      totalQueries: number;
      totalClicks: number;
      totalImpressions: number;
      avgPosition: number;
    };
    period: {
      start: string;
      end: string;
      comparisonStart: string;
      comparisonEnd: string;
    };
  };
  error?: string;
}

/**
 * クエリ別集計データを取得
 * @param annotationId - content_annotation_id
 * @param dateRange - '7d' | '28d' | '3m'
 */
export async function fetchQueryAnalysis(
  annotationId: string,
  dateRange: '7d' | '28d' | '3m' = '28d'
): Promise<QueryAnalysisResponse> {
  try {
    const authId = await getAuthUserId();
    if ('error' in authId) {
      return gscAuthErrorPayload(authId);
    }
    const { userId } = authId;

    const { accessibleIds, error: accessCheckError } = await getAccessibleUserIds(userId);
    if (accessCheckError || !accessibleIds) {
      return { success: false, error: accessCheckError || ERROR_MESSAGES.AUTH.ACCESS_CHECK_FAILED };
    }

    // 期間計算
    const days = dateRange === '7d' ? 7 : dateRange === '28d' ? 28 : 90;

    const { startIso, endIso } = buildGscDateRange(days);

    // 比較期間
    const compEndDate = new Date(`${startIso}T00:00:00.000Z`);
    compEndDate.setUTCDate(compEndDate.getUTCDate() - 1);
    const compStartDate = new Date(compEndDate);
    compStartDate.setUTCDate(compStartDate.getUTCDate() - days + 1);

    const compStartIso = compStartDate.toISOString().slice(0, 10);
    const compEndIso = compEndDate.toISOString().slice(0, 10);

    // annotationのnormalized_urlを取得（DBで自動生成された正規化済みURL）
    const { data: annotation, error: annotationError } = await supabaseService
      .getClient()
      .from('content_annotations')
      .select('user_id, normalized_url')
      .eq('id', annotationId)
      .in('user_id', accessibleIds)
      .maybeSingle();

    if (annotationError || !annotation?.normalized_url) {
      return { success: false, error: ERROR_MESSAGES.GSC.ARTICLE_NOT_FOUND_GENERIC };
    }

    const ownerUserId = annotation.user_id;

    // GSC Credential取得（既定のPropertyURI）
    const credential = await supabaseService.getGscCredentialByUserId(ownerUserId);
    if (!credential) {
      return { success: false, error: ERROR_MESSAGES.GSC.CREDENTIAL_NOT_FOUND };
    }
    const normalizedUrl = annotation.normalized_url;
    const preferredPropertyUri = credential.propertyUri ?? null;

    // 通常パスでは既定プロパティで即時取得し、空結果のときのみ重い候補探索を行う
    let rpcData: Awaited<ReturnType<typeof fetchQueryAnalysisRows>> = [];

    if (preferredPropertyUri) {
      rpcData = await fetchQueryAnalysisRows({
        userId: ownerUserId,
        propertyUri: preferredPropertyUri,
        normalizedUrl,
        startIso,
        endIso,
        compStartIso,
        compEndIso,
      });
    }

    if (rpcData.length === 0) {
      const propertyResolution = await resolveBestQueryPropertyUri({
        userId: ownerUserId,
        normalizedUrl,
        startIso,
        endIso,
        preferredPropertyUri,
      });
      const { resolvedPropertyUri, bestPropertyUri } = propertyResolution;

      if (!resolvedPropertyUri) {
        return { success: false, error: ERROR_MESSAGES.GSC.QUERY_METRICS_FETCH_FAILED };
      }

      // 既定プロパティで空だった場合のみ、候補プロパティへ切り替えて再取得
      const shouldRetryWithResolvedProperty =
        !preferredPropertyUri ||
        (resolvedPropertyUri !== preferredPropertyUri && bestPropertyUri === resolvedPropertyUri);

      if (shouldRetryWithResolvedProperty) {
        rpcData = await fetchQueryAnalysisRows({
          userId: ownerUserId,
          propertyUri: resolvedPropertyUri,
          normalizedUrl,
          startIso,
          endIso,
          compStartIso,
          compEndIso,
        });
        if (preferredPropertyUri && resolvedPropertyUri !== preferredPropertyUri && rpcData.length > 0) {
          console.warn('[gsc-dashboard] query analysis fallback property applied', {
            annotationId,
            fromPropertyUri: preferredPropertyUri,
            toPropertyUri: resolvedPropertyUri,
          });
        }
      }
    }

    // RPC結果をQueryAggregation形式に変換
    const queries: QueryAggregation[] = (rpcData ?? []).map(
      (row: {
        query: string;
        query_normalized: string;
        clicks: number;
        impressions: number;
        avg_ctr: number;
        avg_position: number;
        position_change: number | null;
        clicks_change: number | null;
        word_count: number;
      }) => ({
        query: row.query,
        queryNormalized: row.query_normalized,
        clicks: Number(row.clicks),
        impressions: Number(row.impressions),
        ctr: Number(row.avg_ctr),
        position: Number(row.avg_position),
        positionChange: row.position_change !== null ? Number(row.position_change) : null,
        clicksChange: row.clicks_change !== null ? Number(row.clicks_change) : null,
        wordCount: row.word_count,
      })
    );

    // サマリー計算（軽量RPCを使うことも可能だが、ここではクエリ数なども必要なため集計結果から算出）
    // 大量データの場合は get_gsc_query_summary を別途呼ぶ設計もありうるが、
    // 現状はフィルタ後の件数表示などにqueriesが必要なためこのまま。
    const totalClicks = queries.reduce((sum, q) => sum + q.clicks, 0);
    const totalImpressions = queries.reduce((sum, q) => sum + q.impressions, 0);
    const positionNumerator = queries.reduce((sum, q) => sum + q.position * q.impressions, 0);
    const avgPosition = totalImpressions > 0 ? positionNumerator / totalImpressions : 0;

    return {
      success: true,
      data: {
        queries,
        summary: {
          totalQueries: queries.length,
          totalClicks,
          totalImpressions,
          avgPosition,
        },
        period: {
          start: startIso,
          end: endIso,
          comparisonStart: compStartIso,
          comparisonEnd: compEndIso,
        },
      },
    };
  } catch (error) {
    console.error('[gsc-dashboard] fetch query analysis failed', error);
    const message = error instanceof Error ? error.message : ERROR_MESSAGES.GSC.QUERY_ANALYSIS_FETCH_FAILED;
    return { success: false, error: message };
  }
}

export async function runQueryImportForAnnotation(
  annotationId: string,
  options?: { days?: number }
) {
  try {
    const authId = await getAuthUserId();
    if ('error' in authId) {
      return gscAuthErrorPayload(authId);
    }
    const { userId, role } = authId;
    if (await isViewModeEnabled(role ?? null)) {
      return { success: false, error: VIEW_MODE_ERROR_MESSAGE };
    }

    const { accessibleIds, error: accessCheckError } = await getAccessibleUserIds(userId);
    if (accessCheckError || !accessibleIds) {
      return { success: false, error: accessCheckError || ERROR_MESSAGES.AUTH.ACCESS_CHECK_FAILED };
    }

    if (!annotationId) {
      return { success: false, error: ERROR_MESSAGES.GSC.ANNOTATION_ID_REQUIRED };
    }

    const { data: annotation, error: annotationError } = await supabaseService
      .getClient()
      .from('content_annotations')
      .select('id, user_id, canonical_url')
      .eq('id', annotationId)
      .in('user_id', accessibleIds)
      .maybeSingle();

    if (annotationError) {
      throw new Error(annotationError.message || '記事情報の取得に失敗しました');
    }
    if (!annotation?.canonical_url) {
      return { success: false, error: ERROR_MESSAGES.GSC.ARTICLE_URL_NOT_FOUND };
    }

    const ownerUserId = annotation.user_id;
    const credential = await supabaseService.getGscCredentialByUserId(ownerUserId);
    if (!credential?.propertyUri) {
      return { success: false, error: ERROR_MESSAGES.GSC.CREDENTIAL_NOT_FOUND };
    }
    if (!doesPropertyCoverUrl(credential.propertyUri, annotation.canonical_url)) {
      return {
        success: false,
        error: ERROR_MESSAGES.GSC.PROPERTY_URL_MISMATCH,
      };
    }

    const days = Math.min(180, Math.max(7, options?.days ?? 90));
    const { startIso, endIso } = buildGscDateRange(days);

    // URL変更時の整合性を守るため、インポート前に古い指標データをクリーンアップ
    const currentNormalizedUrl = normalizeUrl(annotation.canonical_url);
    if (!currentNormalizedUrl) {
      return { success: false, error: ERROR_MESSAGES.GSC.URL_NORMALIZE_FAILED };
    }
    const [hasOldQuery, hasOldPage] = await Promise.all([
      supabaseService.hasOldGscQueryMetrics(annotationId, currentNormalizedUrl),
      supabaseService.hasOldGscPageMetrics(annotationId, currentNormalizedUrl),
    ]);
    if (hasOldQuery) {
      await supabaseService.cleanupOldGscQueryMetrics(annotationId, currentNormalizedUrl);
    }
    if (hasOldPage) {
      await supabaseService.cleanupOldGscPageMetrics(annotationId, currentNormalizedUrl);
    }

    const summary = await gscImportService.importPageAndQueryForUrlWithSplit(ownerUserId, {
      startDate: startIso,
      endDate: endIso,
      pageUrl: annotation.canonical_url,
      contentAnnotationId: annotation.id,
      segmentDays: 30,
    });

    revalidatePath('/gsc-dashboard');
    return { success: true, data: summary };
  } catch (error) {
    console.error('[gsc-dashboard] run query import failed', error);
    const message = error instanceof Error ? error.message : ERROR_MESSAGES.GSC.QUERY_METRICS_FETCH_FAILED;
    return { success: false, error: message };
  }
}

/**
 * 今すぐ評価を実行（手動実行用）
 *
 * 評価期限に関係なく、ログインユーザーの全評価対象記事について：
 * 1. cycle_days 日分のデータをインポート
 * 2. 評価を実行（順位比較 + 改善提案生成）
 */
export async function runEvaluationNow(contentAnnotationId: string) {
  try {
    const authId = await getAuthUserId();
    if ('error' in authId) {
      return gscAuthErrorPayload(authId);
    }
    const { userId, role } = authId;
    if (await isViewModeEnabled(role ?? null)) {
      return { success: false, error: VIEW_MODE_ERROR_MESSAGE };
    }

    const { accessibleIds, error: accessCheckError } = await getAccessibleUserIds(userId);
    if (accessCheckError || !accessibleIds) {
      return { success: false, error: accessCheckError || ERROR_MESSAGES.AUTH.ACCESS_CHECK_FAILED };
    }

    if (!contentAnnotationId) {
      return { success: false, error: ERROR_MESSAGES.GSC.ANNOTATION_ID_REQUIRED };
    }

    const { data: annotation, error: annotationError } = await supabaseService
      .getClient()
      .from('content_annotations')
      .select('user_id')
      .eq('id', contentAnnotationId)
      .in('user_id', accessibleIds)
      .maybeSingle();

    if (annotationError) {
      throw new Error(annotationError.message || '記事情報の取得に失敗しました');
    }
    if (!annotation) {
      return { success: false, error: ERROR_MESSAGES.GSC.ARTICLE_NOT_FOUND };
    }

    // 動的インポートで循環参照を回避
    const { gscEvaluationService } = await import('@/server/services/gscEvaluationService');

    const ownerUserId = annotation.user_id;

    // 手動実行なので force: true で評価期限をスキップ
    const summary = await gscEvaluationService.runDueEvaluationsForUser(ownerUserId, {
      force: true,
      contentAnnotationId,
    });

    revalidatePath('/gsc-dashboard');
    revalidatePath('/analytics');

    return {
      success: true,
      data: summary,
    };
  } catch (error) {
    console.error('[gsc-dashboard] run evaluation now failed', error);
    const message = error instanceof Error ? error.message : ERROR_MESSAGES.GSC.EVALUATION_PROCESS_FAILED;
    return { success: false, error: message };
  }
}
