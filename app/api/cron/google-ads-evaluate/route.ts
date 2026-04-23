import { NextRequest, NextResponse } from 'next/server';
import { formatLocalDateYMD } from '@/lib/date-utils';
import { SupabaseService } from '@/server/services/supabaseService';
import { googleAdsAiAnalysisService } from '@/server/services/googleAdsAiAnalysisService';

const BATCH_LIMIT = 10;
const TIMEOUT_GUARD_MS = 250_000;

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      console.error('[cron/google-ads-evaluate] CRON_SECRET is not configured');
      return NextResponse.json(
        { success: false, error: 'Cron secret not configured' },
        { status: 500 }
      );
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[cron/google-ads-evaluate] Unauthorized request');
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const startedAt = Date.now();
    const todayJst = formatLocalDateYMD(new Date());
    const supabaseService = new SupabaseService();
    const dueUsersResult = await supabaseService.listDueGoogleAdsEvaluationUsers(todayJst, BATCH_LIMIT);

    if (!dueUsersResult.success) {
      return NextResponse.json(
        { success: false, error: dueUsersResult.error.userMessage },
        { status: 500 }
      );
    }

    const summary = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      timedOut: false,
      failedUserIds: [] as string[],
    };

    for (const user of dueUsersResult.data) {
      if (Date.now() - startedAt > TIMEOUT_GUARD_MS) {
        summary.timedOut = true;
        console.warn('[cron/google-ads-evaluate] Timeout reached, aborting loop', {
          startedAt,
          timeoutGuardMs: TIMEOUT_GUARD_MS,
          now: Date.now(),
        });
        break;
      }

      summary.processed += 1;
      try {
        const result = await googleAdsAiAnalysisService.analyzeAndSend(user.userId, {
          dateRangeDays: user.dateRangeDays,
        });

        if (result.success && result.skipped) {
          summary.skipped += 1;
        } else if (result.success) {
          summary.succeeded += 1;
        } else {
          summary.failed += 1;
          summary.failedUserIds.push(user.userId);
        }
      } catch (error) {
        console.error('[cron/google-ads-evaluate] User batch item failed:', {
          userId: user.userId,
          error,
        });
        summary.failed += 1;
        summary.failedUserIds.push(user.userId);
      }
    }

    console.info('[cron/google-ads-evaluate] Batch completed', {
      startedAt,
      finishedAt: Date.now(),
      todayJst,
      processed: summary.processed,
      succeeded: summary.succeeded,
      failed: summary.failed,
      skipped: summary.skipped,
      timedOut: summary.timedOut,
      failedUserIds: summary.failedUserIds,
    });

    return NextResponse.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error('[cron/google-ads-evaluate] Batch failed:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
