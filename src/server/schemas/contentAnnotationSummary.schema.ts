import { z } from 'zod';

export const summarizeContentAnnotationSchema = z
  .object({
    sessionId: z.string().min(1).optional(),
    annotationId: z.string().min(1).optional(),
  })
  .superRefine((value, context) => {
    if (Boolean(value.sessionId) === Boolean(value.annotationId)) {
      context.addIssue({
        code: 'custom',
        message: 'セッションIDまたはアノテーションIDのいずれか一方が必要です',
      });
    }
  })
  .transform(value =>
    value.annotationId
      ? ({ annotationId: value.annotationId } as const)
      : ({ sessionId: value.sessionId! } as const)
  );

export type SummarizeContentAnnotationTarget = z.infer<
  typeof summarizeContentAnnotationSchema
>;

const contentAnnotationAiSummarySchema = z.object({
  main_kw: z.string(),
  kw: z.string(),
  needs: z.string(),
  persona: z.string(),
  goal: z.string(),
  prep: z.string(),
  opening_proposal: z.string(),
});

export type ContentAnnotationAiSummaryFields = z.infer<typeof contentAnnotationAiSummarySchema>;

export { contentAnnotationAiSummarySchema };
