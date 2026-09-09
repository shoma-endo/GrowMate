/**
 * マイホーム「今日の確認」の表示条件（`home-today`）
 *
 * 表示条件は遷移先の proxy.ts ゲート（/setup /analytics は paid/admin、
 * /setup/google-ads は認証のみ、Instagram は paid/admin）と一致していなければならない。
 */
import { describe, expect, it } from 'vitest';
import { buildHomeToday, type HomeTodayInput } from '@/lib/home-today';

const allBroken: Omit<HomeTodayInput, 'role'> = {
  gsc: { connected: true, needsReauth: true },
  ga4: { connected: true, connectionStage: 'configured', needsReauth: true },
  googleAds: { connected: true, needsReauth: true },
  instagram: { connected: true, needsReauth: true },
  unreadSuggestionCount: 3,
};

const allHealthy: Omit<HomeTodayInput, 'role'> = {
  gsc: { connected: true, needsReauth: false },
  ga4: { connected: true, connectionStage: 'configured', needsReauth: false },
  googleAds: { connected: true, needsReauth: false },
  instagram: { connected: true, needsReauth: false },
  unreadSuggestionCount: 0,
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
        'unread-suggestions',
      ]);
    });

    it('trial は Google Ads の再連携だけ（/setup /analytics /instagram に入れないため）', () => {
      expect(idsOf({ role: 'trial', ...allBroken })).toEqual(['google-ads-reauth']);
    });

    it('全連携が正常で未読 0 件なら空（空状態を出す）', () => {
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

    it('改善提案は件数を見出しに含め、未読フィルタ付きの一覧へ飛ばす', () => {
      const result = buildHomeToday({ role: 'paid', ...allHealthy, unreadSuggestionCount: 3 });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.title).toBe('3 件のコンテンツに改善提案があります');
      expect(result.items[0]?.cta.href).toBe('/analytics?unread_suggestion=1');
    });

    it('paid でも Instagram の再連携は出る（canAccessInstagram は paid/admin）', () => {
      expect(
        idsOf({ role: 'paid', ...allHealthy, instagram: { connected: true, needsReauth: true } })
      ).toEqual(['instagram-reauth']);
    });

    it('未読件数の取得失敗は fetchFailed にし、提案は出さない', () => {
      const result = buildHomeToday({ role: 'paid', ...allHealthy, unreadSuggestionCount: null });
      expect(result.fetchFailed).toBe(true);
      expect(result.items).toEqual([]);
    });

    it('trial で唯一取得する Google Ads の失敗も fetchFailed になる', () => {
      expect(buildHomeToday({ role: 'trial', googleAds: null }).fetchFailed).toBe(true);
    });

    it('取得失敗（null）は fetchFailed にし、他の項目は出す', () => {
      const result = buildHomeToday({
        role: 'paid',
        ...allHealthy,
        gsc: null,
        unreadSuggestionCount: 2,
      });
      expect(result.fetchFailed).toBe(true);
      expect(result.items.map(item => item.id)).toEqual(['unread-suggestions']);
    });

    it('役割上取得しないもの（undefined）は失敗扱いにしない', () => {
      const result = buildHomeToday({ role: 'trial', googleAds: { connected: false, needsReauth: false } });
      expect(result.fetchFailed).toBe(false);
      expect(result.items).toEqual([]);
    });
  });
});
