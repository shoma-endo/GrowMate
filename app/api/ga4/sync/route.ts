import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { ga4ImportService } from '@/server/services/ga4ImportService';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { nextJson409IfEmailLinkConflict } from '@/server/middleware/authMiddlewareGuards';
import { canWriteGa4 } from '@/server/lib/ga4-permissions';
import { ga4SyncRequestSchema } from '@/server/schemas/ga4.schema';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const requestBody: unknown = await request.json().catch(() => ({}));
  const authResult = await authMiddleware();

  const conflict409 = nextJson409IfEmailLinkConflict(authResult);
  if (conflict409) return conflict409;
  if (authResult.error || !authResult.userId) {
    return NextResponse.json(
      { success: false, error: authResult.error || ERROR_MESSAGES.AUTH.USER_AUTH_FAILED },
      { status: 401 }
    );
  }

  if (
    !canWriteGa4({
      role: authResult.userDetails?.role ?? null,
    })
  ) {
    return NextResponse.json(
      { success: false, error: ERROR_MESSAGES.AUTH.UNAUTHORIZED },
      { status: 403 }
    );
  }

  const parsedRequest = ga4SyncRequestSchema.safeParse(requestBody);
  if (!parsedRequest.success) {
    console.error('[ga4/sync] invalid request body', z.prettifyError(parsedRequest.error));
    return NextResponse.json(
      { success: false, error: ERROR_MESSAGES.COMMON.VALIDATION_FAILED },
      { status: 400 }
    );
  }

  try {
    const result = await ga4ImportService.syncUser(authResult.userId, parsedRequest.data);
    if (!result.ok && result.reason === 'not_connected') {
      return NextResponse.json(
        { success: false, error: ERROR_MESSAGES.GA4.NOT_CONNECTED },
        { status: 400 }
      );
    }
    if (!result.ok && result.reason === 'already_synced') {
      return NextResponse.json({
        success: true,
        data: { alreadySynced: true as const },
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
