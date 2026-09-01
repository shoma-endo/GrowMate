'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import type { ServerActionResult } from '@/lib/async-handler';
import { MAX_BULK_SUMMARY_TARGETS } from '@/lib/constants';
import { canWriteGa4 } from '@/server/lib/ga4-permissions';
import {
  chunkIds,
  ID_QUERY_CHUNK_SIZE,
  normalizeBulkTargetIds,
} from '@/server/lib/gsc-bulk-evaluation';
import {
  computeSummaryItemBudgetMs,
  isGeneratedSummaryEmpty,
  isSummaryEmpty,
  isWordPressLinkedForSummary,
  orderTargetsForProcessing,
  SUMMARY_TARGET_FIELD_KEYS,
  type BulkSummaryResult,
  type SummaryFailureCode,
  type SummaryTargetFieldKey,
  type BulkSummaryStoppedReason,
} from '@/server/lib/content-annotation-bulk-summary';
import { isWithAuthEmailLinkConflict, withAuth } from '@/server/middleware/withAuth.middleware';
import { analyticsContentService } from '@/server/services/analyticsContentService';
import {
  contentAnnotationSummaryService,
  type GenerateSummaryResult,
} from '@/server/services/contentAnnotationSummaryService';
import { SupabaseService } from '@/server/services/supabaseService';

/**
 * AI 要約一括実行の Server Action。
 * 正本: docs/plans/content-annotation-bulk-ai-summary-spec.md
 *
 * 評価サイクル一括開始（`registerEvaluationsBulk`）とは処理を統合しない（BR-09）。
 * 対象選定・スキップ判定・件数集計は本 Action が持ち、要約そのものは単記事コア
 * （`generateSummary` / `saveSummary`）を再利用する（FR-004）。
 */

const supabaseService = new SupabaseService();

/** 対象行の取得に必要な列だけを引く（本文は引かない。取得は単記事コアが行う） */
const TARGET_COLUMNS = ['id', 'updated_at', 'wp_post_id', 'canonical_url']
  .concat(SUMMARY_TARGET_FIELD_KEYS)
  .join(', ');

/**
 * 実行直前に取り直す行。**8項目を型に明示する**こと。
 * `isSummaryEmpty` が手入力値の上書きを防ぐ唯一のガードで、その入力がこの型だから。
 * 8項目を型から落とすと、TypeScript 上は常に undefined＝空となり `isSummaryEmpty` が
 * 常に true になる。誰かが `TARGET_COLUMNS` から列を削っても型検査で気づけない状態にしない。
 */
type BulkSummaryTargetRow = {
  id: string;
  updated_at: string | null;
  wp_post_id: number | null;
  canonical_url: string | null;
} & Record<SummaryTargetFieldKey, string | null>;

const bulkSummaryInputSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('ids'),
    contentAnnotationIds: z.array(z.uuidv4()),
  }),
  z.object({
    mode: z.literal('all'),
    /** 全選択したまま個別解除した記事（評価親 BR-07「全選択後の個別解除」）。母集団から差し引く */
    excludedIds: z.array(z.uuidv4()).optional(),
  }),
]);

/**
 * 1件の要約に上限時間を掛ける。LLM の timeoutMs だけでは WordPress 本文取得（タイムアウト無し）
 * を閉じられず、ハングすると maxDuration でハードキルされてレスポンスごと失われるため、
 * 1件全体を `Promise.race` で打ち切る（`googleAdsNegativeKeywordsSuggestionService`
 * の `runWithUserTimeLimit` と同型）。
 *
 * 打ち切っても裏の fetch は走り続けるが、目的は**関数の応答を守ること**であり、
 * 成功済みの件数を利用者へ返せる状態を維持する。
 */
async function runWithItemTimeLimit(
  work: Promise<GenerateSummaryResult>,
  timeLimitMs: number,
  annotationId: string
): Promise<GenerateSummaryResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<GenerateSummaryResult>(resolve => {
        timer = setTimeout(() => {
          console.error('[content-annotation-bulk-summary] item time limit reached:', {
            annotationId,
            timeLimitMs,
          });
          resolve({ success: false, code: 'SUMMARY_CONTENT_FETCH_FAILED' });
        }, timeLimitMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function summarizeContentAnnotationsBulk(
  params: unknown
): Promise<ServerActionResult<BulkSummaryResult>> {
  const startedAt = Date.now();

  const parsed = bulkSummaryInputSchema.safeParse(params);
  if (!parsed.success) {
    console.error(
      '[content-annotation-bulk-summary] validation failed:',
      z.prettifyError(parsed.error)
    );
    return { success: false, error: ERROR_MESSAGES.COMMON.VALIDATION_FAILED };
  }
  const input = parsed.data;

  try {
    const authResult = await withAuth(async ({ userId, cookieStore, userDetails }) => {
      if (!canWriteGa4({ role: userDetails?.role ?? null })) {
        console.error('[content-annotation-bulk-summary] forbidden role:', {
          role: userDetails?.role ?? null,
        });
        return { success: false as const, error: ERROR_MESSAGES.GA4.FEATURE_ACCESS_DENIED };
      }

      // ---- 対象 ID の解決 -------------------------------------------------
      let candidateIds: string[];
      if (input.mode === 'ids') {
        candidateIds = normalizeBulkTargetIds(input.contentAnnotationIds);
        if (candidateIds.length === 0) {
          return {
            success: false as const,
            error: ERROR_MESSAGES.WORDPRESS.SUMMARY_BULK_TARGETS_REQUIRED,
          };
        }
        if (candidateIds.length > MAX_BULK_SUMMARY_TARGETS) {
          return {
            success: false as const,
            error: ERROR_MESSAGES.WORDPRESS.SUMMARY_BULK_TARGETS_LIMIT_EXCEEDED,
          };
        }
      } else {
        const population = await analyticsContentService.resolveAllAnnotationIds(
          userId,
          MAX_BULK_SUMMARY_TARGETS
        );
        if (!population) {
          console.error('[content-annotation-bulk-summary] population resolve failed');
          return {
            success: false as const,
            error: ERROR_MESSAGES.WORDPRESS.SUMMARY_BULK_POPULATION_MISMATCH,
          };
        }
        // 突合（R-002）は除外を差し引く前の母集団に対して行う。除外は利用者の意思なので
        // 「取得できた件数が想定と食い違う」障害とは区別する
        const expectedCount = Math.min(population.total, MAX_BULK_SUMMARY_TARGETS);
        if (population.ids.length !== expectedCount) {
          console.error('[content-annotation-bulk-summary] population count mismatch:', {
            resolved: population.ids.length,
            expected: expectedCount,
            total: population.total,
          });
          return {
            success: false as const,
            error: ERROR_MESSAGES.WORDPRESS.SUMMARY_BULK_POPULATION_MISMATCH,
          };
        }
        const excluded = new Set(normalizeBulkTargetIds(input.excludedIds ?? []));
        candidateIds = population.ids.filter(id => !excluded.has(id));
        if (candidateIds.length === 0) {
          return {
            success: false as const,
            error: ERROR_MESSAGES.WORDPRESS.SUMMARY_BULK_TARGETS_REQUIRED,
          };
        }
      }

      // ---- 実行直前の再取得（BR-01） --------------------------------------
      // 単記事コアは充填チェックを持たず saveSummary は無条件 UPDATE なので、
      // ここで8項目を取り直さないと手入力値を黙って上書きする（履歴が無く復旧できない）。
      // 所有権もこのクエリの user_id 一致で担保する。
      const rows: BulkSummaryTargetRow[] = [];
      for (const chunk of chunkIds(candidateIds, ID_QUERY_CHUNK_SIZE)) {
        const { data, error } = await supabaseService
          .getClient()
          .from('content_annotations')
          .select(TARGET_COLUMNS)
          .eq('user_id', userId)
          .in('id', chunk);
        if (error) {
          throw new Error(error.message);
        }
        for (const row of (data ?? []) as unknown as BulkSummaryTargetRow[]) {
          rows.push(row);
        }
      }

      const result: BulkSummaryResult = {
        succeededCount: 0,
        failedCount: 0,
        failedByCode: {},
        skippedCount: 0,
        unprocessedCount: 0,
        stoppedReason: 'completed',
      };
      const fail = (code: SummaryFailureCode) => {
        result.failedCount += 1;
        result.failedByCode[code] = (result.failedByCode[code] ?? 0) + 1;
      };

      // 取り直しで消えた ID（他人の記事・削除済み）は失敗に計上する
      for (let i = rows.length; i < candidateIds.length; i += 1) {
        fail('NOT_OWNED');
      }

      // 未要約（BR-02）でない記事は対象外としてスキップする。BR-02 は「8項目すべて空」と
      // 「WordPress 連携済み」の両方なので、片方だけで判定すると全選択（母集団はフィルタ
      // 非依存の全記事）に WordPress 未連携の空欄記事が混ざり、SUMMARY_SOURCE_NOT_LINKED で
      // 失敗に計上されてしまう。仕様 §6 誤読罠「未要約フィルタは WordPress 未連携を含まない。
      // 連携前の空欄記事は対象外」と食い違い、インポート前の記事が多い利用者ほど
      // 失敗件数が水増しされて AC-04 の件数通知の意味が壊れる。
      // どちらも「再実行しても変わらない対象外」なのでスキップに寄せる（未実行とは別物）。
      //
      // **ループの前に全件を振り分ける。** ループ内で判定すると、予算切れの時点で未検査の
      // 記事がすべて未実行に計上される。全選択（母集団は全記事）では未検査の大半がスキップ
      // 対象になりうるので、「未実行 697 件」と案内したのに再実行で2件しか進まない、という
      // 数字の意味が壊れた通知になる。
      const workable: BulkSummaryTargetRow[] = [];
      for (const row of rows) {
        if (isSummaryEmpty(row) && isWordPressLinkedForSummary(row)) {
          workable.push(row);
        } else {
          result.skippedCount += 1;
        }
      }

      // 処理順は updated_at 昇順（古い順）。降順のままだと、本文取得だけ成功して
      // updated_at が最新化された失敗記事が次回実行でキュー先頭に戻る（§6 実行順序 / R-001）
      const targets = orderTargetsForProcessing(workable);

      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index];
        if (!target) continue;

        const budget = computeSummaryItemBudgetMs(Date.now() - startedAt);
        if (budget === null) {
          // 着手すると maxDuration を超えうるので、残りは未実行として返す（BR-03）。
          // targets はスキップ対象を除いた「実際に要約する記事」だけなので、
          // この件数はそのまま「再実行すれば進む件数」になる
          result.unprocessedCount = targets.length - index;
          result.stoppedReason = 'time_budget' satisfies BulkSummaryStoppedReason;
          break;
        }

        // 1件の例外でループ全体を落とさない。落とすと withAuth が素通しして外側 catch に入り、
        // 成功分は DB にコミット済みなのに件数通知が返らず、利用者は何件成功したか分からない
        // （runWithItemTimeLimit がハング経路で守っている性質を、throw 経路でも守る）
        try {
          const generated = await runWithItemTimeLimit(
            contentAnnotationSummaryService.generateSummary({
              target: { annotationId: target.id },
              executorUserId: userId,
              cookieStore,
              llmTimeoutMs: budget.llmMs,
            }),
            budget.itemMs,
            target.id
          );
          if (!generated.success) {
            console.error('[content-annotation-bulk-summary] generate failed:', {
              annotationId: target.id,
              code: generated.code,
            });
            fail(generated.code);
            continue;
          }

          // 8項目すべて空を成功に数えると記事は未要約のまま残り、再実行のたびに
          // WordPress 取得と Claude 呼び出しを繰り返す（AC-04b / R-004）
          if (isGeneratedSummaryEmpty(generated.fields)) {
            console.error('[content-annotation-bulk-summary] empty summary:', {
              annotationId: target.id,
            });
            fail('EMPTY_SUMMARY');
            continue;
          }

          const saved = await contentAnnotationSummaryService.saveSummary({
            annotationId: generated.annotationId,
            userId: generated.userId,
            fields: generated.fields,
          });
          if (!saved.success) {
            console.error('[content-annotation-bulk-summary] save failed:', {
              annotationId: target.id,
            });
            fail('SAVE_FAILED');
            continue;
          }

          result.succeededCount += 1;
        } catch (error) {
          console.error('[content-annotation-bulk-summary] item threw:', {
            annotationId: target.id,
            error,
          });
          fail('UNEXPECTED');
        }
      }

      revalidatePath('/analytics');
      return { success: true as const, data: result };
    });

    if (isWithAuthEmailLinkConflict(authResult)) {
      return { success: false, error: authResult.error, emailLinkConflict: true };
    }
    return authResult;
  } catch (error) {
    console.error('[content-annotation-bulk-summary] bulk summarize failed:', error);
    return { success: false, error: ERROR_MESSAGES.WORDPRESS.SUMMARY_BULK_FAILED };
  }
}
