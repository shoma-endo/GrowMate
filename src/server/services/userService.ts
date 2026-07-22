import { SupabaseService } from './supabaseService';
import { toIsoTimestamp } from '@/lib/timestamps';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import type { User, UserRole, AdminUserListItem } from '@/types/user';
import {
  toDbUserInsert,
  toUser,
  resolveUserDeletionBlockedReason,
  getUserDeletionBlockedMessage,
  type DbUser,
  type DbUserUpdate,
} from '@/types/user';

/**
 * Phase 1: email 一致による自動リンクを行わず INSERT した結果、メールまたは auth の一意制約に触れた場合に投げる。
 * （例: 既存 LINE 行が同じメールを保持しており、別の Supabase Auth で新規 users 行を作れない）
 */
export class EmailAuthLinkConflictError extends Error {
  readonly code = 'EMAIL_AUTH_LINK_CONFLICT' as const;

  constructor() {
    super(
      'メール認証の紐付け競合: 該当する public.users 行は既に別の Supabase Auth ユーザーに関連付けられています'
    );
    this.name = 'EmailAuthLinkConflictError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** public.users 削除後に Auth が残っており、再作成を拒否する状態 */
export class PendingAuthDeletionError extends Error {
  readonly code = 'PENDING_AUTH_DELETION' as const;

  constructor() {
    super(ERROR_MESSAGES.AUTH.PENDING_AUTH_DELETION);
    this.name = 'PendingAuthDeletionError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function mapDeleteUserFullyRpcError(rpcErrorMessage: string | undefined): string {
  switch (rpcErrorMessage) {
    case 'blocked_admin':
      return getUserDeletionBlockedMessage('admin');
    case 'blocked_active_subscription':
      return getUserDeletionBlockedMessage('active_subscription');
    case 'blocked_organization':
      return getUserDeletionBlockedMessage('organization_linked');
    default:
      return ERROR_MESSAGES.USER.DELETE_DB_FAILED;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * ユーザーサービス: ユーザー管理機能を提供
 */
class UserService {
  private supabaseService: SupabaseService;

  constructor() {
    this.supabaseService = new SupabaseService();
  }

  private buildDbUserUpdates(
    updates: Partial<Omit<User, 'id' | 'createdAt' | 'updatedAt'>>,
    timestampIso = toIsoTimestamp(new Date())
  ): DbUserUpdate {
    const dbUpdates: DbUserUpdate = {
      updated_at: timestampIso,
    };

    if (updates.lineDisplayName !== undefined) {
      dbUpdates.line_display_name = updates.lineDisplayName;
    }
    if (updates.linePictureUrl !== undefined) {
      dbUpdates.line_picture_url = updates.linePictureUrl;
    }
    if (updates.lineStatusMessage !== undefined) {
      dbUpdates.line_status_message = updates.lineStatusMessage;
    }
    if (updates.lastLoginAt !== undefined) {
      dbUpdates.last_login_at = updates.lastLoginAt;
    }
    if (updates.fullName !== undefined) {
      dbUpdates.full_name = updates.fullName;
    }
    if (updates.role !== undefined) {
      dbUpdates.role = updates.role;
    }

    return dbUpdates;
  }

  /**
   * アプリケーションのユーザーIDからユーザー情報を取得
   */
  async getUserById(id: string): Promise<User | null> {
    const result = await this.supabaseService.getUserById(id);

    if (!result.success) {
      console.error(`Failed to get user by ID (${id}) in userService:`, result.error);
      return null;
    }

    return result.data ? toUser(result.data) : null;
  }

  async updateFullName(userId: string, fullName: string): Promise<boolean> {
    const timestamp = toIsoTimestamp(new Date());
    const result = await this.supabaseService.updateUserById(
      userId,
      this.buildDbUserUpdates({ fullName }, timestamp)
    );

    if (!result.success) {
      console.error('Failed to update full name:', result.error);
      return false;
    }
    // maybeSingle: 対象行が無い場合も success になり得るため data を必須にする
    if (!result.data) {
      console.error('Failed to update full name: no row updated', { userId });
      return false;
    }

    return true;
  }

  async getAllUsersForAdmin(): Promise<AdminUserListItem[]> {
    const result = await this.supabaseService.getAllUsers();

    if (!result.success) {
      console.error('Failed to fetch all users for admin:', result.error);
      throw new Error(result.error.developerMessage ?? result.error.userMessage);
    }

    const dbUsers = result.data;
    return dbUsers.map(dbUser => {
      const deletionBlockedReason = resolveUserDeletionBlockedReason(dbUser, dbUsers);
      return {
        ...toUser(dbUser),
        canDelete: deletionBlockedReason === null,
        deletionBlockedReason,
      };
    });
  }

  /**
   * ユーザーの権限を更新
   */
  async updateUserRole(userId: string, newRole: UserRole): Promise<boolean> {
    const result = await this.supabaseService.updateUserRole(userId, newRole);

    if (!result.success) {
      console.error('Failed to update user role:', result.error);
      return false;
    }

    return true;
  }

  /**
   * 管理者によるユーザー完全削除ユースケース（設計書 §7.4）。
   * 1. 対象再取得 2. アプリ層の早期検証 3. 監査 started
   * 4. RPC（行ロック＋保護再検証＋DB削除） 5. Auth削除 6/7. 監査 succeeded/failed
   */
  async deleteUserFully(
    targetUserId: string,
    actorUserId: string
  ): Promise<{ success: true } | { success: false; error: string }> {
    const targetResult = await this.supabaseService.getUserById(targetUserId);
    if (!targetResult.success || !targetResult.data) {
      return { success: false, error: ERROR_MESSAGES.USER.DELETE_TARGET_INVALID };
    }
    const target = targetResult.data;
    const supabaseAuthId = target.supabase_auth_id;

    const allUsersResult = await this.supabaseService.getAllUsers();
    if (!allUsersResult.success) {
      return { success: false, error: ERROR_MESSAGES.USER.DELETE_TARGET_INVALID };
    }
    const blockedReason = resolveUserDeletionBlockedReason(target, allUsersResult.data);
    if (blockedReason !== null) {
      return { success: false, error: getUserDeletionBlockedMessage(blockedReason) };
    }

    const auditStart = await this.supabaseService.createAdminActionLogStarted({
      actorUserId,
      targetUserId,
      action: 'user_deletion',
      targetSupabaseAuthId: supabaseAuthId,
    });
    if (!auditStart.success) {
      console.error('[UserService] Failed to start admin_action_logs row:', auditStart.error);
      return { success: false, error: ERROR_MESSAGES.USER.DELETE_AUDIT_LOG_START_FAILED };
    }
    const logId = auditStart.data;

    // DB削除を先に行い、RPC内の FOR UPDATE + 保護再検証で TOCTOU を閉じる。
    // Auth がある場合、RPC は users 削除前に pending を同一TXで作成する。
    // Auth は DB 成功後に削除する（保護違反時に Auth を触らない）。
    const rpcResult = await this.supabaseService.deleteUserFully(targetUserId, logId);
    if (!rpcResult.success) {
      console.error('[UserService] Failed to delete user via RPC:', rpcResult.error);
      const auditFinalized = await this.updateAdminActionLogStatusWithRetry(
        logId,
        'failed',
        'db_delete_failed'
      );
      if (!auditFinalized) {
        return { success: false, error: ERROR_MESSAGES.USER.DELETE_AUDIT_LOG_FINALIZE_FAILED };
      }
      return {
        success: false,
        error: mapDeleteUserFullyRpcError(rpcResult.error.userMessage),
      };
    }

    if (supabaseAuthId) {
      const authResult = await this.deleteAuthUserWithRetry(supabaseAuthId);
      if (!authResult.success) {
        console.error('[UserService] Failed to delete Supabase Auth user:', authResult.error);
        // pending は RPC で作成済み（初期 lease 付き）。バックオフだけ更新する。
        await this.supabaseService.schedulePendingAuthUserDeletionRetry(supabaseAuthId);
        const auditFinalized = await this.updateAdminActionLogStatusWithRetry(
          logId,
          'failed',
          'auth_delete_failed'
        );
        if (!auditFinalized) {
          return { success: false, error: ERROR_MESSAGES.USER.DELETE_AUDIT_LOG_FINALIZE_FAILED };
        }
        return { success: false, error: ERROR_MESSAGES.USER.DELETE_AUTH_FAILED_AFTER_DB };
      }
      const pendingCleanup = await this.supabaseService.deletePendingAuthUserDeletion(supabaseAuthId);
      if (!pendingCleanup.success) {
        console.error(
          '[UserService] Failed to delete pending_auth_user_deletions after Auth delete:',
          pendingCleanup.error
        );
        const auditFinalized = await this.updateAdminActionLogStatusWithRetry(
          logId,
          'failed',
          'pending_cleanup_failed'
        );
        if (!auditFinalized) {
          return { success: false, error: ERROR_MESSAGES.USER.DELETE_AUDIT_LOG_FINALIZE_FAILED };
        }
        return { success: false, error: ERROR_MESSAGES.USER.DELETE_PENDING_CLEANUP_FAILED };
      }
    }

    const finalized = await this.updateAdminActionLogStatusWithRetry(logId, 'succeeded');
    if (!finalized) {
      return { success: false, error: ERROR_MESSAGES.USER.DELETE_AUDIT_LOG_FINALIZE_FAILED };
    }

    return { success: true };
  }

  private async deleteAuthUserWithRetry(
    supabaseAuthId: string
  ): Promise<{ success: true } | { success: false; error: unknown }> {
    const maxAttempts = 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const result = await this.supabaseService.deleteAuthUser(supabaseAuthId);
      if (result.success) {
        return { success: true };
      }
      lastError = result.error;
      console.error(
        `[UserService] deleteAuthUser failed (attempt ${attempt}/${maxAttempts}):`,
        result.error
      );
      if (attempt < maxAttempts) {
        await sleep(100 * attempt);
      }
    }
    return { success: false, error: lastError };
  }

  /** 監査ログの確定更新を短時間リトライする。0件更新も失敗。 */
  private async updateAdminActionLogStatusWithRetry(
    logId: string,
    status: 'succeeded' | 'failed',
    failureCode?: string
  ): Promise<boolean> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const updateResult = await this.supabaseService.updateAdminActionLogStatus(
        logId,
        status,
        failureCode
      );
      if (updateResult.success) {
        return true;
      }
      console.error(
        `[UserService] Failed to mark admin_action_logs as ${status} (attempt ${attempt}/${maxAttempts}):`,
        updateResult.error
      );
      if (attempt < maxAttempts) {
        await sleep(100 * attempt);
      }
    }
    return false;
  }

  /**
   * Supabase Auth ユーザーを GrowMate ユーザーに解決または新規作成（idempotent）
   * Phase 1: `supabase_auth_id` の既存解決と新規 INSERT のみ。email 一致で既存 LINE 行へ自動リンクしない
   * （仕様: docs/plans/2026-03-01-email-auth-and-migration-spec.md §7）。既存メール併用は Phase 1.5 手動移行。
   * OTP ログイン成功直後は updateLastLoginAt() を別途呼び出すこと。
   * 既存ユーザー解決時は last_login_at が1日以上前なら touchLastLoginIfStale() で自動更新する。
   */
  async resolveOrCreateEmailUser(supabaseAuthId: string, email: string): Promise<User> {
    const normalizedEmail = email.trim().toLowerCase();

    const existingByAuth = await this.supabaseService.getUserBySupabaseAuthId(supabaseAuthId);
    if (!existingByAuth.success) {
      throw new Error(existingByAuth.error.developerMessage ?? existingByAuth.error.userMessage);
    }

    if (existingByAuth.data) {
      const user = toUser(existingByAuth.data);
      this.touchLastLoginIfStale(user);
      return user;
    }

    // public.users が無い場合: 削除途中の Auth 残存なら再作成せず Auth 削除を再試行する
    await this.resolvePendingAuthDeletionOrThrow(supabaseAuthId);

    const createResult = await this.supabaseService.createEmailUser(normalizedEmail, supabaseAuthId);
    if (!createResult.success) {
      if (createResult.error.code === '23505') {
        const retryByAuthId = await this.supabaseService.getUserBySupabaseAuthId(supabaseAuthId);
        if (retryByAuthId.success && retryByAuthId.data) {
          return toUser(retryByAuthId.data);
        }
        throw new EmailAuthLinkConflictError();
      }
      throw new Error(createResult.error.developerMessage ?? createResult.error.userMessage);
    }

    return toUser(createResult.data);
  }

  /**
   * pending_auth_user_deletions がある場合、原子的 claim できたときだけ Auth 削除を1回試し、
   * 必ず同一 auth id での public.users 再作成を拒否する。
   * - absent: pending なし（通常の新規作成へ）
   * - not_due: 初期 lease / バックオフ中（Auth API 非呼び出し）
   * - claimed + Auth成功: pending 削除を確認。失敗しても再作成は禁止
   * - claimed + Auth失敗: next_attempt_at は claim RPC 時に更新済み
   */
  private async resolvePendingAuthDeletionOrThrow(supabaseAuthId: string): Promise<void> {
    const claimResult = await this.supabaseService.claimPendingAuthUserDeletion(supabaseAuthId);
    if (!claimResult.success) {
      throw new Error(claimResult.error.developerMessage ?? claimResult.error.userMessage);
    }
    if (claimResult.data === 'absent') {
      return;
    }
    if (claimResult.data === 'not_due') {
      throw new PendingAuthDeletionError();
    }

    const authResult = await this.supabaseService.deleteAuthUser(supabaseAuthId);
    if (authResult.success) {
      const pendingCleanup = await this.supabaseService.deletePendingAuthUserDeletion(supabaseAuthId);
      if (!pendingCleanup.success) {
        console.error(
          '[UserService] Failed to delete pending_auth_user_deletions after Auth delete on login:',
          pendingCleanup.error
        );
      }
    }
    throw new PendingAuthDeletionError();
  }

  /**
   * セッション継続中は OTP 再入力が発生せず last_login_at が更新されないため、
   * 1日以上更新がなければセッション解決時にも last_login_at を打ち直す（フロー非ブロッキング）。
   */
  private touchLastLoginIfStale(user: User): void {
    const staleAfterMs = 24 * 60 * 60 * 1000;
    const lastLoginMs = user.lastLoginAt ? new Date(user.lastLoginAt).getTime() : 0;
    if (Date.now() - lastLoginMs < staleAfterMs) {
      return;
    }
    this.updateLastLoginAt(user.id).catch(err => {
      console.error('[UserService] touchLastLoginIfStale failed:', err);
    });
  }

  /**
   * Email ユーザーの last_login_at を更新する
   * OTP ログイン成功後（Server Action）、または touchLastLoginIfStale() から呼び出す
   */
  async updateLastLoginAt(userId: string): Promise<void> {
    const now = toIsoTimestamp(new Date());
    const result = await this.supabaseService.updateUserById(userId, {
      last_login_at: now,
      updated_at: now,
    });
    if (!result.success) {
      console.error('[UserService] Failed to update last_login_at:', result.error);
    }
  }
}

export const userService = new UserService();
