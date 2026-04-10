import { NextRequest, NextResponse } from 'next/server';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { isAdmin } from '@/authUtils';
import { PromptService } from '@/server/services/promptService';
import { ChatError, ChatErrorCode } from '@/domain/errors/ChatError';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { nextJson409IfEmailLinkConflict } from '@/server/middleware/authMiddlewareGuards';
import { z } from 'zod';
import {
  isViewModeEnabled,
  resolveViewModeRole,
  VIEW_MODE_ERROR_MESSAGE,
} from '@/server/lib/view-mode';
import { getLiffTokensFromRequest } from '@/server/lib/auth-helpers';

const promptVariableSchema = z.object({
  name: z.string(),
  description: z.string(),
});

const promptSchema = z.object({
  name: z.string(),
  display_name: z.string(),
  content: z.string(),
  variables: z.array(promptVariableSchema).default([]),
});

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const bearer = authHeader?.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : undefined;
    const { accessToken: cookieAccessToken, refreshToken } = getLiffTokensFromRequest(request);
    const liffAccessToken = bearer || cookieAccessToken;

    // liffAccessToken がない場合も authMiddleware が Supabase Email セッションで解決する
    const authResult = await authMiddleware(liffAccessToken, refreshToken);
    const conflict409get = nextJson409IfEmailLinkConflict(authResult);
    if (conflict409get) return conflict409get;
    if (authResult.error) {
      const isTokenExpired = authResult.error.includes('expired');
      const errorCode = isTokenExpired ? ChatErrorCode.TOKEN_EXPIRED : ChatErrorCode.AUTHENTICATION_FAILED;
      const chatError = new ChatError(authResult.error, errorCode);
      return NextResponse.json(
        {
          success: false,
          error: chatError.userMessage,
        },
        { status: 401 }
      );
    }

    const role = authResult.userDetails?.role ?? null;
    if (!isAdmin(role)) {
      return NextResponse.json({ success: false, error: '管理者権限がありません' }, { status: 403 });
    }

    const { pathname } = request.nextUrl;
    const id = pathname.split('/').pop() as string;
    const template = await PromptService.getTemplateWithVersions(id);
    if (!template) {
      return NextResponse.json({ success: false, error: '見つかりません' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: template });
  } catch (error) {
    console.error('Admin prompt detail API error:', error);
    return NextResponse.json(
      { success: false, error: ERROR_MESSAGES.COMMON.SERVER_ERROR },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const bearer = authHeader?.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : undefined;
    const { accessToken: cookieAccessToken, refreshToken } = getLiffTokensFromRequest(request);
    const liffAccessToken = bearer || cookieAccessToken;

    // liffAccessToken がない場合も authMiddleware が Supabase Email セッションで解決する
    const authResult = await authMiddleware(liffAccessToken, refreshToken);
    const conflict409post = nextJson409IfEmailLinkConflict(authResult);
    if (conflict409post) return conflict409post;
    if (authResult.error || !authResult.userId) {
      const errorMsg = authResult.error ?? ERROR_MESSAGES.AUTH.NOT_AUTHENTICATED;
      const isTokenExpired = authResult.error?.includes('expired') ?? false;
      const errorCode = isTokenExpired ? ChatErrorCode.TOKEN_EXPIRED : ChatErrorCode.AUTHENTICATION_FAILED;
      const chatError = new ChatError(errorMsg, errorCode);
      return NextResponse.json(
        {
          success: false,
          error: chatError.userMessage,
        },
        { status: 401 }
      );
    }
    if (await isViewModeEnabled(resolveViewModeRole(authResult))) {
      return NextResponse.json(
        { success: false, error: VIEW_MODE_ERROR_MESSAGE },
        { status: 403 }
      );
    }

    const role = authResult.userDetails?.role ?? null;
    if (!isAdmin(role)) {
      return NextResponse.json({ success: false, error: '管理者権限がありません' }, { status: 403 });
    }

    const { pathname } = request.nextUrl;
    const id = pathname.split('/').pop() as string;

    const body = await request.json();
    const validated = promptSchema.parse(body);

    const updateInput = {
      name: validated.name,
      display_name: validated.display_name,
      content: validated.content,
      variables: validated.variables,
      updated_by: authResult.userId,
    } as const;

    const result = await PromptService.updateTemplate(id, updateInput);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('Admin prompt update API error:', error);
    return NextResponse.json(
      { success: false, error: ERROR_MESSAGES.COMMON.SERVER_ERROR },
      { status: 500 }
    );
  }
}
