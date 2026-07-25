import type { InstagramCredential } from '@/types/instagram';
import { isInstagramTokenExpired } from '@/server/lib/instagram-status';

const REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_ISSUED_AGE_MS = 24 * 60 * 60 * 1000;

export type InstagramTokenAction = 'reuse' | 'refresh' | 'wait_24h' | 'needs_reauth';

export function resolveInstagramTokenAction(
  credential: InstagramCredential,
  now: Date = new Date()
): InstagramTokenAction {
  const expiresAtMs = new Date(credential.accessTokenExpiresAt).getTime();
  const issuedAtMs = new Date(credential.accessTokenIssuedAt).getTime();
  const nowMs = now.getTime();
  const msUntilExpiry = expiresAtMs - nowMs;
  const msSinceIssue = nowMs - issuedAtMs;

  if (msUntilExpiry <= 0) {
    return 'needs_reauth';
  }

  if (msUntilExpiry >= REFRESH_THRESHOLD_MS) {
    return 'reuse';
  }

  if (msSinceIssue < MIN_ISSUED_AGE_MS) {
    return 'wait_24h';
  }

  return 'refresh';
}

interface EnsureInstagramTokenResult {
  accessToken: string;
  needsReauth: false;
}

interface EnsureInstagramTokenReauthResult {
  needsReauth: true;
}

export type EnsureInstagramTokenOutcome =
  | EnsureInstagramTokenResult
  | EnsureInstagramTokenReauthResult;

export interface EnsureInstagramTokenDeps {
  refreshLongLivedToken: (accessToken: string) => Promise<{ accessToken: string; expiresIn: number }>;
  persistToken: (payload: {
    accessToken: string;
    accessTokenExpiresAt: string;
    accessTokenIssuedAt: string;
  }) => Promise<void>;
  now: Date;
}

export async function ensureValidInstagramToken(
  credential: InstagramCredential,
  deps: EnsureInstagramTokenDeps
): Promise<EnsureInstagramTokenOutcome> {
  const action = resolveInstagramTokenAction(credential, deps.now);

  if (action === 'needs_reauth' || isInstagramTokenExpired(credential, deps.now)) {
    return { needsReauth: true };
  }

  if (action === 'reuse' || action === 'wait_24h') {
    return { accessToken: credential.accessToken, needsReauth: false };
  }

  const refreshed = await deps.refreshLongLivedToken(credential.accessToken);
  const expiresAt = new Date(deps.now.getTime() + refreshed.expiresIn * 1000).toISOString();
  const issuedAt = deps.now.toISOString();

  await deps.persistToken({
    accessToken: refreshed.accessToken,
    accessTokenExpiresAt: expiresAt,
    accessTokenIssuedAt: issuedAt,
  });

  return { accessToken: refreshed.accessToken, needsReauth: false };
}
