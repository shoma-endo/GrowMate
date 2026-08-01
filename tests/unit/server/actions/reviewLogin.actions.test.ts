import { afterEach, describe, expect, it, vi } from 'vitest';

import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
}));

// 認証経路に到達したかどうかを createSupabaseServerClient の呼び出しで判定する
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}));

vi.mock('@/server/middleware/auth.middleware', () => ({
  clearAuthCookies: vi.fn(),
}));

vi.mock('@/server/services/userService', () => ({
  userService: { resolveOrCreateEmailUser: vi.fn(), updateLastLoginAt: vi.fn() },
  EmailAuthLinkConflictError: class extends Error {},
  PendingAuthDeletionError: class extends Error {},
}));

const { signInWithReviewPassword } = await import('@/server/actions/auth.actions');

describe('signInWithReviewPassword のキルスイッチ', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mocks.createSupabaseServerClient.mockClear();
  });

  // 審査終了後は REVIEW_LOGIN_EMAIL を消すことが唯一の撤去手段なので、
  // ここが壊れると認証経路が黙って開いたままになる。
  it.each([
    ['未設定', undefined],
    ['空文字', ''],
    ['空白のみ', '   '],
  ])('REVIEW_LOGIN_EMAIL が%sなら認証に到達せず失敗する', async (_label, value) => {
    if (value === undefined) {
      vi.stubEnv('REVIEW_LOGIN_EMAIL', '');
    } else {
      vi.stubEnv('REVIEW_LOGIN_EMAIL', value);
    }

    const result = await signInWithReviewPassword('review@example.com', 'password');

    expect(result).toEqual({
      success: false,
      error: ERROR_MESSAGES.AUTH.REVIEW_LOGIN_DISABLED,
    });
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it('許可アドレス以外は認証に到達せず失敗する', async () => {
    vi.stubEnv('REVIEW_LOGIN_EMAIL', 'review@example.com');

    const result = await signInWithReviewPassword('someone-else@example.com', 'password');

    expect(result).toEqual({
      success: false,
      error: ERROR_MESSAGES.AUTH.REVIEW_LOGIN_INVALID,
    });
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });
});
