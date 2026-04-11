import { authMiddleware } from '@/server/middleware/auth.middleware';
import { getEmailLinkConflictMessage } from '@/server/middleware/authMiddlewareGuards';
import { SupabaseService } from '@/server/services/supabaseService';
import { WordPressService, WordPressAuth } from '@/server/services/wordpressService';
import type { WordPressSettings, WordPressType } from '@/types/wordpress';

export const WORDPRESS_COM_AUTH_REQUIRED_MESSAGE =
  'WordPress認証に失敗しました。WordPress.comとの連携が必要です。';

interface CookieGetter {
  (name: string): string | undefined;
}

export const WPCOM_TOKEN_COOKIE_NAME = 'wpcom_oauth_token';

export type WordPressServiceBuildFailureReason =
  | 'wordpress_auth_missing'
  | 'self_hosted_credentials_missing';

export type WordPressServiceBuildResult =
  | {
      success: true;
      auth: WordPressAuth;
      service: WordPressService;
    }
  | {
      success: false;
      reason: WordPressServiceBuildFailureReason;
      message: string;
      needsWordPressAuth?: boolean;
    };

export function buildWordPressServiceFromSettings(
  wpSettings: WordPressSettings,
  getCookie: CookieGetter
): WordPressServiceBuildResult {
  if (wpSettings.wpType === 'wordpress_com') {
    const accessToken = getCookie(WPCOM_TOKEN_COOKIE_NAME) || wpSettings.wpAccessToken || '';
    if (!accessToken) {
      return {
        success: false,
        reason: 'wordpress_auth_missing',
        message: WORDPRESS_COM_AUTH_REQUIRED_MESSAGE,
        needsWordPressAuth: true,
      };
    }

    const auth: WordPressAuth = {
      type: 'wordpress_com',
      wpComAuth: {
        accessToken,
        siteId: wpSettings.wpSiteId || '',
      },
    };

    return {
      success: true,
      auth,
      service: new WordPressService(auth),
    };
  }

  if (!wpSettings.wpSiteUrl || !wpSettings.wpUsername || !wpSettings.wpApplicationPassword) {
    return {
      success: false,
      reason: 'self_hosted_credentials_missing',
      message: 'セルフホストWordPressの認証情報が不足しています',
    };
  }

  const auth: WordPressAuth = {
    type: 'self_hosted',
    selfHostedAuth: {
      siteUrl: wpSettings.wpSiteUrl,
      username: wpSettings.wpUsername,
      applicationPassword: wpSettings.wpApplicationPassword,
    },
  };

  return {
    success: true,
    auth,
    service: new WordPressService(auth),
  };
}

export type WordPressContextFailureReason =
  | 'line_auth_invalid'
  | 'requires_reauth'
  | 'email_link_conflict'
  | 'settings_missing'
  | WordPressServiceBuildFailureReason;

export type WordPressContextResult =
  | {
      success: true;
      userId: string;
      wpSettings: WordPressSettings;
      auth: WordPressAuth;
      service: WordPressService;
    }
  | {
      success: false;
      reason: WordPressContextFailureReason;
      message: string;
      status: number;
      userId?: string;
      needsWordPressAuth?: boolean;
      wpType?: WordPressType;
      wpSettings?: WordPressSettings;
    };

interface ResolveWordPressContextOptions {
  supabaseService?: SupabaseService;
}

export async function resolveWordPressContext(
  getCookie: CookieGetter,
  options: ResolveWordPressContextOptions = {}
): Promise<WordPressContextResult> {
  const accessToken = getCookie('line_access_token');
  const refreshToken = getCookie('line_refresh_token');
  // accessToken がない場合も authMiddleware が Supabase Email セッションで解決する
  const authResult = await authMiddleware(accessToken, refreshToken, { allowEmailFallback: true });

  const conflictMessage = getEmailLinkConflictMessage(authResult);
  if (conflictMessage !== undefined) {
    return {
      success: false,
      reason: 'email_link_conflict',
      message: conflictMessage,
      status: 409,
    };
  }

  if (authResult.needsReauth) {
    return {
      success: false,
      reason: 'requires_reauth',
      message: authResult.error || '再認証が必要です',
      status: 401,
    };
  }

  if (authResult.error || !authResult.userId) {
    return {
      success: false,
      reason: 'line_auth_invalid',
      message: authResult.error || 'ユーザー認証に失敗しました',
      status: 401,
    };
  }

  const supabaseService = options.supabaseService ?? new SupabaseService();
  const wpSettings = await supabaseService.getWordPressSettingsByUserId(authResult.userId);

  if (!wpSettings) {
    return {
      success: false,
      reason: 'settings_missing',
      message: 'WordPress設定が登録されていません',
      status: 200,
      userId: authResult.userId,
    };
  }

  const buildResult = buildWordPressServiceFromSettings(wpSettings, getCookie);
  if (!buildResult.success) {
    return {
      success: false,
      reason: buildResult.reason,
      message: buildResult.message,
      status: buildResult.reason === 'wordpress_auth_missing' ? 401 : 400,
      userId: authResult.userId,
      wpType: wpSettings.wpType,
      wpSettings,
      ...(buildResult.needsWordPressAuth ? { needsWordPressAuth: true } : {}),
    };
  }

  return {
    success: true,
    userId: authResult.userId,
    wpSettings,
    auth: buildResult.auth,
    service: buildResult.service,
  };
}
