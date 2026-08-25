import { z } from 'zod';

const cycleDaysSchema = z.number().int().min(1).max(365);
const evaluationHourSchema = z.number().int().min(0).max(23);

export const ga4ContentEvaluationCycleAnnotationIdSchema = z.uuidv4();

export const ga4ContentEvaluationCycleRegisterInputSchema = z.object({
  annotationId: z.uuidv4(),
  baseEvaluationDate: z.iso.date(),
  cycleDays: cycleDaysSchema.default(30),
  evaluationHour: evaluationHourSchema.default(12),
}).strict();

export const ga4ContentEvaluationCycleUpdateInputSchema = z.object({
  annotationId: z.uuidv4(),
  baseEvaluationDate: z.iso.date(),
  cycleDays: cycleDaysSchema.default(30),
  evaluationHour: evaluationHourSchema.default(12),
}).strict();

export type Ga4ContentEvaluationCycleRegisterInput = z.infer<typeof ga4ContentEvaluationCycleRegisterInputSchema>;
export type Ga4ContentEvaluationCycleUpdateInput = z.infer<typeof ga4ContentEvaluationCycleUpdateInputSchema>;
