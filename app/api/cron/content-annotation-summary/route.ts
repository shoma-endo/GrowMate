import { NextRequest, NextResponse } from 'next/server';
import { CRON_DEFINITIONS } from '@/server/lib/cron-definitions';
import { contentAnnotationSummaryJobService } from '@/server/services/contentAnnotationSummaryJobService';

/**
 * AI要約一括のバックグラウンド実行 Cron エンドポイント
 * （docs/plans/content-annotation-bulk-summary-background-spec.md §9）
 *
 * GitHub Actions（`.github/workflows/content-annotation-summary-cron.yml`）が10分ごとに
 * GET で呼び出す。1起動で行うのは次の順序:
 *   1. 未通知で終了済みのジョブの掃き出し（**claim の前**。claim RPC が failed に落とした行は
 *      アプリ層が一度も見ないため、ここが無いと通知が永久に届かない）
 *   2. 未処理ジョブを1件 claim
 *   3. 時間予算の範囲で、配列順に3件ずつのチャンクで要約を生成
 *
 * 認証: CRON_SECRET による Bearer トークン認証（既存 `/api/cron/*` と同型）。
 * 成功時の応答本文には集計値のみを含め、記事タイトル・URL・要約結果・メールアドレス等の
 * 利用者データは一切含めない。
 *
 * **時間予算の起点はこのハンドラの開始時刻**（BR-B04）。claim 完了時刻を起点にすると、
 * 掃き出しに要した時間の分だけ maxDuration に対する返却バッファを食い潰す。
 */
export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      console.error('[cron/content-annotation-summary] CRON_SECRET is not configured');
      return NextResponse.json(
        { success: false, error: 'Cron secret not configured' },
        { status: 500 }
      );
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[cron/content-annotation-summary] Unauthorized request');
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const result = await contentAnnotationSummaryJobService.runNextJob(startedAt);

    // `success` は「運用が気づくべき失敗が1件も無いか」。記事単位の失敗は正常系なので含めない
    // （`result.failed` にも記事単位は入らない。§9「前例からの意図的な差分」）。
    return NextResponse.json({
      success: result.failed === 0,
      data: result,
    });
  } catch (error) {
    CRON_DEFINITIONS.contentAnnotationSummary.logRouteFailure(error, startedAt);
    console.error('[cron/content-annotation-summary] Batch failed:', error);
    const message = error instanceof Error ? error.message : 'バッチ処理に失敗しました';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// GitHub Actions の invoke-cron.sh は GET で呼び出す
export const dynamic = 'force-dynamic';
// 値は src/lib/constants.ts の CONTENT_ANNOTATION_BULK_SUMMARY_MAX_DURATION_SEC と必ず一致させること。
// route segment config は静的解析のため import 定数を使えず、ここはリテラル必須。
export const maxDuration = 800;
