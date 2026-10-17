import { describe, expect, it } from 'vitest';
import {
  classifyWordPressImportFailure,
  hasWordPressImportTargetChanged,
  isChangedSinceBaseline,
  isWordPressImportStalled,
} from '@/server/lib/wordpress-diff-import';

describe('WordPress 差分取込（auto-daily-imports-spec §6）', () => {
  it.each([
    ['date_gmt だけが基準より後', { date_gmt: '2026-10-14T00:00:00', modified_gmt: '2026-10-10T00:00:00' }, true],
    ['timezoneのないGMT値をUTCとして比較する', { date_gmt: '2026-10-12T01:00:00' }, true],
    ['modified_gmt だけが基準より後', { date_gmt: '2026-10-10T00:00:00', modified_gmt: '2026-10-14T00:00:00' }, true],
    ['両方とも基準以前', { date_gmt: '2026-10-10T00:00:00', modified_gmt: '2026-10-11T00:00:00' }, false],
  ])('%sの記事を判定する', (_label, post, expected) => {
    expect(isChangedSinceBaseline(post, '2026-10-12T00:00:00Z')).toBe(expected);
  });

  it.each([
    ['タイプを外しただけ', ['posts', 'pages', 'product'], ['posts', 'pages'], false],
    ['タイプを足した', ['posts'], ['posts', 'pages'], true],
    ['入れ替えた（足したタイプがある）', ['posts', 'product'], ['posts', 'pages'], true],
  ])('投稿タイプの変更で基準をリセットするか: %s', (_label, before, after, expected) => {
    expect(hasWordPressImportTargetChanged(
      { wp_type: 'self_hosted', wp_site_url: 'https://example.com', wp_site_id: null, wp_content_types: before },
      { wpType: 'self_hosted', wpSiteUrl: 'https://example.com', wpSiteId: null, wpContentTypes: after }
    )).toBe(expected);
  });

  it('投稿タイプの順序だけでは基準をリセットしない', () => {
    expect(hasWordPressImportTargetChanged(
      { wp_type: 'self_hosted', wp_site_url: 'https://example.com', wp_site_id: null, wp_content_types: ['posts', 'pages'] },
      { wpType: 'self_hosted', wpSiteUrl: 'https://example.com', wpSiteId: null, wpContentTypes: ['pages', 'posts'] }
    )).toBe(false);
  });

  it.each([
    ['候補に401がある', { statuses: [401, 404] }, 'auth_expired'],
    // 片方の候補がサイトの失敗なら、403 はその形式が使えないだけのことがあり、再連携では直らない
    ['一方が5xxでもう一方が403', { statuses: [500, 403] }, 'temporary_failure'],
    // 401 は認証情報が無効になったので、別の候補がサイトの失敗でも再連携を求める
    ['応答切れと401', { statuses: [0, 401] }, 'auth_expired'],
    ['5xx/ネットワークだけ', { statuses: [503, 0] }, 'temporary_failure'],
    ['ステータスの無いエラー', null, 'temporary_failure'],
  ] as const)('%sを分類する', (_label, error, expected) => {
    expect(classifyWordPressImportFailure(error)).toBe(expected);
  });
});

describe('isWordPressImportStalled（auto-daily-imports-spec FR-012）', () => {
  const now = new Date('2026-10-20T00:00:00Z').getTime();
  it.each([
    ['一時的な失敗で、最後に取り込めたのが3日前', 'temporary_failure', '2026-10-17T00:00:00Z', '2026-09-01T00:00:00Z', true],
    ['一時的な失敗だが、最後に取り込めたのが2日前', 'temporary_failure', '2026-10-18T00:00:00Z', '2026-09-01T00:00:00Z', false],
    ['一度も取り込めず、連携から3日以上たった', 'temporary_failure', null, '2026-10-16T00:00:00Z', true],
    ['一度も取り込めず、連携から間もない', 'temporary_failure', null, '2026-10-19T00:00:00Z', false],
    ['成功している', 'succeeded', '2026-10-01T00:00:00Z', '2026-09-01T00:00:00Z', false],
    ['認証切れ（別のカードで知らせる）', 'auth_expired', '2026-10-01T00:00:00Z', '2026-09-01T00:00:00Z', false],
    ['未実行', null, null, '2026-09-01T00:00:00Z', false],
    ['日付が無い', 'temporary_failure', null, null, false],
    // Supabase の timestamptz はマイクロ秒付きで返る
    ['マイクロ秒付きの日時', 'temporary_failure', '2026-10-16T23:59:59.123456+00:00', null, true],
  ] as const)('%s', (_label, autoImportStatus, importBaselineAt, createdAt, expected) => {
    expect(isWordPressImportStalled({ autoImportStatus, importBaselineAt, createdAt }, now)).toBe(expected);
  });
});
