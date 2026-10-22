import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  existing: {} as Record<string, Row[]>,
  upserts: [] as Array<{ table: string; rows: Row[] }>,
  upsertError: (() => null) as (rows: Row[]) => { code: string; message: string } | null,
  selectError: null as { code: string; message: string } | null,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/client-manager', () => ({
  SupabaseClientManager: {
    getInstance: () => ({
      getServiceRoleClient: () => ({
        from: (table: string) => {
          const filters: Array<(row: Row) => boolean> = [];
          const chain = {
            select: () => chain,
            eq: (column: string, value: unknown) => {
              filters.push(row => row[column] === value);
              return chain;
            },
            gte: (column: string, value: string) => {
              filters.push(row => String(row[column]) >= value);
              return chain;
            },
            lte: (column: string, value: string) => {
              filters.push(row => String(row[column]) <= value);
              return chain;
            },
            order: () => chain,
            range: (from: number, to: number) => {
              if (mocks.selectError) return Promise.resolve({ data: null, error: mocks.selectError, count: null });
              const rows = (mocks.existing[table] ?? []).filter(row => filters.every(filter => filter(row)));
              return Promise.resolve({ data: rows.slice(from, to + 1), error: null, count: null });
            },
            upsert: (rows: Row[]) => {
              mocks.upserts.push({ table, rows });
              return Promise.resolve({ error: mocks.upsertError(rows) });
            },
          };
          return chain;
        },
      }),
    }),
  },
}));

import { SupabaseService } from '@/server/services/supabaseService';

const queryRow = (
  overrides: Partial<{ query: string; clicks: number; ctr: number; position: number; contentAnnotationId: string | null }> = {}
) => {
  const query = overrides.query ?? 'kw';
  return {
    userId: 'user-1',
    propertyUri: 'https://example.com/',
    propertyType: 'url-prefix' as const,
    searchType: 'web' as const,
    date: '2026-10-01',
    url: 'https://example.com/post/',
    normalizedUrl: 'example.com/post',
    query,
    queryNormalized: query,
    clicks: overrides.clicks ?? 1,
    impressions: 10,
    ctr: overrides.ctr ?? 0.1,
    position: overrides.position ?? 3.456,
    contentAnnotationId: overrides.contentAnnotationId === undefined ? 'annotation-1' : overrides.contentAnnotationId,
    importedAt: '2026-10-21T00:00:00.000Z',
  };
};

const storedQueryRow = (row: ReturnType<typeof queryRow>): Row => ({
  user_id: row.userId,
  property_uri: row.propertyUri,
  search_type: row.searchType,
  date: row.date,
  normalized_url: row.normalizedUrl,
  query_normalized: row.queryNormalized,
  url: row.url,
  query: row.query,
  property_type: row.propertyType,
  clicks: row.clicks,
  impressions: row.impressions,
  // DB の numeric(6,4) / numeric(6,2) に丸められた値で返る
  ctr: Math.round(row.ctr * 10_000) / 10_000,
  position: Math.round(row.position * 100) / 100,
  content_annotation_id: row.contentAnnotationId,
});

const pageRow = (overrides: Partial<{ url: string; clicks: number; date: string }> = {}) => ({
  user_id: 'user-1',
  content_annotation_id: 'annotation-1',
  property_uri: 'https://example.com/',
  search_type: 'web',
  date: overrides.date ?? '2026-10-01',
  url: overrides.url ?? 'https://example.com/post/',
  clicks: overrides.clicks ?? 1,
  impressions: 10,
  ctr: 0.1,
  position: 2.123456,
  imported_at: '2026-10-21T00:00:00.000Z',
});

const storedPageRow = (row: ReturnType<typeof pageRow>, id: string): Row => ({
  id,
  user_id: row.user_id,
  property_uri: row.property_uri,
  search_type: row.search_type,
  date: row.date,
  normalized_url: row.url.replace(/^https?:\/\//, '').replace(/\/+$/, ''),
  url: row.url,
  clicks: row.clicks,
  impressions: row.impressions,
  ctr: row.ctr,
  position: Math.round(row.position * 10_000) / 10_000,
  content_annotation_id: row.content_annotation_id,
});

describe('GSC 指標の upsert は値が同じ行を書かない', () => {
  beforeEach(() => {
    mocks.existing = {};
    mocks.upserts = [];
    mocks.upsertError = () => null;
    mocks.selectError = null;
    vi.restoreAllMocks();
  });

  describe('upsertGscQueryMetrics', () => {
    it('値が同じなら書かない', async () => {
      const rows = [queryRow({ query: 'a' }), queryRow({ query: 'b' })];
      mocks.existing.gsc_query_metrics = rows.map(storedQueryRow);

      await new SupabaseService().upsertGscQueryMetrics(rows);

      expect(mocks.upserts).toEqual([]);
    });

    it('新規行と値が変わった行だけを書く', async () => {
      const same = queryRow({ query: 'same' });
      const changed = queryRow({ query: 'changed', clicks: 2 });
      const added = queryRow({ query: 'new' });
      mocks.existing.gsc_query_metrics = [storedQueryRow(same), storedQueryRow({ ...changed, clicks: 1 })];

      await new SupabaseService().upsertGscQueryMetrics([same, changed, added]);

      expect(mocks.upserts.flatMap(call => call.rows.map(row => row.query))).toEqual(['changed', 'new']);
    });

    it('記事との紐付けが null から値に変わった行は書く', async () => {
      const row = queryRow({ contentAnnotationId: 'annotation-1' });
      mocks.existing.gsc_query_metrics = [storedQueryRow(queryRow({ contentAnnotationId: null }))];

      await new SupabaseService().upsertGscQueryMetrics([row]);

      expect(mocks.upserts.flatMap(call => call.rows.map(stored => stored.content_annotation_id))).toEqual(['annotation-1']);
    });

    it('既存行が1000行を超えてもページングして全件と突き合わせる', async () => {
      const rows = Array.from({ length: 1500 }, (_, i) => queryRow({ query: `q${String(i).padStart(4, '0')}` }));
      mocks.existing.gsc_query_metrics = rows.map(storedQueryRow);

      await new SupabaseService().upsertGscQueryMetrics(rows);

      expect(mocks.upserts).toEqual([]);
    });

    it('200件ずつに分けて書く', async () => {
      const rows = Array.from({ length: 450 }, (_, i) => queryRow({ query: `q${i}` }));

      await new SupabaseService().upsertGscQueryMetrics(rows);

      expect(mocks.upserts.map(call => call.rows.length)).toEqual([200, 200, 50]);
    });

    it('57014 のときはチャンクを半分にして再試行する', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      mocks.upsertError = rows =>
        rows.length > 100 ? { code: '57014', message: 'canceling statement due to statement timeout' } : null;
      const rows = Array.from({ length: 200 }, (_, i) => queryRow({ query: `q${i}` }));

      await new SupabaseService().upsertGscQueryMetrics(rows);

      expect(mocks.upserts.map(call => call.rows.length)).toEqual([200, 100, 100]);
    });

    it('下限まで割っても 57014 ならエラーにする', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mocks.upsertError = () => ({ code: '57014', message: 'canceling statement due to statement timeout' });
      const rows = Array.from({ length: 200 }, (_, i) => queryRow({ query: `q${i}` }));

      await expect(new SupabaseService().upsertGscQueryMetrics(rows)).rejects.toThrow('statement timeout');
      expect(mocks.upserts.some(call => call.rows[0]?.query === 'q100')).toBe(true);
    });

    it('既存行を読めなければ書かずにエラーにする', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mocks.selectError = { code: '57014', message: 'canceling statement due to statement timeout' };

      await expect(new SupabaseService().upsertGscQueryMetrics([queryRow()])).rejects.toThrow('statement timeout');
      expect(mocks.upserts).toEqual([]);
    });
  });

  describe('upsertGscPageMetrics', () => {
    it('値が同じなら書かず、保存済みとして数える', async () => {
      const row = pageRow();
      mocks.existing.gsc_page_metrics = [storedPageRow(row, 'id-1')];

      const result = await new SupabaseService().upsertGscPageMetrics([row]);

      expect(mocks.upserts).toEqual([]);
      expect(result).toEqual({ written: 0, unchanged: 1, failedRows: 0, failedChunks: 0 });
    });

    it('新規行と値が変わった行だけを書く', async () => {
      const same = pageRow({ url: 'https://example.com/same/' });
      const changed = pageRow({ url: 'https://example.com/changed/', clicks: 5 });
      const added = pageRow({ url: 'https://example.com/new/' });
      mocks.existing.gsc_page_metrics = [storedPageRow(same, 'id-1'), storedPageRow({ ...changed, clicks: 1 }, 'id-2')];

      const result = await new SupabaseService().upsertGscPageMetrics([same, changed, added]);

      expect(mocks.upserts.flatMap(call => call.rows.map(row => row.url))).toEqual([
        'https://example.com/changed/',
        'https://example.com/new/',
      ]);
      expect(result).toEqual({ written: 2, unchanged: 1, failedRows: 0, failedChunks: 0 });
    });

    it('複数の日と URL が混ざっても、日と URL の組で突き合わせる', async () => {
      const sameA = pageRow({ url: 'https://example.com/a/', date: '2026-10-01' });
      const sameB = pageRow({ url: 'https://example.com/b/', date: '2026-10-01' });
      const changedA = pageRow({ url: 'https://example.com/a/', date: '2026-10-02', clicks: 9 });
      mocks.existing.gsc_page_metrics = [
        storedPageRow(sameA, 'id-1'),
        storedPageRow(sameB, 'id-2'),
        storedPageRow({ ...changedA, clicks: 1 }, 'id-3'),
      ];

      const result = await new SupabaseService().upsertGscPageMetrics([sameA, sameB, changedA]);

      expect(mocks.upserts.flatMap(call => call.rows.map(row => [row.date, row.url]))).toEqual([
        ['2026-10-02', 'https://example.com/a/'],
      ]);
      expect(result).toEqual({ written: 1, unchanged: 2, failedRows: 0, failedChunks: 0 });
    });

    it('下限まで割っても 57014 なら失敗として数える', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mocks.upsertError = rows =>
        rows.length > 25 ? { code: '57014', message: 'canceling statement due to statement timeout' } : null;
      const rows = Array.from({ length: 60 }, (_, i) => pageRow({ url: `https://example.com/p${i}/` }));

      const result = await new SupabaseService().upsertGscPageMetrics(rows);

      expect(mocks.upserts.map(call => call.rows.length)).toEqual([60, 30, 30]);
      expect(result).toEqual({ written: 0, unchanged: 0, failedRows: 60, failedChunks: 1 });
    });
  });
});
