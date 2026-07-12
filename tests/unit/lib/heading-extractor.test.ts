import { describe, expect, it } from 'vitest';
import {
  extractHeadingsFromMarkdown,
  normalizeHeadingUnitContent,
} from '@/lib/heading-extractor';

describe('extractHeadingsFromMarkdown', () => {
  it.each([
    [
      'H2: 壁紙張り替えの後悔は「色選び」「追加費用」「施工品質」の3つに集中\n  する\n',
      '壁紙張り替えの後悔は「色選び」「追加費用」「施工品質」の3つに集中する',
    ],
    [
      'H2: 失敗パターンを知ることが、安心して任せられる業者を見つける近道に\n  なる\n',
      '失敗パターンを知ることが、安心して任せられる業者を見つける近道になる',
    ],
  ])('長い見出し末尾の折り返しを連結する', (markdown, expected) => {
    expect(extractHeadingsFromMarkdown(markdown)).toEqual([
      { text: expected, level: 2, orderIndex: 0 },
    ]);
  });

  it('短い見出し直後の本文は見出しへ連結しない', () => {
    const markdown = ['H2: 料金について', '  補足本文', '', 'H3: 詳細'].join('\n');

    expect(extractHeadingsFromMarkdown(markdown)).toEqual([
      { text: '料金について', level: 2, orderIndex: 0 },
      { text: '詳細', level: 3, orderIndex: 1 },
    ]);
  });
});

describe('normalizeHeadingUnitContent', () => {
  it('対象H2を除去し、後続H3以降を切り離す', () => {
    const content = [
      '## 壁紙張り替えの後悔',
      '',
      'H2直下の導入本文です。',
      '',
      '### サンプルと実際の壁面',
      '',
      'H3の本文です。',
    ].join('\n');

    expect(
      normalizeHeadingUnitContent(content, '壁紙張り替えの後悔', [
        'サンプルと実際の壁面',
      ])
    ).toBe(
      'H2直下の導入本文です。'
    );
  });

  it('独自形式の後続見出しも境界として扱う', () => {
    const content = ['通常本文です。', '', 'h4: 注意点', '', '後続本文です。'].join('\n');

    expect(normalizeHeadingUnitContent(content, '現在の見出し', ['注意点'])).toBe(
      '通常本文です。'
    );
  });

  it('区切りなし独自形式は後続の正本見出しと一致する場合だけ境界として扱う', () => {
    const content = ['H2直下の導入本文です。', '', 'H3次の見出し', '', '後続本文です。'].join('\n');

    expect(normalizeHeadingUnitContent(content, '現在の見出し', ['次の見出し'])).toBe(
      'H2直下の導入本文です。'
    );
  });

  it('対象見出し前の短い前置きも除去する', () => {
    const content = ['以下に本文を示します。', '', '### 対象見出し', '', '本文です。'].join('\n');

    expect(normalizeHeadingUnitContent(content, '対象見出し')).toBe('本文です。');
  });

  it('Canvas付与見出しとAI応答の類似・正規見出しが連続しても本文だけを残す', () => {
    const content = [
      '## 壁紙張り替えの後悔は3つに集中する',
      '',
      '## 壁紙張り替えの後悔は3つに集中',
      '',
      '## 壁紙張り替えの後悔は3つに集中する',
      '',
      '本文です。',
    ].join('\n');

    expect(normalizeHeadingUnitContent(content, '壁紙張り替えの後悔は3つに集中する')).toBe(
      '本文です。'
    );
  });

  it.each(['H2 直下の導入本文です。', 'H3: では具体例を説明します。'])(
    '正本見出しと一致しない独自形式風の本文を保持する: %s',
    content => {
      expect(normalizeHeadingUnitContent(content, '現在の見出し', ['次の見出し'])).toBe(
        content
      );
    }
  );

  it('コロン付き独自形式は後続の正本見出しと一致する場合だけ境界として扱う', () => {
    const content = ['現在の本文です。', '', 'H3: 次の見出し', '', '後続本文です。'].join('\n');

    expect(normalizeHeadingUnitContent(content, '現在の見出し', ['次の見出し'])).toBe(
      '現在の本文です。'
    );
  });

  it('fenced code block内の見出し風テキストを保持する', () => {
    const content = ['本文です。', '', '```md', '### コード例', '```', '', '続きです。'].join('\n');

    expect(normalizeHeadingUnitContent(content, '対象見出し')).toBe(content);
  });

  it('indented code block内の見出し風テキストを保持する', () => {
    const content = ['本文です。', '', '    ## コード例', '', '続きです。'].join('\n');

    expect(normalizeHeadingUnitContent(content, '対象見出し')).toBe(content);
  });

  it('後続見出しがない本文は末尾空白だけを除去して保持する', () => {
    expect(normalizeHeadingUnitContent('本文だけです。\n\n', '対象見出し')).toBe(
      '本文だけです。'
    );
  });

  it('対象見出ししかない場合は空文字列を返す', () => {
    expect(normalizeHeadingUnitContent('## 対象見出し\n', '対象見出し')).toBe('');
  });
});
