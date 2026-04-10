import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

/**
 * authMiddleware がメールと public.users の紐付け競合を返したときに投げる。
 * Server Action / withAuth 等で instanceof により 409 相当として判別する。
 */
export class AuthEmailLinkConflictError extends Error {
  readonly code = 'EMAIL_LINK_CONFLICT' as const;

  constructor(message: string = ERROR_MESSAGES.AUTH.EMAIL_LINK_CONFLICT) {
    super(message);
    this.name = 'AuthEmailLinkConflictError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
