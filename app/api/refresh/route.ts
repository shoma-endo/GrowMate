import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { clearAuthCookies, refreshTokens, setAuthCookies } from '@/server/middleware/auth.middleware';

export async function POST() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get('line_refresh_token')?.value;

  if (!refreshToken) {
    return NextResponse.json({ error: ERROR_MESSAGES.AUTH.NO_REFRESH_TOKEN }, { status: 401 });
  }

  const result = await refreshTokens(refreshToken);

  if (!result.success || !result.accessToken) {
    if (result.status === 400 || result.status === 401) {
      await clearAuthCookies();
      return NextResponse.json(
        {
          error: result.error || ERROR_MESSAGES.AUTH.REFRESH_TOKEN_INVALID,
          requires_login: true,
        },
        { status: result.status ?? 400 }
      );
    }

    return NextResponse.json(
      {
        error: result.error || ERROR_MESSAGES.AUTH.LINE_TOKEN_REFRESH_FAILED,
      },
      { status: result.status ?? 500 }
    );
  }

  await setAuthCookies(result.accessToken, result.refreshToken);

  return NextResponse.json({ message: ERROR_MESSAGES.COMMON.TOKEN_REFRESHED });
}
