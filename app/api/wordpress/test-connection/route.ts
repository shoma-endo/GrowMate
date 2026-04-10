import { NextRequest, NextResponse } from 'next/server';
import { resolveWordPressContext } from '@/server/services/wordpressContext';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { nextJson409IfEmailLinkConflict } from '@/server/middleware/authMiddlewareGuards';
import { SupabaseService } from '@/server/services/supabaseService';
import { isAdmin as isAdminRole } from '@/authUtils';
import {
  isViewModeEnabled,
  resolveViewModeRole,
  VIEW_MODE_ERROR_MESSAGE,
} from '@/server/lib/view-mode';
import { getLiffTokensFromRequest } from '@/server/lib/auth-helpers';

const supabaseService = new SupabaseService();

// WordPress接続状態をGETメソッドで確認（WordPress.comとセルフホスト両対応）
export async function GET(request: NextRequest) {
  try {
    const { accessToken: liffToken, refreshToken } = getLiffTokensFromRequest(request);
    const authResult = await authMiddleware(liffToken, refreshToken);

    const conflict409get = nextJson409IfEmailLinkConflict(authResult, msg => ({
      success: false,
      connected: false,
      message: msg,
    }));
    if (conflict409get) return conflict409get;
    if (authResult.error || !authResult.userId || !authResult.userDetails?.role) {
      return NextResponse.json({ success: false, connected: false, message: 'ユーザー認証に失敗しました' }, { status: 401 });
    }
    if (authResult.viewMode || authResult.ownerUserId) {
      return NextResponse.json(
        {
          success: false,
          connected: false,
          message: ERROR_MESSAGES.AUTH.OWNER_ACCOUNT_REQUIRED,
        },
        { status: 403 }
      );
    }
    if (await isViewModeEnabled(resolveViewModeRole(authResult))) {
      return NextResponse.json(
        { success: false, connected: false, message: VIEW_MODE_ERROR_MESSAGE },
        { status: 403 }
      );
    }

    const isAdmin = isAdminRole(authResult.userDetails.role);
    const wpSettings = await supabaseService.getWordPressSettingsByUserId(authResult.userId);

    if (!wpSettings) {
      return NextResponse.json({
        success: false,
        connected: false,
        message: ERROR_MESSAGES.WORDPRESS.SETTINGS_INCOMPLETE,
        wpType: 'self_hosted',
      });
    }

    if (!isAdmin && wpSettings.wpType === 'wordpress_com') {
      return NextResponse.json(
        {
          success: false,
          connected: false,
          message: 'WordPress.com 連携は管理者のみ利用できます。セルフホスト版で再設定してください。',
          wpType: wpSettings.wpType,
        },
        { status: 403 }
      );
    }

    const context = await resolveWordPressContext(name => request.cookies.get(name)?.value);

    if (!context.success) {
      const responseBody = {
        success: false,
        connected: false,
        message: context.message,
        wpType: context.wpType ?? 'wordpress_com',
        needsWordPressAuth: context.needsWordPressAuth,
      };
      const status =
        context.reason === 'settings_missing' || context.reason === 'wordpress_auth_missing'
          ? 200
          : context.status;

      if (context.reason === 'settings_missing') {
        return NextResponse.json({
          ...responseBody,
          message: ERROR_MESSAGES.WORDPRESS.SETTINGS_INCOMPLETE,
        });
      }

      return NextResponse.json(responseBody, { status });
    }

    const connectionTest = await context.service.testConnection();

    if (!connectionTest.success) {
      return NextResponse.json({
        success: false,
        connected: false,
        message: ERROR_MESSAGES.WORDPRESS.CONNECTION_FAILED,
        error: connectionTest.error,
        wpType: context.wpSettings.wpType,
      });
    }

    return NextResponse.json({
      success: true,
      connected: true,
      message: `${
        context.wpSettings.wpType === 'wordpress_com' ? 'WordPress.com' : 'セルフホストWordPress'
      }に接続済み`,
      wpType: context.wpSettings.wpType,
    });
  } catch (error) {
    console.error('WordPress connection check error:', error);
    return NextResponse.json({
      success: false,
      connected: false,
      message: ERROR_MESSAGES.WORDPRESS.CONNECTION_FAILED,
      error: error instanceof Error ? error.message : ERROR_MESSAGES.COMMON.UNEXPECTED_ERROR,
      wpType: 'wordpress_com', // エラー時のデフォルト値
    });
  }
}

// POSTメソッドも統合接続テストに対応
export async function POST(request: NextRequest) {
  try {
    const { accessToken: liffToken, refreshToken } = getLiffTokensFromRequest(request);
    const authResult = await authMiddleware(liffToken, refreshToken);

    const conflict409post = nextJson409IfEmailLinkConflict(authResult);
    if (conflict409post) return conflict409post;
    if (authResult.error || !authResult.userId || !authResult.userDetails?.role) {
      return NextResponse.json(
        { success: false, error: 'ユーザー認証に失敗しました' },
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
    const wpSettings = await supabaseService.getWordPressSettingsByUserId(authResult.userId);

    if (!wpSettings) {
      return NextResponse.json(
        { success: false, error: ERROR_MESSAGES.WORDPRESS.SETTINGS_INCOMPLETE },
        { status: 400 }
      );
    }

    if (!isAdmin && wpSettings.wpType === 'wordpress_com') {
      return NextResponse.json(
        {
          success: false,
          error: 'WordPress.com 連携は管理者のみ利用できます。セルフホスト版で再設定してください。',
        },
        { status: 403 }
      );
    }

    const context = await resolveWordPressContext(name => request.cookies.get(name)?.value);

    if (!context.success) {
      return NextResponse.json(
        {
          success: false,
          error: context.message,
          needsWordPressAuth: context.needsWordPressAuth,
        },
        { status: context.status }
      );
    }

    const connectionTest = await context.service.testConnection();

    if (!connectionTest.success) {
      return NextResponse.json(
        {
          success: false,
          error:
            connectionTest.error ||
            ERROR_MESSAGES.WORDPRESS.CONNECTION_FAILED,
        },
        {
          status:
            connectionTest.error &&
            (connectionTest.error.toLowerCase().includes('token') ||
              connectionTest.error.toLowerCase().includes('invalid_request') ||
              connectionTest.error.toLowerCase().includes('unauthorized'))
              ? 401
              : 400,
        }
      );
    }

    return NextResponse.json({
      success: true,
      message: `${
        context.wpSettings.wpType === 'wordpress_com' ? 'WordPress.com' : 'セルフホストWordPress'
      }接続テストが成功しました`,
    });
  } catch (error) {
    console.error('WordPress connection test error:', error);
    return NextResponse.json(
      { success: false, error: ERROR_MESSAGES.WORDPRESS.CONNECTION_TEST_ERROR },
      { status: 500 }
    );
  }
}
