import { z } from 'zod';

export const updateGoogleAdsEvaluationSettingsSchema = z
  .object({
    dateRangeDays: z.number().int().min(1).max(365).optional(),
    cronEnabled: z.boolean().optional(),
  })
  .refine(value => value.dateRangeDays !== undefined || value.cronEnabled !== undefined, {
    message: '更新対象が指定されていません',
  });

export type UpdateGoogleAdsEvaluationSettingsSchemaInput = z.infer<
  typeof updateGoogleAdsEvaluationSettingsSchema
>;
