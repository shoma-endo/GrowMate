import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: {
    NEXT_PUBLIC_SITE_URL: 'https://example.com',
    ADMIN_SIGNUP_NOTIFICATION_EMAILS: 'admin@example.com' as string | undefined,
  },
  resolveOrCreateEmailUser: vi.fn(),
  updateFullName: vi.fn(),
  sendAdminSignupNotification: vi.fn(),
  afterCallbacks: [] as Array<() => unknown>,
}));

vi.mock('@/env', () => ({ env: mocks.env }));

// after() の予約内容を取り出して、応答後の処理として明示的に実行する
vi.mock('next/server', () => ({
  after: (callback: () => unknown) => {
    mocks.afterCallbacks.push(callback);
  },
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: 'auth-1', email: 'taro@example.com' } },
        error: null,
      }),
    },
  }),
}));

vi.mock('@/server/middleware/auth.middleware', () => ({
  clearAuthCookies: vi.fn(),
}));

vi.mock('@/server/services/userService', () => ({
  userService: {
    resolveOrCreateEmailUser: mocks.resolveOrCreateEmailUser,
    updateFullName: mocks.updateFullName,
  },
  EmailAuthLinkConflictError: class extends Error {},
  PendingAuthDeletionError: class extends Error {},
}));

vi.mock('@/server/services/emailService', () => ({
  emailService: { sendAdminSignupNotification: mocks.sendAdminSignupNotification },
}));

const { registerFullName } = await import('@/server/actions/auth.actions');

const newUser = {
  id: 'user-1',
  fullName: undefined,
  createdAt: '2026-10-09T23:05:09.000Z',
  role: 'unavailable',
};

async function registerAndRunAfter(fullName: string) {
  const result = await registerFullName(fullName);
  for (const callback of mocks.afterCallbacks) {
    await callback();
  }
  return result;
}

describe('registerFullName の管理者通知', () => {
  beforeEach(() => {
    mocks.env.ADMIN_SIGNUP_NOTIFICATION_EMAILS = 'admin@example.com';
    mocks.resolveOrCreateEmailUser.mockResolvedValue(newUser);
    mocks.updateFullName.mockResolvedValue(true);
    mocks.sendAdminSignupNotification.mockResolvedValue({ success: true });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    mocks.afterCallbacks.length = 0;
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('名前が未保存なら、保存後にユーザー単位の冪等キーで1通送り、承認待ち画面へ進める', async () => {
    const result = await registerAndRunAfter('山田太郎');

    expect(result).toEqual({ success: true, nextPath: '/unavailable' });
    expect(mocks.sendAdminSignupNotification).toHaveBeenCalledTimes(1);
    expect(mocks.sendAdminSignupNotification).toHaveBeenCalledWith(
      ['admin@example.com'],
      '【GrowMate】新規ユーザーが登録しました：山田太郎',
      expect.any(String),
      'admin-signup-notification/user-1'
    );
  });

  it('名前が保存済みなら送らない', async () => {
    mocks.resolveOrCreateEmailUser.mockResolvedValue({ ...newUser, fullName: '山田太郎' });

    const result = await registerAndRunAfter('山田次郎');

    expect(result.success).toBe(true);
    expect(mocks.sendAdminSignupNotification).not.toHaveBeenCalled();
  });

  it('名前の保存に失敗したら送らない', async () => {
    mocks.updateFullName.mockResolvedValue(false);

    const result = await registerAndRunAfter('山田太郎');

    expect(result.success).toBe(false);
    expect(mocks.sendAdminSignupNotification).not.toHaveBeenCalled();
  });

  it('宛先が未設定なら送らずに登録は成功する', async () => {
    mocks.env.ADMIN_SIGNUP_NOTIFICATION_EMAILS = undefined;

    const result = await registerAndRunAfter('山田太郎');

    expect(result).toEqual({ success: true, nextPath: '/unavailable' });
    expect(mocks.sendAdminSignupNotification).not.toHaveBeenCalled();
  });

  it('送信に失敗しても登録は成功する', async () => {
    mocks.sendAdminSignupNotification.mockResolvedValue({ success: false, error: 'resend error' });

    const result = await registerAndRunAfter('山田太郎');

    expect(result).toEqual({ success: true, nextPath: '/unavailable' });
  });
});
