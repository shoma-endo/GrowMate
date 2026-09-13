import type { GscConnectionStatus, GscCredential, GscPropertyType } from '@/types/gsc';
import { formatGscPropertyDisplayName } from '@/server/services/gscService';
import { hasReusableAccessToken } from '@/server/services/googleTokenService';
import type { HomeGoogleCredentialResult } from '@/server/lib/home-google-credential';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

export function toGscConnectionStatus(credential: GscCredential | null): GscConnectionStatus {
  if (!credential) {
    return { connected: false };
  }

  // トークンの有効性をチェック
  // accessToken と accessTokenExpiresAt が存在し、かつ有効期限内である場合のみトークン有効とする
  const hasValidToken = hasReusableAccessToken(credential);

  const propertyDisplayName =
    credential.propertyDisplayName ||
    (credential.propertyUri ? formatGscPropertyDisplayName(credential.propertyUri) : null);

  return {
    connected: true,
    needsReauth: !hasValidToken,
    googleAccountEmail: credential.googleAccountEmail ?? null,
    propertyUri: credential.propertyUri ?? null,
    propertyDisplayName,
    propertyType: credential.propertyType ?? null,
    permissionLevel: credential.permissionLevel ?? null,
    verified: credential.verified ?? null,
    lastSyncedAt: credential.lastSyncedAt ?? null,
    updatedAt: credential.updatedAt ?? null,
    scope: credential.scope ?? null,
  };
}

/**
 * resolveHomeGoogleCredential の結果からGSC連携ステータスを組み立てる。
 * setup系ページ・Server Action（/setup, /setup/gsc, fetchGscStatus）はここを唯一の入口にする。
 *
 * - unconnected: 未連携として判定
 * - ok: 実リフレッシュ済み（or キャッシュ有効）のcredentialでそのまま判定
 * - transient_failure: refresh tokenの生死が確認できていないだけなので、
 *   needsReauthを立てず（誤って再認証を促さない）hasTemporaryErrorで一時的失敗として区別する
 */
export function toGscConnectionStatusFromResolution(
  result: HomeGoogleCredentialResult
): GscConnectionStatus {
  if (result.kind === 'unconnected') {
    return toGscConnectionStatus(null);
  }
  const status = toGscConnectionStatus(result.credential);
  if (result.kind === 'transient_failure') {
    return {
      ...status,
      needsReauth: false,
      hasTemporaryError: true,
      temporaryErrorMessage: ERROR_MESSAGES.GSC.TOKEN_REFRESH_TEMPORARY_FAILURE,
    };
  }
  return status;
}

export function propertyTypeFromUri(uri: string): GscPropertyType {
  return uri.startsWith('sc-domain:') ? 'sc-domain' : 'url-prefix';
}
