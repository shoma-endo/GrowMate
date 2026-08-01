import { afterEach, describe, expect, it, vi } from 'vitest';

import { canAccessInstagram } from '@/server/lib/instagram-permissions';

const ORIGINAL_BETA = process.env.INSTAGRAM_BETA_USER_IDS;

afterEach(() => {
  if (ORIGINAL_BETA === undefined) {
    delete process.env.INSTAGRAM_BETA_USER_IDS;
  } else {
    process.env.INSTAGRAM_BETA_USER_IDS = ORIGINAL_BETA;
  }
  vi.unstubAllEnvs();
});

describe('canAccessInstagram', () => {
  it('allowlist 指定時は列挙 user_id のみ true', () => {
    vi.stubEnv('INSTAGRAM_BETA_USER_IDS', 'user-a,user-b');

    expect(canAccessInstagram({ userId: 'user-a', role: 'trial' })).toBe(true);
    expect(canAccessInstagram({ userId: 'user-c', role: 'admin' })).toBe(false);
  });

  it('allowlist が空文字のとき admin/paid/trial にフォールバックする', () => {
    vi.stubEnv('INSTAGRAM_BETA_USER_IDS', '');

    expect(canAccessInstagram({ userId: 'any-user', role: 'admin' })).toBe(true);
    expect(canAccessInstagram({ userId: 'any-user', role: 'paid' })).toBe(true);
    expect(canAccessInstagram({ userId: 'any-user', role: 'trial' })).toBe(true);
  });

  it('allowlist 未設定時も admin/paid/trial にフォールバックする', () => {
    delete process.env.INSTAGRAM_BETA_USER_IDS;

    expect(canAccessInstagram({ userId: 'any-user', role: 'paid' })).toBe(true);
  });

  it('unavailable ロールは false', () => {
    vi.stubEnv('INSTAGRAM_BETA_USER_IDS', '');

    expect(canAccessInstagram({ userId: 'any-user', role: 'unavailable' })).toBe(false);
  });
});
