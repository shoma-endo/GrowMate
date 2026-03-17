import { createSupabaseServerClient } from '@/lib/supabase/server';
import { userService } from '@/server/services/userService';
import type { User } from '@/types/user';

/**
 * Email 認証結果の統一型。
 * 一時障害（transient）を未認証と区別し、呼び出し元で 503/再試行を一貫して扱う。
 */
export type EmailAuthResult =
  | { ok: true; user: User }
  | { ok: false; reason: 'unauthenticated' }
  | { ok: false; reason: 'transient' };

/**
 * Supabase Auth セッションから Email ユーザーを解決する（結果を理由付きで返す）。
 * Route Handlers / Server Actions ではこちらを使い、transient 時は 503 や再試行で統一する。
 */
export async function resolveEmailUserWithReason(): Promise<EmailAuthResult> {
  const supabase = await createSupabaseServerClient();
  const { data: { user: authUser }, error } = await supabase.auth.getUser();

  if (error) {
    // セッションなし（未ログイン）は AuthSessionMissingError。一時障害と区別して unauthenticated とする
    if (error.name === 'AuthSessionMissingError') return { ok: false, reason: 'unauthenticated' };
    return { ok: false, reason: 'transient' };
  }
  if (!authUser?.email) return { ok: false, reason: 'unauthenticated' };

  try {
    const user = await userService.resolveOrCreateEmailUser(authUser.id, authUser.email);
    return { ok: true, user };
  } catch (err) {
    const code = (err as Record<string, unknown>)?.code;
    console.error('[resolveEmailUserWithReason] transient failure:', code ?? (err instanceof Error ? err.message : 'unknown'));
    return { ok: false, reason: 'transient' };
  }
}
