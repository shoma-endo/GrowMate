import { describe, expect, it } from 'vitest';

import { mergeGa4Reports } from '@/server/lib/ga4-report-merge';

/**
 * 完読率の「未計測」と「実測0回」を取り違えると、読了スコア40未満の記事が
 * 計測していない完読率を根拠に R_TOP_EXIT へ強制上書きされ、LLM へも
 * 「実測なし。1人あたり平均で全体の0%まで読まれています」という矛盾した文言が渡る。
 * mergeReports はその分岐点なので、境界を固定する（BR-02 / 仕様書 §6.2.4）。
 */
const baseRow = {
  date: '2026-08-18',
  pagePath: '/articles/one',
  sessions: 10,
  users: 10,
  engagementTimeSec: 100,
  bounceRate: 0.3,
  engagementRate: 0.5,
  activeUsers: 8,
};

const otherBaseRow = { ...baseRow, pagePath: '/articles/two' };

const merge = (
  eventRows: Array<{ date: string; pagePath: string; eventName: string; eventCount: number }>,
  scrollEventName: string | null,
  conversionEvents: string[] = []
) => mergeGa4Reports([baseRow, otherBaseRow], eventRows, conversionEvents, scrollEventName);

describe('mergeGa4Reports — スクロールの未計測と実測0の区別', () => {
  it('採用イベント名が null なら全行を未計測(null)として書く', () => {
    const merged = merge([], null);

    expect(merged).toHaveLength(2);
    expect(merged.every(row => row.scroll90EventCount === null)).toBe(true);
  });

  it('採用イベント名が null でも、CVイベントは通常どおり加算する', () => {
    const merged = merge(
      [{ date: '2026-08-18', pagePath: '/articles/one', eventName: 'purchase', eventCount: 3 }],
      null,
      ['purchase']
    );

    const target = merged.find(row => row.normalizedPath === '/articles/one');
    expect(target?.cvEventCount).toBe(3);
    expect(target?.scroll90EventCount).toBeNull();
  });

  it('採用イベント名があれば、発火しなかったページは実測0として書く（nullにしない）', () => {
    const merged = merge(
      [{ date: '2026-08-18', pagePath: '/articles/one', eventName: 'scroll', eventCount: 4 }],
      'scroll'
    );

    expect(merged.find(row => row.normalizedPath === '/articles/one')?.scroll90EventCount).toBe(4);
    // 同じウィンドウで1件も発火しなかったページは「実測して0回」であり未計測ではない
    expect(merged.find(row => row.normalizedPath === '/articles/two')?.scroll90EventCount).toBe(0);
  });

  it('採用イベント名以外のスクロール候補は加算しない（両方あっても二重計上しない）', () => {
    const merged = merge(
      [
        { date: '2026-08-18', pagePath: '/articles/one', eventName: 'scroll_90', eventCount: 4 },
        { date: '2026-08-18', pagePath: '/articles/one', eventName: 'scroll', eventCount: 7 },
      ],
      'scroll_90'
    );

    expect(merged.find(row => row.normalizedPath === '/articles/one')?.scroll90EventCount).toBe(4);
  });

  it('ベース行が無いイベント行は無視する（ページ文脈のないイベントは集計しない）', () => {
    const merged = merge(
      [{ date: '2026-08-18', pagePath: '/not-in-base', eventName: 'scroll', eventCount: 99 }],
      'scroll'
    );

    expect(merged).toHaveLength(2);
    expect(merged.every(row => row.scroll90EventCount === 0)).toBe(true);
  });

  it('末尾スラッシュ違いのイベント行も正規化後のパスで突き合わせる', () => {
    const merged = merge(
      [{ date: '2026-08-18', pagePath: '/articles/one/', eventName: 'scroll', eventCount: 5 }],
      'scroll'
    );

    expect(merged.find(row => row.normalizedPath === '/articles/one')?.scroll90EventCount).toBe(5);
  });
});
