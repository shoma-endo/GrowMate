import { FileText, Home, List, MessageCircle, Plug, Settings, Shield, type LucideIcon } from 'lucide-react';
import { isAdmin } from '@/authUtils';
import { hasPaidFeatureAccess, type UserRole } from '@/types/user';

/**
 * アプリ共通ナビ（サイドバー / モバイルドロワー）の項目定義。ここが唯一の正本。
 *
 * `access` は UI の出し分けだけを担う。実際の認可は proxy.ts のパス別ゲート
 * （/analytics・/setup は paid/admin、/admin は admin）が行うので、ここは
 * それと同じ条件に揃えておく。
 *
 * 追加基準（docs/plans/pc-first-app-shell-spec.md「項目とグループの追加基準」）:
 * - 足すのは他の画面から辿れないハブだけ。既存ハブ配下の画面は親の activePrefixes に足す
 * - グループは 3 つ据え置き。増やすのはどこにも入らない項目が 2 つ以上たまったとき
 * - 10 個を超えたら階層表示を別仕様で検討する（グループ折りたたみは作らない）
 */
type AppNavAccess = 'all' | 'paid' | 'admin';

/** サイドバーのグループ。表示順は APP_NAV_GROUPS の順 */
type AppNavGroupId = 'main' | 'analytics' | 'admin';

export interface AppNavGroup {
  id: AppNavGroupId;
  label: string;
}

const APP_NAV_GROUPS: readonly AppNavGroup[] = [
  { id: 'main', label: 'メイン' },
  { id: 'analytics', label: '分析' },
  { id: 'admin', label: '管理' },
];

export interface AppNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  access: AppNavAccess;
  group: AppNavGroupId;
  /** href 配下ではないが、この項目をアクティブ扱いにするパスの接頭辞 */
  activePrefixes?: readonly string[];
}

const APP_NAV_ITEMS: readonly AppNavItem[] = [
  { label: 'マイホーム', href: '/', icon: Home, access: 'all', group: 'main' },
  { label: '事業者情報', href: '/business-info', icon: FileText, access: 'all', group: 'main' },
  { label: 'チャット', href: '/chat', icon: MessageCircle, access: 'all', group: 'main' },
  {
    label: 'コンテンツ一覧',
    href: '/analytics',
    icon: List,
    access: 'paid',
    group: 'analytics',
    // /analytics 内の導線から遷移する取り込み・GA4 画面。サイドバーには載せない
    activePrefixes: ['/ga4-dashboard', '/gsc-import', '/wordpress-import'],
  },
  { label: 'Google Ads 分析', href: '/google-ads-dashboard', icon: Plug, access: 'all', group: 'analytics' },
  { label: '設定', href: '/setup', icon: Settings, access: 'paid', group: 'admin' },
  { label: '管理者ダッシュボード', href: '/admin', icon: Shield, access: 'admin', group: 'admin' },
];

function hasNavAccess(role: UserRole | null, access: AppNavAccess): boolean {
  switch (access) {
    case 'all':
      return true;
    case 'paid':
      return hasPaidFeatureAccess(role);
    case 'admin':
      return isAdmin(role);
  }
}

export function getVisibleNavItems(role: UserRole | null): AppNavItem[] {
  return APP_NAV_ITEMS.filter(item => hasNavAccess(role, item.access));
}

/** 表示できる項目をグループ順に束ねる。項目が 1 つも無いグループは返さない */
export function getVisibleNavGroups(
  role: UserRole | null
): Array<{ group: AppNavGroup; items: AppNavItem[] }> {
  const items = getVisibleNavItems(role);
  return APP_NAV_GROUPS.map(group => ({
    group,
    items: items.filter(item => item.group === group.id),
  })).filter(entry => entry.items.length > 0);
}

/**
 * 完全一致、またはスラッシュ区切りの前方一致で判定する（public-paths と同じ境界ルール）。
 * '/' だけは完全一致のみ。前方一致にすると全ページでアクティブになる。
 */
function matchesPath(pathname: string, prefix: string): boolean {
  if (prefix === '/') return pathname === '/';
  return pathname === prefix || pathname.startsWith(prefix + '/');
}

export function isNavItemActive(pathname: string | null, item: AppNavItem): boolean {
  if (!pathname) return false;
  if (matchesPath(pathname, item.href)) return true;
  return (item.activePrefixes ?? []).some(prefix => matchesPath(pathname, prefix));
}
