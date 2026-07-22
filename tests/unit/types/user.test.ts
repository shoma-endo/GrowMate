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
    owner_previous_role: null,
    owner_user_id: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    supabase_auth_id: null,
    ...overrides,
  };
}

describe('resolveUserDeletionBlockedReason', () => {
  it('管理者ユーザーは admin を返す', () => {
    const target = createDbUser({ id: 'user-1', role: 'admin' });
    expect(resolveUserDeletionBlockedReason(target, [target])).toBe('admin');
  });

  it('Stripe契約があるユーザーは active_subscription を返す', () => {
    const target = createDbUser({
      id: 'user-1',
      role: 'paid',
      stripe_subscription_id: 'sub_123',
    });
    expect(resolveUserDeletionBlockedReason(target, [target])).toBe('active_subscription');
  });

  it('親組織があるユーザーは organization_linked を返す', () => {
    const owner = createDbUser({ id: 'owner-1', role: 'paid' });
    const target = createDbUser({
      id: 'user-1',
      role: 'trial',
      owner_user_id: owner.id,
    });
    expect(resolveUserDeletionBlockedReason(target, [owner, target])).toBe('organization_linked');
  });

  it('子スタッフを持つユーザーは organization_linked を返す', () => {
    const target = createDbUser({ id: 'owner-1', role: 'paid' });
    const staff = createDbUser({
      id: 'staff-1',
      role: 'trial',
      owner_user_id: target.id,
    });
    expect(resolveUserDeletionBlockedReason(target, [target, staff])).toBe('organization_linked');
  });

  it('削除可能なユーザーは null を返す', () => {
    const target = createDbUser({ id: 'user-1', role: 'trial' });
    expect(resolveUserDeletionBlockedReason(target, [target])).toBeNull();
  });

  it('管理者は契約情報より優先される', () => {
    const target = createDbUser({
      id: 'user-1',
      role: 'admin',
      stripe_subscription_id: 'sub_123',
      owner_user_id: 'owner-1',
    });
    expect(resolveUserDeletionBlockedReason(target, [target])).toBe('admin');
  });
});
