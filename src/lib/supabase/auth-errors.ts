import type { AuthError } from '@supabase/supabase-js';

export function isUnauthenticatedAuthError(error: AuthError): boolean {
  return (
    error.name === 'AuthSessionMissingError' ||
    error.code === 'refresh_token_not_found' ||
    error.code === 'refresh_token_already_used'
  );
}
