import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ensureValidInstagramToken,
  resolveInstagramTokenAction,
} from '@/server/lib/instagram-token';
import type { InstagramCredential } from '@/types/instagram';

const baseCredential: InstagramCredential = {
  igUserId: '17841400000000000',
  username: 'growmate_demo',
  accountType: 'BUSINESS',
  profilePictureUrl: null,
  accessToken: 'token',
  accessTokenExpiresAt: '2026-08-01T00:00:00.000Z',
  accessTokenIssuedAt: '2026-07-01T00:00:00.000Z',
  scope: ['instagram_business_basic'],
  lastSyncedAt: null,
};

afterEach(() => {
  vi.useRealTimers();
});

describe('resolveInstagramTokenAction', () => {
  it('期限まで7日以上あるとき reuse を返す', () => {
    expect(
      resolveInstagramTokenAction(baseCredential, new Date('2026-07-01T00:00:00.000Z'))
    ).toBe('reuse');
  });

  it('期限7日未満かつ発行24時間超のとき refresh を返す', () => {
    const credential: InstagramCredential = {
      ...baseCredential,
      accessTokenExpiresAt: '2026-07-05T00:00:00.000Z',
      accessTokenIssuedAt: '2026-06-20T00:00:00.000Z',
    };

    expect(
      resolveInstagramTokenAction(credential, new Date('2026-07-01T00:00:00.000Z'))
    ).toBe('refresh');
  });

  it('発行24時間未満のとき wait_24h を返す', () => {
    const credential: InstagramCredential = {
      ...baseCredential,
      accessTokenExpiresAt: '2026-07-05T00:00:00.000Z',
      accessTokenIssuedAt: '2026-07-01T12:00:00.000Z',
    };

    expect(
      resolveInstagramTokenAction(credential, new Date('2026-07-02T00:00:00.000Z'))
    ).toBe('wait_24h');
  });

  it('期限切れのとき needs_reauth を返す', () => {
    const credential: InstagramCredential = {
      ...baseCredential,
      accessTokenExpiresAt: '2026-06-01T00:00:00.000Z',
    };

    expect(
      resolveInstagramTokenAction(credential, new Date('2026-07-01T00:00:00.000Z'))
    ).toBe('needs_reauth');
  });
});

describe('ensureValidInstagramToken', () => {
  it('refresh 成功時に persist して新しい accessToken を返す', async () => {
    const now = new Date('2026-07-01T00:00:00.000Z');
    const credential: InstagramCredential = {
      ...baseCredential,
      accessToken: 'old-token',
      accessTokenExpiresAt: '2026-07-05T00:00:00.000Z',
      accessTokenIssuedAt: '2026-06-20T00:00:00.000Z',
    };
    const refreshLongLivedToken = vi.fn().mockResolvedValue({
      accessToken: 'new-token',
      expiresIn: 5184000,
    });
    const persistToken = vi.fn().mockResolvedValue(undefined);

    const result = await ensureValidInstagramToken(credential, {
      refreshLongLivedToken,
      persistToken,
      now,
    });

    expect(result).toEqual({ accessToken: 'new-token', needsReauth: false });
    expect(refreshLongLivedToken).toHaveBeenCalledWith('old-token');
    expect(persistToken).toHaveBeenCalledWith({
      accessToken: 'new-token',
      accessTokenExpiresAt: '2026-08-30T00:00:00.000Z',
      accessTokenIssuedAt: '2026-07-01T00:00:00.000Z',
    });
  });

  it('wait_24h のとき refresh も persist も行わず既存トークンを返す', async () => {
    const now = new Date('2026-07-02T00:00:00.000Z');
    const credential: InstagramCredential = {
      ...baseCredential,
      accessToken: 'existing-token',
      accessTokenExpiresAt: '2026-07-05T00:00:00.000Z',
      accessTokenIssuedAt: '2026-07-01T12:00:00.000Z',
    };
    const refreshLongLivedToken = vi.fn();
    const persistToken = vi.fn();

    const result = await ensureValidInstagramToken(credential, {
      refreshLongLivedToken,
      persistToken,
      now,
    });

    expect(result).toEqual({ accessToken: 'existing-token', needsReauth: false });
    expect(refreshLongLivedToken).not.toHaveBeenCalled();
    expect(persistToken).not.toHaveBeenCalled();
  });

  it('needs_reauth のとき refresh も persist も行わない', async () => {
    const now = new Date('2026-07-01T00:00:00.000Z');
    const credential: InstagramCredential = {
      ...baseCredential,
      accessTokenExpiresAt: '2026-06-01T00:00:00.000Z',
    };
    const refreshLongLivedToken = vi.fn();
    const persistToken = vi.fn();

    const result = await ensureValidInstagramToken(credential, {
      refreshLongLivedToken,
      persistToken,
      now,
    });

    expect(result).toEqual({ needsReauth: true });
    expect(refreshLongLivedToken).not.toHaveBeenCalled();
    expect(persistToken).not.toHaveBeenCalled();
  });
});
