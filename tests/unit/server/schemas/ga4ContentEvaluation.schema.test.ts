import { describe, expect, it } from 'vitest';

import {
  ga4ContentEvaluationInputSchema,
  ga4EvaluationLlmOutputSchema,
} from '@/server/schemas/ga4ContentEvaluation.schema';

const valid = {
  headline: '見出し',
  situation: '状況',
  cause: '原因',
  next_action: '次の一手',
  target: '対象',
};

describe('ga4ContentEvaluation.schema', () => {
  it('5フィールドを検証し、スコア項目を受け付けない', () => {
    expect(ga4EvaluationLlmOutputSchema.safeParse(valid).success).toBe(true);
    expect(ga4EvaluationLlmOutputSchema.safeParse({ ...valid, headline: 'x'.repeat(121) }).success).toBe(false);
    expect(ga4EvaluationLlmOutputSchema.safeParse({ ...valid, score: 99, pattern: 'R_GOOD' }).success).toBe(false);
    expect(ga4EvaluationLlmOutputSchema.safeParse({ ...valid, cause: undefined }).success).toBe(false);
  });

  it('評価期間は90日以内かつ開始日以前の終了日を要求する', () => {
    expect(ga4ContentEvaluationInputSchema.safeParse({
      annotationId: '00000000-0000-4000-8000-000000000001',
      startDate: '2026-01-01',
      endDate: '2026-03-31',
    }).success).toBe(true);
    expect(ga4ContentEvaluationInputSchema.safeParse({
      annotationId: '00000000-0000-4000-8000-000000000001',
      startDate: '2026-01-01',
      endDate: '2026-04-01',
    }).success).toBe(false);
    expect(ga4ContentEvaluationInputSchema.safeParse({
      annotationId: '00000000-0000-4000-8000-000000000001',
      startDate: '2026-04-01',
      endDate: '2026-03-31',
    }).success).toBe(false);
  });
});
