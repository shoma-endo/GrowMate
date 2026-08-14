/**
 * proxy.ts のルートゲートが参照するパス定義。
 *
 * ロールとの突き合わせは proxy.ts が行う。ここは「どのパスがどのゲートの対象か」だけを
 * 純関数として持ち、単体テストできるようにしている。
 *
 * 認証不要パスはここに置かない（proxy.ts の PUBLIC_PATHS と src/lib/public-paths.ts が正本）。
 */

const ADMIN_REQUIRED_PATHS = ['/admin'] as const;
const SETUP_PATHS = ['/setup'] as const;

/**
 * Google Ads は有料ロール限定にせず trial にも開放しているパス。
 * `/setup` 配下だが設定ゲートの対象外として扱う（既存の運用）。
 */
const GOOGLE_ADS_PATHS = ['/setup/google-ads', '/google-ads-dashboard'] as const;

/**
 * Instagram の開放範囲は admin / paid / trial（`docs/plans/instagram-integration-design.md` §7）。
 * App Review 通過に伴う限定公開の解除（同 §4 Phase 2 item6）で trial まで広げるため、
 * `/setup/instagram` は設定ゲートの対象から外す。
 *
 * **`/analytics` はここに入れない。** 同ページは Instagram タブが有料機能のブログ一覧と
 * 同居するため、proxy にロール判定を一切持たせず、`app/analytics/page.tsx` の
 * `hasPaidFeatureAccess` を唯一のゲートにしている。`/analytics` は `/setup` 配下ではないので
 * この配列に入れても `requiresSetupAccess` の分岐に到達せず、読み手に
 * 「ここで開放されている」と誤解させるだけになる。
 */
const INSTAGRAM_PATHS = ['/setup/instagram'] as const;

/**
 * 完全一致、またはスラッシュ区切りの前方一致で判定する。
 * `/setup/instagram-old` のような別パスを誤って同一視しないよう境界を明示的に見る。
 */
function matchesPath(pathname: string, paths: readonly string[]): boolean {
  return paths.some(path => pathname === path || pathname.startsWith(path + '/'));
}

export function requiresAdminAccess(pathname: string): boolean {
  return matchesPath(pathname, ADMIN_REQUIRED_PATHS);
}

export function isGoogleAdsPath(pathname: string): boolean {
  return matchesPath(pathname, GOOGLE_ADS_PATHS);
}

export function isInstagramPath(pathname: string): boolean {
  return matchesPath(pathname, INSTAGRAM_PATHS);
}

/**
 * 設定ゲート（paid / admin のみ）の対象パスか。
 * Google Ads と Instagram は trial にも開放するため対象外にする。
 */
export function requiresSetupAccess(pathname: string): boolean {
  return (
    matchesPath(pathname, SETUP_PATHS) &&
    !isGoogleAdsPath(pathname) &&
    !isInstagramPath(pathname)
  );
}
