import { describe, expect, it } from 'vitest';

import type { Ga4ContentEvaluationScheduleDatabase } from '@/types/database.types.pending';

/**
 * 生成型の取りこぼし補正が「効いていること」を型レベルで固定する。
 *
 * `supabase gen types` は `returns table(...)` の各列を非 null として出力するため、
 * 実際には null を返す `ga4_last_evaluated_on` / `ga4_last_seen_content_score` が
 * 非 null になる。これを補正しているが、**交差（`&`）で合成すると
 * `string & (string | null)` = `string` に潰れて無言で無効化される**。
 * 実際 2026-09-01 まで潰れており、型が付いているように見えて何も守っていなかった。
 *
 * 潰れても実行時は動いてしまい、初回評価前の行（`ga4_last_evaluated_on is null`）を
 * 踏んだときだけ壊れるので、テストで固定しないと再発に気づけない。
 * 判定は `@ts-expect-error` が担う（誤りが消えると `npm run build` の tsc が落ちる）。
 */
type DueRow =
  Ga4ContentEvaluationScheduleDatabase['public']['Functions']['list_due_ga4_content_evaluations']['Returns'][number];

// @ts-expect-error ga4_last_evaluated_on は null を含むので string に代入できない
const _dateMustNotBeNonNull: string = null as unknown as DueRow['ga4_last_evaluated_on'];
void _dateMustNotBeNonNull;

// @ts-expect-error ga4_last_seen_content_score は null を含むので number に代入できない
const _scoreMustNotBeNonNull: number = null as unknown as DueRow['ga4_last_seen_content_score'];
void _scoreMustNotBeNonNull;

// 補正後の正しい型
const _dateIsNullable: string | null = null as unknown as DueRow['ga4_last_evaluated_on'];
void _dateIsNullable;
const _scoreIsNullable: number | null = null as unknown as DueRow['ga4_last_seen_content_score'];
void _scoreIsNullable;

// coalesce で算出する列は非 null のままで正しい（補正しすぎていないこと）
const _nextDateIsNonNull: string = null as unknown as DueRow['ga4_next_evaluation_date'];
void _nextDateIsNonNull;

describe('list_due_ga4_content_evaluations の戻り値型', () => {
  it('null 許容の補正が交差で潰されていない（判定は上の @ts-expect-error）', () => {
    // tsc が通った時点で成立している。vitest からは到達確認だけ行う
    expect(true).toBe(true);
  });
});
