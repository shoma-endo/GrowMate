import { NextRequest, NextResponse } from 'next/server';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { nextJson409IfEmailLinkConflict } from '@/server/middleware/authMiddlewareGuards';
import { SupabaseService } from '@/server/services/supabaseService';
import {
  isViewModeEnabled,
  resolveViewModeRole,
  VIEW_MODE_ERROR_MESSAGE,
} from '@/server/lib/view-mode';
import { getLiffTokensFromRequest } from '@/server/lib/auth-helpers';

const supabaseService = new SupabaseService();

interface UpdateEvaluationRequest {
  contentAnnotationId: string;
  baseEvaluationDate: string; // YYYY-MM-DD - 評価基準日
}

/**
 * 評価対象の基準日を更新
 */
export async function POST(request: NextRequest) {
  try {
    const { accessToken: liffAccessToken, refreshToken } = getLiffTokensFromRequest(request);

    // liffAccessToken がない場合も authMiddleware が Supabase Email セッションで解決する
    const authResult = await authMiddleware(liffAccessToken, refreshToken);
    const conflict409 = nextJson409IfEmailLinkConflict(authResult);
    if (conflict409) return conflict409;
    if (authResult.error || !authResult.userId) {
      return NextResponse.json(
        { success: false, error: authResult.error || 'ユーザー認証に失敗しました' },
        { status: 401 }
      );
    }
    if (await isViewModeEnabled(resolveViewModeRole(authResult))) {
      return NextResponse.json(
        { success: false, error: VIEW_MODE_ERROR_MESSAGE },
        { status: 403 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as Partial<UpdateEvaluationRequest>;
    const { contentAnnotationId, baseEvaluationDate } = body;

    // バリデーション
    if (!contentAnnotationId || !baseEvaluationDate) {
      return NextResponse.json(
        { success: false, error: 'contentAnnotationId, baseEvaluationDate は必須です' },
        { status: 400 }
      );
    }

    // 日付形式チェック (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(baseEvaluationDate)) {
      return NextResponse.json(
        { success: false, error: '日付は YYYY-MM-DD 形式で指定してください' },
        { status: 400 }
      );
    }

    // 日付の妥当性チェック
    const evaluationDate = new Date(`${baseEvaluationDate}T00:00:00.000Z`);
    if (Number.isNaN(evaluationDate.getTime())) {
      return NextResponse.json(
        { success: false, error: '無効な日付が指定されました' },
        { status: 400 }
      );
    }

    const userId = authResult.userId;

    // 評価対象の存在確認
    const { data: evaluation, error: evaluationError } = await supabaseService
      .getClient()
      .from('gsc_article_evaluations')
      .select('id')
      .eq('user_id', userId)
      .eq('content_annotation_id', contentAnnotationId)
      .maybeSingle();

    if (evaluationError) {
      throw new Error(evaluationError.message || '評価対象の確認に失敗しました');
    }

    if (!evaluation) {
      return NextResponse.json(
        { success: false, error: '評価対象が見つかりません' },
        { status: 404 }
      );
    }

    // 評価基準日を更新
    const { error: updateError } = await supabaseService
      .getClient()
      .from('gsc_article_evaluations')
      .update({
        base_evaluation_date: baseEvaluationDate,
        updated_at: new Date().toISOString(),
      })
      .eq('id', evaluation.id)
      .eq('user_id', userId);

    if (updateError) {
      throw new Error(updateError.message || '評価基準日の更新に失敗しました');
    }

    return NextResponse.json({
      success: true,
      data: {
        contentAnnotationId,
        baseEvaluationDate,
      },
    });
  } catch (error) {
    console.error('[gsc/evaluations/update] Update failed', error);
    const message = error instanceof Error ? error.message : '評価日の更新に失敗しました';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
