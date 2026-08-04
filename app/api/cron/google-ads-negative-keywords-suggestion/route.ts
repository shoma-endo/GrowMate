import { NextRequest, NextResponse } from 'next/server';
import { googleAdsNegativeKeywordsSuggestionService } from '@/server/services/googleAdsNegativeKeywordsSuggestionService';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      console.error('[cron/google-ads-negative-keywords-suggestion] CRON_SECRET is not configured');
      return NextResponse.json(
        { success: false, error: 'Cron secret not configured' },
        { status: 500 }
      );
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[cron/google-ads-negative-keywords-suggestion] Unauthorized request');
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const result = await googleAdsNegativeKeywordsSuggestionService.runAllDueSuggestions();

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[cron/google-ads-negative-keywords-suggestion] Batch failed:', error);
    const message = error instanceof Error ? error.message : 'バッチ処理に失敗しました';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
// 1ユーザーあたり LLM 呼び出しに約2分かかるため、300秒では数ユーザーで枯渇する。
// 800秒（Vercel Pro の Fluid Compute 上限）まで広げ、サービス側の時間予算で安全に打ち切る。
// Next.js の segment config はリテラルしか受け付けないため定数を import できない。
// サービス側の NEGATIVE_KEYWORDS_CRON_MAX_DURATION_SEC と一致していることをテストで担保する。
export const maxDuration = 800;
