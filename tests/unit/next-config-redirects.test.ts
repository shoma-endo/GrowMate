import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';

describe('旧記事詳細URLのredirect設定', () => {
  it('annotationId付きと素URLの2ルールを仕様順に308 redirectとして宣言する', async () => {
    if (!nextConfig.redirects) {
      throw new Error('redirects configuration is required');
    }

    const redirects = await nextConfig.redirects();

    expect(redirects).toHaveLength(2);
    expect(redirects[0]).toEqual({
      source: '/gsc-dashboard',
      has: [{ type: 'query', key: 'annotationId', value: '(?<annotationId>[^&]+)' }],
      destination: '/analytics/:annotationId',
      permanent: true,
    });
    expect(redirects[1]).toEqual({
      source: '/gsc-dashboard',
      destination: '/analytics',
      permanent: true,
    });
  });
});
