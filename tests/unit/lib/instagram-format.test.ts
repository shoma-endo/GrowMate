import { describe, expect, it } from 'vitest';
import { formatCount, formatPostedAt, calculateInstagramRate } from '@/lib/instagram-format';

describe('formatPostedAt', () => {
  it('年を必ず含める', () => {
    // プレビューは「最新3件」であって「最近の3件」ではない。
    // 年が無いと、2019年の投稿が今年のものに見える（manbou536 で実際に発生した）。
    expect(formatPostedAt('2019-03-10T02:12:24+0000')).toBe('2019/3/10 投稿');
  });

  it('今年の投稿にも年を出す', () => {
    expect(formatPostedAt('2026-08-02T03:03:06+0000')).toBe('2026/8/2 投稿');
  });

  it('パースできない値はそのまま返す', () => {
    expect(formatPostedAt('not-a-date')).toBe('not-a-date');
  });
});

describe('formatCount', () => {
  it('null は "-"（取得できなかった）', () => {
    // 転換前投稿では insights が取れず null になる。0 に丸めると
    // 「実際に0件だった」と区別がつかなくなる。
    expect(formatCount(null)).toBe('-');
  });

  it('0 は "0"（実際に0件）', () => {
    expect(formatCount(0)).toBe('0');
  });

  it('1000未満はそのまま', () => {
    expect(formatCount(89)).toBe('89');
    expect(formatCount(999)).toBe('999');
  });

  it('1000以上は k 表記', () => {
    expect(formatCount(1000)).toBe('1k');
    expect(formatCount(1500)).toBe('1.5k');
    expect(formatCount(12345)).toBe('12.3k');
  });
});

describe('calculateInstagramRate', () => {
  it('reach が null / 0 のとき null', () => {
    expect(calculateInstagramRate(10, null)).toBeNull();
    expect(calculateInstagramRate(10, 0)).toBeNull();
  });

  it('分子が null のとき null', () => {
    expect(calculateInstagramRate(null, 100)).toBeNull();
  });

  it('分子 0 かつ分母 > 0 のとき 0.0%', () => {
    expect(calculateInstagramRate(0, 523)).toBe(0);
  });

  it('reach を分母に小数第1位で四捨五入', () => {
    expect(calculateInstagramRate(21, 523)).toBe(4);
  });
});
