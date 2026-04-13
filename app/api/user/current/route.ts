import { NextResponse } from 'next/server';

import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { nextJson409EmailLinkConflict } from '@/server/middleware/authMiddlewareGuards';
import { resolveEmailUserWithReason } from '@/server/auth/resolveUser';

export async function GET() {
  const result = await resolveEmailUserWithReason();
  if (!result.ok) {
    if (result.reason === 'transient') {
      return NextResponse.json({ error: ERROR_MESSAGES.USER.SERVICE_UNAVAILABLE }, { status: 503 });
    }
    if (result.reason === 'email_link_conflict') {
      return nextJson409EmailLinkConflict({ userId: null, user: null });
    }
    return NextResponse.json({ userId: null, user: null });
  }

  const emailUser = result.user;
  return NextResponse.json({
    userId: emailUser.id,
    user: {
      id: emailUser.id,
      fullName: emailUser.fullName ?? null,
      email: emailUser.email ?? null,
      role: emailUser.role,
      lineUserId: emailUser.lineUserId ?? null,
      lineDisplayName: emailUser.lineDisplayName ?? null,
      linePictureUrl: emailUser.linePictureUrl ?? null,
    },
    viewMode: false,
    tokenRefreshed: false,
    authMethod: 'email',
  });
}
