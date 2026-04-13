'use server';

import { authMiddleware } from '@/server/middleware/auth.middleware';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

import { emailLinkConflictErrorPayload } from '@/server/middleware/authMiddlewareGuards';

export async function clearAuthCache() {
  try {
    const authResult = await authMiddleware();
    const linkConflict = emailLinkConflictErrorPayload(authResult);
    if (linkConflict) return linkConflict;
    if (authResult.error || !authResult.userId) {
      return { success: false, error: authResult.error || ERROR_MESSAGES.AUTH.USER_AUTH_FAILED };
    }
    // 実際のキャッシュクリアエンドポイントを叩く（認証済み想定）
    const clearRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/auth/clear-cache`, {
      method: 'POST',
      credentials: 'include',
    }).catch(() => null);

    if (!clearRes || !clearRes.ok) {
      return { success: false, error: ERROR_MESSAGES.ADMIN.CACHE_CLEAR_FAILED };
    }

    return { success: true };
  } catch (error) {
    console.error('[admin/users] clear auth cache failed', error);
    return { success: false, error: ERROR_MESSAGES.ADMIN.CACHE_CLEAR_FAILED };
  }
}
