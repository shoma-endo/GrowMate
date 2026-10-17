/**
 * マイホーム（連携の異常）の表示条件（`home-today`）
 *
 * 表示条件は遷移先の proxy.ts ゲート（/setup /analytics は paid/admin、
 * /setup/google-ads は認証のみ、Instagram は paid/admin）と一致していなければならない。
 */
import { describe, expect, it } from 'vitest';
import {
  buildHomeToday,
  isGoogleAdsFetchFailed,
  isGoogleAdsTemporaryError,
  type HomeTodayInput,
} from '@/lib/home-today';

const allBroken: Omit<HomeTodayInput, 'role'> = {
  gsc: { connected: true, needsReauth: true },
  ga4: { connected: true, connectionStage: 'configured', needsReauth: true },
  googleAds: { connected: true, needsReauth: true },
  instagram: { connected: true, needsReauth: true },
  wordpress: { needsReauth: true, importStalled: false },
};

const allHealthy: Omit<HomeTodayInput, 'role'> = {
  gsc: { connected: true, needsReauth: false },
  ga4: { connected: true, connectionStage: 'configured', needsReauth: false },
  googleAds: { connected: true, needsReauth: false },
  instagram: { connected: true, needsReauth: false },
  wordpress: { needsReauth: false, importStalled: false },
};

const idsOf = (input: HomeTodayInput) => buildHomeToday(input).items.map(item => item.id);

describe('@/lib/home-today', () => {
  describe('buildHomeToday', () => {
    it('admin は異常→提案の順で全項目が出る', () => {
      expect(idsOf({ role: 'admin', ...allBroken })).toEqual([
        'gsc-reauth',
        'ga4-reauth',
        'google-ads-reauth',
        'instagram-reauth',
        'wordpress-reauth',
      ]);
    });

    it('trial は Google Ads の再連携だけ（/setup /analytics /instagram に入れないため）', () => {
      expect(idsOf({ role: 'trial', ...allBroken })).toEqual(['google-ads-reauth']);
    });

    it('WordPress は paid/admin の認証切れだけで表示し、trial と正常時は表示しない', () => {
      expect(idsOf({ role: 'paid', ...allHealthy, wordpress: { needsReauth: true, importStalled: false } })).toContain('wordpress-reauth');
      expect(idsOf({ role: 'trial', ...allHealthy, wordpress: { needsReauth: true, importStalled: false } })).not.toContain('wordpress-reauth');
      expect(idsOf({ role: 'admin', ...allHealthy })).not.toContain('wordpress-reauth');
    });

    it('全連携が正常なら空（空状態を出す）', () => {
      const result = buildHomeToday({ role: 'paid', ...allHealthy });
      expect(result.items).toEqual([]);
      expect(result.fetchFailed).toBe(false);
    });

    it('GA4 はプロパティ未選択を出すが、再連携が必要ならそちらを優先する', () => {
      const unselected = { connected: true, connectionStage: 'linked_unselected' as const };
      expect(idsOf({ role: 'paid', ...allHealthy, ga4: unselected })).toEqual(['ga4-unselected']);
      expect(idsOf({ role: 'paid', ...allHealthy, ga4: { ...unselected, needsReauth: true } })).toEqual([
        'ga4-reauth',
      ]);
    });

    it('未連携（connected: false）の GSC は再連携として出さない', () => {
      expect(idsOf({ role: 'paid', ...allHealthy, gsc: { connected: false } })).toEqual([]);
    });

    it('GSC だけ連携した利用者の GA4（unlinked かつ needsReauth）は再連携として出さない', () => {
      const gscOnly = { connected: false, connectionStage: 'unlinked' as const, needsReauth: true };
      const result = buildHomeToday({ role: 'paid', ...allHealthy, ga4: gscOnly });
      expect(result.items).toEqual([]);
      expect(result.hasUnlinked).toBe(true);
    });

    it('全部連携済みなら hasUnlinked は false（空状態で設定へ誘導しない）', () => {
      expect(buildHomeToday({ role: 'paid', ...allHealthy }).hasUnlinked).toBe(false);
      expect(buildHomeToday({ role: 'paid', ...allHealthy, googleAds: { connected: false, needsReauth: false } }).hasUnlinked).toBe(true);
    });


    it('paid でも Instagram の再連携は出る（canAccessInstagram は paid/admin）', () => {
      expect(
        idsOf({ role: 'paid', ...allHealthy, instagram: { connected: true, needsReauth: true } })
      ).toEqual(['instagram-reauth']);
    });


    it('trial で唯一取得する Google Ads の失敗も fetchFailed になる', () => {
      expect(buildHomeToday({ role: 'trial', googleAds: null }).fetchFailed).toBe(true);
    });

    it('取得失敗（null）は fetchFailed にし、他の項目は出す', () => {
      const result = buildHomeToday({
        role: 'paid',
        ...allHealthy,
        gsc: null,
        googleAds: { connected: true, needsReauth: true },
      });
      expect(result.fetchFailed).toBe(true);
      expect(result.items.map(item => item.id)).toEqual(['google-ads-reauth']);
    });

    it('役割上取得しないもの（undefined）は失敗扱いにしない', () => {
      const result = buildHomeToday({ role: 'trial', googleAds: { connected: false, needsReauth: false } });
      expect(result.fetchFailed).toBe(false);
      expect(result.items).toEqual([]);
    });
  });

  describe('isGoogleAdsFetchFailed', () => {
    it('例外で ok:false なら取得失敗', () => {
      expect(isGoogleAdsFetchFailed({ ok: false })).toBe(true);
    });

    it('needsReauth:true + error は正当な再連携待ちなので取得失敗にしない', () => {
      expect(
        isGoogleAdsFetchFailed({
          ok: true,
          value: { connected: true, needsReauth: true, error: 'AUTH_EXPIRED_OR_REVOKED' },
        })
      ).toBe(false);
    });

    it('needsReauth:false + error（一時的失敗）は取得失敗にする', () => {
      expect(
        isGoogleAdsFetchFailed({
          ok: true,
          value: { connected: true, needsReauth: false, error: 'TOKEN_REFRESH_TEMPORARY_FAILURE' },
        })
      ).toBe(true);
    });

    it('needsReauth:false + error無しは健全（取得失敗にしない）', () => {
      expect(
        isGoogleAdsFetchFailed({ ok: true, value: { connected: true, needsReauth: false } })
      ).toBe(false);
    });
  });

  describe('isGoogleAdsTemporaryError', () => {
    it('connected:true + needsReauth:false + error は一時的失敗', () => {
      expect(
        isGoogleAdsTemporaryError({ connected: true, needsReauth: false, error: 'TEMP' })
      ).toBe(true);
    });

    it('needsReauth:true は再連携待ちの正当な状態なので一時的失敗にしない', () => {
      expect(
        isGoogleAdsTemporaryError({ connected: true, needsReauth: true, error: 'AUTH_EXPIRED' })
      ).toBe(false);
    });

    it('connected:false は setup 画面の「連携を開始」表示に譲るため一時的失敗にしない（google-ads/page.tsxと条件を揃える）', () => {
      expect(
        isGoogleAdsTemporaryError({ connected: false, needsReauth: false, error: 'UNKNOWN_ERROR' })
      ).toBe(false);
    });

    it('error が無ければ健全', () => {
      expect(isGoogleAdsTemporaryError({ connected: true, needsReauth: false })).toBe(false);
    });
  });
});

describe('buildHomeToday: プロパティの権限切れ（auto-daily-imports-spec FR-011）', () => {
  const denied: Omit<HomeTodayInput, 'role'> = {
    ...allHealthy,
    gsc: { connected: true, needsReauth: false, propertyAccessDenied: true },
    ga4: { connected: true, connectionStage: 'configured', needsReauth: false, propertyAccessDenied: true },
  };

  it('トークンが有効で権限切れなら、GSC・GA4 のアクセスできないカードが出る', () => {
    const today = buildHomeToday({ role: 'paid', ...denied });
    expect(today.items.map(item => item.id)).toEqual(['gsc-property-denied', 'ga4-property-denied']);
    expect(today.items.every(item => item.kind === 'reauth')).toBe(true);
    expect(today.items.map(item => item.cta.href)).toEqual(['/setup/gsc', '/setup/ga4']);
  });

  it('トークン失効のときは再連携カードだけを出し、アクセスできないカードは重ねない', () => {
    expect(
      idsOf({
        role: 'paid',
        ...denied,
        gsc: { connected: true, needsReauth: true, propertyAccessDenied: true },
        ga4: { connected: true, connectionStage: 'configured', needsReauth: true, propertyAccessDenied: true },
      })
    ).toEqual(['gsc-reauth', 'ga4-reauth']);
  });

  it('権限切れでなければ出ない', () => {
    expect(idsOf({ role: 'paid', ...allHealthy })).toEqual([]);
  });

  it('trial には出さない', () => {
    expect(idsOf({ role: 'trial', ...denied })).toEqual([]);
  });
});

describe('buildHomeToday: WordPress の取込が止まっている（auto-daily-imports-spec FR-012）', () => {
  it('一時的な失敗で止まっていれば、取込が止まっているカードを出す', () => {
    const today = buildHomeToday({ role: 'paid', ...allHealthy, wordpress: { needsReauth: false, importStalled: true } });
    expect(today.items.map(item => item.id)).toEqual(['wordpress-import-stalled']);
    expect(today.items[0]).toMatchObject({ kind: 'reauth', cta: { href: '/setup/wordpress' } });
  });

  it('認証切れのときは再連携カードだけを出し、重ねない', () => {
    expect(idsOf({ role: 'paid', ...allHealthy, wordpress: { needsReauth: true, importStalled: true } }))
      .toEqual(['wordpress-reauth']);
  });

  it('trial には出さない', () => {
    expect(idsOf({ role: 'trial', ...allHealthy, wordpress: { needsReauth: false, importStalled: true } })).toEqual([]);
  });

  it('admin にも出す', () => {
    expect(idsOf({ role: 'admin', ...allHealthy, wordpress: { needsReauth: false, importStalled: true } }))
      .toEqual(['wordpress-import-stalled']);
  });

  it('WordPress 設定の取得に失敗したらカードを出さず、取得失敗として扱う', () => {
    const today = buildHomeToday({ role: 'paid', ...allHealthy, wordpress: null });
    expect(today.items).toEqual([]);
    expect(today.fetchFailed).toBe(true);
  });
});
