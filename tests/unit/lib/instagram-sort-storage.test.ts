import { describe, expect, it } from 'vitest';

import {
  parseInstagramHighOnly,
  parseInstagramSortKey,
  resolveInstagramRestorePatch,
} from '@/lib/constants';
import type { InstagramMediaSortKey } from '@/types/instagram';

describe('parseInstagramSortKey', () => {
  // 解釈せずに URL へ流すと壊れた値がサーバーのクエリに乗る。
  // 許可値以外はすべて既定（投稿日）へ畳むことを固定する
  it.each([['posted_at'], ['reach'], ['views'], ['engagement_rate']])('許可値 %s はそのまま通す', raw => {
    expect(parseInstagramSortKey(raw)).toBe(raw);
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
        urlHigh: null,
        storedSort: 'engagement_rate',
        storedHighOnly: true,
        visibleIds: ['engagement_rate'],
        canJudgeTarget: true,
      })
    ).toEqual({ igSort: 'engagement_rate', igHigh: true });
  });

  it('目標を判定できないときは絞り込みを復元しない', () => {
    expect(
      resolveInstagramRestorePatch({
        urlSort: null,
        urlHigh: null,
        storedSort: 'engagement_rate',
        storedHighOnly: true,
        visibleIds: ['engagement_rate'],
        canJudgeTarget: false,
      })
    ).toEqual({ igSort: 'engagement_rate' });
  });

  it('並び順を復元しない条件でも絞り込みだけ復元する', () => {
    expect(
      resolveInstagramRestorePatch({
        urlSort: 'posted_at',
        urlHigh: null,
        storedSort: 'engagement_rate',
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
        urlHigh: '0',
        storedSort: 'posted_at',
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
        urlHigh,
        storedSort,
        storedHighOnly,
        visibleIds: ['posted_at', 'engagement_rate'],
        canJudgeTarget: true,
      })
    ).toBeNull();
  });
});
