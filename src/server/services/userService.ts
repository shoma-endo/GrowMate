import { SupabaseService } from './supabaseService';
import type { SupabaseResult } from './supabaseService';
import { toIsoTimestamp } from '@/lib/timestamps';
import type { User, UserRole } from '@/types/user';
import { toDbUserInsert, toUser, type DbUser, type DbUserUpdate } from '@/types/user';

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

/**
 * ユーザーサービス: ユーザー管理機能を提供
 */
export class UserService {
  private supabaseService: SupabaseService;

  constructor() {
    this.supabaseService = new SupabaseService();
  }

  private unwrapResult<T>(result: SupabaseResult<T>): T {
    if (!result.success) {
      throw new Error(result.error.developerMessage ?? result.error.userMessage);
    }
    return result.data;
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

    return true;
  }

  async getAllUsers(): Promise<User[]> {
    const result = await this.supabaseService.getAllUsers();

    if (!result.success) {
      console.error('Failed to fetch all users:', result.error);
      return [];
    }

    return result.data.map(dbUser => toUser(dbUser));
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

  async getEmployeeByOwnerId(ownerId: string): Promise<User | null> {
    const result = await this.supabaseService.getEmployeeByOwnerId(ownerId);
    if (!result.success) {
      console.error('Failed to get employee by owner id:', result.error);
      return null;
    }
    return result.data ? toUser(result.data) : null;
  }

  /**
   * Supabase Auth ユーザーを GrowMate ユーザーに解決または新規作成（idempotent）
   * Phase 1: `supabase_auth_id` の既存解決と新規 INSERT のみ。email 一致で既存 LINE 行へ自動リンクしない
   * （仕様: docs/plans/2026-03-01-email-auth-and-migration-spec.md §7）。既存メール併用は Phase 1.5 手動移行。
   * OTP ログイン成功後は updateLastLoginAt() を別途呼び出すこと。
   */
  async resolveOrCreateEmailUser(supabaseAuthId: string, email: string): Promise<User> {
    const normalizedEmail = email.trim().toLowerCase();

    const existingByAuth = await this.supabaseService.getUserBySupabaseAuthId(supabaseAuthId);
    if (!existingByAuth.success) {
      throw new Error(existingByAuth.error.developerMessage ?? existingByAuth.error.userMessage);
    }

    if (existingByAuth.data) {
      return toUser(existingByAuth.data);
    }

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
   * Email ユーザーの last_login_at を更新する
   * OTP ログイン成功後（Server Action）でのみ呼び出すこと
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
