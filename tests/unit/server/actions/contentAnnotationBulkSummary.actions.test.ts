import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AI要約一括の Server Action（**ジョブ起票**）のユニットテスト。
 * 正本: docs/plans/content-annotation-bulk-summary-background-spec.md §6 / §7
 *
 * 2026-09-04 に同期実行からバックグラウンド実行へ差し替えたため、要約の生成・件数集計・
 * 時間予算の網は `tests/unit/server/services/contentAnnotationSummaryJobService.test.ts` へ移した。
 * ここで見るのは「対象 ID を解決してジョブを1件作る」までの契約だけ。
 */

const mocks = vi.hoisted(() => ({
  authMiddleware: vi.fn(),
  cookies: vi.fn(),
  resolveAllAnnotationIds: vi.fn(),
  findActiveJob: vi.fn(),
  createJob: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));

vi.mock('@/server/middleware/auth.middleware', () => ({
  authMiddleware: mocks.authMiddleware,
}));
vi.mock('@/server/middleware/authMiddlewareGuards', () => ({
  getEmailLinkConflictMessage: () => undefined,
}));

vi.mock('@/server/services/analyticsContentService', () => ({
  analyticsContentService: {
    resolveAllAnnotationIds: mocks.resolveAllAnnotationIds,
  },
}));

vi.mock('@/server/services/contentAnnotationSummaryJobService', () => ({
  contentAnnotationSummaryJobService: {
    findActiveJob: mocks.findActiveJob,
    createJob: mocks.createJob,
  },
}));

import { summarizeContentAnnotationsBulk } from '@/server/actions/contentAnnotationBulkSummary.actions';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

const USER_ID = 'b0ed75ba-bb37-4dd7-89a0-c6ce940f991c';
const uuid = (n: number) => `0000000${n}-0000-4000-8000-000000000000`.slice(-36);

function authAs(role: string | null) {
  mocks.authMiddleware.mockResolvedValue({
    userId: USER_ID,
    userDetails: role === null ? null : { role },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookies.mockResolvedValue({ get: () => undefined });
  authAs('paid');
  mocks.findActiveJob.mockResolvedValue(null);
  mocks.createJob.mockImplementation(
    async ({ targetAnnotationIds }: { targetAnnotationIds: string[] }) => ({
      success: true,
      jobId: 'job-1',
      totalCount: targetAnnotationIds.length,
    })
  );
});

describe('認可（FR-B10 / AC-B09）', () => {
  it('trial はサーバー側で拒否し、ジョブを作らない', async () => {
    authAs('trial');
    const result = await summarizeContentAnnotationsBulk({
      mode: 'ids',
      contentAnnotationIds: [uuid(1)],
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe(ERROR_MESSAGES.GA4.FEATURE_ACCESS_DENIED);
    expect(mocks.createJob).not.toHaveBeenCalled();
  });

  it('role なしも拒否する', async () => {
    authAs(null);
    const result = await summarizeContentAnnotationsBulk({
      mode: 'ids',
      contentAnnotationIds: [uuid(1)],
    });
    expect(result.success).toBe(false);
    expect(mocks.createJob).not.toHaveBeenCalled();
  });
});

describe('入力検証（AC-B11）', () => {
  it('0件はエラー', async () => {
    const result = await summarizeContentAnnotationsBulk({
      mode: 'ids',
      contentAnnotationIds: [],
    });
    expect(result.error).toBe(ERROR_MESSAGES.WORDPRESS.SUMMARY_BULK_TARGETS_REQUIRED);
    expect(mocks.createJob).not.toHaveBeenCalled();
  });

  it('1001件はジョブを作らずエラー', async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => uuid(i + 1));
    const result = await summarizeContentAnnotationsBulk({ mode: 'ids', contentAnnotationIds: ids });
    expect(result.error).toBe(ERROR_MESSAGES.WORDPRESS.SUMMARY_BULK_TARGETS_LIMIT_EXCEEDED);
    expect(mocks.createJob).not.toHaveBeenCalled();
  });

  it('UUID でない ID は検証で弾く', async () => {
    const result = await summarizeContentAnnotationsBulk({
      mode: 'ids',
      contentAnnotationIds: ['not-a-uuid'],
    });
    expect(result.error).toBe(ERROR_MESSAGES.COMMON.VALIDATION_FAILED);
  });
});

describe('起票（AC-B01 / BR-B02）', () => {
  it('ジョブ ID と対象件数を返す（同期実行の結果は返さない）', async () => {
    const result = await summarizeContentAnnotationsBulk({
      mode: 'ids',
      contentAnnotationIds: [uuid(1), uuid(2)],
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ jobId: 'job-1', totalCount: 2 });
    expect(mocks.createJob).toHaveBeenCalledWith({
      userId: USER_ID,
      targetAnnotationIds: [uuid(1), uuid(2)],
    });
  });

  it('mode: all の母集団解決は起票時に1回だけ行い、解決した ID をジョブへ固定する', async () => {
    mocks.resolveAllAnnotationIds.mockResolvedValue({ ids: [uuid(1), uuid(2)], total: 2 });

    const result = await summarizeContentAnnotationsBulk({
      mode: 'all',
      excludedIds: [uuid(2)],
    });

    expect(result.success).toBe(true);
    expect(mocks.resolveAllAnnotationIds).toHaveBeenCalledTimes(1);
    expect(mocks.createJob).toHaveBeenCalledWith({
      userId: USER_ID,
      targetAnnotationIds: [uuid(1)],
    });
  });

  it('母集団の件数と取得 ID 数が食い違えばジョブを作らない（R-002）', async () => {
    mocks.resolveAllAnnotationIds.mockResolvedValue({ ids: [uuid(1)], total: 5 });
    const result = await summarizeContentAnnotationsBulk({ mode: 'all' });
    expect(result.error).toBe(ERROR_MESSAGES.WORDPRESS.SUMMARY_BULK_POPULATION_MISMATCH);
    expect(mocks.createJob).not.toHaveBeenCalled();
  });

  it('母集団が1000件超なら先頭1000件へ丸めて起票する（エラーにしない）', async () => {
    const ids = Array.from({ length: 1000 }, (_, i) => uuid(i + 1));
    mocks.resolveAllAnnotationIds.mockResolvedValue({ ids, total: 1500 });

    const result = await summarizeContentAnnotationsBulk({ mode: 'all' });

    expect(result.success).toBe(true);
    expect(mocks.resolveAllAnnotationIds).toHaveBeenCalledWith(USER_ID, 1000);
    expect(result.data?.totalCount).toBe(1000);
  });

  it('全件を除外したらジョブを作らない', async () => {
    mocks.resolveAllAnnotationIds.mockResolvedValue({ ids: [uuid(1)], total: 1 });
    const result = await summarizeContentAnnotationsBulk({
      mode: 'all',
      excludedIds: [uuid(1)],
    });
    expect(result.error).toBe(ERROR_MESSAGES.WORDPRESS.SUMMARY_BULK_TARGETS_REQUIRED);
    expect(mocks.createJob).not.toHaveBeenCalled();
  });
});

describe('二重起票の拒否（AC-B07 / BR-B03）', () => {
  it('事前検出で見つかったら SUMMARY_BULK_ALREADY_RUNNING を返す', async () => {
    mocks.findActiveJob.mockResolvedValue({ jobId: 'job-1', processedCount: 3, totalCount: 10 });

    const result = await summarizeContentAnnotationsBulk({
      mode: 'ids',
      contentAnnotationIds: [uuid(1)],
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe(ERROR_MESSAGES.WORDPRESS.SUMMARY_BULK_ALREADY_RUNNING);
    expect(mocks.createJob).not.toHaveBeenCalled();
  });

  it('ユニーク制約違反も同じ文言を返す（汎用の失敗に落とさない）', async () => {
    mocks.createJob.mockResolvedValue({ success: false, reason: 'already_running' });

    const result = await summarizeContentAnnotationsBulk({
      mode: 'ids',
      contentAnnotationIds: [uuid(1)],
    });

    expect(result.error).toBe(ERROR_MESSAGES.WORDPRESS.SUMMARY_BULK_ALREADY_RUNNING);
    expect(result.error).not.toBe(ERROR_MESSAGES.WORDPRESS.SUMMARY_BULK_FAILED);
  });

  it('起票そのものの失敗は SUMMARY_BULK_FAILED を返す', async () => {
    mocks.createJob.mockResolvedValue({ success: false, reason: 'failed' });

    const result = await summarizeContentAnnotationsBulk({
      mode: 'ids',
      contentAnnotationIds: [uuid(1)],
    });

    expect(result.error).toBe(ERROR_MESSAGES.WORDPRESS.SUMMARY_BULK_FAILED);
  });
});
