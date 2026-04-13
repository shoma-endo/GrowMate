import { redirect } from 'next/navigation';
import GscSetupClient from '@/components/GscSetupClient';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { redirectIfEmailLinkConflict } from '@/server/middleware/authMiddlewareGuards';
import { SupabaseService } from '@/server/services/supabaseService';
import { toGscConnectionStatus } from '@/server/lib/gsc-status';

export const dynamic = 'force-dynamic';

const supabaseService = new SupabaseService();

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

  const credential = await supabaseService.getGscCredentialByUserId(authResult.userId);
  const initialStatus = toGscConnectionStatus(credential);

  return <GscSetupClient initialStatus={initialStatus} isOauthConfigured={isOauthConfigured} />;
}
