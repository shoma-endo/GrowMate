import type { IsoTimestamp } from '@/lib/timestamps';
import { parseTimestamp, parseTimestampOrNull, toIsoTimestamp } from '@/lib/timestamps';
import type { Database } from '@/types/database.types';

/**
 * ユーザーロールの型定義
 */
export type UserRole = 'trial' | 'paid' | 'admin' | 'unavailable' | 'owner';

/**
 * 有効なUserRole値の配列
 */
export const VALID_USER_ROLES: readonly UserRole[] = [
  'trial',
  'paid',
  'admin',
  'unavailable',
  'owner',
] as const;

/**
 * 型ガード: 値が有効なUserRoleかどうかを実行時検証
 */
export function isValidUserRole(role: unknown): role is UserRole {
  return typeof role === 'string' && (VALID_USER_ROLES as readonly string[]).includes(role);
}

/**
 * 管理機能（設定・コンテンツ一覧）へのアクセスを許可するロール
 */
export const PAID_FEATURE_ROLES = ['paid', 'admin'] as const;

export type PaidFeatureRole = (typeof PAID_FEATURE_ROLES)[number];

export function hasPaidFeatureAccess(role: UserRole | null): role is PaidFeatureRole {
  return role === 'paid' || role === 'admin';
}

/**
 * ユーザー情報の型定義
 */
export interface User {
  // 基本情報
  id: string; // ユーザーID (Supabaseの自動生成ID等)
  createdAt: IsoTimestamp; // ユーザー作成日時 (UTC ISO文字列)
  updatedAt: IsoTimestamp; // 最終更新日時 (UTC ISO文字列)
  lastLoginAt?: IsoTimestamp | undefined; // 最終ログイン日時 (UTC ISO文字列)
  fullName?: string | undefined; // フルネーム

  // LINE関連情報 (Email 専用ユーザーは null になる場合がある)
  lineUserId?: string | null | undefined; // LINE UserID
  lineDisplayName?: string | null | undefined; // LINE表示名
  linePictureUrl?: string | undefined; // LINEプロフィール画像URL
  lineStatusMessage?: string | undefined; // LINEステータスメッセージ
  lineAccessToken?: string | undefined; // LINEアクセストークン (一時的)

  // Email 認証関連 (Email ユーザーのみ)
  email?: string | null | undefined; // メールアドレス
  supabaseAuthId?: string | null | undefined; // Supabase Auth ユーザー ID

  // 権限管理
  role: UserRole; // ユーザーロール（trial: お試し, paid: 有料契約, admin: 管理者, unavailable: サービス利用不可, owner: スタッフを持つあなた）
  ownerUserId?: string | null | undefined; // スタッフが紐づくあなたのID（あなた自身はNULL）
  ownerPreviousRole?: UserRole | null | undefined; // owner化前のロール（復帰用）
}

/**
 * データベースモデルへの変換用インターフェース
 */
export type DbUser = Database['public']['Tables']['users']['Row'];
export type DbUserInsert = Database['public']['Tables']['users']['Insert'];
export type DbUserUpdate = Database['public']['Tables']['users']['Update'];

/**
 * アプリケーションモデルから users.Insert 用ペイロードへ変換
 */
export function toDbUserInsert(user: User): DbUserInsert {
  const createdAt = toIsoTimestamp(user.createdAt);
  const updatedAt = toIsoTimestamp(user.updatedAt);
  const lastLoginAt = user.lastLoginAt !== undefined ? toIsoTimestamp(user.lastLoginAt) : null;
  return {
    id: user.id,
    created_at: createdAt,
    updated_at: updatedAt,
    last_login_at: lastLoginAt,
    full_name: user.fullName ?? null,
    line_user_id: user.lineUserId ?? null,
    line_display_name: user.lineDisplayName ?? null,
    line_picture_url: user.linePictureUrl ?? null,
    line_status_message: user.lineStatusMessage ?? null,
    email: user.email ?? null,
    supabase_auth_id: user.supabaseAuthId ?? null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    role: user.role,
    owner_user_id: user.ownerUserId ?? null,
    owner_previous_role: user.ownerPreviousRole ?? null,
  };
}

export function toUser(dbUser: DbUser): User {
  if (!isValidUserRole(dbUser.role)) {
    throw new Error(`Invalid user role: ${dbUser.role}`);
  }
  const role = dbUser.role;

  // ownerPreviousRoleのバリデーション（null/undefined以外の場合）
  if (dbUser.owner_previous_role != null && !isValidUserRole(dbUser.owner_previous_role)) {
    throw new Error(`Invalid owner previous role: ${dbUser.owner_previous_role}`);
  }

  const createdAt = parseTimestamp(dbUser.created_at);
  const updatedAt = parseTimestamp(dbUser.updated_at);
  const lastLoginAt = parseTimestampOrNull(dbUser.last_login_at);
  return {
    id: dbUser.id,
    createdAt,
    updatedAt,
    lastLoginAt: lastLoginAt ?? undefined,
    fullName: dbUser.full_name ?? undefined,
    lineUserId: dbUser.line_user_id,
    lineDisplayName: dbUser.line_display_name,
    linePictureUrl: dbUser.line_picture_url ?? undefined,
    lineStatusMessage: dbUser.line_status_message ?? undefined,
    email: dbUser.email,
    supabaseAuthId: dbUser.supabase_auth_id,
    role,
    ownerUserId: dbUser.owner_user_id,
    ownerPreviousRole: dbUser.owner_previous_role ?? null,
  };
}
