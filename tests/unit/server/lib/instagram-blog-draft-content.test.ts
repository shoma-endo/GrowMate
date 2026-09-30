import { describe, expect, it } from 'vitest';
import {
  buildInstagramHeadingInput,
  buildInstagramStep1Input,
  buildInstagramStep6Input,
  extractStep6LeadPatternA,
  getInstagramResumeAction,
  parseInstagramKeywordProposal,
} from '@/server/lib/instagram-blog-draft-content';

describe('Instagram blog draft content', () => {
  it('キーワード案の JSON を検証する', () => {
    expect(parseInstagramKeywordProposal('```json\n{"main_kw":"主題","kw":["関連"]}\n```'))
      .toEqual({ main_kw: '主題', kw: ['関連'] });
    expect(() => parseInstagramKeywordProposal('{"main_kw":" ","kw":["関連"]}')).toThrow();
    expect(() => parseInstagramKeywordProposal('{"main_kw":"主題","kw":[]}')).toThrow();
    expect(() => parseInstagramKeywordProposal('[]')).toThrow();
  });

  it('手動フローと同じ入力文を組み立てる', () => {
    expect(buildInstagramStep1Input('主題', ['関連1', '関連2'], '投稿文'))
      .toBe('主題\n関連1\n関連2\n\n【元になった Instagram 投稿】\n投稿文');
    expect(buildInstagramStep6Input('前の出力', '投稿文'))
      .toBe('前の出力\n\n【一次情報（元の Instagram 投稿）】\n投稿文');
    expect(buildInstagramHeadingInput('見出し')).toBe('「見出し」の本文を書いてください');
  });

  it('パターンAの通常版本文だけを抽出し、形式違いと空は失敗する', () => {
    expect(extractStep6LeadPatternA('【書き出し案：パターンA】\n▼本文（通常版）\n 通常本文 \n▼本文（短縮版）\n短縮本文'))
      .toBe('通常本文');
    expect(extractStep6LeadPatternA('書き出し案は別形式')).toBeNull();
    expect(extractStep6LeadPatternA('【書き出し案：パターンA】▼本文（通常版）  ▼本文（短縮版）')).toBeNull();
  });

  it.each([
    [null, false, 'generate'],
    [null, true, 'advance'],
    [0, false, 'generate'],
    [1, true, 'continue'],
  ] as const)('再開位置: continuation=%s / modelMatch=%s', (continuation, matches, expected) => {
    expect(getInstagramResumeAction(continuation, matches)).toBe(expected);
  });
});
