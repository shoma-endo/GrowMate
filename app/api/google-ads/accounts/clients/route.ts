import { type NextRequest, NextResponse } from 'next/server';
import { GoogleAdsService } from '@/server/services/googleAdsService';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { ensureGoogleAdsAuth, refreshGoogleAdsTokenIfNeeded } from '@/server/lib/google-auth';

export const dynamic = 'force-dynamic';

/**
 * マネージャーアカウント配下のクライアントアカウント一覧を取得
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const managerCustomerId = searchParams.get('managerCustomerId')?.replace(/\D/g, '') ?? null;

    if (!managerCustomerId) {
      return NextResponse.json(
        { error: ERROR_MESSAGES.GOOGLE_ADS.MISSING_PARAMS },
        { status: 400 }
      );
    }

    // 認証・権限チェックと認証情報取得
    const authResult = await ensureGoogleAdsAuth();
    if (!authResult.success) {
      return authResult.response;
    }

    const { userId, credential } = authResult;

    // アクセストークンが期限切れの場合はリフレッシュ
    const tokenResult = await refreshGoogleAdsTokenIfNeeded(userId, credential);
    if (!tokenResult.success) {
      return tokenResult.response;
    }
    const accessToken = tokenResult.accessToken;

    // クライアントアカウント一覧を取得
    const googleAdsService = new GoogleAdsService();
    try {
      const clientAccounts = await googleAdsService.getClientAccounts(
        managerCustomerId,
        accessToken
      );

      return NextResponse.json({
        accounts: clientAccounts,
      });
    } catch (apiError) {
      console.error('Failed to fetch client accounts:', apiError);
      return NextResponse.json(
        { error: ERROR_MESSAGES.GOOGLE_ADS.ACCOUNT_LIST_FETCH_FAILED },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error in client accounts API:', error);
    return NextResponse.json({ error: ERROR_MESSAGES.GOOGLE_ADS.SERVER_ERROR }, { status: 500 });
  }
}
