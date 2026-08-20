import { describe, expect, it } from 'vitest';
import { annotationDetailPath } from '@/lib/routes';

describe('annotationDetailPath', () => {
  it('動的セグメントとして組み立てる', () => {
    expect(annotationDetailPath('0e9e2d1c-4b6a-4f2e-9a1b-3c5d7e9f1a2b')).toBe(
      '/analytics/0e9e2d1c-4b6a-4f2e-9a1b-3c5d7e9f1a2b'
    );
  });

  it('クエリ文字列形式を生成しない', () => {
    // `/analytics?annotationId=<id>` は annotationId が解釈されず
    // コンテンツ一覧へ落ちる（実際に GA4 ダッシュボードで発生した不具合）
    const path = annotationDetailPath('abc');
    expect(path).not.toContain('?');
    expect(path).not.toContain('annotationId=');
  });

  it('パスに使えない文字をエスケープする', () => {
    expect(annotationDetailPath('a/b?c#d')).toBe('/analytics/a%2Fb%3Fc%23d');
  });

  it('空文字でも一覧のパスにならない', () => {
    // `/analytics` そのものになると一覧へ遷移してしまうため、末尾スラッシュを残す
    expect(annotationDetailPath('')).toBe('/analytics/');
  });
});
