import { isUnavailable } from '@/authUtils';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isUnauthenticatedAuthError } from '@/lib/supabase/auth-errors';
import { EmailAuthLinkConflictError, userService } from '@/server/services/userService';
import type { User } from '@/types/user';

/**
 * Email 認証結果の統一型。
 * 一時障害（transient）を未認証と区別し、呼び出し元で 503/再試行を一貫して扱う。
 */
type EmailAuthResult =
  | { ok: true; user: User }
  | { ok: false; reason: 'unauthenticated' }
  | { ok: false; reason: 'transient' }
  | { ok: false; reason: 'email_link_conflict' }
  | { ok: false; reason: 'unavailable'; user: User };

/**
 * Supabase Auth セッションから Email ユーザーを解決する（結果を理由付きで返す）。
 * Route Handlers / Server Actions ではこちらを使い、transient 時は 503 や再試行で統一する。
 */
export async function resolveEmailUserWithReason(): Promise<EmailAuthResult> {
  const supabase = await createSupabaseServerClient();
  const { data: { user: authUser }, error } = await supabase.auth.getUser();

  if (error) {
    if (isUnauthenticatedAuthError(error)) return { ok: false, reason: 'unauthenticated' };
    return { ok: false, reason: 'transient' };
  }
  if (!authUser?.email) return { ok: false, reason: 'unauthenticated' };

  try {
    const user = await userService.resolveOrCreateEmailUser(authUser.id, authUser.email);
    if (isUnavailable(user.role)) {
      return { ok: false, reason: 'unavailable', user };
    }
    return { ok: true, user };
  } catch (err) {
    if (err instanceof EmailAuthLinkConflictError) {
      return { ok: false, reason: 'email_link_conflict' };
    }
    const code = (err as Record<string, unknown>)?.code;
    console.error('[resolveEmailUserWithReason] transient failure:', code ?? (err instanceof Error ? err.message : 'unknown'));
    return { ok: false, reason: 'transient' };
  }
}
