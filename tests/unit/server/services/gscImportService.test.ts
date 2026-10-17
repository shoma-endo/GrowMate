import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCredential: vi.fn(),
  listAnnotationKeys: vi.fn(),
  listDailyTargets: vi.fn(),
  upsertPageMetrics: vi.fn(),
  refreshAccessToken: vi.fn(),
  recordResult: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    getGscCredentialByUserId = mocks.getCredential;
    listContentAnnotationKeys = mocks.listAnnotationKeys;
    listGscAutoImportTargets = mocks.listDailyTargets;
    recordGoogleAutoImportResult = mocks.recordResult;
    getClient = () => ({
      from: () => ({ upsert: mocks.upsertPageMetrics }),
    });
    upsertGscQueryMetrics = vi.fn();
  },
}));
vi.mock('@/server/services/gscService', () => ({
  GscService: class {
    refreshAccessToken = mocks.refreshAccessToken;
  },
}));

import { gscImportService } from '@/server/services/gscImportService';

describe('GSC daily import request options（auto-daily-imports-spec FR-001）', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.clearAllMocks();
    // 日次バッチは実行日で取込範囲（太平洋時間）とユーザーの処理順（rotateForDay）が変わる。
    // 行の日付 2026-10-12 が範囲に入り、user-1 から処理される日に固定する
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T00:00:00.000Z'));
    vi.stubGlobal('fetch', fetchMock);
    mocks.getCredential.mockResolvedValue({
      refreshToken: 'refresh-token',
      propertyUri: 'https://example.com/',
      propertyType: 'url-prefix',
    });
    mocks.refreshAccessToken.mockResolvedValue({ accessToken: 'access-token' });
    mocks.listAnnotationKeys.mockResolvedValue([]);
    mocks.listDailyTargets.mockResolvedValue([]);
    mocks.upsertPageMetrics.mockResolvedValue({ error: null });
    mocks.recordResult.mockResolvedValue(undefined);
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ rows: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('dataStateは日次取込のページ・クエリ要求だけに付く', async () => {
    await gscImportService.importMetrics('user-1', {
      startDate: '2026-10-11',
      endDate: '2026-10-13',
      searchType: 'web',
      maxRows: 25_000,
      dataState: 'all',
    });
    const automaticBodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);

    fetchMock.mockClear();
    await gscImportService.importMetrics('user-1', {
      startDate: '2026-10-11',
      endDate: '2026-10-13',
      searchType: 'web',
    });
    const manualBodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);

    expect(automaticBodies.length).toBeGreaterThan(1);
    expect(automaticBodies.every(body => body.dataState === 'all')).toBe(true);
    expect(automaticBodies.find(body => Array.isArray(body.dimensions) && body.dimensions.includes('page'))?.rowLimit).toBe(25_000);
    expect(manualBodies.every(body => !('dataState' in body))).toBe(true);
    expect(manualBodies.find(body => Array.isArray(body.dimensions) && body.dimensions.includes('page'))?.rowLimit).toBe(1_000);
  });

  it('日次バッチはページ保存失敗をfailedに数え、次のユーザーへ進む', async () => {
    mocks.listDailyTargets.mockResolvedValue(['user-1', 'user-2']);
    mocks.listAnnotationKeys.mockResolvedValue([{ id: 'annotation-1', normalized_url: 'example.com/post' }]);
    mocks.upsertPageMetrics
      .mockResolvedValueOnce({ error: { message: 'database write failed' } })
      .mockResolvedValueOnce({ error: null });
    fetchMock.mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { dimensions: string[] };
      const rows = body.dimensions.includes('page')
        ? [{ keys: ['2026-10-12', 'https://example.com/post/'], clicks: 1, impressions: 2, ctr: 0.5, position: 1 }]
        : [];
      return new Response(JSON.stringify({ rows }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await gscImportService.runDailyBatch();

    expect(result).toMatchObject({ total: 2, succeeded: 1, failed: 1, skippedDueToLimit: 0 });
    expect(mocks.upsertPageMetrics).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.filter(([, init]) => {
      const body = JSON.parse(String(init?.body)) as { dimensions: string[] };
      return body.dimensions.includes('page') && !body.dimensions.includes('query');
    })).toHaveLength(2);
    expect(errorLog).toHaveBeenCalledWith('[daily-import:gsc] user failed', {
      userId: 'user-1',
      reason: 'page_metrics_save_failed:1',
    });
  });

  it('日次バッチはクエリ取得失敗をfailedに数え、次のユーザーへ進む', async () => {
    mocks.listDailyTargets.mockResolvedValue(['user-1', 'user-2']);
    let pageFetches = 0;
    fetchMock.mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { dimensions: string[] };
      if (body.dimensions.includes('page') && !body.dimensions.includes('query')) {
        pageFetches += 1;
        const rows = pageFetches === 2
          ? [{ keys: ['2026-10-12', 'https://unmatched.example/post'], clicks: 1, impressions: 2, ctr: 0.5, position: 1 }]
          : [];
        return new Response(JSON.stringify({ rows }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (pageFetches === 1) {
        return new Response('upstream unavailable', { status: 503 });
      }
      return new Response(JSON.stringify({ rows: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await gscImportService.runDailyBatch();

    expect(result).toMatchObject({ total: 2, succeeded: 1, failed: 1, skippedDueToLimit: 0 });
    expect(fetchMock.mock.calls.filter(([, init]) => {
      const body = JSON.parse(String(init?.body)) as { dimensions: string[] };
      return body.dimensions.includes('page') && !body.dimensions.includes('query');
    })).toHaveLength(2);
    const userFailure = errorLog.mock.calls.find(([message]) => message === '[daily-import:gsc] user failed');
    expect(userFailure?.[1]).toEqual({
      userId: 'user-1',
      reason: expect.stringMatching(/^query_fetch_failed:\d+$/),
    });
  });

  describe('日次バッチの結果の保存（FR-011）', () => {
    const pageOnly = (init: RequestInit | undefined) => {
      const body = JSON.parse(String(init?.body)) as { dimensions: string[] };
      return body.dimensions.includes('page') && !body.dimensions.includes('query');
    };

    it('403 は権限切れとして保存し、failed に数えて次のユーザーへ進む', async () => {
      mocks.listDailyTargets.mockResolvedValue(['user-1', 'user-2']);
      let pageFetches = 0;
      fetchMock.mockImplementation(async (_input, init) => {
        if (pageOnly(init) && ++pageFetches === 1) {
          return new Response(
            '{"error":{"code":403,"message":"User does not have sufficient permission for site","errors":[{"reason":"forbidden"}]}}',
            { status: 403 }
          );
        }
        return new Response(JSON.stringify({ rows: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      });
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const result = await gscImportService.runDailyBatch();

      expect(result).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
      expect(mocks.recordResult.mock.calls).toEqual([
        ['user-1', 'gsc', 'permission_denied'],
        ['user-2', 'gsc', 'succeeded'],
      ]);
      const userFailure = errorLog.mock.calls.find(([message]) => message === '[daily-import:gsc] user failed');
      expect(userFailure?.[1]).toEqual({ userId: 'user-1', reason: expect.stringMatching(/^permission_denied: GSC Search Analytics API エラー: 403 /) });
    });

    it('403 以外の失敗では結果を書き換えない', async () => {
      mocks.listDailyTargets.mockResolvedValue(['user-1']);
      fetchMock.mockImplementation(async (_input, init) =>
        pageOnly(init)
          ? new Response('upstream unavailable', { status: 503 })
          : new Response(JSON.stringify({ rows: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const result = await gscImportService.runDailyBatch();

      expect(result).toMatchObject({ total: 1, failed: 1 });
      expect(mocks.recordResult).not.toHaveBeenCalled();
    });
  });
});
