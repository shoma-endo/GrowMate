import { describe, expect, it } from 'vitest';

import { isWordPressLinked } from '@/lib/wordpress-link';

describe('isWordPressLinked', () => {
  it('保存済みURLがあれば連携済みと判定する', () => {
    expect(isWordPressLinked({ canonical_url: 'https://example.com/post/' })).toBe(true);
  });

  it('有効な投稿IDがあれば連携済みと判定する', () => {
    expect(isWordPressLinked({ canonical_url: null, wp_post_id: 42 })).toBe(true);
  });

  it('URLと投稿IDが解除された場合は未連携と判定する', () => {
    expect(isWordPressLinked({ canonical_url: null, wp_post_id: null })).toBe(false);
  });
});
