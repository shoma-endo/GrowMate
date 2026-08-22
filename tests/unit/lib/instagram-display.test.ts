/**
 * Instagram の表示用整形
 *
 * 件数・投稿日時・率の整形（`instagram-format`）と、同期結果のトースト文言
 * （`instagram-sync`）。
 *
 * 元は1モジュール1ファイルに分かれていた。30行未満のファイルが並んで
 * 目的のものを絞れなくなっていたため、役割の単位でまとめている。
 * どのモジュールの検査かは外側の describe が示す。
 * 各モジュールのフック（useFakeTimers 等）も外側の describe に閉じる。
 */
import { describe, expect, it } from 'vitest';
import { formatCount, formatPostedAt, calculateInstagramRate } from '@/lib/instagram-format';
import { getInstagramSyncToastMessage } from '@/lib/instagram-sync';
import type { InstagramSyncResult } from '@/types/instagram';

describe('@/lib/instagram-format', () => {
  describe('formatPostedAt', () => {
    it('年を必ず含める', () => {
      // プレビューは「最新3件」であって「最近の3件」ではない。
      // 年が無いと、2019年の投稿が今年のものに見える（manbou536 で実際に発生した）。
      expect(formatPostedAt('2019-03-10T02:12:24+0000')).toBe('2019/3/10 投稿');
    });

    it('今年の投稿にも年を出す', () => {
      expect(formatPostedAt('2026-08-02T03:03:06+0000')).toBe('2026/8/2 投稿');
    });

    it('パースできない値はそのまま返す', () => {
      expect(formatPostedAt('not-a-date')).toBe('not-a-date');
    });
  });

  describe('formatCount', () => {
    it('null は "-"（取得できなかった）', () => {
      // 転換前投稿では insights が取れず null になる。0 に丸めると
      // 「実際に0件だった」と区別がつかなくなる。
      expect(formatCount(null)).toBe('-');
    });

    it('0 は "0"（実際に0件）', () => {
      expect(formatCount(0)).toBe('0');
    });

    it('1000未満はそのまま', () => {
      expect(formatCount(89)).toBe('89');
      expect(formatCount(999)).toBe('999');
    });

    it('1000以上は k 表記', () => {
      expect(formatCount(1000)).toBe('1k');
      expect(formatCount(1500)).toBe('1.5k');
      expect(formatCount(12345)).toBe('12.3k');
    });
  });

  describe('calculateInstagramRate', () => {
    it('reach が null / 0 のとき null', () => {
      expect(calculateInstagramRate(10, null)).toBeNull();
      expect(calculateInstagramRate(10, 0)).toBeNull();
    });

    it('分子が null のとき null', () => {
      expect(calculateInstagramRate(null, 100)).toBeNull();
    });

    it('分子 0 かつ分母 > 0 のとき 0.0%', () => {
      expect(calculateInstagramRate(0, 523)).toBe(0);
    });

    it('reach を分母に小数第1位で四捨五入', () => {
      expect(calculateInstagramRate(21, 523)).toBe(4);
    });
  });
});

describe('@/lib/instagram-sync', () => {
  function baseResult(overrides: Partial<InstagramSyncResult> = {}): InstagramSyncResult {
    return {
      mode: 'incremental',
      synced: 0,
      failed: 0,
      skipped: 0,
      truncated: false,
      preConversionCount: 0,
      backfillCompleted: false,
      ...overrides,
    };
  }

  describe('getInstagramSyncToastMessage', () => {
    it('成功時は件数を含む success を返す', () => {
      expect(getInstagramSyncToastMessage(baseResult({ synced: 3 }))).toEqual({
        type: 'success',
        message: '3件を更新しました',
      });
    });

    it('部分失敗時は warning を返す', () => {
      expect(
        getInstagramSyncToastMessage(baseResult({ synced: 2, failed: 1 })).type
      ).toBe('warning');
    });

    it('incremental で truncated 時は info を返し、backfill への誘導文言を含む', () => {
      const message = getInstagramSyncToastMessage(
        baseResult({ synced: 50, truncated: true })
      );
      expect(message.type).toBe('info');
      expect(message.message).toContain('過去の投稿をインポート');
    });

    it('incremental の time_budget 中断時は「最新化」への再試行文言を含む', () => {
      const message = getInstagramSyncToastMessage(
        baseResult({ synced: 10, stoppedReason: 'time_budget' })
      );
      expect(message.type).toBe('warning');
      expect(message.message).toContain('最新化');
    });

    it('backfill の time_budget 中断時は「過去の投稿をインポート」への再試行文言を含む', () => {
      const message = getInstagramSyncToastMessage(
        baseResult({ mode: 'backfill', synced: 10, stoppedReason: 'time_budget' })
      );
      expect(message.type).toBe('warning');
      expect(message.message).toContain('過去の投稿をインポート');
    });

    it('backfill 完了時は success を返す', () => {
      const message = getInstagramSyncToastMessage(
        baseResult({ mode: 'backfill', synced: 5, backfillCompleted: true })
      );
      expect(message.type).toBe('success');
      expect(message.message).toContain('完了');
    });

    it('backfill が truncated（続きあり）のときは info を返す', () => {
      const message = getInstagramSyncToastMessage(
        baseResult({ mode: 'backfill', synced: 50, truncated: true })
      );
      expect(message.type).toBe('info');
      expect(message.message).toContain('続きがあります');
    });

    it('rate_limit 中断はモードに関わらず同じ warning を返す', () => {
      const message = getInstagramSyncToastMessage(
        baseResult({ mode: 'backfill', stoppedReason: 'rate_limit' })
      );
      expect(message.type).toBe('warning');
      expect(message.message).toContain('利用上限');
    });
  });
});
