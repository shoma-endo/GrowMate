import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  client: { from: vi.fn(), rpc: vi.fn() },
  fetchAllPaged: vi.fn(),
  withServiceRoleClient: vi.fn(),
  getTemplateByName: vi.fn(),
  generateGa4EvaluationLlmOutput: vi.fn(),
  credential: null as {
    ga4PropertyId: string;
    ga4LastSyncedAt: string;
    accessToken: string;
    accessTokenExpiresAt: string;
    scope: string[];
  } | null,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/server/services/promptService', () => ({
  PromptService: {
    getTemplateByName: mocks.getTemplateByName,
    replaceVariables: (content: string) => content,
  },
}));
vi.mock('@/server/services/ga4EvaluationLlmService', () => ({
  generateGa4EvaluationLlmOutput: mocks.generateGa4EvaluationLlmOutput,
}));
vi.mock('@/server/services/supabaseService', () => {
  class MockSupabaseService {
    static withServiceRoleClient = mocks.withServiceRoleClient;

    getClient() {
      return mocks.client;
    }

    async getGscCredentialByUserId() {
      return mocks.credential;
    }

    async fetchAllPaged(...args: unknown[]) {
      return mocks.fetchAllPaged(...args);
    }
  }
  return { SupabaseService: MockSupabaseService };
});

import { ga4ContentEvaluationService } from '@/server/services/ga4ContentEvaluationService';
import type { ContentScoreRankingItem } from '@/server/lib/ga4-content-score-aggregation';

const USER_ID = 'b0ed75ba-bb37-4dd7-89a0-c6ce940f991c';

function createQuery(resolve: (ids: string[]) => Promise<unknown>) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.in.mockImplementation((_column: string, ids: string[]) => resolve(ids));
  return query;
}

function createRunQuery(result: unknown) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    not: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(),
  };
  for (const method of [query.select, query.eq, query.in, query.not, query.order, query.gte]) {
    method.mockReturnValue(query);
  }
  query.limit.mockResolvedValue(result);
  query.lte.mockResolvedValue(result);
  query.range.mockResolvedValue(result);
  query.maybeSingle.mockResolvedValue(result);
  return query;
}

const RUN_INPUT = {
  userId: USER_ID,
  annotationId: 'annotation-1',
  startDate: '2026-08-01',
  endDate: '2026-08-10',
};

const EVALUATION_VIEW = {
  settingsEnabled: true,
  missingMetrics: [],
  displayStatus: 'narrative_failed' as const,
  projection: null,
  history: [],
};

function configureRunClient({
  metricsError = null,
  includeRanking = false,
  importedAt = '2026-08-10T00:00:00.000Z',
  annotationPatch = {},
}: {
  metricsError?: unknown;
  includeRanking?: boolean;
  importedAt?: string;
  annotationPatch?: Record<string, unknown>;
} = {}) {
  const annotation = {
    id: RUN_INPUT.annotationId,
    canonical_url: 'https://example.com/article-1',
    wp_post_title: '記事タイトル',
    wp_content_text: 'a'.repeat(1000),
    wp_image_count: 0,
    basic_structure: '## 見出し',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...annotationPatch,
  };
  const metrics = {
    date: '2026-08-01', normalized_path: '/article-1', sessions: 30, users: 30,
    engagement_time_sec: 3000, bounce_rate: 0.2, engagement_rate: 0.5, active_users: 30,
    cv_event_count: 0, scroll_90_event_count: 10, search_clicks: 0, impressions: 0,
    is_sampled: false, is_partial: false, imported_at: importedAt,
  };
  const queries = new Map<string, ReturnType<typeof createRunQuery>>([
    ['content_annotations:detail', createRunQuery({ data: annotation, error: null })],
    ['ga4_page_metrics_daily:detail', createRunQuery({ data: metricsError ? null : [metrics], error: metricsError, count: metricsError ? null : 1 })],
  ]);
  if (includeRanking) {
    queries.set('ga4_content_evaluations:ranking', createRunQuery({
      data: [
        { content_annotation_id: RUN_INPUT.annotationId, last_success_history_id: 'history-1' },
        { content_annotation_id: 'annotation-2', last_success_history_id: 'history-2' },
      ], error: null, count: 2,
    }));
    queries.set('ga4_content_evaluation_history:ranking', createRunQuery({
      data: [
        { id: 'history-1', content_annotation_id: RUN_INPUT.annotationId, status: 'evaluated', content_score: 70, sessions: 40, read_score: 60, engage_score: 80 },
        { id: 'history-2', content_annotation_id: 'annotation-2', status: 'evaluated', content_score: 50, sessions: 50, read_score: 50, engage_score: 50 },
      ], error: null,
    }));
    queries.set('content_annotations:ranking', createRunQuery({
      data: [
        { id: RUN_INPUT.annotationId, canonical_url: annotation.canonical_url, wp_post_title: annotation.wp_post_title },
        { id: 'annotation-2', canonical_url: 'https://example.com/article-2', wp_post_title: '記事2' },
      ], error: null,
    }));
    queries.set('ga4_content_evaluation_history:previous', createRunQuery({
      data: [{ content_score: 60, engage_score: 50, read_score: 55 }], error: null,
    }));
  }
  let detailQueryUsed = false;
  mocks.client.from.mockImplementation((table: string) => {
    if (table === 'content_annotations') {
      if (!detailQueryUsed) {
        detailQueryUsed = true;
        return queries.get('content_annotations:detail');
      }
      return queries.get('content_annotations:ranking');
    }
    if (table === 'ga4_page_metrics_daily') return queries.get('ga4_page_metrics_daily:detail');
    if (table === 'ga4_content_evaluations') return queries.get('ga4_content_evaluations:ranking');
    if (table === 'ga4_content_evaluation_history') {
      return queries.get('ga4_content_evaluation_history:ranking') ?? queries.get('ga4_content_evaluation_history:previous');
    }
    throw new Error(`unexpected table: ${table}`);
  });
  mocks.client.rpc.mockImplementation((name: string) => {
    if (name === 'start_ga4_content_evaluation') return Promise.resolve({ data: [{ evaluation_run_id: 'run-1' }], error: null });
    if (name === 'finish_ga4_content_evaluation') return Promise.resolve({ data: null, error: null });
    if (name === 'update_ga4_content_evaluation_attempt') return Promise.resolve({ data: true, error: null });
    throw new Error(`unexpected rpc: ${name}`);
  });
}

describe('ga4ContentEvaluationService の評価済み記事集計', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mocks.credential = null;
    mocks.withServiceRoleClient.mockImplementation(
      async (handler: (client: unknown) => Promise<unknown>) => handler(mocks.client)
    );
  });

  it('記事ごとの最新成功投影を1000件超でも全件取得し、各取得にユーザー境界を付ける', async () => {
    const projectionRows = Array.from({ length: 1001 }, (_, index) => ({
      content_annotation_id: `annotation-${index}`,
      last_success_history_id: `history-${index}`,
    }));
    mocks.fetchAllPaged.mockResolvedValue({ data: projectionRows, error: null, truncated: false });

    const historyQuery = createQuery(async ids => ({
      data: ids.map(id => ({
        id,
        content_annotation_id: `annotation-${id.slice('history-'.length)}`,
        status: 'evaluated',
        content_score: 70,
        sessions: 30,
        read_score: 60,
        engage_score: 80,
      })),
      error: null,
    }));
    const annotationQuery = createQuery(async ids => ({
      data: ids.map(id => ({
        id,
        canonical_url: `https://example.com/${id}`,
        wp_post_title: id,
      })),
      error: null,
    }));
    mocks.client.from.mockImplementation((table: string) => {
      if (table === 'ga4_content_evaluation_history') return historyQuery;
      if (table === 'content_annotations') return annotationQuery;
      throw new Error(`unexpected table: ${table}`);
    });

    const result = await ga4ContentEvaluationService.fetchLatestSuccessfulContentScores(USER_ID);

    expect(result).toHaveLength(1001);
    expect(result[0]?.annotationId).toBe('annotation-0');
    expect(result[1000]?.annotationId).toBe('annotation-1000');
    expect(mocks.fetchAllPaged).toHaveBeenCalledWith(expect.any(Function), { pageSize: 500 });
    expect(historyQuery.in.mock.calls.map(([_column, ids]) => (ids as string[]).length)).toEqual([500, 500, 1]);
    expect(annotationQuery.in.mock.calls.map(([_column, ids]) => (ids as string[]).length)).toEqual([500, 500, 1]);
    expect(historyQuery.eq.mock.calls.every(([column, value]) => column !== 'user_id' || value === USER_ID)).toBe(true);
    expect(annotationQuery.eq.mock.calls.every(([column, value]) => column !== 'user_id' || value === USER_ID)).toBe(true);
    expect(historyQuery.eq.mock.calls.filter(([column]) => column === 'user_id')).toHaveLength(3);
    expect(annotationQuery.eq.mock.calls.filter(([column]) => column === 'user_id')).toHaveLength(3);
  });

  it('順位算出は記事ごとの最新成功投影を母集団にし、同一記事の再評価で件数を増やさない', async () => {
    const projectionRows = [
      { content_annotation_id: RUN_INPUT.annotationId, last_success_history_id: 'history-1' },
      { content_annotation_id: 'annotation-2', last_success_history_id: 'history-2' },
    ];
    mocks.fetchAllPaged.mockResolvedValue({ data: projectionRows, error: null, truncated: false });

    const historyQuery = createQuery(async ids => ({
      data: ids.map(id => ({
        id,
        content_annotation_id: id === 'history-1' ? RUN_INPUT.annotationId : 'annotation-2',
        status: 'evaluated',
        content_score: id === 'history-1' ? 70 : 50,
        sessions: 30,
        read_score: 60,
        engage_score: 80,
      })),
      error: null,
    }));
    const annotationQuery = createQuery(async ids => ({
      data: ids.map(id => ({ id, canonical_url: `https://example.com/${id}`, wp_post_title: id })),
      error: null,
    }));
    mocks.client.from.mockImplementation((table: string) => {
      if (table === 'ga4_content_evaluation_history') return historyQuery;
      if (table === 'content_annotations') return annotationQuery;
      throw new Error(`unexpected table: ${table}`);
    });
    const serviceInternals = ga4ContentEvaluationService as unknown as {
      calculateRank: (userId: string, annotationId: string, current: ContentScoreRankingItem) => Promise<{ rank: number; totalArticles: number }>;
    };

    await expect(serviceInternals.calculateRank(USER_ID, RUN_INPUT.annotationId, {
      id: RUN_INPUT.annotationId,
      contentScore: 70,
      sessions: 30,
      readScore: 60,
      engageScore: 80,
    })).resolves.toEqual({ rank: 1, totalArticles: 2 });
  });



  it('GA4取得失敗を import_failed として完了RPCへ渡す', async () => {
    mocks.credential = {
      ga4PropertyId: 'property-1',
      ga4LastSyncedAt: '2026-08-11T00:00:00.000Z',
      accessToken: 'access-token',
      accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
      scope: ['https://www.googleapis.com/auth/analytics.readonly'],
    };
    const serviceInternals = ga4ContentEvaluationService as unknown as {
      resolveInitialDisplayStatus: (...args: unknown[]) => Promise<{ status: 'eligible'; missingMetrics: string[] }>;
    };
    vi.spyOn(serviceInternals, 'resolveInitialDisplayStatus').mockResolvedValue({ status: 'eligible', missingMetrics: [] });
    vi.spyOn(ga4ContentEvaluationService, 'fetchEvaluation').mockResolvedValue(EVALUATION_VIEW);
    configureRunClient({ metricsError: { code: 'ga4_query_failed' } });

    await expect(ga4ContentEvaluationService.run(RUN_INPUT)).resolves.toEqual(EVALUATION_VIEW);

    const finishCall = mocks.client.rpc.mock.calls.find(([name]) => name === 'finish_ga4_content_evaluation');
    expect(finishCall?.[1]).toMatchObject({
      p_status: 'import_failed',
      p_error_code: 'ga4_query_failed',
    });
    // スコア未算出はキー省略で表す（SQL 側が default null のため NULL 保存と等価）
    expect(finishCall?.[1]?.p_content_score ?? null).toBeNull();
  });

  it('アクセストークンの残り期限が切れていてもリフレッシュを試みずに評価を実行する（run()はGoogle APIを呼ばないため再認証チェックは不要。過去の誤ブロック不具合の回帰）', async () => {
    mocks.credential = {
      ga4PropertyId: 'property-1',
      ga4LastSyncedAt: '2026-08-11T00:00:00.000Z',
      accessToken: 'access-token',
      accessTokenExpiresAt: '2020-01-01T00:00:00.000Z', // 残り期限切れ（=旧実装ならneeds_reauthで即拒否していた）
      scope: ['https://www.googleapis.com/auth/analytics.readonly'],
    };
    const serviceInternals = ga4ContentEvaluationService as unknown as {
      resolveInitialDisplayStatus: (...args: unknown[]) => Promise<{ status: 'eligible'; missingMetrics: string[] }>;
    };
    vi.spyOn(serviceInternals, 'resolveInitialDisplayStatus').mockResolvedValue({ status: 'eligible', missingMetrics: [] });
    vi.spyOn(ga4ContentEvaluationService, 'fetchEvaluation').mockResolvedValue(EVALUATION_VIEW);
    configureRunClient({ metricsError: { code: 'ga4_query_failed' } });

    await expect(ga4ContentEvaluationService.run(RUN_INPUT)).resolves.toEqual(EVALUATION_VIEW);

    const finishCall = mocks.client.rpc.mock.calls.find(([name]) => name === 'finish_ga4_content_evaluation');
    expect(finishCall?.[1]).toMatchObject({
      p_status: 'import_failed',
      p_error_code: 'ga4_query_failed',
    });
  });

  it('評価対象期間の終端からGA4取込までの間隔が長くても評価をブロックしない（データ鮮度チェック撤去の回帰）', async () => {
    mocks.getTemplateByName.mockResolvedValue(null);
    mocks.credential = {
      ga4PropertyId: 'property-1',
      ga4LastSyncedAt: '2026-08-14T00:00:00.000Z',
      accessToken: 'access-token',
      accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
      scope: ['https://www.googleapis.com/auth/analytics.readonly'],
    };
    const serviceInternals = ga4ContentEvaluationService as unknown as {
      resolveInitialDisplayStatus: (...args: unknown[]) => Promise<{ status: 'eligible'; missingMetrics: string[] }>;
    };
    vi.spyOn(serviceInternals, 'resolveInitialDisplayStatus').mockResolvedValue({ status: 'eligible', missingMetrics: [] });
    vi.spyOn(ga4ContentEvaluationService, 'fetchEvaluation').mockResolvedValue(EVALUATION_VIEW);
    // 対象期間の終端（RUN_INPUT.endDate: 2026-08-10）から4日後の取込＝旧48時間鮮度チェックなら insufficient_data で打ち切っていたケース
    configureRunClient({ includeRanking: true, importedAt: '2026-08-14T00:00:00.000Z' });

    await expect(ga4ContentEvaluationService.run(RUN_INPUT)).resolves.toEqual(EVALUATION_VIEW);

    const finishCall = mocks.client.rpc.mock.calls.find(([name]) => name === 'finish_ga4_content_evaluation');
    expect(finishCall?.[1]).toMatchObject({
      p_status: 'narrative_failed',
      p_content_score: expect.any(Number),
    });
    expect(finishCall?.[1]?.p_status).not.toBe('insufficient_data');
    expect(finishCall?.[1]?.p_error_code).not.toBe('ga4_data_stale');
  });

  it('narrative失敗時はスコアを保持して narrative_failed を保存する', async () => {
    mocks.credential = {
      ga4PropertyId: 'property-1',
      ga4LastSyncedAt: '2026-08-11T00:00:00.000Z',
      accessToken: 'access-token',
      accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
      scope: ['https://www.googleapis.com/auth/analytics.readonly'],
    };
    mocks.getTemplateByName.mockResolvedValue({ id: 'template-1', version: 1, content: 'prompt {{title}}' });
    mocks.generateGa4EvaluationLlmOutput.mockImplementation(async (request: { onAttempt?: (attemptCount: number) => Promise<void> }) => {
      await request.onAttempt?.(1);
      return { success: false, code: 'llm_timeout', attemptCount: 3 };
    });
    const serviceInternals = ga4ContentEvaluationService as unknown as {
      resolveInitialDisplayStatus: (...args: unknown[]) => Promise<{ status: 'eligible'; missingMetrics: string[] }>;
    };
    vi.spyOn(serviceInternals, 'resolveInitialDisplayStatus').mockResolvedValue({ status: 'eligible', missingMetrics: [] });
    vi.spyOn(ga4ContentEvaluationService, 'fetchEvaluation').mockResolvedValue(EVALUATION_VIEW);
    configureRunClient({ includeRanking: true });

    await expect(ga4ContentEvaluationService.run(RUN_INPUT)).resolves.toEqual(EVALUATION_VIEW);

    const finishCall = mocks.client.rpc.mock.calls.find(([name]) => name === 'finish_ga4_content_evaluation');
    expect(finishCall?.[1]).toMatchObject({
      p_status: 'narrative_failed',
      p_error_code: 'llm_timeout',
      p_content_score: expect.any(Number),
      p_diagnosis_code: expect.any(String),
    });
    expect(mocks.client.rpc.mock.calls.filter(([name]) => name === 'update_ga4_content_evaluation_attempt')).toHaveLength(1);
  });

  it('プロンプト未登録時はスコアを保持して narrative_failed を保存しLLMを呼び出さない', async () => {
    mocks.getTemplateByName.mockResolvedValue(null);
    mocks.generateGa4EvaluationLlmOutput.mockResolvedValue({ success: true });
    mocks.credential = {
      ga4PropertyId: 'property-1',
      ga4LastSyncedAt: '2026-08-11T00:00:00.000Z',
      accessToken: 'access-token',
      accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
      scope: ['https://www.googleapis.com/auth/analytics.readonly'],
    };
    const serviceInternals = ga4ContentEvaluationService as unknown as {
      resolveInitialDisplayStatus: (...args: unknown[]) => Promise<{ status: 'eligible'; missingMetrics: string[] }>;
    };
    vi.spyOn(serviceInternals, 'resolveInitialDisplayStatus').mockResolvedValue({ status: 'eligible', missingMetrics: [] });
    vi.spyOn(ga4ContentEvaluationService, 'fetchEvaluation').mockResolvedValue(EVALUATION_VIEW);
    configureRunClient({ includeRanking: true });

    await expect(ga4ContentEvaluationService.run(RUN_INPUT)).resolves.toEqual(EVALUATION_VIEW);

    const finishCall = mocks.client.rpc.mock.calls.find(([name]) => name === 'finish_ga4_content_evaluation');
    expect(finishCall?.[1]).toMatchObject({
      p_status: 'narrative_failed',
      p_error_code: 'llm_output_invalid',
      p_content_score: expect.any(Number),
    });
    expect(mocks.generateGa4EvaluationLlmOutput).not.toHaveBeenCalled();
  });
});
