import { z } from 'zod';

export const summarizeContentAnnotationSchema = z.object({
  sessionId: z.string().min(1, 'セッションIDが必要です'),
});

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
