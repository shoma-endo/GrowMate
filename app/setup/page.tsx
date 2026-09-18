import { getWordPressSettings } from '@/server/actions/wordpress.actions';
import SetupDashboard from '@/components/SetupDashboard';
import { requireSetupAuth } from '@/server/lib/require-setup-auth';
import { toGscConnectionStatusFromResolution } from '@/server/lib/gsc-status';
import { toGa4ConnectionStatusFromResolution } from '@/server/lib/ga4-status';
import { resolveHomeGoogleCredential } from '@/server/lib/home-google-credential';
import { getGoogleAdsConnectionStatus } from '@/server/actions/googleAds.actions';
import { canAccessInstagram } from '@/server/lib/instagram-permissions';
import { getInstagramConnectionStatus } from '@/server/actions/instagramSetup.actions';
import { isGoogleAdsTemporaryError } from '@/lib/home-today';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  const authResult = await requireSetupAuth();
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

  // アクセストークンの期限切れだけで再認証必須と誤判定しないよう、実際にリフレッシュを
  // 試みてから判定する（マイホームと同じロジックを共有。詳細は home-google-credential.ts 参照）。
  const googleCredentialResult = await resolveHomeGoogleCredential(authResult.userId);
  const gscStatus = toGscConnectionStatusFromResolution(googleCredentialResult);
  const ga4Status = toGa4ConnectionStatusFromResolution(googleCredentialResult);

  const result = await getGoogleAdsConnectionStatus();
  const isGoogleAdsTemporarilyFailing = isGoogleAdsTemporaryError(result);
  const googleAdsStatus = {
    connected: result.connected,
    needsReauth: result.needsReauth,
    googleAccountEmail: result.googleAccountEmail,
    customerId: result.customerId,
    hasTemporaryError: isGoogleAdsTemporarilyFailing,
    temporaryErrorMessage: isGoogleAdsTemporarilyFailing ? (result.error ?? null) : null,
  };

  let instagramStatus;
  if (
    canAccessInstagram(authResult.userDetails?.role ?? null)
  ) {
    const instagramResult = await getInstagramConnectionStatus();
    if (instagramResult.success && instagramResult.data) {
      instagramStatus = instagramResult.data;
    }
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
      instagramStatus={instagramStatus}
    />
  );
}
