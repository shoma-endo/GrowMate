/**
 * 日付と集計期間
 *
 * JST の日付操作・期間の組み立て（`date-utils`）と、集計期間のクランプ
 * （`analytics-period`）。
 *
 * 元は1モジュール1ファイルに分かれていた。30行未満のファイルが並んで
 * 目的のものを絞れなくなっていたため、役割の単位でまとめている。
 * どのモジュールの検査かは外側の describe が示す。
 * 各モジュールのフック（useFakeTimers 等）も外側の describe に閉じる。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addDaysISO,
  buildGscDateRange,
  buildLocalDateRange,
  formatJstDateISO,
} from '@/lib/date-utils';
import { clampAnalyticsPeriod } from '@/lib/analytics-period';

describe('@/lib/date-utils', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('formatJstDateISO', () => {
    it.each([
      ['2026-01-01T14:59:00.000Z', '2026-01-01'],
      ['2026-01-01T15:00:00.000Z', '2026-01-02'],
      ['2026-01-31T15:00:00.000Z', '2026-02-01'],
      ['2025-12-31T15:00:00.000Z', '2026-01-01'],
    ])('%s をJST日付 %s に変換する', (input, expected) => {
      expect(formatJstDateISO(new Date(input))).toBe(expected);
    });
  });

  describe('addDaysISO', () => {
    it.each([
      ['2026-01-31', 1, '2026-02-01'],
      ['2025-12-31', 1, '2026-01-01'],
      ['2024-02-28', 1, '2024-02-29'],
      ['2026-01-01', -1, '2025-12-31'],
    ])('%s に %d 日加算すると %s になる', (input, days, expected) => {
      expect(addDaysISO(input, days)).toBe(expected);
    });

    it('YYYY-MM-DD以外の形式を拒否する', () => {
      expect(() => addDaysISO('2026/01/01', 1)).toThrow('isoDate must be in YYYY-MM-DD format');
    });

    it('整数以外の日数を拒否する', () => {
      expect(() => addDaysISO('2026-01-01', 1.5)).toThrow('days must be an integer');
    });

    it('形式は正しいが実在しない日付を拒否する', () => {
      expect(() => addDaysISO('2026-13-01', 1)).toThrow('Invalid date');
    });
  });

  describe('buildLocalDateRange', () => {
    it('JSTの今日を含む指定日数の範囲を返す', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-02T15:00:00.000Z'));

      expect(buildLocalDateRange(1)).toEqual({
        startDate: '2026-01-03',
        endDate: '2026-01-03',
      });
      expect(buildLocalDateRange(3)).toEqual({
        startDate: '2026-01-01',
        endDate: '2026-01-03',
      });
    });

    it.each([0, -1, 1.5])('%s 日を拒否する', days => {
      expect(() => buildLocalDateRange(days)).toThrow('days must be a positive integer');
    });
  });

  describe('buildGscDateRange', () => {
    it('UTC基準の2日前を終了日として指定日数の範囲を返す', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-10T15:00:00.000Z'));

      expect(buildGscDateRange(3)).toEqual({
        startIso: '2026-01-06',
        endIso: '2026-01-08',
      });
    });

    it.each([
      [0, '2026-01-09'],
      [-1, '2026-01-10'],
    ])('%s 日は開始日が終了日より後になる現行挙動を固定する', (days, startIso) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-10T15:00:00.000Z'));

      expect(buildGscDateRange(days)).toEqual({
        startIso,
        endIso: '2026-01-08',
      });
    });

    it('整数以外の日数を拒否する', () => {
      expect(() => buildGscDateRange(1.5)).toThrow('days must be an integer');
    });
  });
});

describe('@/lib/analytics-period', () => {
  describe('analytics-period', () => {
    it('100日を上限にする', () => {
      expect(clampAnalyticsPeriod('2026-01-01', '2026-04-10')).toEqual({
        startDate: '2026-01-01', endDate: '2026-04-10', clamped: false,
      });
      expect(clampAnalyticsPeriod('2026-01-01', '2026-04-11')).toEqual({
        startDate: '2026-01-02', endDate: '2026-04-11', clamped: true,
      });
      expect(clampAnalyticsPeriod('2026-01-01', '2026-04-10')).toEqual({
        startDate: '2026-01-01', endDate: '2026-04-10', clamped: false,
      });
    });
  });
});
