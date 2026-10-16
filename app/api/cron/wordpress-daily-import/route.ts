import { NextRequest, NextResponse } from 'next/server';
import { CRON_DEFINITIONS } from '@/server/lib/cron-definitions';
import { wordpressImportService } from '@/server/services/wordpressImportService';

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      console.error('[cron/wordpress-daily-import] CRON_SECRET is not configured');
      return NextResponse.json({ success: false, error: 'Cron secret not configured' }, { status: 500 });
    }
    if (request.headers.get('authorization') !== `Bearer ${secret}`) {
      console.warn('[cron/wordpress-daily-import] Unauthorized request');
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ success: true, data: await wordpressImportService.runDailyBatch() });
  } catch (error) {
    CRON_DEFINITIONS.wordpressDailyImport.logRouteFailure(error, startedAt);
    console.error('[cron/wordpress-daily-import] Batch failed:', error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Batch failed' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
// 記事の多いサイトの初回全件取込を1回で終えるため、Pro の拡張上限（ベータ）を使う
export const maxDuration = 1800;
