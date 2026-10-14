import { NextRequest, NextResponse } from 'next/server';
import { CRON_DEFINITIONS } from '@/server/lib/cron-definitions';
import { ga4ImportService } from '@/server/services/ga4ImportService';

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) return NextResponse.json({ success: false, error: 'Cron secret not configured' }, { status: 500 });
    if (request.headers.get('authorization') !== `Bearer ${secret}`) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ success: true, data: await ga4ImportService.runBatch() });
  } catch (error) {
    CRON_DEFINITIONS.ga4DailySync.logRouteFailure(error, startedAt);
    console.error('[cron/ga4-daily-sync] Batch failed:', error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Batch failed' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
export const maxDuration = 800;
