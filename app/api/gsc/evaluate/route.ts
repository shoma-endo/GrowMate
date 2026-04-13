import { NextResponse } from 'next/server';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { nextJson409IfEmailLinkConflict } from '@/server/middleware/authMiddlewareGuards';
import { gscEvaluationService } from '@/server/services/gscEvaluationService';


/**
 * GSC 評価実行 API（手動実行用）
 *
 * 認証済みユーザーの評価対象記事について：
 * 1. cycle_days 日分のデータをインポート
 * 2. 評価を実行（順位比較 + 改善提案生成）
 *
 * Cron バッチと同じロジックを使用。
 */
export async function POST() {
  try {
    const authResult = await authMiddleware();
    const conflict409 = nextJson409IfEmailLinkConflict(authResult);
    if (conflict409) return conflict409;
    if (authResult.error || !authResult.userId) {
      return NextResponse.json(
        { success: false, error: authResult.error || 'ユーザー認証に失敗しました' },
        { status: 401 }
      );
    }
    // Cron バッチと同じロジックで評価を実行
    // （cycle_days 日分のデータインポート + 評価）
    const summary = await gscEvaluationService.runDueEvaluationsForUser(authResult.userId);

    return NextResponse.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error('[gsc/evaluate] Evaluation failed', error);
    const message = error instanceof Error ? error.message : '評価処理に失敗しました';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
