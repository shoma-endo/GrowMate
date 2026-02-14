import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getWordPressSettings } from '@/server/actions/wordpress.actions';
import SetupDashboard from '@/components/SetupDashboard';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { SupabaseService } from '@/server/services/supabaseService';
import { toGscConnectionStatus } from '@/server/lib/gsc-status';
import { toGa4ConnectionStatus } from '@/server/lib/ga4-status';
import { toUser } from '@/types/user';
import { isAdmin } from '@/authUtils';
import { getGoogleAdsConnectionStatus } from '@/server/actions/googleAds.actions';

export const dynamic = 'force-dynamic';

const supabaseService = new SupabaseService();

export default async function SetupPage() {
  const cookieStore = await cookies();
  const liffAccessToken = cookieStore.get('line_access_token')?.value;
  const refreshToken = cookieStore.get('line_refresh_token')?.value;

  if (!liffAccessToken) {
    redirect('/login');
  }

  const authResult = await authMiddleware(liffAccessToken, refreshToken);
  if (authResult.error || !authResult.userId) {
    redirect('/login');
  }
  // Setup page should be accessible to owners at all times
  // for configuration and error resolution (e.g., GSC re-auth).

  // WordPress設定をチェック（WordPress.comとセルフホスト両対応）
  let hasWordPressSettings = false;
  let wordpressSettings = null;
  try {
    wordpressSettings = await getWordPressSettings();
    hasWordPressSettings = !!(
      (
        wordpressSettings &&
        (wordpressSettings.wpSiteId || // WordPress.com
          wordpressSettings.wpSiteUrl)
      ) // セルフホスト
    );
  } catch (error) {
    console.error('[Setup] Failed to fetch WordPress settings:', error);
  }

  const gscCredential = await supabaseService.getGscCredentialByUserId(authResult.userId);
  const gscStatus = toGscConnectionStatus(gscCredential);
  const ga4Status = toGa4ConnectionStatus(gscCredential);

  // ユーザー情報を取得して管理者かどうかを判定
  const userResult = await supabaseService.getUserById(authResult.userId);
  const user = userResult.success && userResult.data ? toUser(userResult.data) : null;
  const userIsAdmin = user ? isAdmin(user.role) : false;

  // 管理者の場合のみ Google Ads の状態を取得（トークン有効性検証込み）
  let googleAdsStatus = undefined;
  if (userIsAdmin) {
    const result = await getGoogleAdsConnectionStatus();
    googleAdsStatus = {
      connected: result.connected,
      needsReauth: result.needsReauth,
      googleAccountEmail: result.googleAccountEmail,
      customerId: result.customerId,
    };
  }

  return (
    <SetupDashboard
      wordpressSettings={{
        hasSettings: hasWordPressSettings,
        type: wordpressSettings?.wpType || 'wordpress_com',
        ...(wordpressSettings?.wpSiteId && { siteId: wordpressSettings.wpSiteId }),
        ...(wordpressSettings?.wpSiteUrl && { siteUrl: wordpressSettings.wpSiteUrl }),
      }}
      gscStatus={gscStatus}
      ga4Status={ga4Status}
      googleAdsStatus={googleAdsStatus}
      isAdmin={userIsAdmin}
    />
  );
}
