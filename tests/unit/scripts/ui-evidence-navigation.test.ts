import { describe, expect, it } from 'vitest';
import { describeNavigationFailure } from '../../../scripts/lib/ui-evidence-navigation';

describe('describeNavigationFailure', () => {
  it('同じパスで 2xx なら測ってよい', () => {
    expect(describeNavigationFailure({ status: 200, requestedPath: '/analytics', finalPath: '/analytics' })).toBeNull();
  });

  it.each([404, 500])('同じパスのまま HTTP %i を返したら測らない（エラーページを合格にしない）', (status) => {
    expect(describeNavigationFailure({ status, requestedPath: '/analytics', finalPath: '/analytics' })).toBe(
      `/analytics が HTTP ${status} を返しました`
    );
  });

  it('レスポンスが無ければ測らない', () => {
    expect(describeNavigationFailure({ status: null, requestedPath: '/analytics', finalPath: '/analytics' })).toBe(
      '/analytics を開いたがレスポンスがありませんでした'
    );
  });

  it('/login へ戻されたらログイン状態の用意を促す', () => {
    expect(describeNavigationFailure({ status: 200, requestedPath: '/analytics', finalPath: '/login' })).toContain(
      'storageState'
    );
  });

  it('/login 以外の別画面へ移動したら測らない', () => {
    expect(describeNavigationFailure({ status: 200, requestedPath: '/analytics', finalPath: '/unauthorized' })).toBe(
      '/analytics が /unauthorized へ移動しました。ログイン状態のユーザーのロールを確認してください'
    );
  });
});
