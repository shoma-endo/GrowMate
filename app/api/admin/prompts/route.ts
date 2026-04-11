import { NextRequest, NextResponse } from 'next/server';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { isAdmin } from '@/authUtils';
import { PromptService } from '@/server/services/promptService';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { nextJson409IfEmailLinkConflict } from '@/server/middleware/authMiddlewareGuards';
import { getLiffTokensFromRequest } from '@/server/lib/auth-helpers';

export async function GET(request: NextRequest) {
  try {
    const { accessToken: liffAccessToken, refreshToken } = getLiffTokensFromRequest(request);

    // liffAccessToken がない場合も authMiddleware が Supabase Email セッションで解決する
    const authResult = await authMiddleware(liffAccessToken, refreshToken, { allowEmailFallback: true });
    const conflict409 = nextJson409IfEmailLinkConflict(authResult);
    if (conflict409) return conflict409;
    if (authResult.error) {
      return NextResponse.json(
        { success: false, error: 'ユーザー認証に失敗しました' },
        { status: 401 }
      );
    }

    const role = authResult.userDetails?.role ?? null;
    if (!isAdmin(role)) {
      return NextResponse.json({ success: false, error: '権限がありません' }, { status: 403 });
    }

    const templates = await PromptService.getAllTemplates();
    return NextResponse.json({ success: true, data: templates });
  } catch (error) {
    console.error('Admin prompts list API error:', error);
    return NextResponse.json(
      { success: false, error: ERROR_MESSAGES.COMMON.SERVER_ERROR },
      { status: 500 }
    );
  }
}
