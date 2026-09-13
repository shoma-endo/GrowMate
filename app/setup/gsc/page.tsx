import { redirect } from 'next/navigation';
import GscSetupClient from '@/components/GscSetupClient';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { redirectIfEmailLinkConflict } from '@/server/middleware/authMiddlewareGuards';
import { toGscConnectionStatus } from '@/server/lib/gsc-status';
import { resolveHomeGoogleCredential } from '@/server/lib/home-google-credential';

export const dynamic = 'force-dynamic';

export default async function GscSetupPage() {
  const isOauthConfigured = Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    process.env.GOOGLE_SEARCH_CONSOLE_REDIRECT_URI
  );

  const authResult = await authMiddleware();
  redirectIfEmailLinkConflict(authResult);
  if (authResult.error || !authResult.userId) {
    redirect('/login');
  }
  // Setup pages should be accessible to owners at all times

  // アクセストークンの期限切れだけで再認証必須と誤判定しないよう、実際にリフレッシュを
  // 試みてから判定する（マイホームと同じロジックを共有。詳細は home-google-credential.ts 参照）。
  const googleCredentialResult = await resolveHomeGoogleCredential(authResult.userId);
  const credential =
    googleCredentialResult.kind === 'unconnected' ? null : googleCredentialResult.credential;
  const initialStatus = toGscConnectionStatus(credential);

  return <GscSetupClient initialStatus={initialStatus} isOauthConfigured={isOauthConfigured} />;
}
