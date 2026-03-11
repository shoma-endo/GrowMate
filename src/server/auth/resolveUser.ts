import { createSupabaseServerClient } from '@/lib/supabase/server';
import { userService } from '@/server/services/userService';
import type { User } from '@/types/user';

/**
 * Supabase Auth セッションから Email ユーザーを解決する
 * Server Actions / Route Handlers から呼び出す
 * 認証確認は getUser() を使用（getSession() は使わない）
 */
export async function resolveEmailUserFromSession(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser?.email) return null;

  try {
    return await userService.resolveOrCreateEmailUser(authUser.id, authUser.email);
  } catch (error) {
    console.error('[resolveUser] Failed to resolve email user:', error);
    return null;
  }
}
