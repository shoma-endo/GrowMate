import { describe, expect, it } from 'vitest';

import { countContentChars, countImageTags, normalizeContentText } from '@/lib/content-text';

describe('content-text', () => {
  it('空白とHTMLエンティティを正規化する', () => {
    expect(normalizeContentText('  A\n&nbsp; &amp; &lt; &gt; &quot; &#39; &#x3042;  ')).toBe(
      'A & < > " \' あ'
    );
  });

  it('正規化後の文字数を数える', () => {
    expect(countContentChars(' A  &amp;  B ')).toBe(5);
    expect(countContentChars(null)).toBe(0);
  });

  it('imgタグだけを数える', () => {
    expect(countImageTags('<p>x</p>')).toBe(0);
    expect(countImageTags('<img src="a"><IMG src="b" /><image src="c">')).toBe(2);
  });
});
