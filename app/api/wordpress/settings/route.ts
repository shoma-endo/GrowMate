import { NextRequest, NextResponse } from 'next/server';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { isAdmin as isAdminRole } from '@/authUtils';
import { SupabaseService } from '@/server/services/supabaseService';
import { normalizeContentTypes } from '@/server/services/wordpressContentTypes';
import {
  isViewModeEnabled,
  resolveViewModeRole,
  VIEW_MODE_ERROR_MESSAGE,
} from '@/server/lib/view-mode';
import { getLiffTokensFromRequest } from '@/server/lib/auth-helpers';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

const supabaseService = new SupabaseService();

export async function POST(request: NextRequest) {
  try {
    const {
      wpType,
      wpSiteId,
      wpSiteUrl,
      wpUsername,
      wpApplicationPassword,
      wpContentTypes,
    } = await request.json();

    const parsedContentTypes = Array.isArray(wpContentTypes)
      ? wpContentTypes
      : typeof wpContentTypes === 'string'
        ? wpContentTypes.split(',').map((value: string) => value.trim())
        : undefined;
    const contentTypes = normalizeContentTypes(parsedContentTypes);

    // 認証情報はCookieから取得（セキュリティベストプラクティス）
    const { accessToken: liffToken, refreshToken } = getLiffTokensFromRequest(request);

    if (!wpType) {
      return NextResponse.json(
        { success: false, error: ERROR_MESSAGES.AUTH.AUTHENTICATION_REQUIRED },
        { status: 401 }
      );
    }

    const authResult = await authMiddleware(liffToken, refreshToken);
    
    if (authResult.error || !authResult.userId || !authResult.userDetails?.role) {
      return NextResponse.json(
        { success: false, error: ERROR_MESSAGES.AUTH.AUTHENTICATION_FAILED },
        { status: 401 }
      );
    }
    if (authResult.viewMode || authResult.ownerUserId) {
      return NextResponse.json(
        {
          success: false,
          error: ERROR_MESSAGES.AUTH.OWNER_ACCOUNT_REQUIRED,
        },
        { status: 403 }
      );
    }
    if (await isViewModeEnabled(resolveViewModeRole(authResult))) {
      return NextResponse.json(
        { success: false, error: VIEW_MODE_ERROR_MESSAGE },
        { status: 403 }
      );
    }

    const isAdmin = isAdminRole(authResult.userDetails.role);

    // 管理者以外はWordPress.comを禁止
    if (!isAdmin && wpType !== 'self_hosted') {
      return NextResponse.json(
        { success: false, error: 'WordPress.com 連携は管理者のみ利用できます。セルフホスト版で設定してください。' },
        { status: 403 }
      );
    }

    // WordPress設定を保存（セルフホスト対応）
    if (wpType === 'self_hosted') {
      if (!wpSiteUrl || !wpUsername || !wpApplicationPassword) {
        return NextResponse.json(
          { success: false, error: ERROR_MESSAGES.WORDPRESS.SELF_HOSTED_REQUIRED_FIELDS },
          { status: 400 }
        );
      }
      
      await supabaseService.createOrUpdateSelfHostedWordPressSettings(
        authResult.userId,
        wpSiteUrl,
        wpUsername,
        wpApplicationPassword,
        { wpContentTypes: contentTypes }
      );
    } else if (wpType === 'wordpress_com') {
      if (!wpSiteId) {
        return NextResponse.json(
          { success: false, error: ERROR_MESSAGES.WORDPRESS.WORDPRESS_COM_SITE_ID_REQUIRED },
          { status: 400 }
        );
      }
      
      // WordPress.com設定を保存（OAuth認証は別途必要）
      await supabaseService.createOrUpdateWordPressSettings(
        authResult.userId,
        '', // clientId - OAuth後に設定
        '', // clientSecret - OAuth後に設定
        wpSiteId,
        { wpContentTypes: contentTypes }
      );
    }

    return NextResponse.json({ 
      success: true, 
      message: ERROR_MESSAGES.WORDPRESS.SETTINGS_SAVED 
    });
  } catch (error) {
    console.error('[WordPress Settings API] Error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : ERROR_MESSAGES.COMMON.UNEXPECTED_ERROR 
      },
      { status: 500 }
    );
  }
}
