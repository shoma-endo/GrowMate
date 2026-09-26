import { describe, expect, it } from 'vitest';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { GA4_SCOPE } from '@/lib/constants';
import { toGa4ConnectionStatusFromResolution } from '@/server/lib/ga4-status';

/**
 * toGa4ConnectionStatusFromResolution（resolveHomeGoogleCredential の結果 → GA4連携ステータス）の検証。
 * 失敗の分類（400 は ok のまま古い credential、429 等は transient_failure）は
 * home-google-credential.test.ts が固定している。ここでは分類結果からの組み立てだけを見る。
 *
 * 要点1: GA4スコープ不足（scopeMissing）はcredential.scopeという静的な事実であり
 * トークンの有効性とは独立なので、一時的失敗時でもneedsReauthをもみ消してはいけない。
 * 要点2: プロパティ未選択（linked_unselected）の連携済みユーザーが一時的失敗に遭遇しても、
 * hasValidToken起因の誤判定で「未連携」に転落させてはいけない。
 */

const EXPIRED_CREDENTIAL_WITH_SCOPE = {
  id: 'cred-1',
  userId: 'b0ed75ba-bb37-4dd7-89a0-c6ce940f991c',
  refreshToken: 'refresh-token',
  accessToken: 'old-token',
  accessTokenExpiresAt: new Date(Date.now() - 60_000).toISOString(),
  scope: [GA4_SCOPE],
  googleAccountEmail: 'user@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('toGa4ConnectionStatusFromResolution', () => {
  it('refresh が 401 相当で失敗（本当の認証失効＝古い credential のまま ok）なら needsReauth:true', () => {
    const status = toGa4ConnectionStatusFromResolution({ kind: 'ok', credential: EXPIRED_CREDENTIAL_WITH_SCOPE });

    expect(status.needsReauth).toBe(true);
  });

  it('プロパティ未選択（連携済み）が429等の一時的失敗に遭遇しても未連携扱いにせず、再認証も促さない', () => {
    const status = toGa4ConnectionStatusFromResolution({
      kind: 'transient_failure',
      credential: EXPIRED_CREDENTIAL_WITH_SCOPE, // ga4PropertyIdなし、scopeはあり
    });

    expect(status).toMatchObject({
      connected: true,
      connectionStage: 'linked_unselected',
      needsReauth: false,
      hasTemporaryError: true,
      temporaryErrorMessage: ERROR_MESSAGES.GA4.TOKEN_REFRESH_TEMPORARY_FAILURE,
    });
  });

  it('GA4スコープ不足かつ一時的失敗なら needsReauth:true を維持する（もみ消さない）', () => {
    const status = toGa4ConnectionStatusFromResolution({
      kind: 'transient_failure',
      credential: {
        ...EXPIRED_CREDENTIAL_WITH_SCOPE,
        scope: ['https://www.googleapis.com/auth/webmasters.readonly'], // GA4_SCOPEなし
      },
    });

    expect(status.needsReauth).toBe(true);
    expect(status.hasTemporaryError).toBe(true);
  });
});
