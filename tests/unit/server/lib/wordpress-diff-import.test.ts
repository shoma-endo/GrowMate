import { describe, expect, it } from 'vitest';
import { classifyWordPressImportFailure, hasWordPressImportTargetChanged, isChangedSinceBaseline } from '@/server/lib/wordpress-diff-import';

describe('WordPress 差分取込（auto-daily-imports-spec §6）', () => {
  it.each([
    ['date_gmt だけが基準より後', { date_gmt: '2026-10-14T00:00:00', modified_gmt: '2026-10-10T00:00:00' }, true],
    ['timezoneのないGMT値をUTCとして比較する', { date_gmt: '2026-10-12T01:00:00' }, true],
    ['modified_gmt だけが基準より後', { date_gmt: '2026-10-10T00:00:00', modified_gmt: '2026-10-14T00:00:00' }, true],
    ['両方とも基準以前', { date_gmt: '2026-10-10T00:00:00', modified_gmt: '2026-10-11T00:00:00' }, false],
  ])('%sの記事を判定する', (_label, post, expected) => {
    expect(isChangedSinceBaseline(post, '2026-10-12T00:00:00Z')).toBe(expected);
  });

  it('投稿タイプの順序だけでは基準をリセットしない', () => {
    expect(hasWordPressImportTargetChanged(
      { wp_type: 'self_hosted', wp_site_url: 'https://example.com', wp_site_id: null, wp_content_types: ['posts', 'pages'] },
      { wpType: 'self_hosted', wpSiteUrl: 'https://example.com', wpSiteId: null, wpContentTypes: ['pages', 'posts'] }
    )).toBe(false);
  });

  it.each([
    ['候補に401がある', { statuses: [401, 404] }, 'auth_expired'],
    ['5xx/ネットワークだけ', { statuses: [503, 0] }, 'temporary_failure'],
    ['ステータスの無いエラー', null, 'temporary_failure'],
  ] as const)('%sを分類する', (_label, error, expected) => {
    expect(classifyWordPressImportFailure(error)).toBe(expected);
  });
});
