'use server';

import { revalidatePath } from 'next/cache';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { emailLinkConflictErrorPayload } from '@/server/middleware/authMiddlewareGuards';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import {
  isInstagramReauthError,
  isInstagramRevokedTokenError,
} from '@/domain/errors/instagram-error-handlers';
import { canAccessInstagram } from '@/server/lib/instagram-permissions';
import { isInstagramSyncEnabled } from '@/server/lib/instagram-sync-config';
import { instagramSyncService } from '@/server/services/instagramSyncService';
import { SupabaseService } from '@/server/services/supabaseService';
import {
  createInstagramTokenDeps,
  ensureValidInstagramToken,
} from '@/server/services/instagramTokenService';
import type { ServerActionResult } from '@/lib/async-handler';
import type { InstagramSyncMode, InstagramSyncResult } from '@/types/instagram';
import type { UserRole } from '@/types/user';

const supabaseService = new SupabaseService();

export async function syncInstagramData(
  mode: InstagramSyncMode
): Promise<ServerActionResult<InstagramSyncResult> & { needsReauth?: boolean }> {
  if (!isInstagramSyncEnabled()) {
    return { success: false, error: ERROR_MESSAGES.INSTAGRAM.SYNC_DISABLED };
  }

  try {
    const authResult = await authMiddleware();
    const linkConflict = emailLinkConflictErrorPayload(authResult);
    if (linkConflict) {
      return { success: false, error: linkConflict.error };
    }
    if (authResult.error || !authResult.userId) {
      return { success: false, error: authResult.error || ERROR_MESSAGES.AUTH.USER_AUTH_FAILED };
    }

    const userId = authResult.userId;
    const role: UserRole | null = authResult.userDetails?.role ?? null;

    if (!canAccessInstagram(role)) {
      return { success: false, error: ERROR_MESSAGES.INSTAGRAM.ACCESS_DENIED };
    }

    const credential = await supabaseService.getInstagramCredential(userId);
    if (!credential) {
      return { success: false, error: ERROR_MESSAGES.INSTAGRAM.CONNECTION_FAILED };
    }

    const tokenResult = await ensureValidInstagramToken(
      credential,
      createInstagramTokenDeps(userId, async payload => {
        const updateResult = await supabaseService.updateInstagramCredential(userId, {
          accessToken: payload.accessToken,
          accessTokenExpiresAt: payload.accessTokenExpiresAt,
          accessTokenIssuedAt: payload.accessTokenIssuedAt,
        });
        if (!updateResult.success) {
          throw new Error(updateResult.error.developerMessage ?? 'Token persist failed');
        }
      })
    );

    if (tokenResult.needsReauth) {
      return {
        success: false,
        error: ERROR_MESSAGES.INSTAGRAM.AUTH_EXPIRED,
        needsReauth: true,
      };
    }

    const syncResult = await instagramSyncService.syncUserData(
      userId,
      tokenResult.accessToken,
      mode
    );

    revalidatePath('/analytics');
    revalidatePath('/setup/instagram');

    return { success: true, data: syncResult };
  } catch (error) {
    console.error('[Instagram Sync] syncInstagramData failed', error);
    if (isInstagramReauthError(error)) {
      const authResult = await authMiddleware();
      const userId = authResult.userId;
      if (userId && isInstagramRevokedTokenError(error)) {
        await supabaseService.updateInstagramCredential(userId, {
          accessTokenExpiresAt: new Date().toISOString(),
        });
      }
      return {
        success: false,
        error: ERROR_MESSAGES.INSTAGRAM.AUTH_EXPIRED,
        needsReauth: true,
      };
    }
    return { success: false, error: ERROR_MESSAGES.INSTAGRAM.SYNC_FAILED };
  }
}
