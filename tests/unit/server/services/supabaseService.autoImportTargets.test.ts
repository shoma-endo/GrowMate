import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tables: [] as string[],
  inCalls: [] as Array<[string, string[]]>,
  rows: [] as Record<string, unknown>[],
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/client-manager', () => ({
  SupabaseClientManager: {
    getInstance: () => ({
      getServiceRoleClient: () => ({
        from: (table: string) => {
          mocks.tables.push(table);
          const chain = {
            select: () => chain,
            not: () => chain,
            in: (column: string, values: string[]) => {
              mocks.inCalls.push([column, values]);
              return chain;
            },
            order: () => chain,
            range: () => Promise.resolve({ data: mocks.rows, error: null, count: mocks.rows.length }),
          };
          return chain;
        },
      }),
    }),
  },
}));

import { SupabaseService } from '@/server/services/supabaseService';

describe('自動取込の対象一覧はロールで絞る（auto-daily-imports-spec D-03 / BR-01）', () => {
  beforeEach(() => {
    mocks.tables = [];
    mocks.inCalls = [];
    mocks.rows = [];
  });

  it.each([
    ['GSC', (service: SupabaseService) => service.listGscAutoImportTargets(), 'gsc_credentials'],
    ['GA4', (service: SupabaseService) => service.listGa4SyncTargets(), 'gsc_credentials'],
  ])('%s の対象を paid と admin だけに絞る', async (_label, list, table) => {
    await list(new SupabaseService());

    expect(mocks.tables).toEqual([table]);
    expect(mocks.inCalls).toEqual([['users.role', ['paid', 'admin']]]);
  });
});
