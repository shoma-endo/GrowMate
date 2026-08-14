import { redirect } from 'next/navigation';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { redirectIfEmailLinkConflict } from '@/server/middleware/authMiddlewareGuards';
import { canAccessInstagram } from '@/server/lib/instagram-permissions';
import { getInstagramConnectionStatus } from '@/server/actions/instagramSetup.actions';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import InstagramSetupClient from '@/components/InstagramSetupClient';

export const dynamic = 'force-dynamic';

const ERROR_MAP: Record<string, string> = {
  access_denied: ERROR_MESSAGES.INSTAGRAM.AUTH_FAILED,
  auth_failed: ERROR_MESSAGES.INSTAGRAM.AUTH_FAILED,
  missing_params: ERROR_MESSAGES.INSTAGRAM.MISSING_PARAMS,
  auth_required: ERROR_MESSAGES.AUTH.UNAUTHENTICATED,
  invalid_state: ERROR_MESSAGES.INSTAGRAM.INVALID_STATE,
  state_cookie_mismatch: ERROR_MESSAGES.INSTAGRAM.STATE_COOKIE_MISMATCH,
  state_user_mismatch: ERROR_MESSAGES.INSTAGRAM.STATE_USER_MISMATCH,
  state_expired: ERROR_MESSAGES.INSTAGRAM.STATE_EXPIRED,
  invalid_state_signature: ERROR_MESSAGES.INSTAGRAM.INVALID_CREDENTIALS,
  invalid_state_format: ERROR_MESSAGES.INSTAGRAM.INVALID_CREDENTIALS,
  invalid_state_payload: ERROR_MESSAGES.INSTAGRAM.INVALID_CREDENTIALS,
  token_exchange_failed: ERROR_MESSAGES.INSTAGRAM.TOKEN_EXCHANGE_FAILED,
  not_professional_account: ERROR_MESSAGES.INSTAGRAM.NOT_PROFESSIONAL_ACCOUNT,
  server_error: ERROR_MESSAGES.INSTAGRAM.SERVER_ERROR,
  email_link_conflict: ERROR_MESSAGES.AUTH.EMAIL_LINK_CONFLICT,
};

async function InstagramSetupContent({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const connected = searchParams.connected === '1';
  const disconnected = searchParams.disconnected === '1';
  const error = typeof searchParams.error === 'string' ? searchParams.error : undefined;

  const errorMessage = error
    ? ERROR_MAP[error] || ERROR_MESSAGES.INSTAGRAM.UNKNOWN_ERROR
    : null;

  const statusResult = await getInstagramConnectionStatus();
  const initialStatus =
    statusResult.success && statusResult.data
      ? statusResult.data
      : { connected: false as const };

  const isOauthConfigured = Boolean(
    process.env.INSTAGRAM_APP_ID &&
      process.env.INSTAGRAM_APP_SECRET &&
      process.env.INSTAGRAM_REDIRECT_URI &&
      process.env.COOKIE_SECRET
  );

  return (
    <InstagramSetupClient
      initialStatus={initialStatus}
      connectedSuccess={connected}
      disconnectedSuccess={disconnected}
      errorMessage={errorMessage}
      isOauthConfigured={isOauthConfigured}
    />
  );
}

export default async function InstagramSetupPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const authResult = await authMiddleware();
  redirectIfEmailLinkConflict(authResult);
  if (authResult.error || !authResult.userId) {
    redirect('/login');
  }

  if (!canAccessInstagram(authResult.userDetails?.role ?? null)) {
    redirect('/setup');
  }

  const resolvedParams = searchParams ? await searchParams : {};

  return (
    <div className="container mx-auto py-10 px-4">
      <InstagramSetupContent searchParams={resolvedParams} />
    </div>
  );
}
