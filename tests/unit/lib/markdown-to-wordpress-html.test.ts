import { describe, expect, it } from 'vitest';
import { markdownToWordPressHtml } from '@/lib/markdown-to-wordpress-html';

describe('markdownToWordPressHtml', () => {
  it('仕様 §13: 見出し・段落・入れ子リスト・表・強調・コードを HTML にする', () => {
    const html = markdownToWordPressHtml(
      [
        '# 見出し1',
        '## 見出し2',
        '### 見出し3',
        '#### 見出し4',
        '',
        '段落 **強調** と *斜体*。',
        '',
        '- 親項目',
        '  - 子項目',
        '',
        '1. 番号付き',
        '2. 二番目',
        '',
        '| 項目 | 値 |',
        '| --- | --- |',
        '| 例 | 1 |',
        '',
        '```ts',
        'const value = 1;',
        '```',
      ].join('\n')
    );

    expect(html).toContain('<h1>見出し1</h1>');
    expect(html).toContain('<h2>見出し2</h2>');
    expect(html).toContain('<h3>見出し3</h3>');
    expect(html).toContain('<h4>見出し4</h4>');
    expect(html).toContain('<p>段落 <strong>強調</strong> と <em>斜体</em>。</p>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<table>');
    expect(html).toContain('<pre><code class="language-ts">const value = 1;\n</code></pre>');
  });

  it('仕様 §8: raw HTML をテキストとしてエスケープする', () => {
    expect(markdownToWordPressHtml('<script>alert("x")</script>')).toContain(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
    );
  });

  it('仕様 §8: http・https・mailto と相対リンクを残し、許可外 URL をリンクにしない', () => {
    const html = markdownToWordPressHtml(
      '[https](https://example.com) [mailto](mailto:test@example.com) [relative](../article) [unsafe](javascript:alert%281%29) [network](//example.com)'
    );

    expect(html).toContain('<a href="https://example.com">https</a>');
    expect(html).toContain('<a href="mailto:test@example.com">mailto</a>');
    expect(html).toContain('<a href="../article">relative</a>');
    expect(html).toContain(' unsafe network</p>');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href="//example.com');
  });
});
