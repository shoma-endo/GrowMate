import { afterEach, describe, expect, it, vi } from 'vitest';
import { getVercelDeployments } from '../../../scripts/check-vercel-stats';
import {
  describeVercelApiError,
  evaluateDeploymentSuccess,
} from '../../../scripts/lib/vercel-stats';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('evaluateDeploymentSuccess', () => {
  it('デプロイメントが0件のときは判定不可を返す（誤った警告を出さない）', () => {
    expect(evaluateDeploymentSuccess(0, 0)).toStrictEqual({
      level: 'no-data',
      message: expect.stringContaining('判定をスキップ'),
    });
  });

  it.each([
    [95, 100, 'success'],
    [100, 100, 'success'],
    [80, 100, 'warning'],
    [94, 100, 'warning'],
    [79, 100, 'critical'],
    [0, 10, 'critical'],
  ])('成功 %i / 全体 %i は %s', (ready, total, level) => {
    expect(evaluateDeploymentSuccess(ready, total).level).toBe(level);
  });
});

describe('getVercelDeployments', () => {
  it('403は空配列にせず確認先つきエラーで失敗させる', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve(JSON.stringify({ error: { message: 'Not authorized' } })),
      })
    );
    await expect(getVercelDeployments('dummy', 'prj_dummy')).rejects.toThrow('VERCEL_TEAM_ID');
  });

  it('正常時はデプロイメント一覧を返す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ deployments: [{ uid: 'dpl_1', state: 'READY' }] }),
      })
    );
    await expect(getVercelDeployments('dummy', 'prj_dummy')).resolves.toStrictEqual([
      { uid: 'dpl_1', state: 'READY' },
    ]);
  });
});

describe('describeVercelApiError', () => {
  it('401はトークンの再発行を案内する', () => {
    expect(describeVercelApiError(401, 'Invalid token', false)).toContain('VERCEL_TOKEN');
  });

  it('403はチームID未設定の場合に追加の確認先を案内する', () => {
    expect(describeVercelApiError(403, 'Not authorized', false)).toContain('VERCEL_TEAM_ID');
    expect(describeVercelApiError(403, 'Not authorized', true)).toContain('VERCEL_PROJECT_ID');
  });

  it('404はプロジェクトIDの確認を案内する', () => {
    expect(describeVercelApiError(404, 'Not found', true)).toContain('VERCEL_PROJECT_ID');
  });

  it('想定外のステータスは原文を落とさず返す', () => {
    expect(describeVercelApiError(500, 'boom', true)).toBe('Vercel APIエラー (HTTP 500): boom');
  });
});
