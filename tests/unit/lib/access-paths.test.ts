import { describe, expect, it } from 'vitest';

import {
  isGoogleAdsPath,
  isInstagramPath,
  requiresAdminAccess,
  requiresSetupAccess,
} from '@/lib/access-paths';

describe('requiresAdminAccess', () => {
  it('/admin とその配下のみ true', () => {
    expect(requiresAdminAccess('/admin')).toBe(true);
    expect(requiresAdminAccess('/admin/users')).toBe(true);
    expect(requiresAdminAccess('/administration')).toBe(false);
    expect(requiresAdminAccess('/setup')).toBe(false);
  });

  // 前方一致だけの別パスを弾くのは意図した挙動。将来 '/admin-console' のような
  // トップレベルルートを足すときは、ここが false であることを踏まえてゲートを設計する。
  it('ハイフン続きの別ルートは対象外', () => {
    expect(requiresAdminAccess('/admin-console')).toBe(false);
  });

  it('末尾スラッシュでもゲートが効く', () => {
    expect(requiresAdminAccess('/admin/')).toBe(true);
  });
});

describe('requiresSetupAccess', () => {
  it('/setup とその配下は設定ゲートの対象', () => {
    expect(requiresSetupAccess('/setup')).toBe(true);
    expect(requiresSetupAccess('/setup/wordpress')).toBe(true);
    expect(requiresSetupAccess('/setup/gsc')).toBe(true);
    expect(requiresSetupAccess('/setup/ga4')).toBe(true);
  });

  it('Google Ads は trial にも開放するため対象外', () => {
    expect(requiresSetupAccess('/setup/google-ads')).toBe(false);
    expect(requiresSetupAccess('/setup/google-ads/callback')).toBe(false);
  });

  it('Instagram は trial にも開放するため対象外', () => {
    expect(requiresSetupAccess('/setup/instagram')).toBe(false);
  });

  it('境界を見て判定する（前方一致だけの別パスを巻き込まない）', () => {
    // '/setup/instagram-old' は Instagram の開放対象ではないため設定ゲートが効く
    expect(requiresSetupAccess('/setup/instagram-old')).toBe(true);
    expect(requiresSetupAccess('/setup-guide')).toBe(false);
  });

  // proxy は Next.js の trailingSlash 正規化より前に走るため、'/setup/' が
  // ノーガードにならないことを固定する。
  it('末尾スラッシュでもゲートが効く', () => {
    expect(requiresSetupAccess('/setup/')).toBe(true);
    expect(requiresSetupAccess('/setup/instagram/')).toBe(false);
  });

  it('Instagram のサブルートを足しても対象外のまま', () => {
    expect(requiresSetupAccess('/setup/instagram/callback')).toBe(false);
  });

  // '/analytics' の有料ゲートは proxy に無く app/analytics/page.tsx が唯一の判定者。
  // ここが true に変わると二重ゲートになり trial が到達できなくなる。
  it('/analytics は設定パスではない', () => {
    expect(requiresSetupAccess('/analytics')).toBe(false);
  });
});

describe('isGoogleAdsPath', () => {
  it('設定画面とダッシュボードの両方を含む', () => {
    expect(isGoogleAdsPath('/setup/google-ads')).toBe(true);
    expect(isGoogleAdsPath('/google-ads-dashboard')).toBe(true);
    expect(isGoogleAdsPath('/setup/instagram')).toBe(false);
  });
});

describe('isInstagramPath', () => {
  it('連携画面とその配下のみ true', () => {
    expect(isInstagramPath('/setup/instagram')).toBe(true);
    expect(isInstagramPath('/setup/instagram/callback')).toBe(true);
  });

  // '/analytics' は proxy に判定を持たない（page 側が唯一のゲート）ため、ここでは false。
  it('/analytics と別パスは含まない', () => {
    expect(isInstagramPath('/analytics')).toBe(false);
    expect(isInstagramPath('/setup/instagram-old')).toBe(false);
    expect(isInstagramPath('/setup')).toBe(false);
  });
});
