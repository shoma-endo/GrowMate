import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Ga4SetupClient from '@/components/Ga4SetupClient';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { SupabaseService } from '@/server/services/supabaseService';
import { toGa4ConnectionStatus } from '@/server/lib/ga4-status';

export const dynamic = 'force-dynamic';

const supabaseService = new SupabaseService();

export default async function Ga4SetupPage() {
  const cookieStore = await cookies();
  const liffAccessToken = cookieStore.get('line_access_token')?.value;
  const refreshToken = cookieStore.get('line_refresh_token')?.value;
  const isOauthConfigured = Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
      process.env.GOOGLE_SEARCH_CONSOLE_REDIRECT_URI
  );

  if (!liffAccessToken) {
    redirect('/login');
  }

  const authResult = await authMiddleware(liffAccessToken, refreshToken);
  if (authResult.error || !authResult.userId) {
    redirect('/login');
  }

  const targetUserId = authResult.actorUserId ?? authResult.userId;
  const credential = await supabaseService.getGscCredentialByUserId(targetUserId);
  const initialStatus = toGa4ConnectionStatus(credential);

  return <Ga4SetupClient initialStatus={initialStatus} isOauthConfigured={isOauthConfigured} />;
}
