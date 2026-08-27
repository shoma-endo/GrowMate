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

/**
 * configureRunClient の入力から手計算した、finish_ga4_content_evaluation へ渡るべき値。
 *
 *   本文1000字・画像0点 → 期待読了時間 = round(1000/500*60 + 0) = 120秒
 *   engagement_time_sec 3000 ÷ active_users 30 = 平均エンゲージメント時間 100秒
 *   読了率 = 100/120 = 0.8333 → アンカー上限(0.5)超えで読了スコア 100
 *   読み始め率 0.5 → アンカー (0.4,40)-(0.5,60) の右端で読み始めスコア 60
 *   コンテンツ力 = round(sqrt(100*60)) = 77
 *   読了80-100 × 読み始め60-79 → R_GOOD
 *
 * expect.any(Number) では p_read_score と p_engage_score を取り違えても、
 * p_content_score にセッション数を入れても通ってしまう（レビューのミューテーションで実証）。
 * スコアの計算自体は ga4-evaluation.test.ts が厳密に固定しているので、ここで守るのは
 * 「算出結果がどの引数に載るか」という配線である。
 */
const EXPECTED_SCORE_ARGS = {
  p_user_id: USER_ID,
  p_content_score: 77,
  p_read_score: 100,
  p_engage_score: 60,
  p_diagnosis_code: 'R_GOOD',
  p_sessions: 30,
  p_char_count: 1000,
  p_expected_read_seconds: 120,
} as const;

function configureRunClient({
  metricsError = null,
  includeRanking = false,
  importedAt = '2026-08-10T00:00:00.000Z',
  annotationPatch = {},
  detailReads = 1,
}: {
  metricsError?: unknown;
  includeRanking?: boolean;
  importedAt?: string;
  annotationPatch?: Record<string, unknown>;
  // content_annotations の「記事1件を読む」クエリを何回返すか。
  // 既定は1（呼び出し側が resolveInitialDisplayStatus を spyOn で差し替える前提）。
  // 実物の resolveInitialDisplayStatus を走らせる場合は、そこで1回・computeGa4Score で
  // もう1回読むため 2 を渡す。どちらも同じ行を同じ条件で読むので同じ結果を返してよい。
  detailReads?: number;
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
  let detailReadsServed = 0;
  mocks.client.from.mockImplementation((table: string) => {
    if (table === 'content_annotations') {
      if (detailReadsServed < detailReads) {
        detailReadsServed += 1;
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
      ...EXPECTED_SCORE_ARGS,
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
      ...EXPECTED_SCORE_ARGS,
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
      ...EXPECTED_SCORE_ARGS,
    });
    expect(mocks.generateGa4EvaluationLlmOutput).not.toHaveBeenCalled();
  });
});

describe('ga4ContentEvaluationService.computeBaselineScore（D10再反転: 定期評価バッチの初回パス）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mocks.credential = null;
    mocks.withServiceRoleClient.mockImplementation(
      async (handler: (client: unknown) => Promise<unknown>) => handler(mocks.client)
    );
  });

  const BASELINE_INPUT = {
    userId: USER_ID,
    annotationId: 'annotation-1',
    startDate: '2026-08-01',
    endDate: '2026-08-10',
  };

  it('resolveInitialDisplayStatusがlow_dataの時点で早期returnし、GA4データ取得（computeGa4Score）を行わない', async () => {
    const serviceInternals = ga4ContentEvaluationService as unknown as {
      resolveInitialDisplayStatus: (...args: unknown[]) => Promise<{ status: 'low_data'; missingMetrics: string[] }>;
    };
    vi.spyOn(serviceInternals, 'resolveInitialDisplayStatus').mockResolvedValue({ status: 'low_data', missingMetrics: [] });

    const result = await ga4ContentEvaluationService.computeBaselineScore(BASELINE_INPUT);

    expect(result).toEqual({ status: 'low_data', contentScore: null });
    // computeGa4Score（GA4データ取得）へ進んでいない
    expect(mocks.client.from).not.toHaveBeenCalled();
  });

  it('GA4データ取得に失敗した場合はimport_failedを返す（LLM・RPC呼び出しなし）', async () => {
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
    configureRunClient({ metricsError: { code: 'ga4_query_failed' } });

    const result = await ga4ContentEvaluationService.computeBaselineScore(BASELINE_INPUT);

    expect(result).toEqual({ status: 'import_failed', contentScore: null });
    expect(mocks.generateGa4EvaluationLlmOutput).not.toHaveBeenCalled();
    expect(mocks.client.rpc).not.toHaveBeenCalled();
  });

  it('成功時はスコアのみを返し、LLM診断コメント生成・履歴行/RPCへの書き込みを一切行わない', async () => {
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
    configureRunClient();

    const result = await ga4ContentEvaluationService.computeBaselineScore(BASELINE_INPUT);

    expect(result.status).toBe('scored');
    expect(result.contentScore).toEqual(expect.any(Number));
    expect(mocks.generateGa4EvaluationLlmOutput).not.toHaveBeenCalled();
    // computeBaselineScore はDB永続化（start/finish RPC）を一切行わない
    expect(mocks.client.rpc).not.toHaveBeenCalled();
  });
  // 本文0字の記事を採点しないこと（レビュー🔴1）。resolveInitialDisplayStatus は
  // 実物を走らせる（既存の run() テストは全て spyOn で差し替えており、この関数の
  // 本体は一度も実行されていなかった）。
  const CREDENTIAL = {
    ga4PropertyId: 'property-1',
    ga4LastSyncedAt: '2026-08-11T00:00:00.000Z',
    accessToken: 'access-token',
    accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
    scope: ['https://www.googleapis.com/auth/analytics.readonly'],
  };

  it.each([
    { name: 'NULL', wpContentText: null },
    { name: '空文字', wpContentText: '' },
    // stripHtml はエンティティをデコードしないため <p>&nbsp;</p> は '&nbsp;' として
    // 保存される（NOT NULL・非空）。一方 countContentChars はデコードしてから空白を
    // 畳むので0文字になる。NULL 判定だけでは取りこぼす経路。
    { name: 'エンティティのみ', wpContentText: '&nbsp;' },
  ])('本文が$nameの記事は採点せず、評価を開始しない', async ({ wpContentText }) => {
    mocks.credential = { ...CREDENTIAL };
    vi.spyOn(ga4ContentEvaluationService, 'fetchEvaluation').mockResolvedValue(EVALUATION_VIEW);
    configureRunClient({ annotationPatch: { wp_content_text: wpContentText, wp_image_count: 5 } });

    await expect(ga4ContentEvaluationService.run(RUN_INPUT)).resolves.toEqual(EVALUATION_VIEW);

    // 評価そのものを開始しない（履歴行もスコアも作らない）
    const rpcNames = mocks.client.rpc.mock.calls.map(([name]) => name);
    expect(rpcNames).not.toContain('start_ga4_content_evaluation');
    expect(rpcNames).not.toContain('finish_ga4_content_evaluation');
    expect(mocks.generateGa4EvaluationLlmOutput).not.toHaveBeenCalled();
  });

  it('本文0字の記事はベースライン算出でもスコアを出さない', async () => {
    mocks.credential = { ...CREDENTIAL };
    configureRunClient({ annotationPatch: { wp_content_text: null, wp_image_count: 5 } });

    const result = await ga4ContentEvaluationService.computeBaselineScore(BASELINE_INPUT);

    expect(result).toEqual({ status: 'low_data', contentScore: null });
    expect(mocks.generateGa4EvaluationLlmOutput).not.toHaveBeenCalled();
  });

  it('本文がある記事はこれまでどおり採点される（上のガードが効きすぎていないこと）', async () => {
    mocks.credential = { ...CREDENTIAL };
    configureRunClient({ detailReads: 2 });

    const result = await ga4ContentEvaluationService.computeBaselineScore(BASELINE_INPUT);

    expect(result.status).toBe('scored');
    expect(result.contentScore).toEqual(expect.any(Number));
  });
});
