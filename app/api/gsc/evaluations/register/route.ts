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

interface RegisterEvaluationRequest {
  contentAnnotationId: string;
  propertyUri: string;
  baseEvaluationDate: string; // YYYY-MM-DD - 評価基準日
}

/**
 * 記事を評価対象として登録
 */
export async function POST(request: NextRequest) {
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
    if (await isViewModeEnabled(resolveViewModeRole(authResult))) {
      return NextResponse.json(
        { success: false, error: VIEW_MODE_ERROR_MESSAGE },
        { status: 403 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as Partial<RegisterEvaluationRequest>;
    const { contentAnnotationId, propertyUri, baseEvaluationDate } = body;

    // バリデーション
    if (!contentAnnotationId || !propertyUri || !baseEvaluationDate) {
      return NextResponse.json(
        { success: false, error: 'contentAnnotationId, propertyUri, baseEvaluationDate は必須です' },
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

    // content_annotation の存在確認
    const { data: annotation, error: annotationError } = await supabaseService
      .getClient()
      .from('content_annotations')
      .select('id')
      .eq('id', contentAnnotationId)
      .eq('user_id', userId)
      .maybeSingle();

    if (annotationError) {
      throw new Error(annotationError.message || 'アノテーションの確認に失敗しました');
    }

    if (!annotation) {
      return NextResponse.json(
        { success: false, error: '指定された記事が見つかりません' },
        { status: 404 }
      );
    }

    // 重複チェック
    const { data: existing, error: duplicateError } = await supabaseService
      .getClient()
      .from('gsc_article_evaluations')
      .select('id')
      .eq('user_id', userId)
      .eq('content_annotation_id', contentAnnotationId)
      .maybeSingle();

    if (duplicateError) {
      throw new Error(duplicateError.message || '重複チェックに失敗しました');
    }

    if (existing) {
      return NextResponse.json(
        { success: false, error: 'この記事は既に評価対象として登録されています' },
        { status: 409 }
      );
    }

    // 評価対象として登録
    const { error: insertError } = await supabaseService
      .getClient()
      .from('gsc_article_evaluations')
      .insert({
        user_id: userId,
        content_annotation_id: contentAnnotationId,
        property_uri: propertyUri,
        base_evaluation_date: baseEvaluationDate,
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

    if (insertError) {
      throw new Error(insertError.message || '評価対象の登録に失敗しました');
    }

    return NextResponse.json({
      success: true,
      data: {
        contentAnnotationId,
        baseEvaluationDate,
      },
    });
  } catch (error) {
    console.error('[gsc/evaluations/register] Registration failed', error);
    const message = error instanceof Error ? error.message : '評価対象の登録に失敗しました';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
