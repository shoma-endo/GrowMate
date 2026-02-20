import type { GscConnectionStatus, GscCredential, GscPropertyType } from '@/types/gsc';
import { formatGscPropertyDisplayName } from '@/server/services/gscService';
import { hasReusableAccessToken } from '@/server/services/googleTokenService';

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

export function propertyTypeFromUri(uri: string): GscPropertyType {
  return uri.startsWith('sc-domain:') ? 'sc-domain' : 'url-prefix';
}
