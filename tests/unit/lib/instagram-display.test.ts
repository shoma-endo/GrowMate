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
import { describe, expect, it, vi } from 'vitest';
import {
  formatCount,
  formatInstagramEngagementTargetLabel,
  formatInstagramRate,
  formatPostedAt,
  getInstagramEngagementTarget,
  isInstagramEngagementTargetMet,
} from '@/lib/instagram-format';
import { getInstagramSyncToastMessage, shouldAutoSyncInstagram } from '@/lib/instagram-sync';
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

  describe('engagement target', () => {
    it.each([
      [0, 'ライト／ビギナー', 6],
      [999, 'ライト／ビギナー', 6],
      [1000, 'ナノ', 4],
      [4999, 'ナノ', 4],
      [5000, null, 3],
      [9999, null, 3],
      [10000, 'マイクロ', 2],
      [49999, 'マイクロ', 2],
      [50000, 'ミドル', 1.5],
      [99999, 'ミドル', 1.5],
      [100000, 'メガ／インフルエンサー', 0.8],
      [1000000, 'メガ／インフルエンサー', 0.8],
    ] as const)('フォロワー数 %s は %s の目標になる', (followers, tier, min) => {
      const target = getInstagramEngagementTarget(followers);
      expect(target?.tierLabel).toBe(tier);
      expect(target?.min).toBe(min);
    });

    it('フォロワー数が null なら判定しない', () => {
      expect(getInstagramEngagementTarget(null)).toBeNull();
    });

    it('下限と同値は達成、下限未満と率 null は未達成', () => {
      const target = getInstagramEngagementTarget(3200);
      expect(target).not.toBeNull();
      expect(isInstagramEngagementTargetMet(4, target)).toBe(true);
      expect(isInstagramEngagementTargetMet(3.99, target)).toBe(false);
      expect(isInstagramEngagementTargetMet(null, target)).toBe(false);
    });

    it('ダイアログの目標文言を整形する', () => {
      const target = getInstagramEngagementTarget(3200);
      expect(target).not.toBeNull();
      expect(formatInstagramEngagementTargetLabel(3200, target!)).toBe(
        'フォロワー 3,200人（ナノ）の目標: 4.0〜6.0%'
      );
      const firstTarget = getInstagramEngagementTarget(0);
      expect(formatInstagramEngagementTargetLabel(0, firstTarget!)).toContain('6.0〜10.0% 以上');
    });

    it('率を小数第1位へ表示する', () => {
      expect(formatInstagramRate(6.04)).toBe('6.0%');
      expect(formatInstagramRate(6.06)).toBe('6.1%');
      expect(formatInstagramRate(null)).toBe('-');
    });
  });
});

describe('@/lib/instagram-sync', () => {
  function baseResult(overrides: Partial<InstagramSyncResult> = {}): InstagramSyncResult {
    return {
      mode: 'incremental',
      synced: 0,
      failed: 0,
      refreshed: 0,
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

    it('取り直しだけのときは「更新対象なし」を返す', () => {
      expect(getInstagramSyncToastMessage(baseResult({ refreshed: 2 }))).toEqual({
        type: 'success',
        message: '更新対象の投稿はありませんでした',
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

  describe('shouldAutoSyncInstagram', () => {
    it('未同期（null）なら同期する', () => {
      expect(shouldAutoSyncInstagram(null, '2026-09-16')).toBe(true);
    });

    it('前日までの同期なら同期する', () => {
      // JST 2026-09-15 23:00 = UTC 14:00
      expect(shouldAutoSyncInstagram('2026-09-15T14:00:00.000Z', '2026-09-16')).toBe(true);
    });

    it('同日に同期済みなら同期しない', () => {
      // JST 2026-09-16 00:30 = UTC 前日 15:30。UTC 日付で比較すると取りこぼす境界
      expect(shouldAutoSyncInstagram('2026-09-15T15:30:00.000Z', '2026-09-16')).toBe(false);
    });

    it('未来日時でも同期する（大小比較だと恒久的に止まる）', () => {
      expect(shouldAutoSyncInstagram('2026-09-20T00:00:00.000Z', '2026-09-16')).toBe(true);
    });

    it('不正なタイムスタンプは同期する側に倒し、console.error を出す', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(shouldAutoSyncInstagram('not-a-date', '2026-09-16')).toBe(true);
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});
