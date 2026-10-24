import { describe, expect, it } from 'vitest';
import { describeNavigationFailure } from '../../../scripts/lib/ui-evidence-navigation';

describe('describeNavigationFailure', () => {
  it('同じパスで 2xx なら測ってよい', () => {
    expect(describeNavigationFailure({ status: 200, requestedPath: '/analytics', finalPath: '/analytics', noindex: false })).toBeNull();
  });

  it.each([404, 500])('同じパスのまま HTTP %i を返したら測らない（エラーページを合格にしない）', (status) => {
    expect(describeNavigationFailure({ status, requestedPath: '/analytics', finalPath: '/analytics', noindex: false })).toBe(
      `/analytics が HTTP ${status} を返しました`
    );
  });

  it('200 でも noindex の meta があれば測らない（ストリーミング中の notFound）', () => {
    expect(
      describeNavigationFailure({ status: 200, requestedPath: '/analytics', finalPath: '/analytics', noindex: true })
    ).toBe('/analytics は 200 を返したが noindex の meta がありました（ストリーミング中の notFound()）');
  });

  it('/login へ戻されたらログイン状態の用意を促す', () => {
    expect(describeNavigationFailure({ status: 200, requestedPath: '/analytics', finalPath: '/login', noindex: false })).toContain(
      'storageState'
    );
  });

  it('/login 以外の別画面へ移動したら測らない', () => {
    expect(describeNavigationFailure({ status: 200, requestedPath: '/analytics', finalPath: '/unauthorized', noindex: false })).toBe(
      '/analytics が /unauthorized へ移動しました。ログイン状態のユーザーのロールを確認してください'
    );
  });
});
