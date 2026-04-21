import { z } from 'zod';

export const updateGoogleAdsEvaluationSettingsSchema = z
  .object({
    dateRangeDays: z
      .number()
      .int('日数は整数で入力してください')
      .min(1, '日数は1日以上である必要があります')
      .max(365, '日数は365日以下である必要があります')
      .optional(),
    cronEnabled: z.boolean().optional(),
  })
  .refine(value => value.dateRangeDays !== undefined || value.cronEnabled !== undefined, {
    message: '更新対象が指定されていません',
  });

export type UpdateGoogleAdsEvaluationSettingsSchemaInput = z.infer<
  typeof updateGoogleAdsEvaluationSettingsSchema
>;
