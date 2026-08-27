/**
 * Instagram 取込の純関数
 *
 * インサイト応答の解釈（`instagram-insights`）、メディア一覧のページング
 * （`instagram-media-pagination`）、レート使用量の解釈（`instagram-rate-limit`）。
 *
 * 元は1モジュール1ファイルに分かれていた。探すときの単位が
 * 「取込 / 連携状態」であってモジュール名ではないため、その単位でまとめている。
 * どのモジュールの検査かは外側の describe が示す。
 */
import { describe, expect, it } from 'vitest';
import {
  extractInsightDailySeries,
  extractInsightMetric,
  insightEndTimeToDateKey,
  parseInsightRawValue,
  type GraphInsightValue,
} from '@/server/lib/instagram-insights';
import {
  collectInstagramMediaPages,
  extractInstagramMediaAfterCursor,
} from '@/server/lib/instagram-media-pagination';
import {
  hasExceededInstagramRateThreshold,
  parseInstagramRateUsage,
} from '@/server/lib/instagram-rate-limit';

describe('@/server/lib/instagram-insights', () => {
  describe('parseInsightRawValue', () => {
    it('数値をそのまま返す', () => {
      expect(parseInsightRawValue(42)).toBe(42);
    });

    it('数値文字列を数値に変換する', () => {
      expect(parseInsightRawValue('123')).toBe(123);
    });

    it('非数値は null を返す', () => {
      expect(parseInsightRawValue('abc')).toBeNull();
      expect(parseInsightRawValue(null)).toBeNull();
      expect(parseInsightRawValue(undefined)).toBeNull();
    });

    it('ネストした value オブジェクトから数値を取り出す', () => {
      expect(parseInsightRawValue({ value: 99 })).toBe(99);
    });
  });

  describe('extractInsightMetric', () => {
    it('先頭 values の metric を返す', () => {
      const values: GraphInsightValue[] = [
        { name: 'reach', values: [{ value: 100 }, { value: 200 }] },
      ];
      expect(extractInsightMetric(values, 'reach')).toBe(100);
    });

    it('data が空のとき null を返す', () => {
      expect(extractInsightMetric([], 'reach')).toBeNull();
    });
  });

  describe('insightEndTimeToDateKey', () => {
    it('end_time の前日を YYYY-MM-DD で返す', () => {
      expect(insightEndTimeToDateKey('2026-07-21T07:00:00+0000')).toBe('2026-07-20');
    });
  });

  describe('extractInsightDailySeries', () => {
    it('日次系列を date と value に展開する', () => {
      const values: GraphInsightValue[] = [
        {
          name: 'reach',
          values: [
            { value: 10, end_time: '2026-07-21T07:00:00+0000' },
            { value: 20, end_time: '2026-07-22T07:00:00+0000' },
          ],
        },
      ];
      expect(extractInsightDailySeries(values, 'reach')).toEqual([
        { date: '2026-07-20', value: 10 },
        { date: '2026-07-21', value: 20 },
      ]);
    });
  });
});

describe('@/server/lib/instagram-media-pagination', () => {
  describe('extractInstagramMediaAfterCursor', () => {
    it('paging.cursors.after を返す', () => {
      expect(
        extractInstagramMediaAfterCursor({
          cursors: { after: 'cursor-abc' },
        })
      ).toBe('cursor-abc');
    });

    it('cursor が欠落しているとき null を返す', () => {
      expect(extractInstagramMediaAfterCursor({})).toBeNull();
      expect(extractInstagramMediaAfterCursor(null)).toBeNull();
      expect(extractInstagramMediaAfterCursor({ cursors: { after: '' } })).toBeNull();
    });
  });

  describe('collectInstagramMediaPages', () => {
    it('複数ページを連結する（最終ページに paging が無ければ nextCursor は null＝アカウント末端）', () => {
      const result = collectInstagramMediaPages(
        [
          { data: [{ id: '1' }, { id: '2' }], paging: { cursors: { after: 'page-2' } } },
          { data: [{ id: '3' }] },
        ],
        50
      );

      expect(result.items).toEqual([{ id: '1' }, { id: '2' }, { id: '3' }]);
      expect(result.truncated).toBe(false);
      expect(result.pagesFetched).toBe(2);
      expect(result.nextCursor).toBeNull();
    });

    it('cursor が欠落したら次ページを辿らない（nextCursor も null）', () => {
      const result = collectInstagramMediaPages(
        [{ data: [{ id: '1' }] }, { data: [{ id: '2' }] }],
        50
      );

      expect(result.items).toEqual([{ id: '1' }]);
      expect(result.pagesFetched).toBe(1);
      expect(result.nextCursor).toBeNull();
    });

    it('空ページで打ち切る（nextCursor は null＝アカウント末端）', () => {
      const result = collectInstagramMediaPages(
        [{ data: [{ id: '1' }], paging: { cursors: { after: 'page-2' } } }, { data: [] }],
        50
      );

      expect(result.items).toEqual([{ id: '1' }]);
      expect(result.pagesFetched).toBe(2);
      expect(result.nextCursor).toBeNull();
    });

    it('maxItems 到達で truncated=true になる', () => {
      const result = collectInstagramMediaPages(
        [
          { data: [{ id: '1' }, { id: '2' }], paging: { cursors: { after: 'page-2' } } },
          { data: [{ id: '3' }, { id: '4' }] },
        ],
        3
      );

      expect(result.items).toEqual([{ id: '1' }, { id: '2' }, { id: '3' }]);
      expect(result.truncated).toBe(true);
      expect(result.pagesFetched).toBe(2);
    });

    it('途中まで完全に取り込んだページの後続カーソルが nextCursor に残る（末端未到達）', () => {
      const result = collectInstagramMediaPages(
        [{ data: [{ id: '1' }, { id: '2' }], paging: { cursors: { after: 'page-2' } } }],
        50
      );

      expect(result.truncated).toBe(false);
      expect(result.nextCursor).toBe('page-2');
    });

    it('truncated したページ自体に paging があれば、その位置からの再開カーソルを nextCursor に返す', () => {
      const result = collectInstagramMediaPages(
        [
          {
            data: [{ id: '1' }, { id: '2' }, { id: '3' }],
            paging: { cursors: { after: 'page-2' } },
          },
        ],
        2
      );

      expect(result.items).toEqual([{ id: '1' }, { id: '2' }]);
      expect(result.truncated).toBe(true);
      expect(result.nextCursor).toBe('page-2');
    });
  });
});

describe('@/server/lib/instagram-rate-limit', () => {
  describe('parseInstagramRateUsage', () => {
    it('X-App-Usage から call_count を読む', () => {
      const headers = new Headers({
        'X-App-Usage': JSON.stringify({ call_count: 42 }),
      });
      expect(parseInstagramRateUsage(headers).appUsage.callCount).toBe(42);
    });
  });

  describe('hasExceededInstagramRateThreshold', () => {
    it('call_count が閾値以上なら true', () => {
      expect(
        hasExceededInstagramRateThreshold(
          { appUsage: { callCount: 80, totalTime: null, totalCpuTime: null }, bucUsage: null },
          80
        )
      ).toBe(true);
    });

    it('call_count が無い場合は false', () => {
      expect(
        hasExceededInstagramRateThreshold(
          { appUsage: { callCount: null, totalTime: null, totalCpuTime: null }, bucUsage: null },
          80
        )
      ).toBe(false);
    });
  });
});
