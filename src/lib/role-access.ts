import { isAdmin, isUnavailable } from '@/authUtils';
import { hasPaidFeatureAccess, type UserRole } from '@/types/user';

const ADMIN_REQUIRED_PATHS = ['/admin'] as const;
// '/ga4-dashboard' は有料機能の画面。Server Action だけでなく画面遷移時にも trial を拒否する。
const PAID_FEATURE_REQUIRED_PATHS = ['/analytics', '/ga4-dashboard'] as const;
const SETUP_PATHS = ['/setup'] as const;
const GOOGLE_ADS_PATHS = ['/setup/google-ads', '/google-ads-dashboard'] as const;

function requiresAdminAccess(pathname: string): boolean {
  return ADMIN_REQUIRED_PATHS.some(path => pathname.startsWith(path));
}

function requiresPaidFeatureAccess(pathname: string): boolean {
  return PAID_FEATURE_REQUIRED_PATHS.some(path => pathname.startsWith(path));
}

function requiresGoogleAdsAccess(pathname: string): boolean {
  return GOOGLE_ADS_PATHS.some(path => pathname.startsWith(path));
}

function requiresSetupAccess(pathname: string): boolean {
  return SETUP_PATHS.some(path => pathname.startsWith(path)) && !requiresGoogleAdsAccess(pathname);
}

/**
 * 認証済みユーザーのロールと現在パスから、必要な退避先を返す。
 * proxy と AuthProvider で同じ判定を使い、キャッシュ復元時も権限外本文を表示しない。
 */
export function getRoleAccessRedirectPath(
  pathname: string,
  role: UserRole
): '/unavailable' | '/unauthorized' | null {
  if (isUnavailable(role)) {
    return pathname === '/unavailable' ? null : '/unavailable';
  }
  if (requiresSetupAccess(pathname) && !hasPaidFeatureAccess(role)) {
    return '/unauthorized';
  }
  if (requiresPaidFeatureAccess(pathname) && !hasPaidFeatureAccess(role)) {
    return '/unauthorized';
  }
  if (requiresAdminAccess(pathname) && !isAdmin(role)) {
    return '/unauthorized';
  }
  return null;
}
