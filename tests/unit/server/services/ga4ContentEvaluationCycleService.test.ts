import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ga4ContentEvaluationView } from '@/types/ga4-evaluation';

// 再レビューで指摘された🟡#4「last_seen_content_score継続更新・truncatedCandidates合算の
// 退行検知手段がない」への対応。Supabaseクライアントを最小限のフェイクで模倣し、
// runAllDueEvaluations() を実際に走らせて2つの回帰を防ぐ。

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  syncUser: vi.fn(),
  rpc: vi.fn(),
  updateCalls: [] as Record<string, unknown>[],
}));

vi.mock('@/server/services/ga4ContentEvaluationService', () => ({
  ga4ContentEvaluationService: { run: mocks.run },
}));
vi.mock('@/server/services/ga4ImportService', () => ({
  ga4ImportService: { syncUser: mocks.syncUser },
}));
// ga4ContentEvaluationCycleService は emailService 経由で @/env を読み込む（RESEND_API_KEY等）。
// このテストはメール未登録（送信されない）経路しか通らないため値はダミーでよい。
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
            if (table === 'ga4_content_evaluation_cycles') {
              return new FakeQuery({ data: { last_notified_history_id: null }, error: null });
            }
            if (table === 'users') {
              return new FakeQuery({ data: { email: null }, error: null });
            }
            throw new Error(`unexpected table: ${table}`);
          },
        };
      }
    },
  };
});

import { ga4ContentEvaluationCycleService } from '@/server/services/ga4ContentEvaluationCycleService';

function buildEvaluatedView(contentScore: number): Ga4ContentEvaluationView {
  const freshStartedAt = new Date(Date.now() + 60_000).toISOString();
  return {
    settingsEnabled: true,
    displayStatus: 'evaluated',
    needsReauth: false,
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
        promptVersion: null,
        promptTemplateId: null,
        promptVersionId: null,
        promptCapturedAt: null,
        promptContentSha256: null,
        inputFingerprint: null,
        scoringConfigVersion: 1,
        errorCode: null,
      },
    ],
  };
}

describe('ga4ContentEvaluationCycleService.runAllDueEvaluations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateCalls.length = 0;
    mocks.syncUser.mockResolvedValue(undefined);
  });

  it('登録時ベースライン失敗（last_seen_content_score=null）でもバッチの評価成功時にlast_seen_content_scoreが更新され、1,000行上限の取りこぼしがskippedDueToLimitへ合算される（🔴指摘#1・#4の回帰防止）', async () => {
    const dueRow = {
      id: 'cycle-1',
      user_id: 'user-1',
      content_annotation_id: 'annotation-1',
      base_evaluation_date: '2020-01-01',
      cycle_days: 30,
      evaluation_hour: 0,
      last_evaluated_on: null,
      next_evaluation_date: '2020-01-31', // 過去日なので必ずdue（時刻判定を経由しない）
    };
    // count(5) > 実際に返った行数(1) のため truncated 扱いになる（listDueCycles の再現）
    mocks.rpc.mockResolvedValue({ data: [dueRow], error: null, count: 5 });
    mocks.run.mockResolvedValue(buildEvaluatedView(55));

    const result = await ga4ContentEvaluationCycleService.runAllDueEvaluations();

    expect(result.articlesEvaluated).toBe(1);
    expect(result.articlesFailed).toBe(0);
    // 指摘#4: 1,000行上限の取りこぼし件数（5 - 1 = 4）が skippedDueToLimit に合算される
    expect(result.skippedDueToLimit).toBe(4);

    // 指摘#1: last_evaluated_on の更新（クールダウン進行）と同時に last_seen_content_score も
    // 評価結果のスコアで更新される（登録時のベースライン取得失敗を後続バッチが解消できる）
    const cooldownUpdate = mocks.updateCalls.find(payload => 'last_evaluated_on' in payload);
    expect(cooldownUpdate).toEqual({
      last_evaluated_on: expect.any(String),
      last_seen_content_score: 55,
    });
  });
});
