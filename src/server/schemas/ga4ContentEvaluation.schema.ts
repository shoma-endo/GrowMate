import { z } from 'zod';

const ga4EvaluationNarrativeSchema = z.object({
  headline: z.string().max(20),
  situation: z.string().max(80),
  cause: z.string().max(80),
  next_action: z.string().max(60),
  target: z.string().max(40),
}).strict();

export const ga4EvaluationLlmOutputSchema = ga4EvaluationNarrativeSchema;

export const ga4ContentEvaluationInputSchema = z.object({
  annotationId: z.uuidv4(),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
}).superRefine((data, ctx) => {
  if (data.startDate > data.endDate) {
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: '評価対象期間が不正です' });
    return;
  }
  const start = Date.parse(`${data.startDate}T00:00:00Z`);
  const end = Date.parse(`${data.endDate}T00:00:00Z`);
  const days = Math.floor((end - start) / 86_400_000) + 1;
  if (days > 90) {
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: '評価対象期間は最大90日です' });
  }
});

export const ga4ContentEvaluationAnnotationIdSchema = z.uuidv4();

export type Ga4EvaluationNarrative = z.infer<typeof ga4EvaluationNarrativeSchema>;
