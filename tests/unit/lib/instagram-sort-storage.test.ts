import { describe, expect, it } from 'vitest';

import {
  parseInstagramHighOnly,
  parseInstagramSortKey,
  parseInstagramSortOrder,
  resolveInstagramRestorePatch,
} from '@/lib/constants';
import type { InstagramMediaSortKey } from '@/types/instagram';

describe('parseInstagramSortKey', () => {
  // 解釈せずに URL へ流すと壊れた値がサーバーのクエリに乗る。
  // 許可値以外はすべて既定（投稿日）へ畳むことを固定する
  it.each([
    ['media_product_type'],
    ['caption'],
    ['posted_at'],
    ['reach'],
    ['views'],
    ['like_count'],
    ['comments_count'],
    ['saved'],
    ['engagement_rate'],
    ['shares'],
    ['reposts'],
    ['total_interactions'],
    ['avg_watch_time_ms'],
    ['total_watch_time_ms'],
    ['reels_skip_rate'],
  ])('許可値 %s はそのまま通す', raw => {
    expect(parseInstagramSortKey(raw)).toBe(raw);
  });

  // 率の列は画面側で計算しており DB の列が無い。URL に載っても DB クエリへ流さない
  it('画面側で計算する率の列は既定へ畳む', () => {
    expect(parseInstagramSortKey('like_rate')).toBe('posted_at');
    expect(parseInstagramSortKey('repost_rate')).toBe('posted_at');
  });

  it('null は既定へ畳む', () => {
    expect(parseInstagramSortKey(null)).toBe('posted_at');
  });

  it('空文字は既定へ畳む', () => {
    expect(parseInstagramSortKey('')).toBe('posted_at');
  });

  it('未知の値は既定へ畳む', () => {
    expect(parseInstagramSortKey('likes')).toBe('posted_at');
    expect(parseInstagramSortKey('POSTED_AT')).toBe('posted_at');
    expect(parseInstagramSortKey('reach; drop table')).toBe('posted_at');
  });

  // 旧実装の JSON 形式が残っていても既定へ畳む（生の文字列で保存しているため）
  it('JSON らしき値でも既定へ畳む', () => {
    expect(parseInstagramSortKey('{"sort":"reach"}')).toBe('posted_at');
    expect(parseInstagramSortKey('"reach"')).toBe('posted_at');
  });
});

describe('parseInstagramSortOrder', () => {
  it('asc だけを昇順と解釈し、それ以外は降順へ畳む', () => {
    expect(parseInstagramSortOrder('asc')).toBe('asc');
    expect(parseInstagramSortOrder('desc')).toBe('desc');
    expect(parseInstagramSortOrder('ASC')).toBe('desc');
    expect(parseInstagramSortOrder('')).toBe('desc');
    expect(parseInstagramSortOrder(null)).toBe('desc');
  });
});

describe('Instagram high-only storage', () => {
  it('1 だけを ON と解釈する', () => {
    expect(parseInstagramHighOnly('1')).toBe(true);
    expect(parseInstagramHighOnly('0')).toBe(false);
    expect(parseInstagramHighOnly('true')).toBe(false);
    expect(parseInstagramHighOnly(null)).toBe(false);
  });

  it('並び順と絞り込みを同じ patch で復元する', () => {
    expect(
      resolveInstagramRestorePatch({
        urlSort: null,
        urlOrder: null,
        urlHigh: null,
        storedSort: 'engagement_rate',
        storedOrder: 'desc',
        storedHighOnly: true,
        visibleIds: ['engagement_rate'],
        canJudgeTarget: true,
      })
    ).toEqual({ igSort: 'engagement_rate', igOrder: 'desc', igHigh: true });
  });

  it('目標を判定できないときは絞り込みを復元しない', () => {
    expect(
      resolveInstagramRestorePatch({
        urlSort: null,
        urlOrder: null,
        urlHigh: null,
        storedSort: 'engagement_rate',
        storedOrder: 'desc',
        storedHighOnly: true,
        visibleIds: ['engagement_rate'],
        canJudgeTarget: false,
      })
    ).toEqual({ igSort: 'engagement_rate', igOrder: 'desc' });
  });

  it('並び順を復元しない条件でも絞り込みだけ復元する', () => {
    expect(
      resolveInstagramRestorePatch({
        urlSort: 'posted_at',
        urlOrder: null,
        urlHigh: null,
        storedSort: 'engagement_rate',
        storedOrder: 'desc',
        storedHighOnly: true,
        visibleIds: [],
        canJudgeTarget: true,
      })
    ).toEqual({ igHigh: true });
  });

  it('URL に絞り込み指定があれば保存値で上書きしない', () => {
    expect(
      resolveInstagramRestorePatch({
        urlSort: null,
        urlOrder: null,
        urlHigh: '0',
        storedSort: 'posted_at',
        storedOrder: 'desc',
        storedHighOnly: true,
        visibleIds: [],
        canJudgeTarget: true,
      })
    ).toBeNull();
  });

  it.each<
    [string, string | null, string | null, InstagramMediaSortKey, boolean]
  >([
    ['URL に並び順と絞り込みの指定がある', 'posted_at', '0', 'engagement_rate', true],
    ['保存値が無い', null, null, 'posted_at', false],
  ])('%s ときは遷移しない', (_label, urlSort, urlHigh, storedSort, storedHighOnly) => {
    expect(
      resolveInstagramRestorePatch({
        urlSort,
        urlOrder: null,
        urlHigh,
        storedSort,
        storedOrder: 'desc',
        storedHighOnly,
        visibleIds: ['posted_at', 'engagement_rate'],
        canJudgeTarget: true,
      })
    ).toBeNull();
  });

  it('投稿日の昇順も保存値として復元する（既定は投稿日の降順だけ）', () => {
    expect(
      resolveInstagramRestorePatch({
        urlSort: null,
        urlOrder: null,
        urlHigh: null,
        storedSort: 'posted_at',
        storedOrder: 'asc',
        storedHighOnly: false,
        visibleIds: ['posted_at'],
        canJudgeTarget: true,
      })
    ).toEqual({ igSort: 'posted_at', igOrder: 'asc' });
  });

  it('URL に向きだけ指定があれば並び順を保存値で上書きしない', () => {
    expect(
      resolveInstagramRestorePatch({
        urlSort: null,
        urlOrder: 'asc',
        urlHigh: null,
        storedSort: 'reach',
        storedOrder: 'desc',
        storedHighOnly: false,
        visibleIds: ['reach'],
        canJudgeTarget: true,
      })
    ).toBeNull();
  });
});
