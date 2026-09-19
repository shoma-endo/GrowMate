import { cache } from 'react';
import { redirect } from 'next/navigation';

import { authMiddleware, type AuthMiddlewareResult } from '@/server/middleware/auth.middleware';
import { redirectIfEmailLinkConflict } from '@/server/middleware/authMiddlewareGuards';

export const requireSetupAuth = cache(async (): Promise<AuthMiddlewareResult> => {
  const authResult = await authMiddleware();
  redirectIfEmailLinkConflict(authResult);
  if (authResult.error || !authResult.userId) {
    redirect('/login');
  }
  return authResult;
});
