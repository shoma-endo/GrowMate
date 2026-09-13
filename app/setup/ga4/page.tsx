import { redirect } from 'next/navigation';
import Ga4SetupClient from '@/components/Ga4SetupClient';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { redirectIfEmailLinkConflict } from '@/server/middleware/authMiddlewareGuards';
import { toGa4ConnectionStatusFromResolution } from '@/server/lib/ga4-status';
import { resolveHomeGoogleCredential } from '@/server/lib/home-google-credential';

export const dynamic = 'force-dynamic';

export default async function Ga4SetupPage() {
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

  const targetUserId = authResult.userId;
  // アクセストークンの期限切れだけで再認証必須と誤判定しないよう、実際にリフレッシュを
  // 試みてから判定する（マイホームと同じロジックを共有。詳細は home-google-credential.ts 参照）。
  const googleCredentialResult = await resolveHomeGoogleCredential(targetUserId);
  const initialStatus = toGa4ConnectionStatusFromResolution(googleCredentialResult);

  return <Ga4SetupClient initialStatus={initialStatus} isOauthConfigured={isOauthConfigured} />;
}
