import { describe, expect, it } from 'vitest';

import { resolveUserDeletionBlockedReason, type DbUser } from '@/types/user';

function createDbUser(overrides: Partial<DbUser> & Pick<DbUser, 'id' | 'role'>): DbUser {
  return {
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    email: null,
    full_name: null,
    last_login_at: null,
    line_display_name: null,
    line_picture_url: null,
    line_status_message: null,
    line_user_id: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    supabase_auth_id: null,
    ...overrides,
  };
}

describe('resolveUserDeletionBlockedReason', () => {
  it('管理者ユーザーは admin を返す', () => {
    const target = createDbUser({ id: 'user-1', role: 'admin' });
    expect(resolveUserDeletionBlockedReason(target)).toBe('admin');
  });

  it('Stripe契約があるユーザーは active_subscription を返す', () => {
    const target = createDbUser({
      id: 'user-1',
      role: 'paid',
      stripe_subscription_id: 'sub_123',
    });
    expect(resolveUserDeletionBlockedReason(target)).toBe('active_subscription');
  });

  it('削除可能なユーザーは null を返す', () => {
    const target = createDbUser({ id: 'user-1', role: 'trial' });
    expect(resolveUserDeletionBlockedReason(target)).toBeNull();
  });

  it('管理者は契約情報より優先される', () => {
    const target = createDbUser({
      id: 'user-1',
      role: 'admin',
      stripe_subscription_id: 'sub_123',
    });
    expect(resolveUserDeletionBlockedReason(target)).toBe('admin');
  });
});
