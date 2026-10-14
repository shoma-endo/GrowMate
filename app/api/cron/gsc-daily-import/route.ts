import { NextRequest, NextResponse } from 'next/server';
import { CRON_DEFINITIONS } from '@/server/lib/cron-definitions';
import { gscImportService } from '@/server/services/gscImportService';

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      console.error('[cron/gsc-daily-import] CRON_SECRET is not configured');
      return NextResponse.json({ success: false, error: 'Cron secret not configured' }, { status: 500 });
    }
    if (request.headers.get('authorization') !== `Bearer ${secret}`) {
      console.warn('[cron/gsc-daily-import] Unauthorized request');
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ success: true, data: await gscImportService.runDailyBatch() });
  } catch (error) {
    CRON_DEFINITIONS.gscDailyImport.logRouteFailure(error, startedAt);
    console.error('[cron/gsc-daily-import] Batch failed:', error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Batch failed' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
export const maxDuration = 800;
