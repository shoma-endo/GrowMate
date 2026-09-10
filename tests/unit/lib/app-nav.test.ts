/**
 * アプリ共通ナビの出し分けとアクティブ判定（`app-nav`）
 *
 * 出し分けは proxy.ts のパス別ゲートと同じ条件でなければならない。
 * UI で見えるのにサーバーで /unauthorized へ飛ばされる、またはその逆が起きる。
 */
import { describe, expect, it } from 'vitest';
import { getVisibleNavGroups, getVisibleNavItems, isNavItemActive } from '@/lib/app-nav';

type Role = Parameters<typeof getVisibleNavItems>[0];

const labelsFor = (role: Role) => getVisibleNavItems(role).map(item => item.label);
const hrefsFor = (role: Role) => getVisibleNavItems(role).map(item => item.href);

// admin は全項目を見られるので、個別項目の取得は admin 起点で行う
const ALL_ITEMS = getVisibleNavItems('admin');
const itemByHref = (href: string) => {
  const item = ALL_ITEMS.find(candidate => candidate.href === href);
  if (!item) throw new Error(`nav item not found: ${href}`);
  return item;
};

describe('@/lib/app-nav', () => {
  describe('getVisibleNavItems', () => {
    it('未ログイン（null）と trial は全員向けの4項目だけ', () => {
      const expected = ['マイホーム', '事業者情報', 'チャット', 'Google Ads 分析'];
      expect(labelsFor(null)).toEqual(expected);
      expect(labelsFor('trial')).toEqual(expected);
    });

    it('paid はコンテンツ一覧と設定が増え、管理者は出ない', () => {
      expect(labelsFor('paid')).toEqual([
        'マイホーム',
        '事業者情報',
        'チャット',
        'コンテンツ一覧',
        'Google Ads 分析',
        '設定',
      ]);
    });

    it('admin は全7項目', () => {
      expect(labelsFor('admin')).toHaveLength(7);
      expect(labelsFor('admin')).toContain('管理者ダッシュボード');
    });

    it('href で proxy.ts のゲートと一致する（trial に paid/admin 画面を出さない）', () => {
      // proxy.ts: /analytics /setup は paid/admin、/admin は admin。/google-ads-dashboard は認証のみ
      expect(hrefsFor('trial')).toEqual(['/', '/business-info', '/chat', '/google-ads-dashboard']);
      expect(hrefsFor('paid')).not.toContain('/admin');
      expect(hrefsFor('paid')).toEqual(expect.arrayContaining(['/analytics', '/setup']));
      expect(hrefsFor('admin')).toContain('/admin');
    });

    it('unavailable は trial と同じ（画面自体は /unavailable へ誘導される）', () => {
      expect(labelsFor('unavailable')).toEqual(labelsFor('trial'));
    });
  });

  describe('getVisibleNavGroups', () => {
    it('グループはメイン→分析→管理の順で、項目が無いグループは返さない', () => {
      expect(getVisibleNavGroups('admin').map(g => g.group.label)).toEqual(['メイン', '分析', '管理']);
      // trial は「管理」に出せる項目（設定・管理者ダッシュボード）が無い
      expect(getVisibleNavGroups('trial').map(g => g.group.label)).toEqual(['メイン', '分析']);
      // paid は「管理」に設定だけが残る
      expect(getVisibleNavGroups('paid').at(-1)?.items.map(i => i.href)).toEqual(['/setup']);
    });
  });

  describe('isNavItemActive', () => {
    const home = itemByHref('/');
    const analytics = itemByHref('/analytics');
    const businessInfo = itemByHref('/business-info');
    const admin = itemByHref('/admin');

    it('マイホームは完全一致のみ', () => {
      expect(isNavItemActive('/', home)).toBe(true);
      expect(isNavItemActive('/chat', home)).toBe(false);
      expect(isNavItemActive(null, home)).toBe(false);
    });

    it('配下パスは前方一致でアクティブになる', () => {
      expect(isNavItemActive('/analytics', analytics)).toBe(true);
      expect(isNavItemActive('/analytics/abc-123', analytics)).toBe(true);
      expect(isNavItemActive('/admin/users', admin)).toBe(true);
    });

    it('スラッシュ境界を見る（/business-infox は別パス）', () => {
      expect(isNavItemActive('/business-infox', businessInfo)).toBe(false);
    });

    it('activePrefixes のパスでもアクティブになる', () => {
      expect(isNavItemActive('/ga4-dashboard', analytics)).toBe(true);
      expect(isNavItemActive('/gsc-import', analytics)).toBe(true);
      expect(isNavItemActive('/wordpress-import', analytics)).toBe(true);
      expect(isNavItemActive('/ga4-dashboard', businessInfo)).toBe(false);
    });
  });
});
