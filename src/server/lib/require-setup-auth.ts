import { cache } from 'react';
import { redirect } from 'next/navigation';

import { authMiddleware, type AuthMiddlewareResult } from '@/server/middleware/auth.middleware';
import { redirectIfEmailLinkConflict } from '@/server/middleware/authMiddlewareGuards';

/**
 * setup 配下の Server Component 用の共通認証ガード。
 *
 * `app/setup/layout.tsx` と各 `page.tsx` から呼ぶ。`cache` で要求ごとに1回だけ
 * `authMiddleware` を実行するため、layout と page の両方から呼んでも多重取得にならない。
 * 未認証は `/login`、メール紐付け競合は `/login?reason=email_link_conflict` へ遷移する。
 */
export const requireSetupAuth = cache(async (): Promise<AuthMiddlewareResult> => {
  const authResult = await authMiddleware();
  redirectIfEmailLinkConflict(authResult);
  if (authResult.error || !authResult.userId) {
    redirect('/login');
  }
  return authResult;
});
