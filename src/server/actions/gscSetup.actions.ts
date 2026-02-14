'use server';

import { revalidatePath } from 'next/cache';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { SupabaseService } from '@/server/services/supabaseService';
import { GscService, formatGscPropertyDisplayName } from '@/server/services/gscService';
import { toGscConnectionStatus, propertyTypeFromUri } from '@/server/lib/gsc-status';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { GscSiteEntry, GscCredential, GscConnectionStatus } from '@/types/gsc';
import { getLiffTokensFromCookies } from '@/server/lib/auth-helpers';
import { ensureValidAccessToken } from '@/server/services/googleTokenService';

const supabaseService = new SupabaseService();
const gscService = new GscService();

const OWNER_ONLY_ERROR_MESSAGE = ERROR_MESSAGES.AUTH.STAFF_OPERATION_NOT_ALLOWED;

/** トークン期限切れ/取り消しエラーかどうかを判定 */
const isTokenExpiredError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return (
    lower.includes('invalid_grant') ||
    lower.includes('token has been expired') ||
    lower.includes('token has been revoked') ||
    lower.includes('トークンリフレッシュに失敗')
  );
};

const ensureAccessToken = async (userId: string, credential: GscCredential): Promise<string> =>
  ensureValidAccessToken(credential, {
    refreshAccessToken: (rt) => gscService.refreshAccessToken(rt),
    persistToken: (accessToken, expiresAt, scope) =>
      supabaseService.updateGscCredential(userId, {
        accessToken,
        accessTokenExpiresAt: expiresAt,
        scope: scope ?? credential.scope ?? null,
      }),
  });

const getAuthUserId = async () => {
  const { accessToken, refreshToken } = await getLiffTokensFromCookies();
  const authResult = await authMiddleware(accessToken, refreshToken);
  if (authResult.error || !authResult.userId) {
    return { error: authResult.error || ERROR_MESSAGES.AUTH.USER_AUTH_FAILED };
  }
  // View Modeの場合でも、Setup画面の操作は本来のユーザー（オーナー）として実行する
  const realUserId = authResult.actorUserId || authResult.userId;
  // actorUserIdがある = View Modeでオーナーとして操作中
  const isViewModeAsOwner = !!authResult.actorUserId;

  return {
    userId: realUserId,
    // スタッフユーザーの場合のみownerUserIdを返す（制限対象）
    ownerUserId: isViewModeAsOwner ? null : (authResult.ownerUserId ?? null),
  };
};

export async function fetchGscStatus() {
  const { userId, ownerUserId, error } = await getAuthUserId();
  if (error || !userId) {
    return { success: false, error: error || ERROR_MESSAGES.AUTH.USER_AUTH_FAILED };
  }
  if (ownerUserId) {
    return { success: false, error: OWNER_ONLY_ERROR_MESSAGE };
  }
  const credential = await supabaseService.getGscCredentialByUserId(userId);
  const status = toGscConnectionStatus(credential);
  return { success: true, data: status };
}

export async function fetchGscProperties() {
  try {
    const { userId, ownerUserId, error } = await getAuthUserId();
    if (error || !userId) {
      return { success: false, error: error || ERROR_MESSAGES.AUTH.USER_AUTH_FAILED };
    }
    if (ownerUserId) {
      return { success: false, error: OWNER_ONLY_ERROR_MESSAGE };
    }

    const credential = await supabaseService.getGscCredentialByUserId(userId);
    if (!credential) {
      return { success: false, error: ERROR_MESSAGES.GSC.NOT_CONNECTED };
    }

    const accessToken = await ensureAccessToken(userId, credential);
    const sites = await gscService.listSites(accessToken);
    await supabaseService.updateGscCredential(userId, {
      lastSyncedAt: new Date().toISOString(),
    });
    return { success: true, data: sites as GscSiteEntry[] };
  } catch (error) {
    console.error('[GSC Setup] fetch properties failed', error);

    // トークン期限切れ/取り消しの場合は再認証フラグを返す
    if (isTokenExpiredError(error)) {
      return {
        success: false,
        error: ERROR_MESSAGES.GSC.AUTH_EXPIRED_OR_REVOKED,
        needsReauth: true,
      };
    }

    return { success: false, error: ERROR_MESSAGES.GSC.PROPERTIES_FETCH_FAILED };
  }
}

export async function saveGscProperty(params: {
  propertyUri: string;
  permissionLevel?: string | null;
}) {
  try {
    const { userId, ownerUserId, error } = await getAuthUserId();
    if (error || !userId) {
      return { success: false, error: error || ERROR_MESSAGES.AUTH.USER_AUTH_FAILED };
    }
    if (ownerUserId) {
      return { success: false, error: OWNER_ONLY_ERROR_MESSAGE };
    }
    const propertyUri = params.propertyUri?.trim();
    if (!propertyUri) {
      return { success: false, error: ERROR_MESSAGES.GSC.PROPERTY_URI_REQUIRED };
    }
    const credential = await supabaseService.getGscCredentialByUserId(userId);
    if (!credential) {
      return { success: false, error: ERROR_MESSAGES.GSC.NOT_CONNECTED };
    }

    const propertyType = propertyTypeFromUri(propertyUri);
    const permissionLevel =
      typeof params.permissionLevel === 'string'
        ? params.permissionLevel
        : credential.permissionLevel;
    const verified = permissionLevel
      ? permissionLevel !== 'siteUnverifiedUser'
      : (credential.verified ?? false);

    await supabaseService.updateGscCredential(userId, {
      propertyUri,
      propertyType,
      propertyDisplayName: formatGscPropertyDisplayName(propertyUri),
      permissionLevel: permissionLevel ?? null,
      verified,
      lastSyncedAt: new Date().toISOString(),
    });

    const updatedCredential = await supabaseService.getGscCredentialByUserId(userId);
    revalidatePath('/setup');
    revalidatePath('/gsc-setup');
    return { success: true, data: toGscConnectionStatus(updatedCredential) };
  } catch (error) {
    console.error('[GSC Setup] save property failed', error);
    return { success: false, error: ERROR_MESSAGES.GSC.PROPERTY_SAVE_FAILED };
  }
}

export async function disconnectGsc() {
  try {
    const { userId, ownerUserId, error } = await getAuthUserId();

    if (error || !userId) {
      console.error('[GSC Setup] disconnectGsc: ユーザー認証失敗', { error });
      return { success: false, error: error || ERROR_MESSAGES.AUTH.USER_AUTH_FAILED };
    }
    if (ownerUserId) {
      return { success: false, error: OWNER_ONLY_ERROR_MESSAGE };
    }

    await supabaseService.deleteGscCredential(userId);

    revalidatePath('/setup');
    revalidatePath('/gsc-setup');
    return { success: true };
  } catch (error) {
    console.error('[GSC Setup] disconnect failed', {
      error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return { success: false, error: ERROR_MESSAGES.GSC.DISCONNECT_FAILED };
  }
}

/**
 * GSCステータスを取得し、トークンの有効性もチェック
 * SetupDashboard で使用
 */
export async function refetchGscStatusWithValidation(): Promise<
  | { success: true; data: GscConnectionStatus; needsReauth: boolean }
  | { success: false; error: string; needsReauth?: boolean }
> {
  try {
    // ステータスを取得（内部で認証チェックを実行）
    const statusResult = await fetchGscStatus();
    if (!statusResult.success || !statusResult.data) {
      return {
        success: false,
        error: statusResult.error || ERROR_MESSAGES.GSC.STATUS_FETCH_FAILED,
      };
    }

    const status = statusResult.data as GscConnectionStatus;

    // 接続済みの場合、プロパティ取得を試みてトークンの有効性をチェック
    if (status.connected) {
      const propertiesResult = await fetchGscProperties();
      if (
        !propertiesResult.success &&
        'needsReauth' in propertiesResult &&
        propertiesResult.needsReauth
      ) {
        return {
          success: true,
          data: status,
          needsReauth: true,
        };
      }
    }

    return {
      success: true,
      data: status,
      needsReauth: false,
    };
  } catch (error) {
    console.error('GSCステータス取得エラー:', error);
    return { success: false, error: ERROR_MESSAGES.GSC.STATUS_FETCH_FAILED };
  }
}
