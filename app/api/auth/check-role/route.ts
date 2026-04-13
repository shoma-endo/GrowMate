import { NextResponse } from 'next/server';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { resolveEmailUserWithReason } from '@/server/auth/resolveUser';
import { nextJson409EmailLinkConflict } from '@/server/middleware/authMiddlewareGuards';

// Node.jsランタイムを強制（Supabase Service Role クライアントが Edge Runtime 非対応のため）
export const runtime = 'nodejs';

export async function GET() {
  try {
    const result = await resolveEmailUserWithReason();
    if (result.ok) {
      return NextResponse.json({ role: result.user.role });
    }
    if (result.reason === 'unauthenticated') {
      return NextResponse.json({ error: ERROR_MESSAGES.AUTH.NOT_AUTHENTICATED }, { status: 401 });
    }
    if (result.reason === 'email_link_conflict') {
      return nextJson409EmailLinkConflict();
    }
    return NextResponse.json(
      { error: ERROR_MESSAGES.AUTH.USER_ROLE_FETCH_FAILED },
      { status: 503 }
    );
  } catch (error) {
    console.error('Role check API error:', error);
    return NextResponse.json({ error: ERROR_MESSAGES.COMMON.SERVER_ERROR }, { status: 503 });
  }
}
