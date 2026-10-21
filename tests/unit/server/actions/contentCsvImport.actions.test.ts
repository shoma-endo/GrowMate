import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  role: 'paid' as string,
  importContentAnnotationsCsv: vi.fn(),
}));

vi.mock('@/server/middleware/withAuth.middleware', () => ({
  withAuth: async (handler: (context: { userId: string; userDetails: { role: string } }) => Promise<unknown>) =>
    handler({ userId: 'user-1', userDetails: { role: mocks.role } }),
  isWithAuthEmailLinkConflict: () => false,
}));

vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    importContentAnnotationsCsv = mocks.importContentAnnotationsCsv;
  },
}));

import { importContentCsvRows } from '@/server/actions/contentCsvImport.actions';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

describe('importContentCsvRows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.role = 'paid';
    mocks.importContentAnnotationsCsv.mockResolvedValue({
      success: true,
      data: { updated: 1, created: 0, unchanged: 0, skipped: [] },
    });
  });

  it.each(['trial', 'unavailable'])('rejects %s without calling the RPC', async role => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.role = role;
    const result = await importContentCsvRows({
      rows: [{ rowNumber: 2, url: 'https://example.com', values: { main_kw: 'keyword' } }],
    });

    expect(result).toEqual({ success: false, error: ERROR_MESSAGES.USER.INSUFFICIENT_PERMISSIONS });
    expect(mocks.importContentAnnotationsCsv).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it.each(['paid', 'admin'])('allows %s and calls the RPC for the current user', async role => {
    mocks.role = role;
    const result = await importContentCsvRows({
      rows: [{ rowNumber: 2, url: 'https://example.com', values: { main_kw: 'keyword' } }],
    });

    expect(result).toEqual({
      success: true,
      data: { updated: 1, created: 0, unchanged: 0, skipped: [] },
    });
    expect(mocks.importContentAnnotationsCsv).toHaveBeenCalledWith('user-1', [
      { rowNumber: 2, url: 'https://example.com/', values: { main_kw: 'keyword' } },
    ]);
  });

  it('maps the RPC row_index to the spreadsheet row after rows skipped in the action', async () => {
    mocks.importContentAnnotationsCsv.mockResolvedValue({
      success: true,
      data: { updated: 1, created: 0, unchanged: 0, skipped: [{ row_index: 2, url: 'https://example.com/d', reason: 'no_values' }] },
    });
    const result = await importContentCsvRows({
      rows: [
        { rowNumber: 2, url: 'https://example.com/b', values: { main_kw: 'x'.repeat(20_001) } },
        { rowNumber: 3, url: 'https://example.com/c', values: { main_kw: 'keyword' } },
        { rowNumber: 4, url: 'https://example.com/d', values: {} },
      ],
    });

    expect(result).toEqual({
      success: true,
      data: {
        updated: 1,
        created: 0,
        unchanged: 0,
        skipped: [
          { rowNumber: 2, url: 'https://example.com/b', reason: 'too_long' },
          { rowNumber: 4, url: 'https://example.com/d', reason: 'no_values' },
        ],
      },
    });
  });

  it('rejects a 2,001 row batch before authorization or RPC', async () => {
    const result = await importContentCsvRows({
      rows: Array.from({ length: 2_001 }, (_, index) => ({
        rowNumber: index + 2,
        url: `https://example.com/${index}`,
        values: {},
      })),
    });

    expect(result).toEqual({ success: false, error: ERROR_MESSAGES.COMMON.VALIDATION_FAILED });
    expect(mocks.importContentAnnotationsCsv).not.toHaveBeenCalled();
  });

  it('skips oversized cells and sends the remaining rows', async () => {
    const result = await importContentCsvRows({
      rows: [
        { rowNumber: 2, url: 'https://example.com/ok', values: { main_kw: 'ok' } },
        { rowNumber: 3, url: 'https://example.com/long', values: { kw: 'x'.repeat(20_001) } },
      ],
    });

    expect(result).toMatchObject({
      success: true,
      data: {
        updated: 1,
        skipped: [{ rowNumber: 3, url: 'https://example.com/long', reason: 'too_long' }],
      },
    });
    expect(mocks.importContentAnnotationsCsv).toHaveBeenCalledWith('user-1', [
      { rowNumber: 2, url: 'https://example.com/ok', values: { main_kw: 'ok' } },
    ]);
  });
});
