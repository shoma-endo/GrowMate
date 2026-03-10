import { NextRequest, NextResponse } from 'next/server';
import { gscEvaluationService } from '@/server/services/gscEvaluationService';

/**
 * GSC 評価バッチ Cron エンドポイント
 *
 * Vercel Cron により毎時0分に呼び出される。
 * 「次回評価予定日時 <= 現在日時」のユーザーのみ評価を実行する。
 *
 * 認証: CRON_SECRET による Bearer トークン認証
 */
export async function GET(request: NextRequest) {
  try {
    // Vercel Cron からのリクエストを認証
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      console.error('[cron/gsc-evaluate] CRON_SECRET is not configured');
      return NextResponse.json(
        { success: false, error: 'Cron secret not configured' },
        { status: 500 }
      );
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[cron/gsc-evaluate] Unauthorized request');
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // 次回評価予定日時に達した全ユーザーの評価を実行
    const result = await gscEvaluationService.runAllDueEvaluations();

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[cron/gsc-evaluate] Batch failed:', error);
    const message = error instanceof Error ? error.message : 'バッチ処理に失敗しました';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// Vercel Cron は GET リクエストを使用
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 300秒（Vercel Pro は最大800秒まで対応）
