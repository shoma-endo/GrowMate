import { NextRequest, NextResponse } from 'next/server';
import { ga4ContentEvaluationBatchService } from '@/server/services/ga4ContentEvaluationBatchService';
import { CRON_DEFINITIONS } from '@/server/lib/cron-definitions';

/**
 * GA4コンテンツ評価 定期バッチ Cron エンドポイント（docs/plans/ga4-content-evaluation-spec.md §8.3）
 *
 * GitHub Actions（`.github/workflows/hourly-cron.yml`）が毎時0分に GET で呼び出す。
 * 「GA4の次回評価予定日時 <= 現在日時」の記事のみ評価を実行する。
 *
 * スケジュール（基準日・サイクル日数・実行時刻）はGSC検索順位評価と同じ gsc_article_evaluations の
 * 1行が正で、GA4は実行進捗（ga4_last_evaluated_on）だけを系統別に持つ（2026-08-26 サイクル統合）。
 * gsc-evaluate と同じ毎時実行に並んで走るが、互いの進捗列には触れない。
 *
 * 認証: CRON_SECRET による Bearer トークン認証。
 * セッションが存在しないため、ロールとGA4連携状態の絞り込みは due 抽出の SQL（§8.3 手順1）で行う。
 * 成功時の応答本文には集計値のみを含め、記事タイトル・URL・評価結果・メールアドレス等の
 * ユーザーデータは一切含めない（§3.3 Cron Route Handler の例外）。
 */
export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      console.error('[cron/ga4-content-evaluate] CRON_SECRET is not configured');
      return NextResponse.json(
        { success: false, error: 'Cron secret not configured' },
        { status: 500 }
      );
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[cron/ga4-content-evaluate] Unauthorized request');
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const result = await ga4ContentEvaluationBatchService.runAllDueEvaluations();

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    CRON_DEFINITIONS.ga4ContentEvaluate.logRouteFailure(error, startedAt);
    console.error('[cron/ga4-content-evaluate] Batch failed:', error);
    const message = error instanceof Error ? error.message : 'バッチ処理に失敗しました';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// GitHub Actions の invoke-cron.sh は GET で呼び出す
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
