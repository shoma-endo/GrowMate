import { describe, expect, it } from 'vitest';
import { getRoleAccessRedirectPath } from '@/lib/role-access';

describe('@/lib/role-access', () => {
  it('trial を有料・管理者向け画面から退避させる', () => {
    expect(getRoleAccessRedirectPath('/analytics', 'trial')).toBe('/unauthorized');
    expect(getRoleAccessRedirectPath('/ga4-dashboard', 'trial')).toBe('/unauthorized');
    expect(getRoleAccessRedirectPath('/setup', 'trial')).toBe('/unauthorized');
    expect(getRoleAccessRedirectPath('/admin/users', 'trial')).toBe('/unauthorized');
  });

  it('paid は有料画面を利用できるが管理者画面からは退避させる', () => {
    expect(getRoleAccessRedirectPath('/analytics/example', 'paid')).toBeNull();
    expect(getRoleAccessRedirectPath('/setup/wordpress', 'paid')).toBeNull();
    expect(getRoleAccessRedirectPath('/admin', 'paid')).toBe('/unauthorized');
  });

  it('Google Ads 設定は trial でも利用できる既存例外を維持する', () => {
    expect(getRoleAccessRedirectPath('/setup/google-ads', 'trial')).toBeNull();
    expect(getRoleAccessRedirectPath('/google-ads-dashboard', 'trial')).toBeNull();
  });

  it('admin は全ての認証必須画面を利用できる', () => {
    expect(getRoleAccessRedirectPath('/admin', 'admin')).toBeNull();
    expect(getRoleAccessRedirectPath('/analytics', 'admin')).toBeNull();
    expect(getRoleAccessRedirectPath('/setup', 'admin')).toBeNull();
  });

  it('unavailable は専用画面以外から退避させる', () => {
    expect(getRoleAccessRedirectPath('/', 'unavailable')).toBe('/unavailable');
    expect(getRoleAccessRedirectPath('/admin', 'unavailable')).toBe('/unavailable');
    expect(getRoleAccessRedirectPath('/unavailable', 'unavailable')).toBeNull();
  });
});
