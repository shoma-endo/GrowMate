import { NextRequest, NextResponse } from 'next/server';
import { gscSuggestionJobService } from '@/server/services/gscSuggestionJobService';
import { CRON_DEFINITIONS } from '@/server/lib/cron-definitions';

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      console.error('[cron/gsc-suggestions] CRON_SECRET is not configured');
      return NextResponse.json(
        { success: false, error: 'Cron secret not configured' },
        { status: 500 }
      );
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[cron/gsc-suggestions] Unauthorized request');
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const result = await gscSuggestionJobService.runNextJobs();
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    CRON_DEFINITIONS.gscSuggestions.logRouteFailure(error, startedAt);
    console.error('[cron/gsc-suggestions] Batch failed:', error);
    const message = error instanceof Error ? error.message : 'バッチ処理に失敗しました';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
