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
  it('連携画面と /analytics を含む', () => {
    expect(isInstagramPath('/setup/instagram')).toBe(true);
    expect(isInstagramPath('/analytics')).toBe(true);
  });

  it('別パスは含まない', () => {
    expect(isInstagramPath('/setup/instagram-old')).toBe(false);
    expect(isInstagramPath('/analytics-export')).toBe(false);
    expect(isInstagramPath('/setup')).toBe(false);
  });
});
