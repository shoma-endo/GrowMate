import { NextRequest, NextResponse } from 'next/server';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { getLiffTokensFromRequest } from '@/server/lib/auth-helpers';
import { ga4ImportService } from '@/server/services/ga4ImportService';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { canWriteGa4 } from '@/server/lib/ga4-permissions';

export async function POST(request: NextRequest) {
  const { accessToken, refreshToken } = getLiffTokensFromRequest(request);
  const authResult = await authMiddleware(accessToken, refreshToken);

  if (authResult.error || !authResult.userId) {
    return NextResponse.json(
      { success: false, error: authResult.error || ERROR_MESSAGES.AUTH.USER_AUTH_FAILED },
      { status: 401 }
    );
  }

  if (
    !canWriteGa4({
      role: authResult.userDetails?.role ?? null,
      ownerUserId: authResult.ownerUserId,
      viewMode: authResult.viewMode ?? false,
    })
  ) {
    return NextResponse.json(
      { success: false, error: ERROR_MESSAGES.AUTH.OWNER_ACCOUNT_REQUIRED },
      { status: 403 }
    );
  }

  try {
    const result = await ga4ImportService.syncUser(authResult.userId);
    if (!result.ok && result.reason === 'not_connected') {
      return NextResponse.json(
        { success: false, error: ERROR_MESSAGES.GA4.NOT_CONNECTED },
        { status: 400 }
      );
    }
    if (!result.ok && result.reason === 'already_synced') {
      return NextResponse.json({
        success: true,
        data: null,
        alreadySynced: true,
      });
    }
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: ERROR_MESSAGES.GA4.SYNC_FAILED },
        { status: 500 }
      );
    }
    return NextResponse.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    console.error('[ga4/sync] manual sync failed', error);
    return NextResponse.json(
      { success: false, error: ERROR_MESSAGES.GA4.SYNC_FAILED },
      { status: 500 }
    );
  }
}
