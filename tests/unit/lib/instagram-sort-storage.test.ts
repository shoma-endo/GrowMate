import { describe, expect, it } from 'vitest';

import { parseInstagramSortKey } from '@/lib/constants';

describe('parseInstagramSortKey', () => {
  // 解釈せずに URL へ流すと壊れた値がサーバーのクエリに乗る。
  // 許可値以外はすべて既定（投稿日）へ畳むことを固定する
  it.each([['posted_at'], ['reach'], ['views']])('許可値 %s はそのまま通す', raw => {
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
