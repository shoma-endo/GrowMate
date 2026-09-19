import GscSetupClient from '@/components/GscSetupClient';
import { requireSetupAuth } from '@/server/lib/require-setup-auth';
import { toGscConnectionStatusFromResolution } from '@/server/lib/gsc-status';
import { resolveHomeGoogleCredential } from '@/server/lib/home-google-credential';

export const dynamic = 'force-dynamic';

export default async function GscSetupPage() {
  const isOauthConfigured = Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    process.env.GOOGLE_SEARCH_CONSOLE_REDIRECT_URI
  );

  const authResult = await requireSetupAuth();
  // Setup pages should be accessible to owners at all times

  // アクセストークンの期限切れだけで再認証必須と誤判定しないよう、実際にリフレッシュを
  // 試みてから判定する（マイホームと同じロジックを共有。詳細は home-google-credential.ts 参照）。
  const googleCredentialResult = await resolveHomeGoogleCredential(authResult.userId);
  const initialStatus = toGscConnectionStatusFromResolution(googleCredentialResult);

  return <GscSetupClient initialStatus={initialStatus} isOauthConfigured={isOauthConfigured} />;
}
