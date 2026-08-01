import { describe, expect, it } from 'vitest';

import { toInstagramConnectionStatus } from '@/server/lib/instagram-status';
import type { InstagramCredential } from '@/types/instagram';

const baseCredential: InstagramCredential = {
  igUserId: '17841400000000000',
  username: 'growmate_demo',
  accountType: 'BUSINESS',
  profilePictureUrl: null,
  accessToken: 'token',
  accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
  accessTokenIssuedAt: '2026-01-01T00:00:00.000Z',
  scope: ['instagram_business_basic'],
  lastSyncedAt: null,
};

describe('toInstagramConnectionStatus', () => {
  it('credential が null のとき未連携を返す', () => {
    expect(toInstagramConnectionStatus(null)).toEqual({ connected: false });
  });

  it('有効な credential のとき connected=true, needsReauth=false を返す', () => {
    expect(toInstagramConnectionStatus(baseCredential)).toEqual({
      connected: true,
      needsReauth: false,
      username: 'growmate_demo',
    });
  });

  it('期限切れ credential のとき needsReauth=true を返す', () => {
    const expiredCredential: InstagramCredential = {
      ...baseCredential,
      accessTokenExpiresAt: '2020-01-01T00:00:00.000Z',
    };

    expect(toInstagramConnectionStatus(expiredCredential, new Date('2026-01-01T00:00:00.000Z'))).toEqual({
      connected: true,
      needsReauth: true,
      username: 'growmate_demo',
    });
  });
});
