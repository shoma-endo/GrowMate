import { redirect } from 'next/navigation';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { redirectIfEmailLinkConflict } from '@/server/middleware/authMiddlewareGuards';
import { toGscConnectionStatus } from '@/server/lib/gsc-status';
import { toGa4ConnectionStatus } from '@/server/lib/ga4-status';
import { resolveHomeGoogleCredential } from '@/server/lib/home-google-credential';
import { getGoogleAdsConnectionStatus } from '@/server/actions/googleAds.actions';
import { canAccessInstagram } from '@/server/lib/instagram-permissions';
import { getInstagramConnectionStatus } from '@/server/actions/instagramSetup.actions';
import { hasPaidFeatureAccess } from '@/types/user';
import { buildHomeToday, isGoogleAdsFetchFailed, type HomeTodayInput } from '@/lib/home-today';
import { TodayChecklist } from './_components/TodayChecklist';

export const dynamic = 'force-dynamic';

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
 * マイホーム。連携の異常だけを出す（docs/plans/home-today-spec.md）。改善提案は toast が担う。
 * GSC/GA4・Google Ads とも、アクセストークンの期限が近ければリフレッシュ
 * （Google OAuth 呼び出し＋保存）を試みてから判定する。GSC/GA4 は同一 credential
 * （アクセストークン）を共有するため、リフレッシュは resolveHomeGoogleCredential で1回にまとめる。
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

  const [gscCredential, googleAds, instagram] = await Promise.all([
    paid ? settle('GSC/GA4 credential', resolveHomeGoogleCredential(authResult.userId)) : undefined,
    settle('Google Ads status', getGoogleAdsConnectionStatus()),
    canAccessInstagram(role) ? settle('Instagram status', getInstagramConnectionStatus()) : undefined,
  ]);

  if (gscCredential) {
    // transient_failure（リフレッシュの一時的失敗）は未連携でも再連携要でもないので取得失敗にする
    if (!gscCredential.ok || gscCredential.value.kind === 'transient_failure') {
      input.gsc = null;
      input.ga4 = null;
    } else if (gscCredential.value.kind === 'unconnected') {
      input.gsc = toGscConnectionStatus(null);
      input.ga4 = toGa4ConnectionStatus(null);
    } else {
      input.gsc = toGscConnectionStatus(gscCredential.value.credential);
      input.ga4 = toGa4ConnectionStatus(gscCredential.value.credential);
    }
  }
  if (googleAds) {
    // getGoogleAdsConnectionStatus は例外を握って error 付きの disconnected/一時失敗を返す。
    // needsReauth:true は再連携待ちの正当な状態、それ以外で error があれば
    // 一時的失敗を含む取得失敗として扱う（isGoogleAdsFetchFailed 参照）
    if (!googleAds.ok) {
      input.googleAds = null;
    } else {
      input.googleAds = isGoogleAdsFetchFailed(googleAds)
        ? null
        : { connected: googleAds.value.connected, needsReauth: Boolean(googleAds.value.needsReauth) };
    }
  }
  if (instagram) {
    input.instagram = instagram.ok && instagram.value.success && instagram.value.data ? instagram.value.data : null;
  }

  return <TodayChecklist today={buildHomeToday(input)} canOpenSetup={paid} />;
}
