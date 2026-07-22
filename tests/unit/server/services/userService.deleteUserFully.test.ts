import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import type { DbUser } from '@/types/user';

const mocks = vi.hoisted(() => ({
  getUserById: vi.fn(),
  getAllUsers: vi.fn(),
  createAdminActionLogStarted: vi.fn(),
  deleteUserFully: vi.fn(),
  deleteAuthUser: vi.fn(),
  updateAdminActionLogStatus: vi.fn(),
  schedulePendingAuthUserDeletionRetry: vi.fn(),
  deletePendingAuthUserDeletion: vi.fn(),
  getUserBySupabaseAuthId: vi.fn(),
  claimPendingAuthUserDeletion: vi.fn(),
  createEmailUser: vi.fn(),
}));

vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    getUserById = mocks.getUserById;
    getAllUsers = mocks.getAllUsers;
    createAdminActionLogStarted = mocks.createAdminActionLogStarted;
    deleteUserFully = mocks.deleteUserFully;
    deleteAuthUser = mocks.deleteAuthUser;
    updateAdminActionLogStatus = mocks.updateAdminActionLogStatus;
    schedulePendingAuthUserDeletionRetry = mocks.schedulePendingAuthUserDeletionRetry;
    deletePendingAuthUserDeletion = mocks.deletePendingAuthUserDeletion;
    getUserBySupabaseAuthId = mocks.getUserBySupabaseAuthId;
    claimPendingAuthUserDeletion = mocks.claimPendingAuthUserDeletion;
    createEmailUser = mocks.createEmailUser;
  },
}));

import { PendingAuthDeletionError, userService } from '@/server/services/userService';

function createDbUser(overrides: Partial<DbUser> & Pick<DbUser, 'id' | 'role'>): DbUser {
  return {
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    email: 'user@example.com',
    full_name: 'Test User',
    last_login_at: null,
    line_display_name: null,
    line_picture_url: null,
    line_status_message: null,
    line_user_id: null,
    owner_previous_role: null,
    owner_user_id: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    supabase_auth_id: 'auth-1',
    ...overrides,
  };
}

describe('userService.deleteUserFully', () => {
  const target = createDbUser({ id: 'user-1', role: 'trial' });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserById.mockResolvedValue({ success: true, data: target });
    mocks.getAllUsers.mockResolvedValue({ success: true, data: [target] });
    mocks.createAdminActionLogStarted.mockResolvedValue({ success: true, data: 'log-1' });
    mocks.deleteUserFully.mockResolvedValue({ success: true, data: undefined });
    mocks.deleteAuthUser.mockResolvedValue({ success: true, data: undefined });
    mocks.updateAdminActionLogStatus.mockResolvedValue({ success: true, data: undefined });
    mocks.schedulePendingAuthUserDeletionRetry.mockResolvedValue({
      success: true,
      data: undefined,
    });
    mocks.deletePendingAuthUserDeletion.mockResolvedValue({ success: true, data: undefined });
  });

  it('DB削除成功後に Auth を削除し、監査を succeeded にする', async () => {
    const result = await userService.deleteUserFully('user-1', 'admin-1');

    expect(result).toEqual({ success: true });
    expect(mocks.createAdminActionLogStarted).toHaveBeenCalledWith({
      actorUserId: 'admin-1',
      targetUserId: 'user-1',
      action: 'user_deletion',
      targetSupabaseAuthId: 'auth-1',
    });
    expect(mocks.deleteUserFully).toHaveBeenCalledWith('user-1', 'log-1');
    expect(mocks.deleteAuthUser).toHaveBeenCalledWith('auth-1');
    expect(mocks.deleteAuthUser.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.deleteUserFully.mock.invocationCallOrder[0]
    );
    expect(mocks.deletePendingAuthUserDeletion).toHaveBeenCalledWith('auth-1');
    expect(mocks.updateAdminActionLogStatus).toHaveBeenCalledWith('log-1', 'succeeded', undefined);
  });

  it('RPC失敗時は Auth を呼ばず監査を failed にする', async () => {
    mocks.deleteUserFully.mockResolvedValue({
      success: false,
      error: { userMessage: 'blocked_admin' },
    });

    const result = await userService.deleteUserFully('user-1', 'admin-1');

    expect(result.success).toBe(false);
    expect(mocks.deleteAuthUser).not.toHaveBeenCalled();
    expect(mocks.updateAdminActionLogStatus).toHaveBeenCalledWith(
      'log-1',
      'failed',
      'db_delete_failed'
    );
  });

  it('RPC失敗後に監査 failed 更新が尽きると削除未完了の監査エラーを返す', async () => {
    mocks.deleteUserFully.mockResolvedValue({
      success: false,
      error: { userMessage: 'blocked_admin' },
    });
    mocks.updateAdminActionLogStatus.mockResolvedValue({
      success: false,
      error: { userMessage: '0 rows' },
    });

    const result = await userService.deleteUserFully('user-1', 'admin-1');

    expect(result).toEqual({
      success: false,
      error: ERROR_MESSAGES.USER.DELETE_AUDIT_LOG_STATUS_FAILED,
    });
    expect(mocks.updateAdminActionLogStatus).toHaveBeenCalledTimes(3);
  });

  it('Auth削除失敗時は pending backoff を更新し dbDeleted 付き専用エラーを返す', async () => {
    mocks.deleteAuthUser.mockResolvedValue({
      success: false,
      error: { userMessage: 'auth failed' },
    });

    const result = await userService.deleteUserFully('user-1', 'admin-1');

    expect(result).toEqual({
      success: false,
      error: ERROR_MESSAGES.USER.DELETE_AUTH_FAILED_AFTER_DB,
      dbDeleted: true,
    });
    expect(mocks.schedulePendingAuthUserDeletionRetry).toHaveBeenCalledWith('auth-1');
    expect(mocks.updateAdminActionLogStatus).toHaveBeenCalledWith(
      'log-1',
      'failed',
      'auth_delete_failed'
    );
  });

  it('Auth削除失敗後に backoff 更新が失敗しても dbDeleted を返す', async () => {
    mocks.deleteAuthUser.mockResolvedValue({
      success: false,
      error: { userMessage: 'auth failed' },
    });
    mocks.schedulePendingAuthUserDeletionRetry.mockResolvedValue({
      success: false,
      error: { userMessage: 'schedule failed' },
    });

    const result = await userService.deleteUserFully('user-1', 'admin-1');

    expect(result).toEqual({
      success: false,
      error: ERROR_MESSAGES.USER.DELETE_AUTH_FAILED_AFTER_DB,
      dbDeleted: true,
    });
    expect(mocks.updateAdminActionLogStatus).toHaveBeenCalledWith(
      'log-1',
      'failed',
      'auth_delete_failed_backoff_failed'
    );
  });

  it('Auth削除失敗後に監査 failed 更新が尽きると監査未確定を dbDeleted 付きで返す', async () => {
    mocks.deleteAuthUser.mockResolvedValue({
      success: false,
      error: { userMessage: 'auth failed' },
    });
    mocks.updateAdminActionLogStatus.mockResolvedValue({
      success: false,
      error: { userMessage: '0 rows' },
    });

    const result = await userService.deleteUserFully('user-1', 'admin-1');

    expect(result).toEqual({
      success: false,
      error: ERROR_MESSAGES.USER.DELETE_AUDIT_LOG_FINALIZE_FAILED,
      dbDeleted: true,
    });
  });

  it('Auth削除成功後に pending 清掃が失敗すると成功扱いにしない', async () => {
    mocks.deletePendingAuthUserDeletion.mockResolvedValue({
      success: false,
      error: { userMessage: 'cleanup failed' },
    });

    const result = await userService.deleteUserFully('user-1', 'admin-1');

    expect(result).toEqual({
      success: false,
      error: ERROR_MESSAGES.USER.DELETE_PENDING_CLEANUP_FAILED,
      dbDeleted: true,
    });
    expect(mocks.updateAdminActionLogStatus).toHaveBeenCalledWith(
      'log-1',
      'failed',
      'pending_cleanup_failed'
    );
  });

  it('監査 succeeded 更新が失敗し続ける場合は成功扱いにしない', async () => {
    mocks.updateAdminActionLogStatus.mockResolvedValue({
      success: false,
      error: { userMessage: '0 rows' },
    });

    const result = await userService.deleteUserFully('user-1', 'admin-1');

    expect(result).toEqual({
      success: false,
      error: ERROR_MESSAGES.USER.DELETE_AUDIT_LOG_FINALIZE_FAILED,
      dbDeleted: true,
    });
    expect(mocks.updateAdminActionLogStatus).toHaveBeenCalledTimes(3);
  });
});

describe('userService.resolveOrCreateEmailUser pending', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserBySupabaseAuthId.mockResolvedValue({ success: true, data: null });
    mocks.claimPendingAuthUserDeletion.mockResolvedValue({
      success: true,
      data: { claimed: true, targetUserId: 'user-1', attemptCount: 1 },
    });
    mocks.deleteAuthUser.mockResolvedValue({ success: true, data: undefined });
    mocks.deletePendingAuthUserDeletion.mockResolvedValue({ success: true, data: undefined });
  });

  it('claim できた場合は Auth を1回試し createEmailUser せず拒否する', async () => {
    await expect(
      userService.resolveOrCreateEmailUser('auth-1', 'user@example.com')
    ).rejects.toBeInstanceOf(PendingAuthDeletionError);

    expect(mocks.deleteAuthUser).toHaveBeenCalledTimes(1);
    expect(mocks.deleteAuthUser).toHaveBeenCalledWith('auth-1');
    expect(mocks.deletePendingAuthUserDeletion).toHaveBeenCalledWith('auth-1');
    expect(mocks.createEmailUser).not.toHaveBeenCalled();
  });

  it('not_due の場合は Auth を呼ばず拒否する', async () => {
    mocks.claimPendingAuthUserDeletion.mockResolvedValue({
      success: true,
      data: 'not_due',
    });

    await expect(
      userService.resolveOrCreateEmailUser('auth-1', 'user@example.com')
    ).rejects.toBeInstanceOf(PendingAuthDeletionError);

    expect(mocks.deleteAuthUser).not.toHaveBeenCalled();
    expect(mocks.createEmailUser).not.toHaveBeenCalled();
  });

  it('claimed 後に Auth 削除失敗でも createEmailUser しない', async () => {
    mocks.deleteAuthUser.mockResolvedValue({
      success: false,
      error: { userMessage: 'auth failed' },
    });

    await expect(
      userService.resolveOrCreateEmailUser('auth-1', 'user@example.com')
    ).rejects.toBeInstanceOf(PendingAuthDeletionError);

    expect(mocks.createEmailUser).not.toHaveBeenCalled();
    expect(mocks.deletePendingAuthUserDeletion).not.toHaveBeenCalled();
  });

  it('claimed 後に Auth 成功しても pending 清掃失敗時は再作成しない', async () => {
    mocks.deletePendingAuthUserDeletion.mockResolvedValue({
      success: false,
      error: { userMessage: 'cleanup failed' },
    });

    await expect(
      userService.resolveOrCreateEmailUser('auth-1', 'user@example.com')
    ).rejects.toBeInstanceOf(PendingAuthDeletionError);

    expect(mocks.createEmailUser).not.toHaveBeenCalled();
  });

  it('absent の場合は通常どおり createEmailUser する', async () => {
    mocks.claimPendingAuthUserDeletion.mockResolvedValue({
      success: true,
      data: 'absent',
    });
    mocks.createEmailUser.mockResolvedValue({
      success: true,
      data: createDbUser({ id: 'user-new', role: 'unavailable' }),
    });

    const user = await userService.resolveOrCreateEmailUser('auth-1', 'user@example.com');

    expect(user.id).toBe('user-new');
    expect(mocks.createEmailUser).toHaveBeenCalledWith('user@example.com', 'auth-1');
  });
});
