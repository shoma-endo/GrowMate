import { redirect } from 'next/navigation';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { redirectIfEmailLinkConflict } from '@/server/middleware/authMiddlewareGuards';
import { SupabaseService } from '@/server/services/supabaseService';
import { toGscConnectionStatus } from '@/server/lib/gsc-status';
import { toGa4ConnectionStatus } from '@/server/lib/ga4-status';
import { getGoogleAdsConnectionStatus } from '@/server/actions/googleAds.actions';
import { canAccessInstagram } from '@/server/lib/instagram-permissions';
import { getInstagramConnectionStatus } from '@/server/actions/instagramSetup.actions';
import { gscNotificationService } from '@/server/services/gscNotificationService';
import { hasPaidFeatureAccess } from '@/types/user';
import { buildHomeToday, type HomeTodayInput } from '@/lib/home-today';
import { TodayChecklist } from './_components/TodayChecklist';

export const dynamic = 'force-dynamic';

const supabaseService = new SupabaseService();

type Settled<T> = { ok: true; value: T } | { ok: false };

/** 例外は ok:false に落として画面を止めない（ログは残す）。値の null は「未連携」なので区別する */
async function settle<T>(label: string, promise: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    console.error(`[Home] Failed to load ${label}:`, error);
    return { ok: false };
  }
}

/**
 * マイホーム。「今日確認が必要なこと」だけを出す（docs/plans/home-today-spec.md）。
 * 連携状態の取得は /setup と同じ関数。Google Ads だけはトークン期限切れ時にリフレッシュ
 * （Google OAuth 呼び出し＋保存）が走る。それ以外は DB 読み取りのみ。
 */
export default async function HomePage() {
  const authResult = await authMiddleware();
  redirectIfEmailLinkConflict(authResult);
  // '/' は proxy.ts の公開パスなので、利用停止ロールの振り分けを proxy が行わない。
  // ここで /unavailable へ送らないと /login → / → /login の無限リダイレクトになる。
  if (authResult.roleUnavailable) {
    redirect('/unavailable');
  }
  if (authResult.error || !authResult.userId) {
    redirect('/login');
  }

  const role = authResult.userDetails?.role ?? null;
  const paid = hasPaidFeatureAccess(role);
  const input: HomeTodayInput = { role };

  const [gscCredential, googleAds, instagram, unread] = await Promise.all([
    paid ? settle('GSC credential', supabaseService.getGscCredentialByUserId(authResult.userId)) : undefined,
    settle('Google Ads status', getGoogleAdsConnectionStatus()),
    canAccessInstagram(role) ? settle('Instagram status', getInstagramConnectionStatus()) : undefined,
    paid
      ? settle('unread suggestions', gscNotificationService.getUnreadSuggestionsAnnotationCount(authResult.userId))
      : undefined,
  ]);

  if (gscCredential) {
    // credential が null なのは未連携（/setup と同じ扱い）。取得失敗だけを null にする
    input.gsc = gscCredential.ok ? toGscConnectionStatus(gscCredential.value) : null;
    input.ga4 = gscCredential.ok ? toGa4ConnectionStatus(gscCredential.value) : null;
  }
  if (googleAds) {
    // getGoogleAdsConnectionStatus は例外を握って error 付きの disconnected を返す。
    // connected: true + error は再連携待ちの正当な状態なので、未連携 + error だけを取得失敗にする
    const failed = !googleAds.ok || (Boolean(googleAds.value.error) && !googleAds.value.connected);
    input.googleAds = failed
      ? null
      : { connected: googleAds.value.connected, needsReauth: Boolean(googleAds.value.needsReauth) };
  }
  if (instagram) {
    input.instagram = instagram.ok && instagram.value.success && instagram.value.data ? instagram.value.data : null;
  }
  if (unread) {
    input.unreadSuggestionCount = unread.ok ? unread.value : null;
  }

  return <TodayChecklist today={buildHomeToday(input)} canOpenSetup={paid} />;
}
