import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';

/**
 * 完了メールの宛先を取り出す。**「行が無い / 空」と「取得できなかった」を別の結果で返す**。
 * 呼び出し側が前者を `notified_at` 打ち、後者を再試行に倒せるようにするため。
 */
export async function fetchUserEmail(
  client: SupabaseClient<Database>,
  userId: string,
  logTag: string
): Promise<{ ok: true; email: string | null } | { ok: false }> {
  const { data, error } = await client
    .from('users')
    .select('email')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.error(`${logTag} failed to fetch user email:`, {
      userId,
      message: error.message,
    });
    return { ok: false };
  }
  const email = data?.email?.trim();
  return { ok: true, email: email ? email : null };
}
