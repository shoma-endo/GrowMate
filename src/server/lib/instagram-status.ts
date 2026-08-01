import type { InstagramConnectionStatus, InstagramCredential } from '@/types/instagram';

const TOKEN_SAFETY_MARGIN_MS = 60 * 1000;

export function isInstagramTokenExpired(credential: InstagramCredential, now: Date = new Date()): boolean {
  const expiresAtMs = new Date(credential.accessTokenExpiresAt).getTime();
  return expiresAtMs - now.getTime() <= TOKEN_SAFETY_MARGIN_MS;
}

export function toInstagramConnectionStatus(
  credential: InstagramCredential | null
): InstagramConnectionStatus {
  if (!credential) {
    return { connected: false };
  }

  const needsReauth = isInstagramTokenExpired(credential);

  return {
    connected: true,
    needsReauth,
    username: credential.username,
  };
}
