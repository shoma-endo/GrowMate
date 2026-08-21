/**
 * GA4取込の純関数
 *
 * 同期範囲の決定（`resolveGa4SyncRange` / `splitGa4SyncRange`）と、
 * ベースレポートとイベントレポートの結合（`mergeGa4Reports`）。
 *
 * 元は1モジュール1ファイルに分かれていた。探すときの単位が
 * 「取込 / 集計 / 評価 / 表示」であってモジュール名ではないため、
 * その単位でまとめている。どのモジュールの検査かは外側の describe が示す。
 */
import { describe, expect, it } from 'vitest';
import { resolveGa4SyncRange, splitGa4SyncRange } from '@/server/lib/ga4-sync-range';
import { mergeGa4Reports } from '@/server/lib/ga4-report-merge';

describe('@/server/lib/ga4-sync-range', () => {
  const baseInput = {
    todayJst: '2026-08-18',
    lastSyncedDate: null,
    initialSyncDays: 30,
  };

  describe('resolveGa4SyncRange', () => {
    it('backfillDays=90はカーソルを無視して前日から90日分を返す', () => {
      expect(
        resolveGa4SyncRange({
          ...baseInput,
          lastSyncedDate: '2026-08-17',
          backfillDays: 90,
        })
      ).toEqual({
        ok: true,
        range: { startDate: '2026-05-20', endDate: '2026-08-17' },
      });
    });

    it('backfillDays=1は前日だけを返す', () => {
      expect(resolveGa4SyncRange({ ...baseInput, backfillDays: 1 })).toEqual({
        ok: true,
        range: { startDate: '2026-08-17', endDate: '2026-08-17' },
      });
    });

    it('カーソルありの通常同期は翌日から前日までを返す', () => {
      expect(
        resolveGa4SyncRange({ ...baseInput, lastSyncedDate: '2026-08-10' })
      ).toEqual({
        ok: true,
        range: { startDate: '2026-08-11', endDate: '2026-08-17' },
      });
    });

    it('カーソルなしの通常同期は初回日数分を返す', () => {
      expect(resolveGa4SyncRange(baseInput)).toEqual({
        ok: true,
        range: { startDate: '2026-07-19', endDate: '2026-08-17' },
      });
    });

    it('カーソルが前日以降の通常同期はalready_syncedを返す', () => {
      expect(
        resolveGa4SyncRange({ ...baseInput, lastSyncedDate: '2026-08-17' })
      ).toEqual({ ok: false, reason: 'already_synced' });
    });
  });

  describe('splitGa4SyncRange', () => {
    it('maxDays以下の範囲は分割しない', () => {
      expect(
        splitGa4SyncRange({ startDate: '2026-08-01', endDate: '2026-08-30' }, 30)
      ).toEqual([{ startDate: '2026-08-01', endDate: '2026-08-30' }]);
    });

    it('90日を30日ずつ3窓へ古い順に分割し、境界日を重複も欠落もさせない', () => {
      expect(
        splitGa4SyncRange({ startDate: '2026-05-20', endDate: '2026-08-17' }, 30)
      ).toEqual([
        { startDate: '2026-05-20', endDate: '2026-06-18' },
        { startDate: '2026-06-19', endDate: '2026-07-18' },
        { startDate: '2026-07-19', endDate: '2026-08-17' },
      ]);
    });

    it('割り切れない範囲は最後の窓だけが短くなる', () => {
      expect(
        splitGa4SyncRange({ startDate: '2026-08-01', endDate: '2026-08-05' }, 2)
      ).toEqual([
        { startDate: '2026-08-01', endDate: '2026-08-02' },
        { startDate: '2026-08-03', endDate: '2026-08-04' },
        { startDate: '2026-08-05', endDate: '2026-08-05' },
      ]);
    });

    it('1日だけの範囲は1窓になる', () => {
      expect(
        splitGa4SyncRange({ startDate: '2026-08-17', endDate: '2026-08-17' }, 30)
      ).toEqual([{ startDate: '2026-08-17', endDate: '2026-08-17' }]);
    });

    it('maxDaysが0以下なら例外にする（無限ループを防ぐ）', () => {
      expect(() =>
        splitGa4SyncRange({ startDate: '2026-08-01', endDate: '2026-08-05' }, 0)
      ).toThrow('maxDays must be >= 1');
    });
  });
});

describe('@/server/lib/ga4-report-merge', () => {
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
});
