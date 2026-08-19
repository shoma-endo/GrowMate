import { describe, expect, it } from 'vitest';

import { normalizeWordPressRestPosts } from '@/server/services/wordpressService';

describe('normalizeWordPressRestPosts の本文抽出', () => {
  it('content.rendered から平文と img タグ数を取り出す', () => {
    const [normalized] = normalizeWordPressRestPosts([
      {
        id: 1,
        link: 'https://example.com/a',
        content: {
          rendered:
            '<p>本文です</p><img src="a.jpg" alt="1"><figure><IMG SRC="b.jpg"></figure><p>続き</p>',
        },
      },
    ]);

    // stripHtml はタグを空白へ置換するだけなので連続空白は残る。
    // 文字数採点は countContentChars 側で空白を畳むため、既存の
    // wordpressContentSync.extractPostFields と同じ形で保存する。
    expect(normalized?.content_text).toBe('本文です      続き');
    expect(normalized?.image_count).toBe(2);
  });

  it('画像が無い本文では image_count が 0 になる（未取得の NULL と区別できる）', () => {
    const [normalized] = normalizeWordPressRestPosts([
      { id: 2, link: 'https://example.com/b', content: { rendered: '<p>画像なし</p>' } },
    ]);

    expect(normalized?.content_text).toBe('画像なし');
    expect(normalized?.image_count).toBe(0);
  });

  it('content 自体が無いレスポンスでは両方 undefined のままにする', () => {
    const [normalized] = normalizeWordPressRestPosts([
      { id: 3, link: 'https://example.com/c' },
    ]);

    expect(normalized?.content_text).toBeUndefined();
    expect(normalized?.image_count).toBeUndefined();
  });

  it('本文が空タグだけなら content_text は落とし、image_count は 0 を返す', () => {
    const [normalized] = normalizeWordPressRestPosts([
      { id: 4, link: 'https://example.com/d', content: { rendered: '<p></p>' } },
    ]);

    expect(normalized?.content_text).toBeUndefined();
    expect(normalized?.image_count).toBe(0);
  });
});
