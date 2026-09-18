import { describe, expect, it } from 'vitest';

import {
  composeBody,
  isUsableBody,
  normalizeGeneratedBody,
} from '../../../scripts/generate-pr-body';

/**
 * PR 本文生成の後処理。
 *
 * ここが緩いと、**LLM の出力揺れがそのまま PR 本文になる**。とくに
 * 「自動生成・作者未確認」バナーの欠落と、コードフェンスで全体を囲まれた
 * 本文（GitHub 上で1個の巨大なコードブロックとして表示される）は、
 * 生成が成功したように見えて成果物だけが壊れるので気づきにくい。
 */

describe('normalizeGeneratedBody', () => {
  it('前後の空白を落とす', () => {
    expect(normalizeGeneratedBody('  ## 概要\n本文  ')).toBe('## 概要\n本文');
  });

  it('全体を囲んだコードフェンスを剥がす', () => {
    expect(normalizeGeneratedBody('```markdown\n## 概要\n本文\n```')).toBe('## 概要\n本文');
    expect(normalizeGeneratedBody('```md\n## 概要\n本文\n```')).toBe('## 概要\n本文');
    expect(normalizeGeneratedBody('```\n## 概要\n本文\n```')).toBe('## 概要\n本文');
  });

  it('本文中のコードフェンスは剥がさない（差分の引用が壊れる）', () => {
    const body = '## 概要\n\n```ts\nconst a = 1;\n```\n\n説明';
    expect(normalizeGeneratedBody(body)).toBe(body);
  });

  it('長すぎる本文は切り捨て、切り捨てた事実を残す', () => {
    const result = normalizeGeneratedBody('## 概要\n'.padEnd(20_000, 'あ'));
    expect(result.length).toBeLessThan(20_000);
    expect(result).toContain('切り捨てました');
  });
});

describe('isUsableBody', () => {
  it('見出し構成を満たす本文は採用する', () => {
    expect(isUsableBody(`## 概要\n${'内容'.repeat(30)}`)).toBe(true);
  });

  it('「## 概要」が無い本文は採用しない（構成が崩れている）', () => {
    expect(isUsableBody(`## サマリー\n${'内容'.repeat(30)}`)).toBe(false);
  });

  it('短すぎる本文は採用しない（生成が途中で切れた等）', () => {
    expect(isUsableBody('## 概要')).toBe(false);
    expect(isUsableBody('')).toBe(false);
  });
});

describe('composeBody', () => {
  const composed = composeBody('## 概要\n列の保存先を変更する。', 'https://example.com/compare');

  it('自動生成・作者未確認のバナーを必ず先頭に付ける', () => {
    expect(composed.startsWith('> [!NOTE]')).toBe(true);
    expect(composed).toContain('自動生成');
    expect(composed).toContain('作者による確認は行われていません');
  });

  it('検証結果を含まない旨を明示する', () => {
    expect(composed).toContain('検証結果・意図・背景は含まれません');
  });

  it('生成本文と比較URLを含める', () => {
    expect(composed).toContain('## 概要\n列の保存先を変更する。');
    expect(composed).toContain('## 比較\nhttps://example.com/compare');
  });

  it('受け入れテスト手順と検証観点を含む本文を壊さない', () => {
    const body = `## 概要\n${'内容'.repeat(30)}\n\n## 受け入れテスト手順\n1. 画面を開く\n\n## 検証観点\n- 境界値`;
    expect(normalizeGeneratedBody(body)).toBe(body);
    expect(isUsableBody(body)).toBe(true);
    const withNewSections = composeBody(body, 'https://example.com/compare');
    expect(withNewSections).toContain('## 受け入れテスト手順');
    expect(withNewSections).toContain('## 検証観点');
  });
});
