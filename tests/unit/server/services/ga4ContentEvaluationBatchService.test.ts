import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ga4ContentEvaluationView } from '@/types/ga4-evaluation';
import { addDaysISO, formatJstDateISO } from '@/lib/date-utils';

// 再レビューで指摘された🟡#4「last_seen_content_score継続更新・truncatedCandidates合算の
// 退行検知手段がない」への対応。Supabaseクライアントを最小限のフェイクで模倣し、
// runAllDueEvaluations() を実際に走らせて回帰を防ぐ。

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  computeBaselineScore: vi.fn(),
  syncUser: vi.fn(),
  rpc: vi.fn(),
  sendEmail: vi.fn(),
  updateCalls: [] as Record<string, unknown>[],
  userEmail: null as string | null,
}));

vi.mock('@/server/services/ga4ContentEvaluationService', () => ({
  ga4ContentEvaluationService: { run: mocks.run, computeBaselineScore: mocks.computeBaselineScore },
}));
vi.mock('@/server/services/ga4ImportService', () => ({
  ga4ImportService: { syncUser: mocks.syncUser },
}));
vi.mock('@/server/services/emailService', () => ({
  emailService: { sendGa4ContentEvaluation: mocks.sendEmail },
}));
// ga4ContentEvaluationBatchService は emailService 経由で @/env を読み込む（RESEND_API_KEY等）。
vi.mock('@/env', () => ({
  env: { RESEND_API_KEY: undefined, NEXT_PUBLIC_SITE_URL: 'https://example.test' },
}));

vi.mock('@/server/services/supabaseService', () => {
  class FakeQuery {
    private resolveValue: { data: unknown; error: null };
    constructor(resolveValue: { data: unknown; error: null }) {
      this.resolveValue = resolveValue;
    }
    select() {
      return this;
    }
    eq() {
      return this;
    }
    update(payload: Record<string, unknown>) {
      mocks.updateCalls.push(payload);
      return this;
    }
    maybeSingle() {
      return Promise.resolve(this.resolveValue);
    }
    then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve(this.resolveValue).then(onFulfilled, onRejected);
    }
  }

  return {
    // src/server/services/supabaseService.ts の fetchAllPaged と同じページング・truncated 判定を
    // 最小限だけ再現する（本体を差し替えるため継承できず、ここで複製する必要がある）。
    SupabaseService: class {
      async fetchAllPaged<T>(
        runPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown; count: number | null }>,
        options: { pageSize?: number; maxRows?: number } = {}
      ): Promise<{ data: T[]; error: unknown; truncated: boolean }> {
        const pageSize = options.pageSize ?? 1000;
        const maxRows = options.maxRows ?? Number.POSITIVE_INFINITY;
        const all: T[] = [];
        let total: number | null = null;

        for (let from = 0; from < maxRows; from += pageSize) {
          const to = Math.min(from + pageSize, maxRows) - 1;
          const { data, error, count } = await runPage(from, to);
          if (error) return { data: all, error, truncated: false };
          if (count !== null && count !== undefined) total = count;
          const batch = data ?? [];
          all.push(...batch);
          if (batch.length === 0 || batch.length < pageSize) break;
          if (total !== null && all.length >= total) break;
        }

        return { data: all, error: null, truncated: total !== null && all.length < total };
      }

      getClient() {
        return {
          rpc: mocks.rpc,
          from: (table: string) => {
            if (table === 'gsc_article_evaluations') {
              return new FakeQuery({ data: { ga4_last_notified_history_id: null }, error: null });
            }
            if (table === 'users') {
              return new FakeQuery({ data: { email: mocks.userEmail }, error: null });
            }
            if (table === 'content_annotations') {
              return new FakeQuery({
                data: { wp_post_title: 'テスト記事', canonical_url: 'https://example.test/articles/a' },
                error: null,
              });
            }
            throw new Error(`unexpected table: ${table}`);
          },
        };
      }
    },
  };
});

import { ga4ContentEvaluationBatchService } from '@/server/services/ga4ContentEvaluationBatchService';

/**
 * listDueEvaluations() は client.rpc(...).range(from, to) の形で呼ぶ（レビュー指摘・実装時訂正で
 * p_limit/p_offset をRPC引数からPostgRESTの.range()へ移した）。mocks.rpc はその呼び出し自体
 * ではなく、続く .range() の戻り値を解決させる必要がある。
 */
function mockRpcRange(value: { data: unknown; error: unknown; count: number | null }) {
  mocks.rpc.mockReturnValue({ range: vi.fn().mockResolvedValue(value) });
}

function buildEvaluatedView(contentScore: number): Ga4ContentEvaluationView {
  const freshStartedAt = new Date(Date.now() + 60_000).toISOString();
  return {
    settingsEnabled: true,
    displayStatus: 'evaluated',
    missingMetrics: [],
    projection: null,
    history: [
      {
        id: 'history-1',
        status: 'evaluated',
        startedAt: freshStartedAt,
        completedAt: freshStartedAt,
        attemptCount: 1,
        readRate: 0.5,
        engageRate: 0.5,
        scrollRate: null,
        readScore: 60,
        engageScore: 60,
        contentScore,
        diagnosisCode: null,
        siteRank: null,
        totalArticles: null,
        sessions: 100,
        charCount: null,
        imageCount: null,
        expectedReadSeconds: null,
        avgEngagementSeconds: null,
        narrative: null,
        dataQuality: null,
        periodStart: '2026-01-01',
        periodEnd: '2026-03-31',
        ga4DataFetchedAt: null,
        errorCode: null,
      },
    ],
  };
}

describe('ga4ContentEvaluationBatchService.runAllDueEvaluations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateCalls.length = 0;
    mocks.userEmail = null;
    mocks.syncUser.mockResolvedValue(undefined);
  });

  it('last_seen_content_score=null（初回due）は軽量パス（computeBaselineScore）へ分岐し、LLM・履歴・メールなしにlast_seen_content_scoreのみ更新する。1,000行上限の取りこぼしはskippedDueToLimitへ合算される（D10再反転の回帰防止・🔴指摘#4）', async () => {
    const dueRow = {
      id: 'cycle-1',
      user_id: 'user-1',
      content_annotation_id: 'annotation-1',
      base_evaluation_date: '2020-01-01',
      cycle_days: 30,
      evaluation_hour: 0,
      ga4_last_evaluated_on: null,
      ga4_last_seen_content_score: null,
      ga4_next_evaluation_date: '2020-01-31', // 過去日なので必ずdue（時刻判定を経由しない）
    };
    // count(5) > 実際に返った行数(1) のため truncated 扱いになる（listDueEvaluations の再現）
    mockRpcRange({ data: [dueRow], error: null, count: 5 });
    mocks.computeBaselineScore.mockResolvedValue({ status: 'scored', contentScore: 55 });

    const result = await ga4ContentEvaluationBatchService.runAllDueEvaluations();

    // 軽量パスはフルパス run() を呼ばない
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.computeBaselineScore).toHaveBeenCalledTimes(1);
    expect(result.articlesEvaluated).toBe(1);
    // articlesEvaluated の内数として、軽量パス成立件数を別カウンタでも観測できる
    // （レビュー指摘。GSCのbaselineInitializedと同じ役割。§8.3可観測性）
    expect(result.articlesBaselineInitialized).toBe(1);
    expect(result.articlesFailed).toBe(0);
    // 軽量パスは履歴行・メールを生成しない結末（baseline_initialized）なので送信されない
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    // 指摘#4: 1,000行上限の取りこぼし件数（5 - 1 = 4）が skippedDueToLimit に合算される
    expect(result.skippedDueToLimit).toBe(4);

    // last_evaluated_on の更新（クールダウン進行）と同時に last_seen_content_score も
    // computeBaselineScore の結果で更新される
    const cooldownUpdate = mocks.updateCalls.find(payload => 'ga4_last_evaluated_on' in payload);
    expect(cooldownUpdate).toEqual({
      ga4_last_evaluated_on: expect.any(String),
      ga4_last_seen_content_score: 55,
    });
  });

  it('GSCバッチが last_evaluated_on を進めても、GA4のdue判定と書き込みは ga4_ 列だけを見る（サイクル統合の核心）', async () => {
    // gsc-evaluate と ga4-content-evaluate は hourly-cron.yml の matrix で互いをブロックせず、
    // 起動順は非決定的。両者が last_evaluated_on を共用すると、先に走った方がそれを today へ
    // 進めて生成列 next_evaluation_date が +cycle_days 跳ぶため、負けた方はそのサイクルを
    // 丸ごと飛ばす。設定は共有・進捗は系統別、という分離が壊れていないことを固定する。
    const dueRow = {
      id: 'cycle-1',
      user_id: 'user-1',
      content_annotation_id: 'annotation-1',
      base_evaluation_date: '2020-01-01',
      cycle_days: 30,
      evaluation_hour: 0,
      // GSC側は既に今日まで進んでいる（GSCバッチが先に走った直後の状態）。
      // それでもGA4は ga4_last_evaluated_on が古いままなので due でなければならない
      ga4_last_evaluated_on: '2020-01-01',
      ga4_last_seen_content_score: 40,
      ga4_next_evaluation_date: '2020-01-31',
    };
    mockRpcRange({ data: [dueRow], error: null, count: 1 });
    mocks.run.mockResolvedValue(buildEvaluatedView(70));

    const result = await ga4ContentEvaluationBatchService.runAllDueEvaluations();

    // due 抽出は GA4 専用のRPCを使う（GSCの生成列 next_evaluation_date は見ない）
    expect(mocks.rpc).toHaveBeenCalledWith(
      'list_due_ga4_content_evaluations',
      { p_today_jst: expect.any(String) },
      { count: 'exact' }
    );
    expect(result.articlesEvaluated).toBe(1);
    expect(result.articlesSkippedCooldown).toBe(0);

    // 書き込みも ga4_ 列だけ。GSCの last_evaluated_on / last_seen_position には触れない
    const cooldownUpdate = mocks.updateCalls.find(payload => 'ga4_last_evaluated_on' in payload);
    expect(cooldownUpdate).toEqual({
      ga4_last_evaluated_on: expect.any(String),
      ga4_last_seen_content_score: 70,
    });
    for (const payload of mocks.updateCalls) {
      expect(payload).not.toHaveProperty('last_evaluated_on');
      expect(payload).not.toHaveProperty('last_seen_position');
    }
  });

  it('軽量パス（computeBaselineScore）がlow_data/import_failedを返した場合もクールダウンは進むが、last_seen_content_scoreは更新しない（次回dueで再び軽量パスに入り再試行できる）', async () => {
    const lowDataRow = {
      id: 'cycle-low',
      user_id: 'user-low',
      content_annotation_id: 'annotation-low',
      base_evaluation_date: '2020-01-01',
      cycle_days: 30,
      evaluation_hour: 0,
      ga4_last_evaluated_on: null,
      ga4_last_seen_content_score: null,
      ga4_next_evaluation_date: '2020-01-31',
    };
    mockRpcRange({ data: [lowDataRow], error: null, count: 1 });
    mocks.computeBaselineScore.mockResolvedValue({ status: 'low_data', contentScore: null });

    const result = await ga4ContentEvaluationBatchService.runAllDueEvaluations();

    expect(result.articlesEvaluated).toBe(1);
    // low_data はbaseline_initializedではないため観測用カウンタは増えない
    expect(result.articlesBaselineInitialized).toBe(0);
    expect(result.articlesFailed).toBe(0);
    const cooldownUpdate = mocks.updateCalls.find(payload => 'ga4_last_evaluated_on' in payload);
    // contentScore が undefined のときは last_seen_content_score をペイロードに含めない
    // （advanceCooldown の仕様。null で上書きせず既存値=nullのまま維持する）
    expect(cooldownUpdate).toEqual({ ga4_last_evaluated_on: expect.any(String) });
  });

  it('軽量パスで last_seen_content_score が埋まった後の次回dueは、フルパス（run()）で評価される（GSCの2回目以降と同型）', async () => {
    // 1回目: last_seen_content_score=null（初回due）→ 軽量パス
    const firstRow = {
      id: 'cycle-transition',
      user_id: 'user-transition',
      content_annotation_id: 'annotation-transition',
      base_evaluation_date: '2020-01-01',
      cycle_days: 30,
      evaluation_hour: 0,
      ga4_last_evaluated_on: null,
      ga4_last_seen_content_score: null,
      ga4_next_evaluation_date: '2020-01-31',
    };
    mockRpcRange({ data: [firstRow], error: null, count: 1 });
    mocks.computeBaselineScore.mockResolvedValue({ status: 'scored', contentScore: 45 });

    const firstResult = await ga4ContentEvaluationBatchService.runAllDueEvaluations();

    expect(mocks.computeBaselineScore).toHaveBeenCalledTimes(1);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(firstResult.articlesBaselineInitialized).toBe(1);

    // 2回目: 1回目のbaseline成功で last_seen_content_score が埋まった状態（次回due）→ フルパス
    vi.clearAllMocks();
    mocks.updateCalls.length = 0;
    mocks.syncUser.mockResolvedValue(undefined);
    const secondRow = { ...firstRow, ga4_last_evaluated_on: '2020-01-31', ga4_last_seen_content_score: 45 };
    mockRpcRange({ data: [secondRow], error: null, count: 1 });
    mocks.run.mockResolvedValue(buildEvaluatedView(60));

    const result = await ga4ContentEvaluationBatchService.runAllDueEvaluations();

    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.computeBaselineScore).not.toHaveBeenCalled();
    expect(result.articlesEvaluated).toBe(1);
    // フルパスはbaseline_initializedではないため観測用カウンタは増えない
    expect(result.articlesBaselineInitialized).toBe(0);
  });

  it('通知メールの「次回評価予定」は advanceCooldown 後の日付（todayJst + cycle_days）で組み立てられ、処理済みのdue日（過去日）を再掲しない（高重要度指摘の回帰防止）', async () => {
    const cycleDays = 14;
    const dueRow = {
      id: 'cycle-2',
      user_id: 'user-2',
      content_annotation_id: 'annotation-2',
      base_evaluation_date: '2020-01-01',
      cycle_days: cycleDays,
      evaluation_hour: 0,
      ga4_last_evaluated_on: '2020-01-17',
      ga4_last_seen_content_score: 40, // ベースライン済み（2回目以降のdue）なのでフルパスへ進む
      ga4_next_evaluation_date: '2020-01-31', // 過去日なので必ずdue。この日付がメールへ再掲されると不具合
    };
    mockRpcRange({ data: [dueRow], error: null, count: 1 });
    mocks.run.mockResolvedValue(buildEvaluatedView(70));
    mocks.userEmail = 'user@example.test';
    mocks.sendEmail.mockResolvedValue({ success: true });

    const todayJst = formatJstDateISO(new Date());
    const expectedNextDate = addDaysISO(todayJst, cycleDays).replaceAll('-', '/');
    const staleDate = dueRow.ga4_next_evaluation_date.replaceAll('-', '/');

    await ga4ContentEvaluationBatchService.runAllDueEvaluations();

    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    const [, , html] = mocks.sendEmail.mock.calls[0] as [string, string, string, string];
    expect(html).toContain(`次回評価予定: ${expectedNextDate}`);
    expect(html).not.toContain(`次回評価予定: ${staleDate}`);
  });

  it('件数上限に達したら後続ユーザーの同期を行わず打ち切る（Cursor Bugbot指摘の回帰防止）', async () => {
    const userACycles = Array.from({ length: 20 }, (_, i) => ({
      id: `cycle-a-${i}`,
      user_id: 'user-a',
      content_annotation_id: `annotation-a-${i}`,
      base_evaluation_date: '2020-01-01',
      cycle_days: 30,
      evaluation_hour: 0,
      ga4_last_evaluated_on: '2020-01-01',
      ga4_last_seen_content_score: 40, // ベースライン済み。フルパス(run())を経由させ既存の上限テストを維持する
      ga4_next_evaluation_date: '2020-01-31',
    }));
    const userBCycle = {
      id: 'cycle-b-0',
      user_id: 'user-b',
      content_annotation_id: 'annotation-b-0',
      base_evaluation_date: '2020-01-01',
      cycle_days: 30,
      evaluation_hour: 0,
      ga4_last_evaluated_on: '2020-01-01',
      ga4_last_seen_content_score: 40,
      ga4_next_evaluation_date: '2020-01-31',
    };
    mockRpcRange({ data: [...userACycles, userBCycle], error: null, count: 21 });
    mocks.run.mockResolvedValue(buildEvaluatedView(60));
    // シャッフルで user-a が必ず先頭に来るよう固定する（Fisher-Yates を no-op にする）。
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);

    try {
      const result = await ga4ContentEvaluationBatchService.runAllDueEvaluations();

      // MAX_ARTICLES_PER_BATCH(20) に達した時点で打ち切り、user-b の syncUser は呼ばれない
      expect(mocks.syncUser).toHaveBeenCalledTimes(1);
      expect(mocks.syncUser).toHaveBeenCalledWith('user-a');
      expect(result.articlesEvaluated).toBe(20);
      expect(result.stoppedReason).toBe('max_articles');
      expect(result.skippedDueToLimit).toBe(1);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('syncUserが例外を投げず{ok:false}を返した場合もsyncFailedとして扱う（Codex指摘の回帰防止）', async () => {
    const todayJst = formatJstDateISO(new Date());
    const dueRow = {
      id: 'cycle-3',
      user_id: 'user-3',
      content_annotation_id: 'annotation-3',
      base_evaluation_date: '2020-01-01',
      cycle_days: 30,
      evaluation_hour: 0,
      ga4_last_evaluated_on: '2020-01-01',
      ga4_last_seen_content_score: 40, // ベースライン済み。フルパス(run())を経由させ既存のsyncFailedテストを維持する
      ga4_next_evaluation_date: todayJst, // withholdForSyncFailure の判定に today と一致させる必要がある
    };
    mockRpcRange({ data: [dueRow], error: null, count: 1 });
    mocks.syncUser.mockResolvedValue({ ok: false, reason: 'not_connected' });
    mocks.run.mockResolvedValue(buildEvaluatedView(60));

    const result = await ga4ContentEvaluationBatchService.runAllDueEvaluations();

    expect(result.syncFailedUsers).toBe(1);
    // §6.6.4: 当日中のsyncFailedはクールダウンを進めない・メールも送らない
    expect(result.articlesSkippedSyncFailed).toBe(1);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    const cooldownUpdate = mocks.updateCalls.find(payload => 'ga4_last_evaluated_on' in payload);
    expect(cooldownUpdate).toBeUndefined();
  });
});
